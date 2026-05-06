from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any


def publish_run_changes(
    repo_path: str,
    patch_text: str,
    run_id: str,
    title: str,
    body: str = "",
    branch_prefix: str = "devflow",
) -> dict[str, Any]:
    repo = Path(repo_path).resolve()
    result: dict[str, Any] = {
        "status": "pending",
        "repo_path": str(repo),
        "run_id": run_id,
        "base_branch": "",
        "branch": "",
        "commit": "",
        "remote": "",
        "pushed": False,
        "review_url": "",
        "review_kind": "",
        "changed_files": [],
        "steps": [],
        "error": "",
    }

    if not patch_text.strip():
        result.update({"status": "skipped", "error": "No final diff to publish."})
        return result

    top = _git(repo, ["rev-parse", "--show-toplevel"], result)
    if top.returncode != 0:
        result.update({"status": "failed", "error": _stderr(top) or "Not a git repository."})
        return result
    repo = Path(top.stdout.strip()).resolve()
    result["repo_path"] = str(repo)

    status = _git(repo, ["status", "--porcelain"], result)
    if status.returncode != 0:
        result.update({"status": "failed", "error": _stderr(status)})
        return result
    if status.stdout.strip():
        result.update({
            "status": "blocked",
            "error": "Working tree is not clean; refusing to mix existing changes into an automated commit.",
            "working_tree_status": status.stdout.strip(),
        })
        return result

    base = _git(repo, ["rev-parse", "--abbrev-ref", "HEAD"], result)
    if base.returncode != 0:
        result.update({"status": "failed", "error": _stderr(base)})
        return result
    result["base_branch"] = base.stdout.strip()

    branch = _unique_branch(repo, branch_prefix, title, run_id, result)
    result["branch"] = branch
    checkout = _git(repo, ["checkout", "-b", branch], result)
    if checkout.returncode != 0:
        result.update({"status": "failed", "error": _stderr(checkout)})
        return result

    apply_result = _apply_patch(repo, patch_text, result)
    if apply_result.returncode != 0:
        result.update({"status": "failed", "error": _stderr(apply_result) or "git apply failed"})
        return result

    changed_paths = _changed_paths_from_patch(patch_text)
    result["changed_files"] = changed_paths
    add_args = ["add", "--all", "--"] + changed_paths if changed_paths else ["add", "--all"]
    add = _git(repo, add_args, result)
    if add.returncode != 0:
        result.update({"status": "failed", "error": _stderr(add)})
        return result

    staged = _git(repo, ["diff", "--cached", "--quiet"], result, record=False)
    if staged.returncode == 0:
        result.update({"status": "skipped", "error": "Patch applied cleanly but produced no staged changes."})
        return result

    commit_message = _commit_message(title, run_id)
    commit = _git(
        repo,
        [
            "-c", "user.name=DevFlow",
            "-c", "user.email=devflow@example.invalid",
            "commit",
            "-m", commit_message,
        ],
        result,
        timeout=120,
    )
    if commit.returncode != 0:
        result.update({"status": "failed", "error": _stderr(commit)})
        return result

    head = _git(repo, ["rev-parse", "HEAD"], result)
    if head.returncode == 0:
        result["commit"] = head.stdout.strip()
    result["status"] = "committed"

    remote = _git(repo, ["remote", "get-url", "origin"], result)
    if remote.returncode != 0 or not remote.stdout.strip():
        result["error"] = "No origin remote configured; branch was committed locally."
        return result
    result["remote"] = remote.stdout.strip()

    push = _git(repo, ["push", "-u", "origin", branch], result, timeout=180)
    if push.returncode != 0:
        result["error"] = _stderr(push)
        return result
    result["pushed"] = True
    result["status"] = "pushed"

    review = _create_review(repo, branch, title, body, result)
    if review:
        result.update(review)
        result["status"] = "review_created"
    return result


