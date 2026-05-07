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

# Names that should be skipped at any depth (caches, build outputs, vendored deps).
_IGNORE_ANYWHERE = (
    ".git", "__pycache__", ".pytest_cache",
    "dist", "node_modules",
    # AI / IDE tool config dirs — keep out of workspaces
    ".claude", ".wolf", ".cursor", ".idea", ".vscode",
)
# Names that should be skipped only when they sit at the repo root.
# Subdirectories with the same name (e.g. frontend/src/data/) MUST NOT be skipped,
# otherwise we silently drop source code the AI just generated.
_IGNORE_TOP_LEVEL_ONLY = ("artifacts", "data", "uploads")

_IGNORE_DIRS_ANYWHERE = set(_IGNORE_ANYWHERE)
_IGNORE_DIRS_TOP_LEVEL = set(_IGNORE_TOP_LEVEL_ONLY)
_IGNORE_FILE_NAMES = {".env", ".env.local", ".env.development", ".env.production", ".env.test", ".DS_Store"}


def _should_ignore_path_parts(parts: tuple[str, ...]) -> bool:
    """True if the relative path should be skipped during workspace creation."""
    if not parts:
        return False
    if parts[0] in _IGNORE_DIRS_TOP_LEVEL:
        return True
    return any(part in _IGNORE_DIRS_ANYWHERE for part in parts)


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
    shutil.copytree(source_repo, workspace, ignore=_copytree_ignore(source_repo))
    logger.info("[workspace] created via copytree: %s", workspace.name)


def _copytree_ignore(source_repo: Path):
    """Build a copytree ignore callback that respects top-level-only patterns."""
    source_root = source_repo.resolve()

    def _ignore(directory: str, names: list[str]) -> set[str]:
        try:
            rel_dir = Path(directory).resolve().relative_to(source_root)
        except ValueError:
            return set()
        parts = rel_dir.parts
        skipped: set[str] = set()
        for name in names:
            full_parts = (*parts, name)
            if _should_ignore_path_parts(full_parts):
                skipped.add(name)
            elif name in _IGNORE_FILE_NAMES:
                skipped.add(name)
        return skipped

    return _ignore


def ensure_frontend_node_modules(workspace_root: Path, source_repo: Path) -> int:
    """Symlink the source repo's ``frontend/.../node_modules`` directories into
    the workspace so the LLM can run ``npx --no-install tsc`` etc. without
    paying for ``npm install``.

    ``create_workspace()`` deliberately skips ``node_modules`` (gitignored, ~hundreds
    of MB), so a fresh worktree has no installed deps. Without these symlinks,
    every agent that tries to verify frontend changes fails with "missing
    typescript dependency". Returns the number of symlinks created.

    Walks every directory in *workspace_root* containing a ``package.json``
    (top-level frontend, monorepo packages, etc.) and creates a symlink to the
    matching directory in *source_repo* if it exists.
    """
    workspace_root = workspace_root.resolve()
    source_repo = source_repo.resolve()
    if workspace_root == source_repo:
        return 0  # nothing to do — source itself
    created = 0
    for pkg_json in workspace_root.rglob("package.json"):
        # Skip anything inside an existing node_modules (transitive deps)
        if "node_modules" in pkg_json.parts:
            continue
        target = pkg_json.parent / "node_modules"
        if target.exists() or target.is_symlink():
            continue
        try:
            rel = pkg_json.parent.relative_to(workspace_root)
        except ValueError:
            continue
        source_modules = (source_repo / rel / "node_modules").resolve()
        if not source_modules.is_dir():
            continue
        try:
            target.symlink_to(source_modules, target_is_directory=True)
            created += 1
        except OSError as exc:
            logger.debug("[workspace] symlink failed for %s: %s", target, exc)
    if created:
        logger.info("[workspace] linked %d node_modules dir(s) into %s", created, workspace_root.name)
    return created


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
        if _should_ignore_path_parts(parts):
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
