import json
from types import SimpleNamespace

import pytest

from devflow.agents.base import AgentContext
from devflow.agents.test_generation import TestGenerationAgent as _TestGenerationAgent
from devflow.agents.prompts import test_generation as test_generation_prompts
from devflow.core.pipeline_definition import STAGE_BY_KEY


class DummyProvider:
    async def chat(self, **kwargs):
        return json.dumps({
            "test_file": "tests/test_generated.py",
            "test_command": "pytest tests/test_generated.py -v",
            "total": 0,
            "passed": 0,
            "failed": 0,
            "skipped": 0,
            "test_cases": [],
            "error_log": "",
            "summary": "not executed",
        })


def _ctx(repo_path, workspace):
    return AgentContext(
        run_id="run-1",
        pipeline=SimpleNamespace(model="", provider="openai"),
        stage_key="test_generation",
        attempt=1,
        artifacts={
            "solution_architecture": {"solution_contract.json": "{}"},
            "detailed_spec": {"detailed_spec.json": "{}"},
            "code_generation": {
                "implementation_summary.md": "summary",
                "generated_files_manifest.json": {
                    "patch_applied_to_workspace": True,
                    "execution_workspace": str(workspace),
                },
            },
        },
        repo_path=str(repo_path),
        provider_router=DummyProvider(),
    )


@pytest.mark.asyncio
async def test_test_generation_refuses_non_workspace_repo_path(tmp_path):
    repo = tmp_path / "repo"
    workspace = tmp_path / "artifacts" / "run-1" / "execution_workspace_abc"
    repo.mkdir()
    workspace.mkdir(parents=True)
    agent = _TestGenerationAgent(STAGE_BY_KEY["test_generation"])

    result = await agent.run(_ctx(repo, workspace))

    assert not result.success
    assert "refused to write outside" in result.error


def test_test_generation_report_is_validated_against_pytest(tmp_path):
    workspace = tmp_path / "artifacts" / "run-1" / "execution_workspace_abc"
    tests_dir = workspace / "tests"
    tests_dir.mkdir(parents=True)
    (tests_dir / "test_generated.py").write_text("def test_ok():\n    assert True\n", encoding="utf-8")

    agent = _TestGenerationAgent(STAGE_BY_KEY["test_generation"])
    ctx = _ctx(workspace, workspace)

    result = agent.parse_response(
        json.dumps({
            "test_file": "tests/test_generated.py",
            "test_command": "pytest tests/test_generated.py -v",
            "total": 0,
            "passed": 0,
            "failed": 0,
            "skipped": 0,
            "exit_code": 1,
            "test_cases": [],
            "error_log": "",
            "summary": "hallucinated failure",
        }),
        ctx,
    )

    assert result.success
    report = json.loads(result.artifacts["test_report.json"])
    assert report["total"] == 1
    assert report["passed"] == 1
    assert report["failed"] == 0
    assert report["exit_code"] == 0
    assert report["runner_validation"]["validated"] is True
    assert report["generated_test_files"][0]["content"].startswith("def test_ok")


def test_test_generation_prompt_uses_failure_analysis_framework():
    prompt = test_generation_prompts.SYSTEM

    assert "not a checklist" in prompt
    assert "failure-analysis thinking framework" in prompt
    assert "about 5" in prompt
    assert "narrow changes" in prompt
    assert "On retry, do not brainstorm from" in prompt
    assert "do not generate broad low-signal tests just to fill a list" in prompt
    assert "risk_brainstorm" in prompt
    assert "verification_log" in prompt
    assert "read_file" in prompt
    assert "search_code" in prompt
    assert "run_test" in prompt
    assert "observable contract tests" in prompt
