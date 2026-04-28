import json

from devflow.agents.base import AgentContext, AgentResult, BaseAgent
from devflow.agents.prompts import delivery as prompts

_SEPARATOR = "---FINAL_DIFF---"


class DeliveryAgent(BaseAgent):
    def build_system_prompt(self, ctx: AgentContext) -> str:
        return prompts.SYSTEM

    def build_user_prompt(self, ctx: AgentContext) -> str:
        patch = self._get_artifact(ctx, "code_generation", "code_diff.patch", "")
        test_report = self._get_artifact(ctx, "test_generation", "test_report.json", "{}")
        if isinstance(test_report, dict):
            test_report = json.dumps(test_report, indent=2, ensure_ascii=False)
        review = self._get_artifact(ctx, "code_review", "review_report.md", "")
        summary = self._get_artifact(ctx, "code_generation", "implementation_summary.md", "")

        return prompts.USER_TMPL.format(
            code_diff=patch,
            test_report=test_report,
            review_report=review,
            implementation_summary=summary,
        )

    def parse_response(self, response: str, ctx: AgentContext) -> AgentResult:
        response = response.strip()
        if _SEPARATOR in response:
            parts = response.split(_SEPARATOR, 1)
            delivery_summary = parts[0].strip()
            final_diff = parts[1].strip()
        else:
            delivery_summary = response
            final_diff = self._get_artifact(ctx, "code_generation", "code_diff.patch", "")
            if isinstance(final_diff, dict):
                final_diff = ""

        # Strip markdown fences from diff if present
        if final_diff.startswith("```"):
            lines = final_diff.splitlines()
            final_diff = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

        return self._ok(ctx, {
            "delivery_summary.md": delivery_summary,
            "final_diff.patch": final_diff,
        }, response)
