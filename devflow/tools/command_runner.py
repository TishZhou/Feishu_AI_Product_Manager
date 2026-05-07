"""Safe project validation commands exposed to coding agents."""

from __future__ import annotations

import re
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


_SHELL_TOKENS = {"|", "||", "&", "&&", ";", ">", ">>", "<", "`"}
_NPM_SCRIPTS = {"test", "build", "lint", "typecheck", "check", "coverage"}
_PYTHON_MODULES = {"pytest", "unittest", "ruff", "mypy"}
_DIRECT_TOOLS = {"pytest", "ruff", "mypy"}
# Read-only / type-check tools we let agents run via `npx --no-install`.
# `--no-install` keeps it offline-safe (no package fetch); the binary must
# already be in node_modules.
_NPX_ALLOWED = {"tsc", "eslint", "prettier", "vitest", "jest"}
_MAX_OUTPUT_CHARS = 12_000


def run_command(command: str, repo_path: str, cwd: str = ".", timeout_seconds: int = 120) -> dict[str, Any]:
    """Run a safe validation command inside repo_path."""
    root = Path(repo_path).resolve()
    workdir = _resolve_cwd(root, cwd)
    if workdir is None:
        return _blocked(command, f"cwd escapes repo root: {cwd}")

    try:
        tokens = shlex.split(command)
    except ValueError as exc:
        return _blocked(command, f"invalid command syntax: {exc}")

    if not tokens:
        return _blocked(command, "empty command")
    if any(token in _SHELL_TOKENS or _has_shell_operator(token) for token in tokens):
        return _blocked(command, "shell operators are not allowed")

    normalized = _normalize_allowed_command(tokens)
    if not normalized:
        return _blocked(command, "command is not in the validation allowlist")

    timeout = max(1, min(int(timeout_seconds or 120), 300))
    start = time.monotonic()
    try:
        completed = subprocess.run(
            normalized,
            cwd=workdir,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        duration = time.monotonic() - start
        return {
            "command": command,
            "normalized_command": " ".join(normalized),
            "cwd": str(workdir.relative_to(root)),
            "success": False,
            "exit_code": -1,
            "stdout": _tail(exc.stdout or ""),
            "stderr": _tail(exc.stderr or ""),
            "error": f"command timed out after {timeout}s",
            "duration_seconds": round(duration, 2),
        }
    except OSError as exc:
        return _blocked(command, str(exc))

    duration = time.monotonic() - start
    return {
        "command": command,
        "normalized_command": " ".join(normalized),
        "cwd": str(workdir.relative_to(root)) or ".",
        "success": completed.returncode == 0,
        "exit_code": completed.returncode,
        "stdout": _tail(completed.stdout),
        "stderr": _tail(completed.stderr),
        "summary": _extract_summary(completed.stdout, completed.stderr),
        "duration_seconds": round(duration, 2),
    }


def _resolve_cwd(root: Path, cwd: str) -> Path | None:
    target = (root / (cwd or ".")).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        return None
    return target if target.exists() and target.is_dir() else None


def _normalize_allowed_command(tokens: list[str]) -> list[str] | None:
    exe = Path(tokens[0]).name
    args = tokens[1:]

    if exe in _DIRECT_TOOLS:
        if exe == "pytest":
            return [sys.executable, "-m", "pytest", *args]
        return _with_executable(exe, args)

    if exe in {"python", "python3"}:
        if len(args) >= 2 and args[0] == "-m" and args[1] in _PYTHON_MODULES:
            return [sys.executable, *args]
        return None

    if exe in {"npm", "pnpm", "yarn"}:
        if _is_allowed_package_command(exe, args):
            return [exe, *args]
        return None

    if exe == "npx":
        # Strip leading flags like --no-install / --yes / -y to find the tool name.
        i = 0
        while i < len(args) and args[i].startswith("-"):
            i += 1
        if i >= len(args):
            return None
        tool = Path(args[i]).name
        if tool not in _NPX_ALLOWED:
            return None
        # Force --no-install so we never trigger a network package fetch.
        if "--no-install" not in args[:i]:
            args = ["--no-install", *args]
        return ["npx", *args]

    if exe == "uv":
        if len(args) >= 2 and args[0] == "run":
            nested = _normalize_allowed_command(args[1:])
            if not nested:
                return None
            return ["uv", "run", *nested[2:]] if nested[:2] == [sys.executable, "-m"] else ["uv", *args]
        return None

    return None


def _with_executable(exe: str, args: list[str]) -> list[str] | None:
    found = shutil.which(exe)
    if not found:
        return None
    return [found, *args]


def _is_allowed_package_command(exe: str, args: list[str]) -> bool:
    if not args:
        return False
    if args[0] in _NPM_SCRIPTS:
        return True
    if args[0] == "run" and len(args) >= 2 and args[1] in _NPM_SCRIPTS:
        return True
    if exe == "yarn" and args[0] in {"test", "build", "lint"}:
        return True
    return False


def _has_shell_operator(token: str) -> bool:
    return bool(re.search(r"(\|\||&&|;|>>|[<>`])", token))


def _blocked(command: str, reason: str) -> dict[str, Any]:
    return {
        "command": command,
        "success": False,
        "exit_code": -1,
        "stdout": "",
        "stderr": "",
        "error": reason,
        "blocked": True,
    }


def _tail(value: str, limit: int = _MAX_OUTPUT_CHARS) -> str:
    text = value or ""
    return text[-limit:]


def _extract_summary(stdout: str, stderr: str) -> str:
    for text in (stdout, stderr):
        for line in reversed((text or "").splitlines()):
            stripped = line.strip()
            if stripped:
                return stripped[-500:]
    return ""


COMMAND_TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "run_command",
            "description": (
                "Run a safe validation command in the repository. Allowed examples: "
                "pytest tests -q, python -m pytest tests -q, npm test, npm run build, "
                "pnpm run lint, ruff check ., mypy package."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "Validation command to execute."},
                    "cwd": {"type": "string", "description": "Working directory relative to repo root.", "default": "."},
                    "timeout_seconds": {"type": "integer", "description": "Timeout in seconds, capped at 300.", "default": 120},
                },
                "required": ["command"],
            },
        },
    },
]
