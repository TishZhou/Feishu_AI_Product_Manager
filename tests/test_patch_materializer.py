from pathlib import Path

from devflow.artifacts.patch_materializer import materialize_patch_files


def test_materialize_patch_files_creates_full_file_snapshot(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "app.py").write_text("def hello():\n    return 'hi'\n", encoding="utf-8")
    artifacts = tmp_path / "artifacts"
    patch = """diff --git a/app.py b/app.py
--- a/app.py
+++ b/app.py
@@ -1,2 +1,2 @@
 def hello():
-    return 'hi'
+    return 'hello'
"""

    manifest = materialize_patch_files(patch, str(repo), artifacts)

    assert manifest["applied_to_repo"] is False
    assert manifest["files"][0]["path"] == "app.py"
    assert (repo / "app.py").read_text(encoding="utf-8") == "def hello():\n    return 'hi'\n"
    assert (artifacts / "generated_files" / "app.py").read_text(encoding="utf-8") == "def hello():\n    return 'hello'\n"
    assert (artifacts / "generated_files_manifest.json").exists()


def test_materialize_patch_files_handles_new_file(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    artifacts = tmp_path / "artifacts"
    patch = """diff --git a/new.py b/new.py
new file mode 100644
--- /dev/null
+++ b/new.py
@@ -0,0 +1,2 @@
+def created():
+    return True
"""

    manifest = materialize_patch_files(patch, str(repo), artifacts)

    assert manifest["files"][0]["action"] == "create"
    assert (artifacts / "generated_files" / "new.py").read_text(encoding="utf-8") == "def created():\n    return True\n"
