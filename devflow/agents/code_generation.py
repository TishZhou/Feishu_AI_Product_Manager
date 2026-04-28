import json

from devflow.agents.base import AgentContext, AgentResult, BaseAgent
from devflow.agents.prompts import code_generation as prompts
from devflow.tools.repo_tools import REPO_TOOL_SCHEMAS

_SEPARATOR = "---IMPLEMENTATION_SUMMARY---"


class CodeGenerationAgent(BaseAgent):
    def build_system_prompt(self, ctx: AgentContext) -> str:
        return prompts.SYSTEM

    def build_user_prompt(self, ctx: AgentContext) -> str:
        spec = self._get_artifact(ctx, "detailed_spec", "detailed_spec.json", "{}")
        if isinstance(spec, dict):
            spec = json.dumps(spec, indent=2, ensure_ascii=False)
        solution = self._get_artifact(ctx, "solution_architecture", "solution_design.md", "")
        return prompts.USER_TMPL.format(
            detailed_spec=spec,
            solution_design=solution,
            repo_path=ctx.repo_path,
        )

    def get_tools(self) -> list[dict]:
        return REPO_TOOL_SCHEMAS[:3]  # list_dir, read_file, search_code

    def parse_response(self, response: str, ctx: AgentContext) -> AgentResult:
        response = response.strip()
        if _SEPARATOR in response:
            parts = response.split(_SEPARATOR, 1)
            patch = parts[0].strip()
            summary = parts[1].strip()
        else:
            patch = response
            summary = "Implementation summary not provided."

        # Strip markdown fences from patch if present
        if patch.startswith("```"):
            lines = patch.splitlines()
            patch = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

        # git apply requires a trailing newline
        if patch and not patch.endswith("\n"):
            patch += "\n"

        return self._ok(ctx, {
            "code_diff.patch": patch,
            "implementation_summary.md": summary,
        }, response)
