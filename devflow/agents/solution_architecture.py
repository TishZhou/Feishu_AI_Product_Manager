import json

from devflow.agents.base import AgentContext, AgentResult, BaseAgent
from devflow.agents.prompts import solution_architecture as prompts
from devflow.services.repo_map import (
    build_repo_context_summary,
    compact_repo_context_for_prompt,
    repo_context_to_json,
)
from devflow.tools.repo_tools import REPO_TOOL_SCHEMAS

_SEPARATOR = "---SOLUTION_CONTRACT_JSON---"


def _extract_json_object(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1] if lines and lines[-1].strip() == "```" else lines[1:]).strip()

    start = text.find("{")
    if start < 0:
        return text

    depth = 0
    in_string = False
    escape = False
    for index, char in enumerate(text[start:], start=start):
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start:index + 1]
    return text[start:]


class SolutionArchitectureAgent(BaseAgent):
    required_inputs = [("requirement_analysis", "requirement_spec.json")]
    output_artifacts = ["repo_context_summary.json", "solution_design.md", "solution_contract.json"]

    async def run(self, ctx: AgentContext) -> AgentResult:
        result = await super().run(ctx)
        if result.success:
            return result
        if not result.raw_llm_response:
            return result
        if not result.error or not (
            result.error.startswith("Missing separator")
            or result.error.startswith("Invalid JSON from LLM")
        ):
            return result
        return await self._repair_contract_response(result.raw_llm_response, ctx)

    def build_system_prompt(self, ctx: AgentContext) -> str:
        return prompts.SYSTEM

    def max_tokens(self) -> int | None:
        return 5000

    def build_user_prompt(self, ctx: AgentContext) -> str:
        req_spec = self._get_artifact(ctx, "requirement_analysis", "requirement_spec.json", "{}")
        repo_context = build_repo_context_summary(ctx.repo_path, req_spec)
        # Save full context to artifact, but feed only the compact version to the LLM.
        self._repo_context_summary = repo_context_to_json(repo_context)
        compact_context = compact_repo_context_for_prompt(repo_context)
        if isinstance(req_spec, dict):
            req_spec = json.dumps(req_spec, indent=2, ensure_ascii=False)
        return prompts.USER_TMPL.format(
            requirement_spec=req_spec,
            repo_context_summary=compact_context,
            repo_path=ctx.repo_path,
        )

    def get_tools(self) -> list[dict]:
        return REPO_TOOL_SCHEMAS[:3]  # list_dir, read_file, search_code

    def parse_response(self, response: str, ctx: AgentContext) -> AgentResult:
        response = response.strip()
        if not response:
            return self._fail(ctx, "Empty response from LLM")
        if _SEPARATOR not in response:
            return self._fail(ctx, f"Missing separator {_SEPARATOR}", response)
        design, contract_text = response.split(_SEPARATOR, 1)
        design = design.strip()
        contract_text = _extract_json_object(contract_text)
        try:
            contract = json.loads(contract_text)
        except json.JSONDecodeError as e:
            return self._fail(ctx, f"Invalid JSON from LLM: {e}", response)
        if not isinstance(contract, dict):
            return self._fail(ctx, "Invalid JSON from LLM: expected an object", response)

        if not design:
            return self._fail(ctx, "Missing solution_design.md content", response)

        return self._ok(ctx, {
            "repo_context_summary.json": getattr(self, "_repo_context_summary", "{}"),
            "solution_design.md": design,
            "solution_contract.json": json.dumps(contract, ensure_ascii=False, indent=2),
        }, response)

    async def _repair_contract_response(self, raw_response: str, ctx: AgentContext) -> AgentResult:
        design = raw_response.split(_SEPARATOR, 1)[0].strip() if _SEPARATOR in raw_response else raw_response.strip()
        if not design:
            return self._fail(ctx, "Missing solution_design.md content", raw_response)

        req_spec = self._get_artifact(ctx, "requirement_analysis", "requirement_spec.json", "{}")
        if isinstance(req_spec, dict):
            req_spec = json.dumps(req_spec, indent=2, ensure_ascii=False)

        repair_system = """You repair missing or malformed solution_contract.json outputs.
Return only one valid JSON object. Do not include markdown, code fences, comments, or explanations.
The JSON object must match the Stage 2A solution_contract schema."""
        repair_user = f"""Requirement spec:
{req_spec}

Repo context summary:
{compact_repo_context_for_prompt(getattr(self, "_repo_context_summary", "{}"))}

Human-readable solution_design.md:
{design}

Generate solution_contract.json now. Use only real paths from the repo context summary unless creating a new file is required."""

        repaired = await ctx.provider_router.chat(
            system=repair_system,
            user=repair_user,
            tools=None,
            model=ctx.pipeline.model or None,
            provider=ctx.pipeline.provider,
            tool_dispatcher=None,
            json_mode=True,
            max_tokens=3500,
            cache_key="devflow:solution_architecture:repair",
        )
        contract_text = _extract_json_object(repaired)
        try:
            contract = json.loads(contract_text)
        except json.JSONDecodeError as e:
            return self._fail(ctx, f"Invalid repaired JSON from LLM: {e}", raw_response)
        if not isinstance(contract, dict):
            return self._fail(ctx, "Invalid repaired JSON from LLM: expected an object", raw_response)

        return self._ok(ctx, {
            "repo_context_summary.json": getattr(self, "_repo_context_summary", "{}"),
            "solution_design.md": design,
            "solution_contract.json": json.dumps(contract, ensure_ascii=False, indent=2),
        }, raw_response)
