from devflow.config import settings
from devflow.services.test_progress import TestProgressRecorder, get_test_progress_recorder, load_test_progress


def test_test_progress_uses_only_latest_run_per_test_path(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "ARTIFACTS_DIR", str(tmp_path))
    run_dir = tmp_path / "run-id"
    run_dir.mkdir()

    recorder = TestProgressRecorder("run-id")
    recorder.prepare()
    recorder.handle_event({"event": "started", "test_path": "tests/test_generated.py"})
    recorder.handle_event({
        "event": "finished",
        "result": {
            "test_path": "tests/test_generated.py",
            "success": False,
            "exit_code": 2,
            "total": 3,
            "counts": {"passed": 0, "failed": 0, "skipped": 0, "errors": 3},
        },
    })
    recorder.handle_event({"event": "started", "test_path": "tests/test_generated.py"})
    recorder.handle_event({
        "event": "finished",
        "result": {
            "test_path": "tests/test_generated.py",
            "success": False,
            "exit_code": 2,
            "total": 3,
            "counts": {"passed": 0, "failed": 0, "skipped": 0, "errors": 3},
        },
    })

    progress = load_test_progress("run-id")

    assert progress["total"] == 3
    assert progress["failed"] == 3
    assert len(progress["runs"]) == 2


def test_test_progress_recorder_requires_existing_run_artifact_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "ARTIFACTS_DIR", str(tmp_path))

    assert get_test_progress_recorder("run-1") is None
    assert not (tmp_path / "run-1").exists()

    (tmp_path / "real-run").mkdir()
    assert get_test_progress_recorder("real-run") is not None
