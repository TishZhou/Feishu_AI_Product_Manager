import json

from devflow.agents.base import AgentContext, AgentResult, BaseAgent
from devflow.agents.prompts import detailed_spec as prompts


class DetailedSpecAgent(BaseAgent):
    def json_mode(self) -> bool:
        return True

    def max_tokens(self) -> int | None:
        return None

    def build_system_prompt(self, ctx: AgentContext) -> str:
        return prompts.SYSTEM

    def build_user_prompt(self, ctx: AgentContext) -> str:
        req_spec = self._get_artifact(ctx, "requirement_analysis", "requirement_spec.json", "{}")
        if isinstance(req_spec, dict):
            req_spec = json.dumps(req_spec, indent=2, ensure_ascii=False)

        solution = self._get_artifact(ctx, "solution_architecture", "solution_design.md", "")

        return prompts.USER_TMPL.format(
            requirement_spec=req_spec,
            solution_design=solution,
        )

    def parse_response(self, response: str, ctx: AgentContext) -> AgentResult:
        response = response.strip()
        if response.startswith("```"):
            lines = response.splitlines()
            response = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

        try:
            json.loads(response)
        except json.JSONDecodeError as e:
            return self._fail(ctx, f"Invalid JSON from LLM: {e}", response)

        return self._ok(ctx, {"detailed_spec.json": response}, response)
