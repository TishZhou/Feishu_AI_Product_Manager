import json
from types import SimpleNamespace

from devflow.agents.requirement_analysis import RequirementAnalysisAgent
from devflow.core.orchestrator import PipelineOrchestrator
from devflow.core.pipeline_definition import STAGE_BY_KEY


def test_requirement_clarification_triggers_on_open_questions():
    orchestrator = PipelineOrchestrator()
    artifacts = {
        "requirement_spec.json": json.dumps({
            "title": "测试需求",
            "open_questions": ["分页上限是多少？"],
            "confidence_score": 0.8,
        }, ensure_ascii=False)
    }

    assert orchestrator._needs_requirement_clarification(artifacts)


def test_requirement_clarification_only_blocks_once_per_run():
    orchestrator = PipelineOrchestrator()
    run_id = "run-1"
    artifacts = {
        "requirement_spec.json": json.dumps({
            "title": "测试需求",
            "open_questions": ["分页上限是多少？"],
            "confidence_score": 0.8,
        }, ensure_ascii=False)
    }

    assert orchestrator._can_request_clarification(run_id, artifacts)
    orchestrator._clarification_completed.add(run_id)

    assert not orchestrator._can_request_clarification(run_id, artifacts)


def test_requirement_clarification_payload_contains_quality_check_items():
    orchestrator = PipelineOrchestrator()
    artifacts = {
        "requirement_spec.json": json.dumps({
            "title": "测试需求",
            "summary": "需要补充边界条件。",
            "open_questions": ["是否需要权限控制？"],
            "quality_check": {
                "missing_critical_info": ["目标用户"],
                "ambiguities": ["成功指标不明确"],
            },
            "confidence_score": 0.5,
        }, ensure_ascii=False)
    }

    payload = orchestrator._build_clarification_payload(artifacts)

    assert payload["title"] == "测试需求"
    assert payload["open_questions"] == ["是否需要权限控制？"]
    assert payload["missing_critical_info"] == ["目标用户"]
    assert payload["ambiguities"] == ["成功指标不明确"]


def test_requirement_prompt_keeps_clarification_separate_from_description():
    agent = RequirementAnalysisAgent(STAGE_BY_KEY["requirement_analysis"])
    ctx = SimpleNamespace(
        pipeline=SimpleNamespace(
            description="原始需求",
            task_type="feature",
            reference_context="参考文档内容",
            clarification_answers="回答人：user\n补充说明",
        ),
        repo_path="/repo",
    )

    prompt = agent.build_user_prompt(ctx)

    assert "需求描述：原始需求" in prompt
    assert "用户补充澄清（如为空则表示暂无）：\n回答人：user\n补充说明" in prompt
    assert "需求描述：原始需求\n\n【用户补充澄清】" not in prompt
