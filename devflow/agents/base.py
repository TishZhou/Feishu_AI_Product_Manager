from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

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
    def __init__(self, stage_def: "StageDefinition") -> None:
        self.stage_def = stage_def

    async def run(self, ctx: AgentContext) -> AgentResult:
        from devflow.providers.router import ToolDispatcher
        from devflow.tools.patch_tools import PATCH_TOOL_SCHEMAS, apply_patch
        from devflow.tools.repo_tools import (
            REPO_TOOL_SCHEMAS,
            list_dir,
            read_file,
            search_code,
            write_file,
        )
        from devflow.tools.test_runner import TEST_TOOL_SCHEMAS, run_test

        # Build a tool dispatcher bound to this run's repo_path
        dispatcher = ToolDispatcher()
        repo = ctx.repo_path

        dispatcher.register("list_dir", lambda path: list_dir(path, repo))
        dispatcher.register("read_file", lambda path: read_file(path, repo))
        dispatcher.register("search_code", lambda query, path_glob="**/*": search_code(query, repo, path_glob))
        dispatcher.register("write_file", lambda path, content: write_file(path, content, repo))
        dispatcher.register("apply_patch", lambda patch_content, check_only=False: apply_patch(patch_content, repo, check_only))
        dispatcher.register("run_test", lambda test_path: run_test(test_path, repo))

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
            run_id=ctx.run_id,
            stage_key=ctx.stage_key,
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

    @abstractmethod
    def parse_response(self, response: str, ctx: AgentContext) -> AgentResult: ...

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _get_artifact(self, ctx: AgentContext, stage_key: str, filename: str, default: Any = "") -> Any:
        return ctx.artifacts.get(stage_key, {}).get(filename, default)

    def _ok(self, ctx: AgentContext, artifacts: dict[str, str], raw: str) -> AgentResult:
        return AgentResult(stage_key=ctx.stage_key, success=True, artifacts=artifacts, raw_llm_response=raw)

    def _fail(self, ctx: AgentContext, error: str, raw: str = "") -> AgentResult:
        return AgentResult(stage_key=ctx.stage_key, success=False, error=error, raw_llm_response=raw)
