"""Apply a generated patch to the source repo with a backup so it can be rolled back.

This replaces the git-branch-based delivery for cases where the user just wants
the AI's changes written to their working tree directly. Before any file is
modified or created, the prior state is snapshotted under
``artifacts/<run_id>/source_backup/``. A rollback API later reads that snapshot
to restore the source tree to its pre-application state.
"""
from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("devflow.source_apply")


_MANIFEST_FILENAME = "_manifest.json"


def apply_to_source(
    source_repo: str,
    patch_text: str,
    run_id: str,
    artifacts_dir: Path,
) -> dict[str, Any]:
    """Snapshot affected files, then apply the patch to the source repo.

    Returns ``{status, applied_files, backup_dir, error, ...}``. ``status`` is
    one of: ``applied``, ``skipped``, ``failed``.
    """
    result: dict[str, Any] = {
        "status": "pending",
        "run_id": run_id,
        "source_repo": str(Path(source_repo).resolve()),
        "applied_files": [],
        "backup_dir": "",
        "error": "",
        "applied_at": _now(),
    }

    if not patch_text.strip():
        result.update({"status": "skipped", "error": "Empty patch — nothing to apply."})
        return result

    repo = Path(source_repo).resolve()
    if not repo.exists() or not repo.is_dir():
        result.update({"status": "failed", "error": f"source_repo not found: {repo}"})
        return result

    backup_root = Path(artifacts_dir) / "source_backup"
    backup_root.mkdir(parents=True, exist_ok=True)
    result["backup_dir"] = str(backup_root)

    file_ops = _changed_paths_with_ops(patch_text)
    if not file_ops:
        result.update({"status": "skipped", "error": "Patch contained no recognisable file changes."})
        return result

    # Phase 1 — snapshot every file the patch will touch BEFORE we apply.
    backup_entries: list[dict[str, Any]] = []
    for rel_path, op in file_ops:
        src_file = (repo / rel_path).resolve()
        try:
            src_file.relative_to(repo)
        except ValueError:
            result.update({"status": "failed", "error": f"refusing to touch path outside repo: {rel_path}"})
            return result

        entry: dict[str, Any] = {"path": rel_path, "op": op, "existed_before": src_file.exists()}
        if src_file.exists() and src_file.is_file():
            backup_target = backup_root / rel_path
            backup_target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src_file, backup_target)
            entry["backup_path"] = str(backup_target.relative_to(backup_root))
        backup_entries.append(entry)

    manifest = {
        "run_id": run_id,
        "source_repo": str(repo),
        "applied_at": _now(),
        "rolled_back": False,
        "rolled_back_at": "",
        "entries": backup_entries,
    }
    _write_manifest(backup_root, manifest)

    # Phase 2 — apply the patch via `git apply`. We don't require the source
    # repo to be a git repository for `git apply` itself (it just needs git
    # installed), but it's the most reliable way to land a unified diff.
    # Defensive: `git apply` rejects patches without a trailing newline as
    # "corrupt patch at line N", and upstream agents have stripped them before.
    if not patch_text.endswith("\n"):
        patch_text = patch_text + "\n"
    apply_cmd = subprocess.run(
        ["git", "apply", "--whitespace=fix", "--ignore-whitespace", "-"],
        cwd=str(repo),
        input=patch_text,
        capture_output=True,
        text=True,
        timeout=120,
    )
    if apply_cmd.returncode != 0:
        # Patch failed — restore anything we touched (we haven't actually written
        # yet, but be defensive in case git apply partially succeeded).
        rollback_result = _restore_from_manifest(repo, backup_root, manifest)
        result.update({
            "status": "failed",
            "error": (apply_cmd.stderr or apply_cmd.stdout or "git apply failed").strip(),
            "rollback_after_failure": rollback_result,
        })
        return result

    result.update({
        "status": "applied",
        "applied_files": [entry["path"] for entry in backup_entries],
    })
    logger.info(
        "[SOURCE_APPLY] run=%s applied %d files to %s",
        run_id[:8], len(backup_entries), repo,
    )
    return result


