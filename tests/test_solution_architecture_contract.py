import json
from types import SimpleNamespace

import pytest

from devflow.agents.solution_architecture import SolutionArchitectureAgent
from devflow.core.pipeline_definition import STAGE_BY_KEY
from devflow.services.repo_map import build_repo_context_summary


def test_repo_context_summary_finds_project_files():
    context = build_repo_context_summary(".", {
        "title": "pipeline runs api",
        "functional_requirements": ["GET /api/runs should list runs"],
    })

    assert context["file_count"] > 0
    assert any(item["path"] == "devflow/api/runs.py" for item in context["files"])
    assert any(route["file"] == "devflow/api/runs.py" for route in context["api_routes"])


def test_solution_architecture_returns_repo_context_design_and_contract():
    agent = SolutionArchitectureAgent(STAGE_BY_KEY["solution_architecture"])
    agent._repo_context_summary = json.dumps({"relevant_files": ["devflow/api/runs.py"]})
    response = (
        "# 技术方案\n\n修改 runs API。\n"
        "---SOLUTION_CONTRACT_JSON---\n"
        + json.dumps({
            "change_intent": "增加 runs API",
            "repo_context": {"relevant_files": ["devflow/api/runs.py"]},
            "localization": {"files": []},
            "impact_analysis": {"files_to_modify": ["devflow/api/runs.py"]},
            "implementation_plan": [],
            "acceptance_mapping": [],
            "validation_plan": {},
            "risks": [],
            "deferred_items": [],
        }, ensure_ascii=False)
    )

    result = agent.parse_response(response, SimpleNamespace(stage_key="solution_architecture"))

    assert result.success
    assert list(result.artifacts) == ["repo_context_summary.json", "solution_design.md", "solution_contract.json"]
    assert "# 技术方案" in result.artifacts["solution_design.md"]
    assert json.loads(result.artifacts["solution_contract.json"])["change_intent"] == "增加 runs API"


def test_solution_architecture_accepts_markdown_without_json_escaping():
    agent = SolutionArchitectureAgent(STAGE_BY_KEY["solution_architecture"])
    agent._repo_context_summary = "{}"
    response = """# 技术方案

这里可以包含 "quotes"、冒号: 和 Markdown 表格，不需要 JSON 转义。

---SOLUTION_CONTRACT_JSON---
{"change_intent":"测试","repo_context":{},"localization":{},"impact_analysis":{},"implementation_plan":[],"acceptance_mapping":[],"validation_plan":{},"risks":[],"deferred_items":[]}
"""

    result = agent.parse_response(response, SimpleNamespace(stage_key="solution_architecture"))

    assert result.success
    assert '"quotes"' in result.artifacts["solution_design.md"]


def test_solution_architecture_extracts_json_from_chatty_response():
    agent = SolutionArchitectureAgent(STAGE_BY_KEY["solution_architecture"])
    agent._repo_context_summary = "{}"
    response = """# 技术方案

设计说明。

---SOLUTION_CONTRACT_JSON---
下面是 contract：

```json
{"change_intent":"测试","repo_context":{},"localization":{},"impact_analysis":{},"implementation_plan":[],"acceptance_mapping":[],"validation_plan":{},"risks":[],"deferred_items":[]}
```

已完成。
"""

    result = agent.parse_response(response, SimpleNamespace(stage_key="solution_architecture"))

    assert result.success
    assert json.loads(result.artifacts["solution_contract.json"])["change_intent"] == "测试"


@pytest.mark.asyncio
async def test_solution_architecture_repairs_missing_separator_with_contract_call():
    class FakeProviderRouter:
        def __init__(self):
            self.calls = 0

        async def chat(self, **kwargs):
            self.calls += 1
            if self.calls == 1:
                return "# 技术方案\n\n模型只返回了 Markdown 方案。"
            return json.dumps({
                "change_intent": "修复 contract",
                "repo_context": {"relevant_files": ["devflow/api/runs.py"]},
                "localization": {"files": []},
                "impact_analysis": {"files_to_modify": ["devflow/api/runs.py"]},
                "implementation_plan": [],
                "acceptance_mapping": [],
                "validation_plan": {},
                "risks": [],
                "deferred_items": [],
            }, ensure_ascii=False)

    provider_router = FakeProviderRouter()
    agent = SolutionArchitectureAgent(STAGE_BY_KEY["solution_architecture"])
    ctx = SimpleNamespace(
        run_id="run-1",
        pipeline=SimpleNamespace(model="", provider="openai"),
        stage_key="solution_architecture",
        attempt=1,
        artifacts={"requirement_analysis": {"requirement_spec.json": {"title": "Runs API"}}},
        repo_path=".",
        provider_router=provider_router,
    )

    result = await agent.run(ctx)

    assert result.success
    assert provider_router.calls == 2
    assert json.loads(result.artifacts["solution_contract.json"])["change_intent"] == "修复 contract"
