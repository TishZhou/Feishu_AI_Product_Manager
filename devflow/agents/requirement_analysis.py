import json
from typing import Any

from devflow.agents.base import AgentContext, AgentResult, BaseAgent
from devflow.agents.prompts import requirement_analysis as prompts
from devflow.services.repo_map import build_repo_context_summary, compact_repo_context_for_prompt


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value).strip()
    return [text] if text else []


def _numbered(items: list[str]) -> str:
    if not items:
        return "- 未指定\n"
    return "\n".join(f"{idx}. {item}" for idx, item in enumerate(items, start=1)) + "\n"


def _bullets(items: list[str]) -> str:
    if not items:
        return "- 未指定\n"
    return "\n".join(f"- {item}" for item in items) + "\n"


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _object_bullets(value: Any) -> str:
    if not isinstance(value, dict) or not value:
        return "- 未指定\n"
    lines = []
    for key, item in value.items():
        label = key.replace("_", " ")
        if isinstance(item, list):
            rendered = "；".join(str(x).strip() for x in item if str(x).strip()) or "未指定"
        else:
            rendered = str(item).strip() or "未指定"
        lines.append(f"- **{label}:** {rendered}")
    return "\n".join(lines) + "\n"


def render_requirement_prd(spec: dict[str, Any]) -> str:
    title = str(spec.get("title") or "需求规格").strip()
    summary = str(spec.get("summary") or "未提供摘要。").strip()
    task_type = str(spec.get("task_type") or "未指定").strip()
    product_type = str(spec.get("product_type") or "未指定").strip()
    status = str(spec.get("status") or "draft").strip()
    user_story = str(spec.get("user_story") or "").strip()
    confidence = spec.get("confidence_score", "n/a")
    confidence_reason = _text(spec.get("confidence_reason"))

    sections = [
        f"# {title}",
        "## 概览",
        summary,
        f"**状态：** {status}  \n**任务类型：** {task_type}  \n**产品类型：** {product_type}  \n**置信度：** {confidence}",
    ]

    if confidence_reason:
        sections.append(f"**置信度说明：** {confidence_reason}")

    narrative_sections = [
        ("## 背景", spec.get("background")),
        ("## 问题陈述", spec.get("problem_statement")),
    ]
    for heading, value in narrative_sections:
        text = _text(value)
        if text:
            sections.extend([heading, text])

    if user_story:
        sections.extend(["## 用户故事", user_story])

    section_map = [
        ("## 目标用户", _as_list(spec.get("target_users")), _bullets),
        ("## 用户场景", _as_list(spec.get("user_scenarios")), _bullets),
        ("## 产品目标", _as_list(spec.get("goals")), _bullets),
        ("## 本次范围", _as_list(spec.get("scope_in")), _bullets),
        ("## 非本次范围", _as_list(spec.get("scope_out")), _bullets),
        ("## 功能需求", _as_list(spec.get("functional_requirements")), _numbered),
        ("## 非功能需求", _as_list(spec.get("non_functional_requirements")), _bullets),
        ("## 用户故事列表", _as_list(spec.get("user_stories")), _bullets),
        ("## 核心流程", _as_list(spec.get("core_flow")), _numbered),
        ("## 验收标准", _as_list(spec.get("acceptance_criteria")), _bullets),
        ("## UX / 交互说明", _as_list(spec.get("ux_notes")), _bullets),
        ("## 数据与集成需求", _as_list(spec.get("data_and_integrations")), _bullets),
        ("## 成功指标", _as_list(spec.get("success_metrics")), _bullets),
        ("## 风险", _as_list(spec.get("risks")), _bullets),
        ("## 依赖", _as_list(spec.get("dependencies")), _bullets),
        ("## 假设", _as_list(spec.get("assumptions")), _bullets),
        ("## 待确认问题", _as_list(spec.get("open_questions")), _bullets),
        ("## 发布 / 里程碑建议", _as_list(spec.get("launch_or_milestone")), _bullets),
    ]

    for heading, items, formatter in section_map:
        sections.extend([heading, formatter(items).rstrip()])

    sections.extend([
        "## 架构交接摘要",
        _object_bullets(spec.get("handoff_to_architecture_agent")).rstrip(),
        "## 质量自检",
        _object_bullets(spec.get("quality_check")).rstrip(),
    ])

    return "\n\n".join(sections).rstrip() + "\n"


class RequirementAnalysisAgent(BaseAgent):
    required_inputs = []
    output_artifacts = ["requirement_spec.prd.md", "requirement_spec.json"]

    def json_mode(self) -> bool:
        return True

    def max_tokens(self) -> int | None:
        return 3500

    def build_system_prompt(self, ctx: AgentContext) -> str:
        return prompts.SYSTEM

    def build_user_prompt(self, ctx: AgentContext) -> str:
        repo_context = build_repo_context_summary(
            ctx.repo_path,
            {
                "title": ctx.pipeline.description,
                "summary": ctx.pipeline.description,
                "functional_requirements": [ctx.pipeline.description],
                "acceptance_criteria": [],
            },
        )
        return prompts.USER_TMPL.format(
            description=ctx.pipeline.description,
            task_type=ctx.pipeline.task_type,
            repo_path=ctx.repo_path,
            repo_context_summary=compact_repo_context_for_prompt(
                repo_context,
                max_files=18,
                max_symbols=35,
                max_routes=20,
                max_models=20,
                max_test_files=10,
                max_chars=6000,
            ),
            reference_context=getattr(ctx.pipeline, "reference_context", "") or "未上传参考文档。",
            clarification_answers=getattr(ctx.pipeline, "clarification_answers", "") or "暂无。",
        )

    def parse_response(self, response: str, ctx: AgentContext) -> AgentResult:
        response = response.strip()
        # Strip potential markdown fences
        if response.startswith("```"):
            lines = response.splitlines()
            response = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

        try:
            spec = json.loads(response)  # validate JSON
        except json.JSONDecodeError as e:
            return self._fail(ctx, f"Invalid JSON from LLM: {e}", response)
        if not isinstance(spec, dict):
            return self._fail(ctx, "Invalid JSON from LLM: expected an object", response)

        prd = render_requirement_prd(spec)
        return self._ok(
            ctx,
            {
                "requirement_spec.prd.md": prd,
                "requirement_spec.json": response,
            },
            response,
        )