def _git(repo: Path, args: list[str], result: dict[str, Any], timeout: int = 60, record: bool = True) -> subprocess.CompletedProcess:
    completed = subprocess.run(
        ["git", *args],
        cwd=repo,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if record:
        result["steps"].append({
            "cmd": "git " + " ".join(args),
            "returncode": completed.returncode,
            "stdout": completed.stdout[-2000:],
            "stderr": completed.stderr[-2000:],
        })
    return completed


def _apply_patch(repo: Path, patch_text: str, result: dict[str, Any]) -> subprocess.CompletedProcess:
    with tempfile.NamedTemporaryFile(mode="w", suffix=".patch", delete=False, encoding="utf-8") as handle:
        handle.write(patch_text)
        patch_path = handle.name
    try:
        return _git(repo, ["apply", "--whitespace=fix", "--ignore-whitespace", patch_path], result, timeout=120)
    finally:
        Path(patch_path).unlink(missing_ok=True)


def _unique_branch(repo: Path, prefix: str, title: str, run_id: str, result: dict[str, Any]) -> str:
    slug = _slug(title) or "run"
    base = f"{prefix}/{slug}-{run_id[:8]}"
    candidate = base
    index = 2
    while True:
        exists = _git(repo, ["rev-parse", "--verify", "--quiet", f"refs/heads/{candidate}"], result, record=False)
        if exists.returncode != 0:
            return candidate
        candidate = f"{base}-{index}"
        index += 1


def _create_review(repo: Path, branch: str, title: str, body: str, result: dict[str, Any]) -> dict[str, Any] | None:
    remote = str(result.get("remote") or "")
    if "github" in remote and shutil.which("gh"):
        completed = _run_cli(
            repo,
            ["gh", "pr", "create", "--title", title, "--body", body or title, "--draft", "--head", branch],
            result,
            "gh pr create",
        )
        if completed.returncode == 0:
            return {"review_kind": "PR", "review_url": _last_url(completed.stdout)}
        result["error"] = completed.stderr.strip() or completed.stdout.strip()
    if "gitlab" in remote and shutil.which("glab"):
        completed = _run_cli(
            repo,
            ["glab", "mr", "create", "--title", title, "--description", body or title, "--draft", "--source-branch", branch],
            result,
            "glab mr create",
        )
        if completed.returncode == 0:
            return {"review_kind": "MR", "review_url": _last_url(completed.stdout)}
        result["error"] = completed.stderr.strip() or completed.stdout.strip()
    return None


def _run_cli(repo: Path, args: list[str], result: dict[str, Any], label: str) -> subprocess.CompletedProcess:
    completed = subprocess.run(args, cwd=repo, capture_output=True, text=True, timeout=180)
    result["steps"].append({
        "cmd": label,
        "returncode": completed.returncode,
        "stdout": completed.stdout[-2000:],
        "stderr": completed.stderr[-2000:],
    })
    return completed


def _changed_paths_from_patch(patch_text: str) -> list[str]:
    paths: list[str] = []
    seen = set()
    for line in patch_text.splitlines():
        if not line.startswith("diff --git "):
            continue
        parts = line.split()
        if len(parts) < 4:
            continue
        for raw in (parts[3], parts[2]):
            path = _normalize_patch_path(raw)
            if path and path not in seen:
                seen.add(path)
                paths.append(path)
                break
    return paths


def _normalize_patch_path(path: str) -> str:
    if not path or path == "/dev/null":
        return ""
    path = path.strip('"')
    if path.startswith("a/") or path.startswith("b/"):
        return path[2:]
    return path


def _commit_message(title: str, run_id: str) -> str:
    clean = " ".join((title or "DevFlow generated changes").split())
    return f"{clean}\n\nGenerated by DevFlow run {run_id}."


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.lower()).strip("-")
    return slug[:48].strip("-")


def _stderr(completed: subprocess.CompletedProcess) -> str:
    return (completed.stderr or completed.stdout or "").strip()


def _last_url(text: str) -> str:
    matches = re.findall(r"https?://\S+", text)
    return matches[-1] if matches else text.strip()
