import subprocess
import time
from pathlib import Path


def run_test(test_path: str, repo_path: str) -> dict:
    """Run pytest on test_path relative to repo_path."""
    full_path = Path(repo_path) / test_path
    if not full_path.exists():
        return {"success": False, "error": f"Test path not found: {test_path}"}

    start = time.monotonic()
    try:
        result = subprocess.run(
            ["python", "-m", "pytest", str(full_path), "-v", "--tb=short", "--no-header"],
            cwd=repo_path,
            capture_output=True,
            text=True,
            timeout=120,
        )
        duration = time.monotonic() - start
        return {
            "success": result.returncode == 0,
            "exit_code": result.returncode,
            "stdout": result.stdout[-8000:],  # cap at 8KB
            "stderr": result.stderr[-2000:],
            "duration_seconds": round(duration, 2),
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "pytest timed out after 120s"}


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
