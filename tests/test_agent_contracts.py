import pytest

from devflow.agents.base import AgentContext
from devflow.agents.detailed_spec import DetailedSpecAgent
from devflow.core.pipeline_definition import STAGE_REGISTRY, STAGE_BY_KEY
from devflow.providers.router import _max_tokens_param


def test_all_agents_declare_valid_io_contracts():
    produced_by_stage = {stage.key: set(stage.output_artifacts) for stage in STAGE_REGISTRY}

    for stage in STAGE_REGISTRY:
        agent_class = stage.get_agent_class()

        assert agent_class.output_artifacts == stage.output_artifacts
        assert agent_class.output_artifacts

        for input_stage, filename in agent_class.required_inputs:
            assert input_stage in STAGE_BY_KEY
            assert input_stage in stage.reads_from_stages
            assert filename in produced_by_stage[input_stage]


def test_openai_reasoning_models_use_max_completion_tokens():
    assert _max_tokens_param("openai", "gpt-5.4") == "max_completion_tokens"
    assert _max_tokens_param("openai", "o3-mini") == "max_completion_tokens"
    assert _max_tokens_param("openai", "gpt-4o") == "max_tokens"
    assert _max_tokens_param("volcano", "seed-v1.6") == "max_tokens"


def test_detailed_spec_agent_uses_explicit_completion_budget():
    agent = DetailedSpecAgent(STAGE_BY_KEY["detailed_spec"])

    # detailed_spec produces large structured output that does not fit in the
    # 12k JSON-mode default; it requires an explicit higher budget. Provider
    # and model stay inherited from pipeline config (chosen in SetupView).
    assert agent.max_tokens() == 16000
    assert agent._resolved_max_tokens() == 16000
    assert agent.provider_override(ctx=None) is None
    assert agent.model_override(ctx=None) is None


def test_delivery_requires_human_confirmation_before_git_publish():
    delivery = STAGE_BY_KEY["delivery"]

    assert delivery.checkpoint_after == 3
    assert delivery.checkpoint_default_retry == "code_review"


def test_agent_init_rejects_output_contract_drift():
    stage = STAGE_BY_KEY["requirement_analysis"]
    agent_class = stage.get_agent_class()
    original_outputs = agent_class.output_artifacts

    try:
        agent_class.output_artifacts = ["wrong.md"]
        with pytest.raises(ValueError, match="output_artifacts mismatch"):
            agent_class(stage)
    finally:
        agent_class.output_artifacts = original_outputs


@pytest.mark.asyncio
async def test_agent_fails_before_llm_when_required_input_is_missing():
    stage = STAGE_BY_KEY["solution_architecture"]
    agent = stage.get_agent_class()(stage)
    ctx = AgentContext(
        run_id="test-run",
        pipeline=object(),
        stage_key=stage.key,
        attempt=1,
        artifacts={},
        repo_path=".",
        provider_router=object(),
    )

    result = await agent.run(ctx)

    assert not result.success
    assert result.error == "Missing required input artifact(s): requirement_analysis/requirement_spec.json"
