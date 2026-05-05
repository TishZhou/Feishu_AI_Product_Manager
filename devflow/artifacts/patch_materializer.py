from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def materialize_patch_files(patch_text: str, repo_path: str, artifact_dir: Path) -> dict[str, Any]:
    """Create artifact-only full-file snapshots for files mentioned in a git patch.

    This does not modify the target repo. It applies a small unified-diff subset
    in memory for modified files and writes the resulting snapshots under
    artifacts/{run_id}/generated_files/.
    """
    target_root = artifact_dir / "generated_files"
    target_root.mkdir(parents=True, exist_ok=True)

    entries = []
    for file_patch in _split_file_patches(patch_text):
        new_path = file_patch.get("new_path")
        old_path = file_patch.get("old_path")
        if not new_path or new_path == "/dev/null":
            continue

        rel_path = new_path.removeprefix("b/")
        action = "create" if old_path == "/dev/null" else "modify"
        original = "" if action == "create" else _read_repo_file(repo_path, rel_path)
        content = _apply_unified_hunks(original, file_patch["lines"])

        artifact_rel = str(Path("generated_files") / rel_path)
        artifact_path = artifact_dir / artifact_rel
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(content, encoding="utf-8")

        entries.append({
            "path": rel_path,
            "action": action,
            "artifact_path": artifact_rel,
            "source": "code_diff.patch",
        })

    manifest = {
        "applied_to_repo": False,
        "mode": "artifact_only",
        "files": entries,
    }
    (artifact_dir / "generated_files_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return manifest


def build_patch_review_payload(patch_text: str, manifest: dict[str, Any] | None, artifact_dir: Path) -> dict[str, Any]:
    """Return a file-by-file review payload for generated code artifacts."""
    manifest = manifest or {}
    manifest_by_path = {
        item.get("path"): item
        for item in manifest.get("files", [])
        if isinstance(item, dict) and item.get("path")
    }

    files = []
    for file_patch in _split_file_patches(patch_text):
        new_path = file_patch.get("new_path")
        old_path = file_patch.get("old_path")
        if not new_path or new_path == "/dev/null":
            continue

        rel_path = new_path.removeprefix("b/")
        action = "create" if old_path == "/dev/null" else "modify"
        diff = "".join(file_patch["lines"])
        additions, deletions = _count_changed_lines(file_patch["lines"])
        manifest_entry = manifest_by_path.get(rel_path, {})
        artifact_rel = manifest_entry.get("artifact_path") or str(Path("generated_files") / rel_path)
        artifact_path = artifact_dir / artifact_rel
        generated_content = ""
        generated_exists = artifact_path.exists() and artifact_path.is_file()
        if generated_exists:
            generated_content = artifact_path.read_text(encoding="utf-8", errors="replace")

        files.append({
            "path": rel_path,
            "action": manifest_entry.get("action") or action,
            "diff": diff,
            "additions": additions,
            "deletions": deletions,
            "generated_file": artifact_rel,
            "generated_exists": generated_exists,
            "generated_content": generated_content,
        })

    return {
        "mode": manifest.get("mode", "artifact_only"),
        "applied_to_repo": bool(manifest.get("applied_to_repo", False)),
        "patch_applied_to_workspace": bool(manifest.get("patch_applied_to_workspace", False)),
        "workspace_apply_error": manifest.get("workspace_apply_error", ""),
        "execution_workspace": manifest.get("execution_workspace", ""),
        "file_count": len(files),
        "files": files,
    }


def _split_file_patches(patch_text: str) -> list[dict[str, Any]]:
    patches = []
    current = None
    for line in patch_text.splitlines(keepends=True):
        if line.startswith("diff --git "):
            if current:
                patches.append(current)
            current = {"old_path": "", "new_path": "", "lines": [line]}
            parts = line.strip().split()
            if len(parts) >= 4:
                current["old_path"] = parts[2]
                current["new_path"] = parts[3]
            continue
        if current is None:
            continue
        current["lines"].append(line)
        if line.startswith("--- "):
            current["old_path"] = line.strip().split(" ", 1)[1]
        elif line.startswith("+++ "):
            current["new_path"] = line.strip().split(" ", 1)[1]
    if current:
        patches.append(current)
    return patches


def _count_changed_lines(patch_lines: list[str]) -> tuple[int, int]:
    additions = 0
    deletions = 0
    for line in patch_lines:
        if line.startswith("+") and not line.startswith("+++"):
            additions += 1
        elif line.startswith("-") and not line.startswith("---"):
            deletions += 1
    return additions, deletions


def _read_repo_file(repo_path: str, rel_path: str) -> str:
    path = Path(repo_path) / rel_path
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8", errors="ignore")


def _apply_unified_hunks(original: str, patch_lines: list[str]) -> str:
    original_lines = original.splitlines(keepends=True)
    output = []
    index = 0
    in_hunk = False

    for line in patch_lines:
        if line.startswith("@@"):
            old_start = _parse_old_start(line)
            copy_until = max(old_start - 1, 0)
            output.extend(original_lines[index:copy_until])
            index = copy_until
            in_hunk = True
            continue
        if not in_hunk:
            continue
        if line.startswith("+") and not line.startswith("+++"):
            output.append(line[1:])
        elif line.startswith("-") and not line.startswith("---"):
            index += 1
        elif line.startswith(" "):
            output.append(original_lines[index] if index < len(original_lines) else line[1:])
            index += 1
        elif line.startswith("\\ No newline"):
            continue

    output.extend(original_lines[index:])
    return "".join(output)


def _parse_old_start(hunk_header: str) -> int:
    marker = hunk_header.split(" ", 2)[1]
    start = marker.removeprefix("-").split(",", 1)[0]
    try:
        return int(start)
    except ValueError:
        return 1
