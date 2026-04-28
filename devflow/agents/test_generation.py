import json

from devflow.agents.base import AgentContext, AgentResult, BaseAgent
from devflow.agents.prompts import test_generation as prompts
from devflow.tools.repo_tools import REPO_TOOL_SCHEMAS
from devflow.tools.test_runner import TEST_TOOL_SCHEMAS


class TestGenerationAgent(BaseAgent):
    def json_mode(self) -> bool:
        return True

    def max_tokens(self) -> int | None:
        return None

    def build_system_prompt(self, ctx: AgentContext) -> str:
        return prompts.SYSTEM

    def build_user_prompt(self, ctx: AgentContext) -> str:
        spec = self._get_artifact(ctx, "detailed_spec", "detailed_spec.json", "{}")
        if isinstance(spec, dict):
            spec = json.dumps(spec, indent=2, ensure_ascii=False)

        summary = self._get_artifact(ctx, "code_generation", "implementation_summary.md", "")

        return prompts.USER_TMPL.format(
            detailed_spec=spec,
            implementation_summary=summary,
            repo_path=ctx.repo_path,
        )

    def get_tools(self) -> list[dict]:
        # write_file to create test file, run_test to execute it
        return [REPO_TOOL_SCHEMAS[3]] + TEST_TOOL_SCHEMAS

    def parse_response(self, response: str, ctx: AgentContext) -> AgentResult:
        response = response.strip()
        if response.startswith("```"):
            lines = response.splitlines()
            response = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

        try:
            json.loads(response)
        except json.JSONDecodeError:
            # LLM didn't return clean JSON — wrap the output as a summary report
            response = json.dumps({
                "test_file": "unknown",
                "test_command": "unknown",
                "total": 0,
                "passed": 0,
                "failed": 0,
                "skipped": 0,
                "exit_code": -1,
                "test_cases": [],
                "error_log": response[:2000],
                "summary": "Test report parsing failed — raw output captured.",
            }, ensure_ascii=False)

        return self._ok(ctx, {"test_report.json": response}, response)
