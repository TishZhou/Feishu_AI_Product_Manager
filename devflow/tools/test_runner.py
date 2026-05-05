import re
import subprocess
import sys
import time
from pathlib import Path


_SUMMARY_RE = re.compile(
    r"(?P<count>\d+)\s+(?P<status>passed|failed|skipped|error|errors|xfailed|xpassed|deselected)\b"
)


def run_test(test_path: str, repo_path: str) -> dict:
    """Run pytest on test_path relative to repo_path."""
    root = Path(repo_path).resolve()
    full_path = _resolve_test_path(test_path, root)
    if full_path is None:
        return {
            "success": False,
            "exit_code": -1,
            "error": f"Test path escapes repo root: {test_path}",
        }
    if not full_path.exists():
        return {"success": False, "exit_code": -1, "error": f"Test path not found: {test_path}"}

    display_path = str(full_path.relative_to(root))

    start = time.monotonic()
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pytest", display_path, "-v", "--tb=short", "--no-header"],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=120,
        )
        duration = time.monotonic() - start
        counts = _parse_pytest_counts(result.stdout)
        return {
            "success": result.returncode == 0,
            "exit_code": result.returncode,
            "test_path": display_path,
            "total": sum(counts.values()),
            "counts": counts,
            "summary": _extract_pytest_summary(result.stdout) or _build_summary(counts, duration),
            "stdout": result.stdout[-8000:],  # cap at 8KB
            "stderr": result.stderr[-2000:],
            "duration_seconds": round(duration, 2),
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "exit_code": -1, "error": "pytest timed out after 120s"}


def _resolve_test_path(test_path: str, root: Path) -> Path | None:
    candidate = Path(test_path)
    target = candidate if candidate.is_absolute() else root / candidate
    target = target.resolve()
    try:
        target.relative_to(root)
    except ValueError:
        return None
    return target


def _parse_pytest_counts(stdout: str) -> dict[str, int]:
    counts = {
        "passed": 0,
        "failed": 0,
        "skipped": 0,
        "errors": 0,
    }
    for match in _SUMMARY_RE.finditer(stdout):
        status = match.group("status")
        count = int(match.group("count"))
        if status == "error":
            status = "errors"
        if status in counts:
            counts[status] += count
    return counts


def _extract_pytest_summary(stdout: str) -> str:
    for line in reversed(stdout.splitlines()):
        stripped = line.strip("= ").strip()
        if " in " in stripped and _SUMMARY_RE.search(stripped):
            return stripped
    return ""


def _build_summary(counts: dict[str, int], duration: float) -> str:
    parts = [f"{count} {name}" for name, count in counts.items() if count]
    if not parts:
        parts = ["0 tests reported"]
    return f"{', '.join(parts)} in {duration:.2f}s"


TEST_TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "run_test",
            "description": "Run pytest on a test file or directory relative to the repository root.",
            "parameters": {
                "type": "object",
                "properties": {
                    "test_path": {"type": "string", "description": "Path to test file or directory relative to repo root"},
                },
                "required": ["test_path"],
            },
        },
    },
]
