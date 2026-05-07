import subprocess

from devflow.services.git_integration import publish_run_changes


def _git(repo, *args):
    return subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, text=True)


def _commit_all(repo, message="initial"):
    _git(repo, "add", "--all")
    _git(repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", message)


def test_publish_run_changes_creates_branch_and_commit(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init")
    (repo / "app.py").write_text("value = 1\n", encoding="utf-8")
    _commit_all(repo)

    patch = """diff --git a/app.py b/app.py
--- a/app.py
+++ b/app.py
@@ -1 +1 @@
-value = 1
+value = 2
"""

    result = publish_run_changes(str(repo), patch, "run-123456789", "Implement value change")

    assert result["status"] == "committed"
    assert result["branch"].startswith("devflow/implement-value-change-run-1234")
    assert result["commit"]
    assert result["changed_files"] == ["app.py"]
    assert (repo / "app.py").read_text(encoding="utf-8") == "value = 2\n"
    branch = _git(repo, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
    assert branch == result["branch"]


def test_publish_run_changes_blocks_dirty_worktree(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init")
    (repo / "app.py").write_text("value = 1\n", encoding="utf-8")
    _commit_all(repo)
    (repo / "notes.txt").write_text("user work\n", encoding="utf-8")

    patch = """diff --git a/app.py b/app.py
--- a/app.py
+++ b/app.py
@@ -1 +1 @@
-value = 1
+value = 2
"""

    result = publish_run_changes(str(repo), patch, "run-123", "Implement value change")

    assert result["status"] == "blocked"
    # The dirty file (notes.txt) is unrelated to the patch (app.py), so the
    # publisher refuses to mix it into an automated commit.
    assert "don't match" in result["error"] or "doesn't match" in result["error"]
    assert _git(repo, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip() in {"master", "main"}


def test_publish_run_changes_commits_when_patch_already_materialised(tmp_path):
    """The orchestrator's apply_to_source writes patch files into the working
    tree before delivery. publish_run_changes must recognise that case and
    commit what's there rather than trying to apply the patch on top."""
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init")
    (repo / "app.py").write_text("value = 1\n", encoding="utf-8")
    _commit_all(repo)

    # Simulate apply_to_source by writing the patched content directly.
    (repo / "app.py").write_text("value = 2\n", encoding="utf-8")

    patch = """diff --git a/app.py b/app.py
--- a/app.py
+++ b/app.py
@@ -1 +1 @@
-value = 1
+value = 2
"""

    result = publish_run_changes(str(repo), patch, "run-aaa", "Already applied")

    assert result["status"] == "committed"
    assert result["changed_files"] == ["app.py"]
    branch = _git(repo, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
    assert branch == result["branch"]
    # File still has the new content because we committed what was already there.
    assert (repo / "app.py").read_text(encoding="utf-8") == "value = 2\n"
