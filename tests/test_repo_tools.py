from devflow.tools.repo_tools import edit_file, read_file, search_code, write_file


def test_edit_file_replaces_exactly_one_match(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "app.py").write_text("x = 1\n", encoding="utf-8")

    result = edit_file("app.py", "x = 1", "x = 2", str(repo))

    assert result["action"] == "edited"
    assert (repo / "app.py").read_text(encoding="utf-8") == "x = 2\n"


def test_edit_file_rejects_ambiguous_match(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "app.py").write_text("x = 1\nx = 1\n", encoding="utf-8")

    result = edit_file("app.py", "x = 1", "x = 2", str(repo))

    assert "must be unique" in result["error"]
    assert (repo / "app.py").read_text(encoding="utf-8") == "x = 1\nx = 1\n"


def test_write_and_read_file_do_not_escape_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()

    assert "escapes repo root" in write_file("../outside.py", "x = 1\n", str(repo))["error"]
    assert "escapes repo root" in read_file("../outside.py", str(repo))["error"]


def test_search_code_finds_match(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "app.py").write_text("def hello():\n    return 'hi'\n", encoding="utf-8")

    result = search_code("hello", str(repo), "**/*.py")

    assert result["matches"]
    assert result["matches"][0]["file"].endswith("app.py")
