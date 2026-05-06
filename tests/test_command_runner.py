from devflow.tools.command_runner import run_command


def test_run_command_rejects_shell_operators(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()

    result = run_command("pytest tests || echo bypass", str(repo))

    assert result["success"] is False
    assert result["blocked"] is True
    assert "shell operators" in result["error"]


def test_run_command_rejects_non_validation_command(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()

    result = run_command("npm install", str(repo))

    assert result["success"] is False
    assert result["blocked"] is True
    assert "allowlist" in result["error"]


def test_run_command_runs_allowed_pytest_command(tmp_path):
    repo = tmp_path / "repo"
    tests_dir = repo / "tests"
    tests_dir.mkdir(parents=True)
    (tests_dir / "test_sample.py").write_text("def test_ok():\n    assert True\n", encoding="utf-8")

    result = run_command("pytest tests/test_sample.py -q", str(repo))

    assert result["success"] is True
    assert result["exit_code"] == 0
    assert "1 passed" in result["stdout"]


def test_run_command_rejects_cwd_escape(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()

    result = run_command("pytest tests -q", str(repo), cwd="../")

    assert result["success"] is False
    assert result["blocked"] is True
    assert "cwd escapes repo root" in result["error"]
