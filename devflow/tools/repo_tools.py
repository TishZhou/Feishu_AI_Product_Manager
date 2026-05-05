"""Read-only and write repo workspace tools exposed to agents as OpenAI function schemas."""

import re
import shutil
import subprocess
from pathlib import Path


# ── Tool implementations ──────────────────────────────────────────────────────


def list_dir(path: str, repo_path: str) -> dict:
    """List directory contents relative to repo_path."""
    target = _resolve_repo_path(repo_path, path)
    if target is None:
        return {"error": f"Path escapes repo root: {path}"}
    if not target.exists():
        return {"error": f"Path not found: {path}"}
    if not target.is_dir():
        return {"error": f"Not a directory: {path}"}
    entries = []
    for item in sorted(target.iterdir()):
        entries.append({
            "name": item.name,
            "type": "dir" if item.is_dir() else "file",
            "size": item.stat().st_size if item.is_file() else None,
        })
    return {"path": path, "entries": entries}


def read_file(path: str, repo_path: str, max_bytes: int = 100_000) -> dict:
    """Read a file relative to repo_path (truncated at max_bytes)."""
    target = _resolve_repo_path(repo_path, path)
    if target is None:
        return {"error": f"Path escapes repo root: {path}"}
    if not target.exists():
        return {"error": f"File not found: {path}"}
    if not target.is_file():
        return {"error": f"Not a file: {path}"}
    content = target.read_bytes()
    truncated = len(content) > max_bytes
    text = content[:max_bytes].decode("utf-8", errors="replace")
    return {"path": path, "content": text, "truncated": truncated, "size": len(content)}


def search_code(query: str, repo_path: str, path_glob: str = "**/*", max_results: int = 200) -> dict:
    """Search for a regex/plain string in files matching path_glob."""
    root = Path(repo_path)
    rg = shutil.which("rg")
    if rg:
        args = [
            rg,
            "--line-number",
            "--with-filename",
            "--color=never",
            "--glob",
            path_glob,
            query,
            ".",
        ]
        result = subprocess.run(args, cwd=root, capture_output=True, text=True, timeout=20)
        if result.returncode == 0:
            rows = []
            for line in result.stdout.splitlines()[:max_results]:
                parts = line.split(":", 2)
                if len(parts) != 3:
                    continue
                rows.append({
                    "file": parts[0].removeprefix("./"),
                    "line": int(parts[1]) if parts[1].isdigit() else 0,
                    "content": parts[2].rstrip(),
                })
            return {
                "query": query,
                "matches": rows,
                "truncated": len(result.stdout.splitlines()) > max_results,
                "engine": "rg",
            }
        if result.returncode == 1:
            return {"query": query, "matches": [], "truncated": False, "engine": "rg"}

    matches = []
    try:
        pattern = re.compile(query)
    except re.error:
        pattern = re.compile(re.escape(query))

    for file_path in root.glob(path_glob):
        if not file_path.is_file():
            continue
        # Skip binary-ish files
        if file_path.suffix in {".pyc", ".pyo", ".so", ".db", ".patch", ".bak"}:
            continue
        try:
            text = file_path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for lineno, line in enumerate(text.splitlines(), 1):
            if pattern.search(line):
                matches.append({
                    "file": str(file_path.relative_to(root)),
                    "line": lineno,
                    "content": line.rstrip(),
                })
                if len(matches) >= max_results:
                    return {"query": query, "matches": matches, "truncated": True}
    return {"query": query, "matches": matches, "truncated": False, "engine": "python"}


def write_file(path: str, content: str, repo_path: str) -> dict:
    """Write content to a file relative to repo_path (creates directories as needed)."""
    target = _resolve_repo_path(repo_path, path)
    if target is None:
        return {"error": f"Path escapes repo root: {path}"}
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return {"path": path, "size": target.stat().st_size}


def edit_file(path: str, old_str: str, new_str: str, repo_path: str) -> dict:
    """Replace one exact text occurrence in a file, or create/append when old_str is empty."""
    target = _resolve_repo_path(repo_path, path)
    if target is None:
        return {"error": f"Path escapes repo root: {path}"}
    if not path or old_str == new_str:
        return {"error": "invalid input parameters"}

    if not target.exists():
        if old_str:
            return {"error": f"File not found: {path}"}
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(new_str, encoding="utf-8")
        return {"path": path, "action": "created", "size": target.stat().st_size}

    if not target.is_file():
        return {"error": f"Not a file: {path}"}

    content = target.read_text(encoding="utf-8", errors="replace")
    if not old_str:
        target.write_text(content + new_str, encoding="utf-8")
        return {"path": path, "action": "appended", "size": target.stat().st_size}

    count = content.count(old_str)
    if count == 0:
        return {"error": "old_str not found in file"}
    if count > 1:
        return {"error": f"old_str found {count} times in file, must be unique"}

    target.write_text(content.replace(old_str, new_str, 1), encoding="utf-8")
    return {"path": path, "action": "edited", "size": target.stat().st_size}


def _resolve_repo_path(repo_path: str, path: str) -> Path | None:
    root = Path(repo_path).resolve()
    target = (root / (path or ".")).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        return None
    return target


# ── OpenAI function-call schemas ──────────────────────────────────────────────

REPO_TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "list_dir",
            "description": "List the contents of a directory in the target repository.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Directory path relative to repo root (use '.' for root)"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read the content of a file in the target repository (truncated at 100KB).",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path relative to repo root"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_code",
            "description": "Search for a regex pattern across files in the repository.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Regex or plain-text search term"},
                    "path_glob": {"type": "string", "description": "Glob pattern to filter files, e.g. '**/*.py'", "default": "**/*"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Write content to a file in the repository (used for test files only).",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path relative to repo root"},
                    "content": {"type": "string", "description": "File content to write"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "edit_file",
            "description": "Make a precise edit by replacing exactly one old_str occurrence with new_str. If old_str is empty, create or append to the file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path relative to repo root"},
                    "old_str": {"type": "string", "description": "Exact text to replace. Must match exactly once, or be empty to create/append."},
                    "new_str": {"type": "string", "description": "Replacement text or full new file content when old_str is empty"},
                },
                "required": ["path", "old_str", "new_str"],
            },
        },
    },
]