def rollback_source(run_id: str, artifacts_dir: Path) -> dict[str, Any]:
    """Restore source files using the snapshot saved during apply_to_source."""
    backup_root = Path(artifacts_dir) / "source_backup"
    manifest_path = backup_root / _MANIFEST_FILENAME

    result: dict[str, Any] = {
        "status": "pending",
        "run_id": run_id,
        "restored_files": [],
        "removed_files": [],
        "error": "",
    }

    if not manifest_path.exists():
        result.update({"status": "not_found", "error": "No source_backup manifest for this run."})
        return result

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        result.update({"status": "failed", "error": f"Corrupt manifest: {exc}"})
        return result

    if manifest.get("rolled_back"):
        result.update({"status": "already_rolled_back", "error": "This run was already rolled back."})
        return result

    repo = Path(manifest.get("source_repo", "")).resolve()
    if not repo.exists():
        result.update({"status": "failed", "error": f"source_repo missing: {repo}"})
        return result

    restored = _restore_from_manifest(repo, backup_root, manifest)
    manifest["rolled_back"] = True
    manifest["rolled_back_at"] = _now()
    _write_manifest(backup_root, manifest)

    result.update({
        "status": "rolled_back",
        "restored_files": restored["restored_files"],
        "removed_files": restored["removed_files"],
        "error": restored.get("error", ""),
    })
    logger.info(
        "[SOURCE_APPLY] run=%s rolled back %d restored, %d removed",
        run_id[:8], len(restored["restored_files"]), len(restored["removed_files"]),
    )
    return result


def get_application_status(run_id: str, artifacts_dir: Path) -> dict[str, Any]:
    """Used by the UI to know whether a run was applied / rolled back."""
    backup_root = Path(artifacts_dir) / "source_backup"
    manifest_path = backup_root / _MANIFEST_FILENAME
    if not manifest_path.exists():
        return {"applied": False, "rolled_back": False}
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"applied": False, "rolled_back": False}
    return {
        "applied": True,
        "rolled_back": bool(manifest.get("rolled_back")),
        "applied_at": manifest.get("applied_at", ""),
        "rolled_back_at": manifest.get("rolled_back_at", ""),
        "source_repo": manifest.get("source_repo", ""),
        "files": [entry.get("path") for entry in manifest.get("entries", []) if isinstance(entry, dict)],
    }


# ── helpers ────────────────────────────────────────────────────────────────


def _restore_from_manifest(
    repo: Path,
    backup_root: Path,
    manifest: dict[str, Any],
) -> dict[str, Any]:
    restored: list[str] = []
    removed: list[str] = []
    errors: list[str] = []

    for entry in manifest.get("entries", []):
        if not isinstance(entry, dict):
            continue
        rel_path = str(entry.get("path", ""))
        if not rel_path:
            continue
        target = (repo / rel_path).resolve()
        try:
            target.relative_to(repo)
        except ValueError:
            errors.append(f"skip out-of-repo path: {rel_path}")
            continue

        if entry.get("existed_before"):
            backup_path = backup_root / rel_path
            if not backup_path.exists():
                errors.append(f"missing backup for {rel_path}")
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(backup_path, target)
            restored.append(rel_path)
        else:
            # File didn't exist before the patch — the patch must have created
            # it, so removing the file restores the prior state.
            if target.exists():
                target.unlink()
                removed.append(rel_path)
    return {"restored_files": restored, "removed_files": removed, "error": "; ".join(errors)}


def _changed_paths_with_ops(patch_text: str) -> list[tuple[str, str]]:
    """Extract (path, op) pairs from a unified diff. ``op`` ∈ {create, delete, modify}."""
    out: list[tuple[str, str]] = []
    blocks = re.split(r"^diff --git ", patch_text, flags=re.MULTILINE)
    for block in blocks:
        block = block.strip()
        if not block:
            continue
        first_line = block.splitlines()[0]
        parts = first_line.split()
        if len(parts) < 2:
            continue
        path = _normalize_patch_path(parts[1])
        if not path:
            for piece in parts[:2]:
                path = _normalize_patch_path(piece)
                if path:
                    break
        if not path:
            continue
        op = "modify"
        if "\nnew file mode" in block:
            op = "create"
        elif "\ndeleted file mode" in block:
            op = "delete"
        if (path, op) not in out:
            out.append((path, op))
    return out


def _normalize_patch_path(path: str) -> str:
    if not path or path == "/dev/null":
        return ""
    path = path.strip().strip('"')
    if path.startswith(("a/", "b/")):
        return path[2:]
    return path


def _write_manifest(backup_root: Path, manifest: dict[str, Any]) -> None:
    backup_root.mkdir(parents=True, exist_ok=True)
    path = backup_root / _MANIFEST_FILENAME
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _temp_patch_file(content: str) -> str:
    handle = tempfile.NamedTemporaryFile(mode="w", suffix=".patch", delete=False, encoding="utf-8")
    handle.write(content)
    handle.close()
    return handle.name
