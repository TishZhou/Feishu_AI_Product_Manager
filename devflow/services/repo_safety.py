"""Detect whether a user-selected repo path is DevFlow's own source code.

We treat self-modification as a privileged operation: the AI pipeline will
generate diffs against this repository, which means a careless run can rewrite
the platform that hosts it. The API requires the caller to set
``confirm_self_modification=True`` before creating a pipeline that targets the
DevFlow source tree.
"""
from __future__ import annotations

from pathlib import Path

# This file lives at devflow/services/repo_safety.py — the project root is
# three parents up. Resolving once at import time avoids repeated stat calls.
_SOURCE_ROOT: Path = Path(__file__).resolve().parent.parent.parent


def get_devflow_source_root() -> Path:
    return _SOURCE_ROOT


def is_devflow_source_repo(repo_path: str | Path) -> bool:
    try:
        resolved = Path(repo_path).expanduser().resolve()
    except (OSError, ValueError, RuntimeError):
        return False
    return resolved == _SOURCE_ROOT


def inspect_repo(repo_path: str) -> dict:
    """Lightweight inspection used by the create-pipeline UI for inline feedback.

    Never raises — returns ``exists: False`` for any unreadable path.
    """
    raw = (repo_path or "").strip()
    if not raw:
        return {"path": "", "exists": False}
    try:
        p = Path(raw).expanduser()
    except (OSError, ValueError, RuntimeError):
        return {"path": raw, "exists": False}
    if not p.exists():
        return {"path": str(p), "exists": False}
    resolved = p.resolve()
    return {
        "path": str(resolved),
        "exists": True,
        "is_directory": p.is_dir(),
        "is_self_repo": is_devflow_source_repo(resolved),
        "is_git_repo": (resolved / ".git").exists(),
        "source_root": str(_SOURCE_ROOT),
    }
