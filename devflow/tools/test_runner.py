import re
import selectors
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable


_SUMMARY_RE = re.compile(
    r"(?P<count>\d+)\s+(?P<status>passed|failed|skipped|error|errors|xfailed|xpassed|deselected)\b"
)


ProgressCallback = Callable[[dict], None]


def run_test(test_path: str, repo_path: str, progress_callback: ProgressCallback | None = None) -> dict:
    """Run pytest on test_path relative to repo_path."""
    root = Path(repo_path).resolve()
    full_path = _resolve_test_path(test_path, root)
    if full_path is None:
        _emit(progress_callback, {"event": "failed", "error": f"Test path escapes repo root: {test_path}"})
        return {
            "success": False,
            "exit_code": -1,
            "error": f"Test path escapes repo root: {test_path}",
        }
    if not full_path.exists():
        _emit(progress_callback, {"event": "failed", "error": f"Test path not found: {test_path}"})
        return {"success": False, "exit_code": -1, "error": f"Test path not found: {test_path}"}

    display_path = str(full_path.relative_to(root))
    _emit(progress_callback, {"event": "started", "test_path": display_path})

    start = time.monotonic()
    try:
        process = subprocess.Popen(
            [sys.executable, "-m", "pytest", display_path, "-v", "--tb=short", "--no-header"],
            cwd=root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        stdout, stderr, timed_out = _collect_process_output(process, progress_callback, timeout=120)
        duration = time.monotonic() - start
        if timed_out:
            result = {"success": False, "exit_code": -1, "test_path": display_path, "error": "pytest timed out after 120s"}
            _emit(progress_callback, {"event": "finished", "result": result})
            return result
        counts = _parse_pytest_counts(stdout)
        result = {
            "success": process.returncode == 0,
            "exit_code": process.returncode,
            "test_path": display_path,
            "total": sum(counts.values()),
            "counts": counts,
            "summary": _extract_pytest_summary(stdout) or _build_summary(counts, duration),
            "stdout": stdout[-8000:],  # cap at 8KB
            "stderr": stderr[-2000:],
            "duration_seconds": round(duration, 2),
        }
        _emit(progress_callback, {"event": "finished", "result": result})
        return result
    except Exception as exc:
        result = {"success": False, "exit_code": -1, "test_path": display_path, "error": str(exc)}
        _emit(progress_callback, {"event": "finished", "result": result})
        return result


def _collect_process_output(
    process: subprocess.Popen,
    progress_callback: ProgressCallback | None,
    timeout: float,
) -> tuple[str, str, bool]:
    selector = selectors.DefaultSelector()
    if process.stdout:
        selector.register(process.stdout, selectors.EVENT_READ, "stdout")
    if process.stderr:
        selector.register(process.stderr, selectors.EVENT_READ, "stderr")

    start = time.monotonic()
    chunks = {"stdout": [], "stderr": []}
    timed_out = False

    while selector.get_map():
        if time.monotonic() - start > timeout:
            timed_out = True
            process.kill()
            break
        for key, _ in selector.select(timeout=0.1):
            line = key.fileobj.readline()
            if line:
                stream = str(key.data)
                chunks[stream].append(line)
                _emit(progress_callback, {"event": "output", "stream": stream, "line": line.rstrip("\n")})
            else:
                selector.unregister(key.fileobj)
        if process.poll() is not None:
            for key in list(selector.get_map().values()):
                for line in key.fileobj.readlines():
                    stream = str(key.data)
                    chunks[stream].append(line)
                    _emit(progress_callback, {"event": "output", "stream": stream, "line": line.rstrip("\n")})
                selector.unregister(key.fileobj)

    process.wait(timeout=2)
    return "".join(chunks["stdout"]), "".join(chunks["stderr"]), timed_out


def _emit(callback: ProgressCallback | None, event: dict) -> None:
    if callback:
        callback(event)


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
