"""Read-only and write repo workspace tools exposed to agents as OpenAI function schemas."""

import fnmatch
import re
from pathlib import Path


# ── Tool implementations ──────────────────────────────────────────────────────


def list_dir(path: str, repo_path: str) -> dict:
    """List directory contents relative to repo_path."""
    target = Path(repo_path) / path
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
    target = Path(repo_path) / path
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
    return {"query": query, "matches": matches, "truncated": False}


def write_file(path: str, content: str, repo_path: str) -> dict:
    """Write content to a file relative to repo_path (creates directories as needed)."""
    target = Path(repo_path) / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return {"path": path, "size": target.stat().st_size}


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
]
