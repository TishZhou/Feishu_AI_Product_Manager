import json

from devflow.agents.base import AgentContext, AgentResult, BaseAgent
from devflow.agents.prompts import code_review as prompts


class CodeReviewAgent(BaseAgent):
    def build_system_prompt(self, ctx: AgentContext) -> str:
        return prompts.SYSTEM

    def build_user_prompt(self, ctx: AgentContext) -> str:
        patch = self._get_artifact(ctx, "code_generation", "code_diff.patch", "")
        test_report = self._get_artifact(ctx, "test_generation", "test_report.json", "{}")
        if isinstance(test_report, dict):
            test_report = json.dumps(test_report, indent=2, ensure_ascii=False)
        spec = self._get_artifact(ctx, "detailed_spec", "detailed_spec.json", "{}")
        if isinstance(spec, dict):
            spec = json.dumps(spec, indent=2, ensure_ascii=False)

        return prompts.USER_TMPL.format(
            code_diff=patch,
            test_report=test_report,
            detailed_spec=spec,
        )

    def parse_response(self, response: str, ctx: AgentContext) -> AgentResult:
        content = response.strip()
        if not content:
            return self._fail(ctx, "Empty response from LLM")
        return self._ok(ctx, {"review_report.md": content}, content)
