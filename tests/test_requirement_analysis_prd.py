import json
from types import SimpleNamespace

from devflow.agents.requirement_analysis import RequirementAnalysisAgent, render_requirement_prd
from devflow.core.pipeline_definition import STAGE_BY_KEY


def _ctx():
    return SimpleNamespace(stage_key="requirement_analysis")


def test_render_requirement_prd_from_spec():
    spec = {
        "title": "Paginated Runs API",
        "summary": "Add a paginated endpoint for listing pipeline runs.",
        "task_type": "feature",
        "scope_in": ["GET /api/runs supports page and page_size"],
        "scope_out": ["Changing run creation behavior"],
        "problem_statement": "Runs are hard to browse when there are many records.",
        "target_users": ["Platform operator"],
        "functional_requirements": ["FR1: Return runs sorted by created_at descending"],
        "acceptance_criteria": ["Given existing runs When page=1 Then the latest runs are returned"],
        "handoff_to_architecture_agent": {
            "core_product_goal": "Expose runs in pages",
            "must_have_capabilities": ["Pagination"],
        },
        "quality_check": {
            "ready_for_stage2_architecture": True,
        },
        "confidence_score": 0.9,
    }

    prd = render_requirement_prd(spec)

    assert "# Paginated Runs API" in prd
    assert "## 功能需求" in prd
    assert "1. FR1: Return runs sorted by created_at descending" in prd
    assert "## 验收标准" in prd
    assert "## 架构交接摘要" in prd
    assert "## 质量自检" in prd


def test_requirement_analysis_returns_prd_and_json_artifacts():
    agent = RequirementAnalysisAgent(STAGE_BY_KEY["requirement_analysis"])
    response = json.dumps(
        {
            "title": "Paginated Runs API",
            "summary": "Add a paginated endpoint for listing pipeline runs.",
            "task_type": "feature",
            "functional_requirements": ["FR1: Return sorted runs"],
            "acceptance_criteria": ["Given runs When requested Then return a page"],
            "confidence_score": 0.9,
        }
    )

    result = agent.parse_response(response, _ctx())

    assert result.success
    assert list(result.artifacts) == ["requirement_spec.prd.md", "requirement_spec.json"]
    assert json.loads(result.artifacts["requirement_spec.json"])["title"] == "Paginated Runs API"
    assert "# Paginated Runs API" in result.artifacts["requirement_spec.prd.md"]
