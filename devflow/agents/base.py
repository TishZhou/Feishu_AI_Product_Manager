from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, ClassVar

if TYPE_CHECKING:
    from devflow.core.pipeline_definition import StageDefinition
    from devflow.db.models import Pipeline
    from devflow.providers.router import ProviderRouter, ToolDispatcher


@dataclass
class AgentContext:
    run_id: str
    pipeline: "Pipeline"
    stage_key: str
    attempt: int
    # {stage_key: {filename: parsed_content_or_str}}
    artifacts: dict[str, dict[str, Any]]
    repo_path: str
    provider_router: "ProviderRouter"
    tool_dispatcher: "ToolDispatcher | None" = None


@dataclass
class AgentResult:
    stage_key: str
    success: bool
    # {filename: raw_string_content} — written to ArtifactStore by orchestrator
    artifacts: dict[str, str] = field(default_factory=dict)
    error: str | None = None
    raw_llm_response: str | None = None


class BaseAgent(ABC):
    required_inputs: ClassVar[list[tuple[str, str]]] = []
    output_artifacts: ClassVar[list[str]] = []

    def __init__(self, stage_def: "StageDefinition") -> None:
        self.stage_def = stage_def
        self._validate_contract()

    async def run(self, ctx: AgentContext) -> AgentResult:
        from devflow.providers.router import ToolDispatcher
        from devflow.tools.patch_tools import PATCH_TOOL_SCHEMAS, apply_patch
        from devflow.tools.command_runner import run_command
        from devflow.tools.repo_tools import (
            REPO_TOOL_SCHEMAS,
            list_dir,
            read_file,
            search_code,
            edit_file,
            write_file,
        )
        from devflow.tools.test_runner import TEST_TOOL_SCHEMAS, run_test
        from devflow.services.test_progress import get_test_progress_recorder

        missing_inputs = self._missing_required_inputs(ctx)
        if missing_inputs:
            formatted = ", ".join(f"{stage}/{filename}" for stage, filename in missing_inputs)
            return self._fail(ctx, f"Missing required input artifact(s): {formatted}")

        # Build a tool dispatcher bound to this run's repo_path
        dispatcher = ToolDispatcher()
        repo = ctx.repo_path
        test_progress = get_test_progress_recorder(ctx.run_id) if ctx.stage_key == "test_generation" else None
        if test_progress:
            test_progress.prepare()

        dispatcher.register("list_dir", lambda path: list_dir(path, repo))
        dispatcher.register("read_file", lambda path: read_file(path, repo))
        dispatcher.register("search_code", lambda query, path_glob="**/*": search_code(query, repo, path_glob))
        dispatcher.register("write_file", lambda path, content: write_file(path, content, repo))
        dispatcher.register("edit_file", lambda path, old_str, new_str: edit_file(path, old_str, new_str, repo))
        dispatcher.register("apply_patch", lambda patch_content, check_only=False: apply_patch(patch_content, repo, check_only))
        dispatcher.register("run_command", lambda command, cwd=".", timeout_seconds=120: run_command(command, repo, cwd, timeout_seconds))
        dispatcher.register(
            "run_test",
            lambda test_path: run_test(
                test_path,
                repo,
                progress_callback=test_progress.handle_event if test_progress else None,
            ),
        )

        system_prompt = self.build_system_prompt(ctx)
        user_prompt = self.build_user_prompt(ctx)
        tools = self.get_tools()

        raw_response = await ctx.provider_router.chat(
            system=system_prompt,
            user=user_prompt,
            tools=tools or None,
            model=ctx.pipeline.model or None,
            provider=ctx.pipeline.provider,
            tool_dispatcher=dispatcher if tools else None,
            json_mode=self.json_mode(),
            max_tokens=self.max_tokens(),
            max_tool_rounds=self.max_tool_rounds(),
            cache_key=f"devflow:{ctx.stage_key}",
        )

        return self.parse_response(raw_response, ctx)

    @abstractmethod
    def build_system_prompt(self, ctx: AgentContext) -> str: ...

    @abstractmethod
    def build_user_prompt(self, ctx: AgentContext) -> str: ...

    def get_tools(self) -> list[dict]:
        return []

    def json_mode(self) -> bool:
        return False

    def max_tokens(self) -> int | None:
        return None

    def max_tool_rounds(self) -> int:
        return 25

    @abstractmethod
    def parse_response(self, response: str, ctx: AgentContext) -> AgentResult: ...

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _validate_contract(self) -> None:
        if not self.output_artifacts:
            raise ValueError(f"{self.__class__.__name__} must declare output_artifacts")
        if self.output_artifacts != self.stage_def.output_artifacts:
            raise ValueError(
                f"{self.__class__.__name__} output_artifacts mismatch: "
                f"agent={self.output_artifacts!r}, stage={self.stage_def.output_artifacts!r}"
            )

        declared_input_stages = {stage for stage, _ in self.required_inputs}
        available_input_stages = set(self.stage_def.reads_from_stages)
        missing_stage_links = sorted(declared_input_stages - available_input_stages)
        if missing_stage_links:
            raise ValueError(
                f"{self.__class__.__name__} requires input stages not declared in pipeline: "
                f"{missing_stage_links!r}"
            )

    def _missing_required_inputs(self, ctx: AgentContext) -> list[tuple[str, str]]:
        missing = []
        for stage_key, filename in self.required_inputs:
            if filename not in ctx.artifacts.get(stage_key, {}):
                missing.append((stage_key, filename))
        return missing

    def _get_artifact(self, ctx: AgentContext, stage_key: str, filename: str, default: Any = "") -> Any:
        return ctx.artifacts.get(stage_key, {}).get(filename, default)

    def _ok(self, ctx: AgentContext, artifacts: dict[str, str], raw: str) -> AgentResult:
        actual = list(artifacts)
        if actual != self.output_artifacts:
            return self._fail(
                ctx,
                f"Output artifact contract mismatch: expected {self.output_artifacts!r}, got {actual!r}",
                raw,
            )
        return AgentResult(stage_key=ctx.stage_key, success=True, artifacts=artifacts, raw_llm_response=raw)

    def _fail(self, ctx: AgentContext, error: str, raw: str = "") -> AgentResult:
        return AgentResult(stage_key=ctx.stage_key, success=False, error=error, raw_llm_response=raw)
