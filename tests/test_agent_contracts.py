import pytest

from devflow.agents.base import AgentContext
from devflow.core.pipeline_definition import STAGE_REGISTRY, STAGE_BY_KEY


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
