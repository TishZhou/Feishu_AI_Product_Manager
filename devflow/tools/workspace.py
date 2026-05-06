"""Isolated workspace creation — git worktree with shutil.copytree fallback.

git worktree is dramatically faster for large repos because git uses hard-links
instead of physically copying files. copytree is the fallback for repos with no
commits or when the worktree command is unavailable.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path

logger = logging.getLogger("devflow.workspace")

_IGNORE_PATTERNS = (
    ".git", "__pycache__", ".pytest_cache",
    "artifacts", "data", "uploads", "dist", "node_modules",
    # AI / IDE tool config dirs — keep out of workspaces
    ".claude", ".wolf", ".cursor", ".idea", ".vscode",
)
_IGNORE_DIRS = set(_IGNORE_PATTERNS)
_IGNORE_FILE_NAMES = {".env", ".env.local", ".env.development", ".env.production", ".env.test", ".DS_Store"}


def create_workspace(source_repo: Path, workspace: Path) -> None:
    """Create an isolated workspace at *workspace* mirroring *source_repo*.

    Prefers ``git worktree add --detach`` (fast, uses hard-links), then syncs
    any modified/untracked files so the workspace matches the working tree.
    Falls back to ``shutil.copytree`` when the source is not a git repo or has
    no commits yet.
    """
    workspace.parent.mkdir(parents=True, exist_ok=True)
    if _try_git_worktree(source_repo, workspace):
        logger.info("[workspace] created via git worktree: %s", workspace.name)
        return
    shutil.copytree(source_repo, workspace, ignore=shutil.ignore_patterns(*_IGNORE_PATTERNS))
    logger.info("[workspace] created via copytree: %s", workspace.name)


def remove_workspace(source_repo: Path, workspace: Path) -> None:
    """Remove a workspace previously created by :func:`create_workspace`."""
    if not workspace.exists():
        return
    if _is_registered_worktree(source_repo, workspace):
        result = subprocess.run(
            ["git", "worktree", "remove", "--force", str(workspace)],
            cwd=source_repo,
            capture_output=True,
        )
        if result.returncode == 0:
            return
    shutil.rmtree(workspace, ignore_errors=True)


# ── internals ─────────────────────────────────────────────────────────────────

def _try_git_worktree(source_repo: Path, workspace: Path) -> bool:
    if not _is_git_repo(source_repo):
        return False
    if not _has_commits(source_repo):
        return False
    result = subprocess.run(
        ["git", "worktree", "add", "--detach", str(workspace)],
        cwd=source_repo,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        logger.debug("[workspace] git worktree add failed: %s", result.stderr.strip())
        return False
    _sync_working_tree_changes(source_repo, workspace)
    return True


def _sync_working_tree_changes(source_repo: Path, workspace: Path) -> None:
    """Copy modified/untracked files from source_repo into the worktree.

    git worktree add gives us committed files at HEAD. This step adds any
    un-committed changes so the workspace truly mirrors the working tree.
    """
    result = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=source_repo,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return
    for raw in result.stdout.splitlines():
        if len(raw) < 4:
            continue
        status = raw[:2].strip()
        filepath = raw[3:].strip()
        if not filepath:
            continue
        parts = Path(filepath).parts
        if any(part in _IGNORE_DIRS for part in parts):
            continue
        if Path(filepath).name in _IGNORE_FILE_NAMES:
            continue
        src = source_repo / filepath
        dst = workspace / filepath
        if status == "D":
            if dst.exists():
                dst.unlink()
        elif src.exists() and src.is_file():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)


def _is_git_repo(path: Path) -> bool:
    return subprocess.run(
        ["git", "rev-parse", "--git-dir"],
        cwd=path,
        capture_output=True,
    ).returncode == 0


def _has_commits(path: Path) -> bool:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=path,
        capture_output=True,
    ).returncode == 0


def _is_registered_worktree(source_repo: Path, workspace: Path) -> bool:
    result = subprocess.run(
        ["git", "worktree", "list", "--porcelain"],
        cwd=source_repo,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return False
    return str(workspace.resolve()) in result.stdout
