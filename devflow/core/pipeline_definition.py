from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from devflow.agents.base import BaseAgent


@dataclass
class StageDefinition:
    key: str
    index: int
    agent_class_path: str           # dotted import path, e.g. "devflow.agents.requirement_analysis.RequirementAnalysisAgent"
    output_artifacts: list[str]
    reads_from_stages: list[str]
    checkpoint_after: int | None    # checkpoint number (1 or 2) that fires after this stage
    allow_parallel: bool = False

    # Checkpoint default retry stage if rejected
    checkpoint_default_retry: str = ""

    def get_agent_class(self) -> type:
        module_path, class_name = self.agent_class_path.rsplit(".", 1)
        import importlib
        module = importlib.import_module(module_path)
        return getattr(module, class_name)


STAGE_REGISTRY: list[StageDefinition] = [
    StageDefinition(
        key="requirement_analysis",
        index=1,
        agent_class_path="devflow.agents.requirement_analysis.RequirementAnalysisAgent",
        output_artifacts=["requirement_spec.prd.md", "requirement_spec.json"],
        reads_from_stages=[],
        checkpoint_after=None,
    ),
    StageDefinition(
        key="solution_architecture",
        index=2,
        agent_class_path="devflow.agents.solution_architecture.SolutionArchitectureAgent",
        output_artifacts=["repo_context_summary.json", "solution_design.md", "solution_contract.json"],
        reads_from_stages=["requirement_analysis"],
        checkpoint_after=None,
    ),
    StageDefinition(
        key="detailed_spec",
        index=3,
        agent_class_path="devflow.agents.detailed_spec.DetailedSpecAgent",
        output_artifacts=["detailed_spec.json"],
        reads_from_stages=["requirement_analysis", "solution_architecture"],
        checkpoint_after=1,
        checkpoint_default_retry="requirement_analysis",
    ),
    StageDefinition(
        key="code_generation",
        index=4,
        agent_class_path="devflow.agents.code_generation.CodeGenerationAgent",
        output_artifacts=["code_diff.patch", "implementation_summary.md", "generated_files_manifest.json"],
        reads_from_stages=["requirement_analysis", "solution_architecture", "detailed_spec"],
        checkpoint_after=None,
    ),
    StageDefinition(
        key="test_generation",
        index=5,
        agent_class_path="devflow.agents.test_generation.TestGenerationAgent",
        output_artifacts=["test_report.json"],
        reads_from_stages=["solution_architecture", "detailed_spec", "code_generation"],
        checkpoint_after=None,
    ),
    StageDefinition(
        key="code_review",
        index=6,
        agent_class_path="devflow.agents.code_review.CodeReviewAgent",
        output_artifacts=["review_report.md"],
        reads_from_stages=["solution_architecture", "detailed_spec", "code_generation", "test_generation"],
        checkpoint_after=2,
        checkpoint_default_retry="code_generation",
    ),
    StageDefinition(
        key="delivery",
        index=7,
        agent_class_path="devflow.agents.delivery.DeliveryAgent",
        output_artifacts=["delivery_summary.md", "final_diff.patch"],
        reads_from_stages=["code_generation", "test_generation", "code_review"],
        checkpoint_after=None,
    ),
]

# Lookup by key
STAGE_BY_KEY: dict[str, StageDefinition] = {s.key: s for s in STAGE_REGISTRY}


def get_stage(key: str) -> StageDefinition:
    if key not in STAGE_BY_KEY:
        raise KeyError(f"Unknown stage key: {key!r}")
    return STAGE_BY_KEY[key]


def stages_from(key: str) -> list[StageDefinition]:
    """Return all stages starting from (and including) the given key, in order."""
    start_index = STAGE_BY_KEY[key].index
    return [s for s in STAGE_REGISTRY if s.index >= start_index]
