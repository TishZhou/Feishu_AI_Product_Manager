import json
from pathlib import Path
from typing import Any

from devflow.agents.base import AgentContext, AgentResult, BaseAgent
from devflow.agents.prompts import test_generation as prompts
from devflow.tools.repo_tools import REPO_TOOL_SCHEMAS
from devflow.tools.test_runner import TEST_TOOL_SCHEMAS, run_test


_DEFAULT_TEST_PATH = "tests/test_generated.py"
_MAX_EMBEDDED_TEST_BYTES = 50_000


class TestGenerationAgent(BaseAgent):
    required_inputs = [
        ("solution_architecture", "solution_contract.json"),
        ("detailed_spec", "detailed_spec.json"),
        ("code_generation", "implementation_summary.md"),
        ("code_generation", "generated_files_manifest.json"),
    ]
    output_artifacts = ["test_report.json"]

    def json_mode(self) -> bool:
        return True

    def max_tokens(self) -> int | None:
        return None

    async def run(self, ctx: AgentContext) -> AgentResult:
        manifest = self._get_artifact(ctx, "code_generation", "generated_files_manifest.json", {})
        if isinstance(manifest, str):
            try:
                manifest = json.loads(manifest)
            except json.JSONDecodeError:
                manifest = {}
        workspace = str(manifest.get("execution_workspace", "")) if isinstance(manifest, dict) else ""
        if not workspace or not manifest.get("patch_applied_to_workspace"):
            return self._fail(ctx, "Test generation requires a successfully patched execution workspace.")
        if Path(ctx.repo_path).resolve() != Path(workspace).resolve():
            return self._fail(ctx, "Test generation refused to write outside the isolated execution workspace.")
        return await super().run(ctx)

    def build_system_prompt(self, ctx: AgentContext) -> str:
        return prompts.SYSTEM

    def build_user_prompt(self, ctx: AgentContext) -> str:
        spec = self._get_artifact(ctx, "detailed_spec", "detailed_spec.json", "{}")
        if isinstance(spec, dict):
            spec = json.dumps(spec, indent=2, ensure_ascii=False)

        summary = self._get_artifact(ctx, "code_generation", "implementation_summary.md", "")
        solution_contract = self._get_artifact(ctx, "solution_architecture", "solution_contract.json", "{}")
        if isinstance(solution_contract, dict):
            solution_contract = json.dumps(solution_contract, indent=2, ensure_ascii=False)

        return prompts.USER_TMPL.format(
            detailed_spec=spec,
            solution_contract=solution_contract,
            implementation_summary=summary,
            repo_path=ctx.repo_path,
        )

    def get_tools(self) -> list[dict]:
        # Read existing code/tests, write generated tests in the isolated workspace, then execute them.
        return [REPO_TOOL_SCHEMAS[i] for i in (0, 1, 2, 3, 4)] + TEST_TOOL_SCHEMAS

    def parse_response(self, response: str, ctx: AgentContext) -> AgentResult:
        raw_response = response.strip()
        response = raw_response
        if response.startswith("```"):
            lines = response.splitlines()
            response = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

        parse_error = ""
        try:
            report = json.loads(response)
            if not isinstance(report, dict):
                raise json.JSONDecodeError("Top-level JSON must be an object", response, 0)
        except json.JSONDecodeError:
            parse_error = response[:2000]
            report = {
                "test_file": _DEFAULT_TEST_PATH,
                "test_command": f"pytest {_DEFAULT_TEST_PATH} -v",
                "total": 0,
                "passed": 0,
                "failed": 0,
                "skipped": 0,
                "exit_code": -1,
                "test_cases": [],
                "error_log": parse_error,
                "summary": "Test report parsing failed — raw output captured.",
            }

        report = _validate_and_enrich_report(report, ctx.repo_path, parse_error)
        response = json.dumps(report, ensure_ascii=False, indent=2)

        return self._ok(ctx, {"test_report.json": response}, response)


