from pathlib import Path

from devflow.tools.test_runner import run_test


def test_run_test_rejects_absolute_path_outside_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    outside = tmp_path / "outside_test.py"
    outside.write_text("def test_outside():\n    assert True\n", encoding="utf-8")

    result = run_test(str(outside), str(repo))

    assert result["success"] is False
    assert result["exit_code"] == -1
    assert "escapes repo root" in result["error"]


def test_run_test_rejects_parent_traversal(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    (tmp_path / "outside_test.py").write_text("def test_outside():\n    assert True\n", encoding="utf-8")

    result = run_test("../outside_test.py", str(repo))

    assert result["success"] is False
    assert result["exit_code"] == -1
    assert "escapes repo root" in result["error"]


def test_run_test_reports_pytest_counts(tmp_path):
    repo = tmp_path / "repo"
    tests_dir = repo / "tests"
    tests_dir.mkdir(parents=True)
    test_file = tests_dir / "test_sample.py"
    test_file.write_text("def test_ok():\n    assert True\n", encoding="utf-8")

    result = run_test(str(Path("tests") / "test_sample.py"), str(repo))

    assert result["success"] is True
    assert result["exit_code"] == 0
    assert result["test_path"] == "tests/test_sample.py"
    assert result["counts"]["passed"] == 1
    assert result["total"] == 1
