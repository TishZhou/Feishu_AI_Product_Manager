import json

from devflow.agents.base import AgentContext, AgentResult, BaseAgent
from devflow.agents.prompts import requirement_analysis as prompts


class RequirementAnalysisAgent(BaseAgent):
    def json_mode(self) -> bool:
        return True

    def max_tokens(self) -> int | None:
        return 2000

    def build_system_prompt(self, ctx: AgentContext) -> str:
        return prompts.SYSTEM

    def build_user_prompt(self, ctx: AgentContext) -> str:
        return prompts.USER_TMPL.format(
            description=ctx.pipeline.description,
            task_type=ctx.pipeline.task_type,
            repo_path=ctx.repo_path,
        )

    def parse_response(self, response: str, ctx: AgentContext) -> AgentResult:
        response = response.strip()
        # Strip potential markdown fences
        if response.startswith("```"):
            lines = response.splitlines()
            response = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

        try:
            json.loads(response)  # validate JSON
        except json.JSONDecodeError as e:
            return self._fail(ctx, f"Invalid JSON from LLM: {e}", response)

        return self._ok(ctx, {"requirement_spec.json": response}, response)