def _validate_and_enrich_report(report: dict[str, Any], repo_path: str, parse_error: str = "") -> dict[str, Any]:
    test_paths = _extract_test_paths(report) or [_DEFAULT_TEST_PATH]
    validation_runs = [run_test(path, repo_path) for path in test_paths[:5]]
    aggregate = _aggregate_runs(validation_runs)

    report["test_file"] = test_paths[0]
    report["test_files"] = test_paths
    report.setdefault("test_command", f"pytest {' '.join(test_paths)} -v")
    report["total"] = aggregate["total"]
    report["passed"] = aggregate["passed"]
    report["failed"] = aggregate["failed"]
    report["skipped"] = aggregate["skipped"]
    report["exit_code"] = aggregate["exit_code"]
    report["summary"] = aggregate["summary"]
    report["error_log"] = _build_error_log(validation_runs, parse_error)
    report["generated_test_files"] = _read_generated_test_files(test_paths, repo_path)
    report["runner_validation"] = {
        "validated": True,
        "runs": validation_runs,
    }

    test_cases = report.get("test_cases")
    if not isinstance(test_cases, list):
        report["test_cases"] = []
    if report["failed"] and not report["test_cases"]:
        report["test_cases"] = [{
            "id": "TC-RUNNER",
            "name": "pytest execution",
            "status": "failed",
            "message": report["summary"],
        }]
    return report


def _extract_test_paths(report: dict[str, Any]) -> list[str]:
    paths: list[str] = []

    def add(value: Any) -> None:
        if isinstance(value, str) and value.strip() and value.strip() != "unknown":
            paths.append(value.strip())

    add(report.get("test_file"))
    test_files = report.get("test_files", [])
    if isinstance(test_files, list):
        for value in test_files:
            add(value)
    generated = report.get("generated_test_files", [])
    if isinstance(generated, list):
        for item in generated:
            if isinstance(item, dict):
                add(item.get("path"))
            else:
                add(item)

    deduped = []
    seen = set()
    for path in paths:
        if path not in seen:
            seen.add(path)
            deduped.append(path)
    return deduped


def _aggregate_runs(runs: list[dict[str, Any]]) -> dict[str, Any]:
    passed = failed = skipped = total = 0
    exit_code = 0
    summaries = []

    for run in runs:
        counts = run.get("counts") if isinstance(run.get("counts"), dict) else {}
        run_passed = int(counts.get("passed", 0) or 0)
        run_failed = int(counts.get("failed", 0) or 0) + int(counts.get("errors", 0) or 0)
        run_skipped = int(counts.get("skipped", 0) or 0)
        run_total = int(run.get("total", 0) or 0)

        if not run.get("success") and run_total == 0:
            run_failed = max(run_failed, 1)
            run_total = max(run_total, 1)

        passed += run_passed
        failed += run_failed
        skipped += run_skipped
        total += run_total
        run_exit_code = int(run.get("exit_code", 1) if run.get("exit_code") is not None else 1)
        if run_exit_code != 0:
            exit_code = run_exit_code
        if run.get("summary"):
            summaries.append(str(run["summary"]))
        elif run.get("error"):
            summaries.append(str(run["error"]))

    return {
        "passed": passed,
        "failed": failed,
        "skipped": skipped,
        "total": total,
        "exit_code": exit_code,
        "summary": "; ".join(summaries) if summaries else "No pytest execution summary available.",
    }


def _build_error_log(runs: list[dict[str, Any]], parse_error: str) -> str:
    chunks = []
    if parse_error:
        chunks.append(f"LLM JSON parse error/raw output:\n{parse_error}")
    for run in runs:
        if run.get("success"):
            continue
        detail = run.get("error") or run.get("stderr") or run.get("stdout") or ""
        if detail:
            chunks.append(str(detail)[-4000:])
    return "\n\n".join(chunks)


def _read_generated_test_files(test_paths: list[str], repo_path: str) -> list[dict[str, Any]]:
    root = Path(repo_path).resolve()
    files = []
    for test_path in test_paths[:5]:
        target = (root / test_path).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            files.append({"path": test_path, "content": "", "truncated": False, "error": "path escapes repo root"})
            continue
        if not target.exists() or not target.is_file():
            files.append({"path": test_path, "content": "", "truncated": False, "error": "file not found"})
            continue
        content = target.read_text(encoding="utf-8", errors="replace")
        truncated = len(content.encode("utf-8")) > _MAX_EMBEDDED_TEST_BYTES
        if truncated:
            content = content[:_MAX_EMBEDDED_TEST_BYTES]
        files.append({"path": test_path, "content": content, "truncated": truncated})
    return files
