import json

from devflow.agents.base import AgentContext, AgentResult, BaseAgent
from devflow.agents.prompts import detailed_spec as prompts
from devflow.agents.solution_architecture import _extract_json_object
from devflow.services.repo_map import compact_repo_context_for_prompt


class DetailedSpecAgent(BaseAgent):
    required_inputs = [
        ("requirement_analysis", "requirement_spec.json"),
        ("solution_architecture", "repo_context_summary.json"),
        ("solution_architecture", "solution_design.md"),
        ("solution_architecture", "solution_contract.json"),
    ]
    output_artifacts = ["detailed_spec.json"]

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
        solution_contract = self._get_artifact(ctx, "solution_architecture", "solution_contract.json", "{}")
        if isinstance(solution_contract, dict):
            solution_contract = json.dumps(solution_contract, indent=2, ensure_ascii=False)
        repo_context = self._get_artifact(ctx, "solution_architecture", "repo_context_summary.json", "{}")
        repo_context = compact_repo_context_for_prompt(repo_context)

        return prompts.USER_TMPL.format(
            requirement_spec=req_spec,
            solution_design=solution,
            solution_contract=solution_contract,
            repo_context_summary=repo_context,
        )

    def parse_response(self, response: str, ctx: AgentContext) -> AgentResult:
        response = response.strip()
        response = _extract_json_object(response)

        try:
            json.loads(response)
        except json.JSONDecodeError as e:
            return self._fail(ctx, f"Invalid JSON from LLM: {e}", response)

        return self._ok(ctx, {"detailed_spec.json": response}, response)
