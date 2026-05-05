import json
from pathlib import Path
from typing import Any

from devflow.agents.base import AgentContext, AgentResult, BaseAgent
from devflow.agents.prompts import code_review as prompts
from devflow.artifacts.patch_materializer import build_patch_review_payload
from devflow.config import settings
from devflow.tools.repo_tools import REPO_TOOL_SCHEMAS
from devflow.tools.test_runner import TEST_TOOL_SCHEMAS


_MAX_REVIEW_FILE_CHARS = 40_000


class CodeReviewAgent(BaseAgent):
    required_inputs = [
        ("solution_architecture", "solution_contract.json"),
        ("detailed_spec", "detailed_spec.json"),
        ("code_generation", "code_diff.patch"),
        ("code_generation", "generated_files_manifest.json"),
        ("test_generation", "test_report.json"),
    ]
    output_artifacts = ["review_report.md"]

    def build_system_prompt(self, ctx: AgentContext) -> str:
        return prompts.SYSTEM

    def build_user_prompt(self, ctx: AgentContext) -> str:
        patch = self._get_artifact(ctx, "code_generation", "code_diff.patch", "")
        manifest = self._get_artifact(ctx, "code_generation", "generated_files_manifest.json", "{}")
        manifest_obj = _ensure_dict(manifest)
        review_payload = _build_review_payload(ctx.run_id, patch, manifest_obj)
        manifest_text = json.dumps(manifest_obj, indent=2, ensure_ascii=False)
        test_report = self._get_artifact(ctx, "test_generation", "test_report.json", "{}")
        if isinstance(test_report, dict):
            test_report = json.dumps(test_report, indent=2, ensure_ascii=False)
        spec = self._get_artifact(ctx, "detailed_spec", "detailed_spec.json", "{}")
        if isinstance(spec, dict):
            spec = json.dumps(spec, indent=2, ensure_ascii=False)
        solution_contract = self._get_artifact(ctx, "solution_architecture", "solution_contract.json", "{}")
        if isinstance(solution_contract, dict):
            solution_contract = json.dumps(solution_contract, indent=2, ensure_ascii=False)

        return prompts.USER_TMPL.format(
            code_diff=patch,
            generated_files_manifest=manifest_text,
            review_payload=json.dumps(review_payload, indent=2, ensure_ascii=False),
            test_report=test_report,
            detailed_spec=spec,
            solution_contract=solution_contract,
            repo_path=ctx.repo_path,
        )

    def get_tools(self) -> list[dict]:
        # Review is read-only, but it may inspect context and re-run focused tests in the patched workspace.
        return [REPO_TOOL_SCHEMAS[i] for i in (0, 1, 2)] + TEST_TOOL_SCHEMAS

    def parse_response(self, response: str, ctx: AgentContext) -> AgentResult:
        content = response.strip()
        if not content:
            return self._fail(ctx, "Empty response from LLM")
        return self._ok(ctx, {"review_report.md": content}, content)


def _ensure_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _build_review_payload(run_id: str, patch: str, manifest: dict[str, Any]) -> dict[str, Any]:
    try:
        payload = build_patch_review_payload(patch, manifest, Path(settings.ARTIFACTS_DIR) / run_id)
    except Exception as exc:
        return {"error": f"Failed to build generated-file review payload: {exc}"}
    return _cap_review_payload(payload)


def _cap_review_payload(payload: dict[str, Any]) -> dict[str, Any]:
    for file_info in payload.get("files", []):
        if not isinstance(file_info, dict):
            continue
        content = file_info.get("generated_content")
        if isinstance(content, str) and len(content) > _MAX_REVIEW_FILE_CHARS:
            file_info["generated_content"] = content[:_MAX_REVIEW_FILE_CHARS]
            file_info["generated_content_truncated"] = True
        else:
            file_info["generated_content_truncated"] = False
    return payload
