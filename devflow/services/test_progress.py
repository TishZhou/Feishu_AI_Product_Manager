from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from devflow.config import settings


_CASE_RE = re.compile(
    r"(?P<name>\S+::\S+)\s+"
    r"(?P<status>PASSED|FAILED|SKIPPED|ERROR|XFAIL|XPASS)\b"
)
_MAX_EVENTS = 500


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _progress_path(run_id: str) -> Path:
    return Path(settings.ARTIFACTS_DIR) / run_id / "test_progress.json"


def get_test_progress_recorder(run_id: str) -> "TestProgressRecorder | None":
    if not run_id:
        return None
    if not (Path(settings.ARTIFACTS_DIR) / run_id).exists():
        return None
    return TestProgressRecorder(run_id)


def default_test_progress(run_id: str) -> dict[str, Any]:
    return {
        "run_id": run_id,
        "status": "idle",
        "active_test_path": "",
        "test_files": [],
        "test_cases": [],
        "runs": [],
        "events": [],
        "total": 0,
        "passed": 0,
        "failed": 0,
        "skipped": 0,
        "exit_code": None,
        "started_at": None,
        "updated_at": None,
    }


def load_test_progress(run_id: str) -> dict[str, Any]:
    path = _progress_path(run_id)
    if not path.exists():
        return default_test_progress(run_id)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        data = default_test_progress(run_id)
        data["status"] = "failed"
        data["events"] = [{
            "time": _now(),
            "stream": "system",
            "line": "test_progress.json is not valid JSON",
        }]
    if not isinstance(data, dict):
        return default_test_progress(run_id)
    return _normalize_progress({**default_test_progress(run_id), **data})


def progress_from_report(run_id: str, report: dict[str, Any]) -> dict[str, Any]:
    runs = report.get("runner_validation", {}).get("runs", [])
    if not isinstance(runs, list):
        runs = []
    test_cases = report.get("test_cases", [])
    if not isinstance(test_cases, list):
        test_cases = []
    failed = _as_int(report.get("failed"))
    exit_code = report.get("exit_code")
    exit_code_int = _as_int(exit_code) if exit_code is not None else 1
    return {
        **default_test_progress(run_id),
        "status": "passed" if failed == 0 and exit_code_int == 0 else "failed",
        "active_test_path": report.get("test_file", "") or "",
        "test_files": report.get("test_files", []) if isinstance(report.get("test_files"), list) else [],
        "test_cases": test_cases,
        "runs": runs,
        "events": _events_from_runs(runs),
        "total": _as_int(report.get("total")),
        "passed": _as_int(report.get("passed")),
        "failed": failed,
        "skipped": _as_int(report.get("skipped")),
        "exit_code": exit_code,
        "started_at": None,
        "updated_at": _now(),
    }


