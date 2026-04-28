import subprocess
import tempfile
from pathlib import Path


def apply_patch(patch_content: str, repo_path: str, check_only: bool = False) -> dict:
    """Apply a unified diff patch to the repo via `git apply`."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".patch", delete=False, encoding="utf-8") as f:
        f.write(patch_content)
        patch_file = f.name

    try:
        cmd = ["git", "apply", "--whitespace=fix", "--ignore-whitespace"]
        if check_only:
            cmd.append("--check")
        cmd.append(patch_file)

        result = subprocess.run(
            cmd,
            cwd=repo_path,
            capture_output=True,
            text=True,
            timeout=30,
        )
        return {
            "success": result.returncode == 0,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "check_only": check_only,
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "git apply timed out"}
    finally:
        Path(patch_file).unlink(missing_ok=True)


PATCH_TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "apply_patch",
            "description": "Apply a unified diff patch to the repository using git apply.",
            "parameters": {
                "type": "object",
                "properties": {
                    "patch_content": {"type": "string", "description": "Unified diff patch content"},
                    "check_only": {"type": "boolean", "description": "If true, only check validity without applying", "default": False},
                },
                "required": ["patch_content"],
            },
        },
    },
]
