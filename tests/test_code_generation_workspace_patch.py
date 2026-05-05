from pathlib import Path

from devflow.agents.code_generation import _build_workspace_patch
from devflow.tools.patch_tools import apply_patch


def test_workspace_patch_applies_for_modified_file(tmp_path):
    source = tmp_path / "source"
    workspace = tmp_path / "workspace"
    source.mkdir()
    workspace.mkdir()
    (source / "app.py").write_text("x = 1\n", encoding="utf-8")
    (workspace / "app.py").write_text("x = 2\n", encoding="utf-8")

    patch = _build_workspace_patch(source, workspace)

    assert "diff --git a/app.py b/app.py" in patch
    assert "+x = 2" in patch
    assert apply_patch(patch, str(source), check_only=True)["success"] is True


def test_workspace_patch_applies_for_new_file(tmp_path):
    source = tmp_path / "source"
    workspace = tmp_path / "workspace"
    source.mkdir()
    workspace.mkdir()
    (workspace / "new.py").write_text("def created():\n    return True\n", encoding="utf-8")

    patch = _build_workspace_patch(source, workspace)

    assert "new file mode 100644" in patch
    assert "--- /dev/null" in patch
    assert "+++ b/new.py" in patch
    assert apply_patch(patch, str(source), check_only=True)["success"] is True
