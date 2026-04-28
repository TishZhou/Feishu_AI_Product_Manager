import json

from devflow.agents.base import AgentContext, AgentResult, BaseAgent
from devflow.agents.prompts import solution_architecture as prompts
from devflow.tools.repo_tools import REPO_TOOL_SCHEMAS


class SolutionArchitectureAgent(BaseAgent):
    def build_system_prompt(self, ctx: AgentContext) -> str:
        return prompts.SYSTEM

    def build_user_prompt(self, ctx: AgentContext) -> str:
        req_spec = self._get_artifact(ctx, "requirement_analysis", "requirement_spec.json", "{}")
        if isinstance(req_spec, dict):
            req_spec = json.dumps(req_spec, indent=2, ensure_ascii=False)
        return prompts.USER_TMPL.format(
            requirement_spec=req_spec,
            repo_path=ctx.repo_path,
        )

    def get_tools(self) -> list[dict]:
        return REPO_TOOL_SCHEMAS[:3]  # list_dir, read_file, search_code

    def parse_response(self, response: str, ctx: AgentContext) -> AgentResult:
        content = response.strip()
        if not content:
            return self._fail(ctx, "Empty response from LLM")
        return self._ok(ctx, {"solution_design.md": content}, content)