class TestProgressRecorder:
    __test__ = False

    def __init__(self, run_id: str) -> None:
        self.run_id = run_id
        self.path = _progress_path(run_id)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def prepare(self) -> None:
        data = load_test_progress(self.run_id)
        if data["status"] == "idle":
            data["status"] = "preparing"
            data["started_at"] = _now()
            data["updated_at"] = data["started_at"]
            self._write(data)

    def handle_event(self, event: dict[str, Any]) -> None:
        data = load_test_progress(self.run_id)
        kind = event.get("event")
        if kind == "started":
            self._start_run(data, str(event.get("test_path") or "pytest"))
        elif kind == "output":
            self._append_output(data, str(event.get("stream") or "stdout"), str(event.get("line") or ""))
        elif kind == "finished":
            result = event.get("result") if isinstance(event.get("result"), dict) else {}
            self._finish_run(data, result)
        elif kind == "failed":
            data["status"] = "failed"
            self._append_event(data, "system", str(event.get("error") or "test run failed"))
        data["updated_at"] = _now()
        self._write(data)

    def _start_run(self, data: dict[str, Any], test_path: str) -> None:
        data["status"] = "running"
        if not data.get("started_at"):
            data["started_at"] = _now()
        data["active_test_path"] = test_path
        if test_path and test_path not in data["test_files"]:
            data["test_files"].append(test_path)
        data["runs"].append({
            "test_path": test_path,
            "success": None,
            "exit_code": None,
            "counts": {},
            "summary": "running",
            "stdout": "",
            "stderr": "",
        })
        self._append_event(data, "system", f"pytest started: {test_path}")

    def _append_output(self, data: dict[str, Any], stream: str, line: str) -> None:
        if not line:
            return
        self._append_event(data, stream, line)
        if data.get("runs"):
            last = data["runs"][-1]
            key = "stderr" if stream == "stderr" else "stdout"
            last[key] = (str(last.get(key) or "") + line + "\n")[-8000:]
        match = _CASE_RE.search(line)
        if match:
            self._upsert_case(data, match.group("name"), _normalize_status(match.group("status")))

    def _finish_run(self, data: dict[str, Any], result: dict[str, Any]) -> None:
        if data.get("runs"):
            data["runs"][-1].update(result)
        data["exit_code"] = result.get("exit_code")
        data["status"] = "passed" if result.get("success") else "failed"
        data["active_test_path"] = ""
        self._append_event(data, "system", str(result.get("summary") or "pytest finished"))
        _recompute_totals(data)

    def _append_event(self, data: dict[str, Any], stream: str, line: str) -> None:
        data["events"].append({"time": _now(), "stream": stream, "line": line})
        if len(data["events"]) > _MAX_EVENTS:
            data["events"] = data["events"][-_MAX_EVENTS:]

    def _upsert_case(self, data: dict[str, Any], name: str, status: str) -> None:
        cases = data.setdefault("test_cases", [])
        for item in cases:
            if isinstance(item, dict) and item.get("name") == name:
                item["status"] = status
                return
        cases.append({"id": f"TC-{len(cases) + 1:02d}", "name": name, "status": status, "message": ""})

    def _write(self, data: dict[str, Any]) -> None:
        _recompute_totals(data)
        tmp = self.path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.path)


def _normalize_status(status: str) -> str:
    mapping = {
        "PASSED": "passed",
        "FAILED": "failed",
        "ERROR": "failed",
        "SKIPPED": "skipped",
        "XFAIL": "skipped",
        "XPASS": "passed",
    }
    return mapping.get(status.upper(), status.lower())


def _as_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _normalize_progress(data: dict[str, Any]) -> dict[str, Any]:
    _recompute_totals(data)
    return data


def _latest_runs_by_path(runs: list[Any]) -> list[dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    fallback_index = 0
    for run in runs:
        if not isinstance(run, dict):
            continue
        path = str(run.get("test_path") or "")
        if not path:
            fallback_index += 1
            path = f"pytest run {fallback_index}"
        latest[path] = run
    return list(latest.values())


def _recompute_totals(data: dict[str, Any]) -> None:
    runs = data.get("runs")
    if not isinstance(runs, list) or not runs:
        return
    passed = failed = skipped = total = 0
    exit_code = 0
    for run in _latest_runs_by_path(runs):
        counts = run.get("counts") if isinstance(run.get("counts"), dict) else {}
        passed += _as_int(counts.get("passed"))
        failed += _as_int(counts.get("failed")) + _as_int(counts.get("errors"))
        skipped += _as_int(counts.get("skipped"))
        total += _as_int(run.get("total"))
        run_exit = run.get("exit_code")
        if run_exit is not None and _as_int(run_exit) != 0:
            exit_code = _as_int(run_exit)
    data["passed"] = passed
    data["failed"] = failed
    data["skipped"] = skipped
    data["total"] = total
    data["exit_code"] = exit_code


def _events_from_runs(runs: list[Any]) -> list[dict[str, str]]:
    events: list[dict[str, str]] = []
    for run in runs:
        if not isinstance(run, dict):
            continue
        for line in str(run.get("stdout") or "").splitlines()[-80:]:
            events.append({"time": _now(), "stream": "stdout", "line": line})
        if run.get("stderr") or run.get("error"):
            for line in str(run.get("stderr") or run.get("error") or "").splitlines()[-40:]:
                events.append({"time": _now(), "stream": "stderr", "line": line})
    return events[-_MAX_EVENTS:]
