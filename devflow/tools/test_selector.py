"""Map changed source files to existing test files in the repository.

Used by TestGenerationAgent to discover focused tests to run before writing
new ones, and to hint the LLM about which existing tests to verify.
"""

from __future__ import annotations

import re
from pathlib import Path

_DIFF_FILE_RE = re.compile(r"^diff --git a/.+ b/(.+)$", re.MULTILINE)


def parse_changed_files(patch: str) -> list[str]:
    """Return the list of changed file paths from a unified diff patch."""
    return [m.group(1) for m in _DIFF_FILE_RE.finditer(patch or "")]


def find_focused_tests(changed_files: list[str], repo_path: str) -> list[str]:
    """Return existing test files related to *changed_files*.

    For each changed ``path/to/foo.py`` we probe several naming patterns:
    ``tests/test_foo.py``, ``tests/path/test_foo.py``, ``tests/**/test_foo.py``,
    and the ``foo_test.py`` variants. Results are de-duplicated and ordered
    most-specific first.
    """
    root = Path(repo_path)
    focused: list[str] = []
    seen: set[str] = set()

    for changed in changed_files:
        p = Path(changed)
        stem = p.stem
        parent_rel = p.parent
        patterns = [
            f"tests/test_{stem}.py",
            f"tests/{parent_rel}/test_{stem}.py",
            f"tests/**/test_{stem}.py",
            f"tests/{stem}_test.py",
            f"tests/**/{stem}_test.py",
        ]
        for pattern in patterns:
            for match in sorted(root.glob(pattern)):
                if not match.is_file():
                    continue
                try:
                    rel = str(match.relative_to(root))
                except ValueError:
                    continue
                if rel not in seen:
                    seen.add(rel)
                    focused.append(rel)

    return focused
