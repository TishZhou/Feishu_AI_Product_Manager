import json
import logging
import re
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from devflow.config import settings
from devflow.db.engine import get_session
from devflow.db.models import Artifact as ArtifactModel
from devflow.db.models import Pipeline, PipelineRun
from devflow.providers.router import provider_router

logger = logging.getLogger("devflow.api.ui_canvas")
router = APIRouter(tags=["UI Canvas"])


# ─── helpers ──────────────────────────────────────────────────────────────────

def _extract_json(text: str) -> str:
    text = text.strip()
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if m:
        return m.group(1)
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        return m.group(0)
    return text


async def _repair_json(raw: str, provider: str, model: str | None) -> dict[str, Any]:
    repaired = await provider_router.chat(
        system=(
            "You repair malformed JSON. Return only one complete, valid JSON object. "
            "Do not include markdown, comments, or explanations."
        ),
        user=f"Repair this malformed JSON response into one valid object:\n\n{raw}",
        provider=provider,
        model=model,
        json_mode=True,
        max_tokens=12000,
    )
    data = json.loads(_extract_json(repaired))
    if not isinstance(data, dict):
        raise ValueError("repaired JSON is not an object")
    return data


def _extract_html(text: str) -> str:
    text = text.strip()
    m = re.search(r"```html\s*(.*?)\s*```", text, re.DOTALL)
    if m:
        return m.group(1).strip()
    m = re.search(r"```\s*(<!DOCTYPE.*?)\s*```", text, re.DOTALL | re.IGNORECASE)
    if m:
        return m.group(1).strip()
    if text.lower().startswith("<!doctype") or text.lower().startswith("<html"):
        return text
    return text


async def _get_pipeline_info(run_id: str, session: AsyncSession) -> tuple[str, str | None, str]:
    run = await session.get(PipelineRun, run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    pipeline = await session.get(Pipeline, run.pipeline_id)
    if pipeline:
        return (
            pipeline.provider or settings.DEFAULT_PROVIDER,
            pipeline.model or None,
            pipeline.description or "",
        )
    return settings.DEFAULT_PROVIDER, None, ""


async def _load_product_context(run_id: str, session: AsyncSession) -> str:
    """Read key pipeline artifacts to provide product context for UI generation."""
    CONTEXT_FILES = [
        "requirement_spec.prd.md",
        "requirement_spec.json",
        "solution_design.md",
        "detailed_spec.json",
    ]
    result = await session.execute(
        select(ArtifactModel).where(
            ArtifactModel.run_id == run_id,
            ArtifactModel.filename.in_(CONTEXT_FILES),
        )
    )
    artifacts = result.scalars().all()

    LABELS = {
        "requirement_spec.prd.md": "需求分析报告",
        "requirement_spec.json": "需求结构化信息",
        "solution_design.md": "技术架构方案",
        "detailed_spec.json": "详细规格文档",
    }
    parts = []
    for fname in CONTEXT_FILES:
        art = next((a for a in artifacts if a.filename == fname), None)
        if not art:
            continue
        try:
            content = Path(art.file_path).read_text(encoding="utf-8")
            parts.append(f"### {LABELS.get(fname, fname)}\n{content[:2500]}")
        except Exception:
            pass
    return "\n\n".join(parts)


# ─── schemas ──────────────────────────────────────────────────────────────────

class CanvasModule(BaseModel):
    id: str = ""
    type: str
    name: str
    category: str = ""
    props: dict[str, Any] = Field(default_factory=dict)


class SuggestRequest(BaseModel):
    description: str


class SuggestResponse(BaseModel):
    modules: list[CanvasModule]
    rationale: str = ""


class GenerateCodeRequest(BaseModel):
    layout: list[CanvasModule]
    description: str = ""
    framework: str = "html"


class GenerateCodeResponse(BaseModel):
    artifact_id: str
    filename: str
    html_content: str
    framework: str = "html"


class RefineRequest(BaseModel):
    layout: list[CanvasModule]
    feedback: str
    description: str = ""
    current_html: str = ""
    framework: str = "html"


class RefineResponse(BaseModel):
    html_content: str
    message: str = ""
    framework: str = "html"


# ─── prompts ──────────────────────────────────────────────────────────────────

_SUGGEST_SYSTEM = """\
你是顶级 UI/UX 设计师，专注 SaaS 和互联网产品落地页。
根据产品需求文档和描述，从候选模块中选择并排序，生成最适合的单页落地页方案。

可用模块类型（type 字段值）：
  导航: navbar
  英雄区: hero_centered  hero_split  hero_minimal
  内容: features_grid  features_list  cards_row  timeline
  口碑: testimonials  stats  logos
  转化: pricing  cta  contact_form  faq  newsletter
  页脚: footer_simple  footer_rich

返回 JSON（无任何其他文字）：
{
  "rationale": "设计理由（1-2句）",
  "modules": [
    {
      "type": "模块type",
      "name": "模块展示名",
      "category": "所属分类",
      "props": {
        // 根据实际产品内容填写，绝不使用通用占位符，全部中文
        // navbar: {"brand":"产品名","links":"功能,定价,案例","cta":"免费试用"}
        // hero_centered: {"headline":"一句话价值主张","sub":"2-3句展开描述","cta1":"免费开始","cta2":"查看演示","style":"渐变背景"}
        // features_grid: {"title":"核心功能","features":"功能名 | 描述\\n功能名 | 描述"}
      }
    }
  ]
}

规则：
1. 必须以 navbar 开头，以 footer_simple 或 footer_rich 结尾
2. 根据产品特性选 5-8 个模块
3. props 内容完全基于产品真实特性，体现产品核心价值，不写通用占位符
4. 仔细阅读下方产品文档，让所有文案真实匹配产品
"""

_CODEGEN_SYSTEM = """\
你是顶级前端工程师，专门开发高转化率、视觉精美的现代 SaaS 落地页。

必须引入以下 CDN（按顺序）：
  1. <link rel="stylesheet" href="https://unpkg.com/aos@2.3.1/dist/aos.css">
  2. <script src="https://cdn.tailwindcss.com"></script>
  3. 紧接 tailwind.config script 自定义品牌色
  4. <script src="https://unpkg.com/aos@2.3.1/dist/aos.js"></script>
  5. <script>AOS.init({ duration:700, once:true, offset:60 })</script>

设计规范：
- 配色方案：根据产品特性选专业色系（AI/科技→蓝紫渐变，金融→深蓝+金，医疗→清绿+白，创意→暖橙）
- Navbar：position:fixed、backdrop-blur-md、bg-white/80、border-b、平滑阴影；logo 用 SVG 圆形色块+文字
- Hero：min-h-screen、大字排版（text-5xl lg:text-7xl）、渐变主标题（bg-gradient-to-r bg-clip-text text-transparent）
- 每个 section 加 data-aos="fade-up"，cards 加 data-aos-delay 错开动效
- 卡片：rounded-2xl、border、hover:-translate-y-2 hover:shadow-xl transition-all duration-300
- 按钮：rounded-full、渐变填充主按钮、hover:scale-105、shadow-lg
- 完全响应式（mobile-first），移动端隐藏复杂布局改为垂直堆叠
- 平滑滚动：<html lang="zh" style="scroll-behavior:smooth">
- 无外部图片依赖（用 SVG icon、emoji、渐变色块代替图片）
- 用所有 props 中的真实内容，绝不留 placeholder 文字

只返回完整 HTML 文件，不含任何 Markdown 标记或说明文字。
"""

_REACT_CODEGEN_SYSTEM = """\
你是顶级前端工程师，专门开发视觉精美的 React 组件落地页。

生成一个完整的 React 单页应用，格式为可直接在浏览器预览的独立 HTML 文件。

必须引入以下 CDN（按顺序放在 <head>）：
  1. <link rel="stylesheet" href="https://unpkg.com/aos@2.3.1/dist/aos.css">
  2. <script src="https://cdn.tailwindcss.com"></script>
  3. <script> // tailwind.config 自定义品牌色（同 HTML 版）
  4. <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  5. <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  6. <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  7. <script src="https://unpkg.com/aos@2.3.1/dist/aos.js"></script>

HTML body 结构：
  <div id="root"></div>
  <script type="text/babel">
  // === JSX_COMPONENT_START ===
  const { useState, useEffect, useRef } = React;
  // 在此处定义所有子组件函数
  function NavBar(props) { ... }
  function HeroSection(props) { ... }
  // ...其他模块组件...
  function App() {
    useEffect(() => { AOS.init({ duration: 700, once: true, offset: 60 }); }, []);
    return (
      <div className="...">
        <NavBar ... />
        <HeroSection ... />
        // ...按布局顺序渲染...
      </div>
    );
  }
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(<App />);
  // === JSX_COMPONENT_END ===
  </script>

设计规范（与 HTML 版保持一致）：
- 配色方案：根据产品特性选专业色系（AI/科技→蓝紫渐变，金融→深蓝+金）
- Navbar：fixed top、backdrop-blur-md、bg-white/80、border-b
- Hero：min-h-screen、大字排版、渐变主标题（bg-gradient-to-r bg-clip-text text-transparent）
- 每个 section 加 data-aos="fade-up"，卡片加 data-aos-delay 错开动效
- 卡片：rounded-2xl、border、hover:-translate-y-2 hover:shadow-xl transition-all
- 按钮：rounded-full、渐变填充主按钮、hover:scale-105
- 完全响应式（mobile-first），各模块拆分为独立函数组件
- 使用 useState 实现 FAQ 展开/收起、导航菜单移动端折叠等交互
- 无外部图片依赖（用 SVG、emoji、渐变色块代替）
- 用所有 props 中的真实内容，绝不留 placeholder

只返回完整 HTML 文件，不含任何 Markdown 标记或说明文字。
"""

_REFINE_SYSTEM = """\
你是顶级前端工程师，根据用户反馈优化已有落地页代码。

工作方式：
1. 仔细理解用户的具体反馈
2. 精确应用要求的修改（主题色、布局、内容调整、风格变化、交互效果等）
3. 保留用户满意的部分，只修改有问题的地方
4. 保持技术栈一致（Tailwind CDN + AOS + 响应式，React 版本保留 JSX markers）
5. 修改后整体效果必须比之前更好

只返回完整 HTML 文件，不含任何 Markdown 标记或说明文字。
"""


# ─── endpoints ────────────────────────────────────────────────────────────────

@router.post("/runs/{run_id}/ui-canvas/suggest", response_model=SuggestResponse)
async def suggest_layout(
    run_id: str,
    body: SuggestRequest,
    session: AsyncSession = Depends(get_session),
):
    provider, model, pipeline_desc = await _get_pipeline_info(run_id, session)
    product_context = await _load_product_context(run_id, session)

    context_block = ""
    if product_context:
        context_block = f"\n\n## 产品文档（请仔细阅读作为设计依据）\n{product_context}"
    elif pipeline_desc:
        context_block = f"\n\n## 产品描述\n{pipeline_desc}"

    user_msg = (
        f"用户补充描述：{body.description or '（无额外描述，请基于产品文档生成）'}"
        f"{context_block}\n\n"
        "请推荐合适的落地页模块组合，props 中填入真实产品内容。"
    )

    try:
        raw = await provider_router.chat(
            system=_SUGGEST_SYSTEM,
            user=user_msg,
            provider=provider,
            model=model,
            json_mode=True,
            max_tokens=12000,
        )
        try:
            data = json.loads(_extract_json(raw))
        except json.JSONDecodeError:
            data = await _repair_json(raw, provider, model)
        modules = [
            CanvasModule(
                id=str(uuid.uuid4()),
                type=m.get("type", ""),
                name=m.get("name", m.get("type", "")),
                category=m.get("category", ""),
                props=m.get("props", {}),
            )
            for m in data.get("modules", [])
        ]
        return SuggestResponse(modules=modules, rationale=data.get("rationale", ""))
    except Exception as e:
        logger.exception("ui-canvas suggest failed")
        raise HTTPException(500, f"AI 生成失败: {e}")


@router.post("/runs/{run_id}/ui-canvas/generate-code", response_model=GenerateCodeResponse)
async def generate_code(
    run_id: str,
    body: GenerateCodeRequest,
    session: AsyncSession = Depends(get_session),
):
    provider, model, pipeline_desc = await _get_pipeline_info(run_id, session)
    product_context = await _load_product_context(run_id, session)

    layout_text = "\n".join(
        f"{i + 1}. [{m.type}] {m.name}"
        + (f"\n   内容: {json.dumps(m.props, ensure_ascii=False)}" if m.props else "")
        for i, m in enumerate(body.layout)
    )

    context_block = product_context or pipeline_desc or body.description or "现代化 SaaS 产品"
    is_react = body.framework == "react"
    task_hint = (
        "请生成完整 React 单页应用（独立 HTML 预览文件），使用 JSX_COMPONENT_START/END 标记包裹组件代码，严格使用所有 props 内容。"
        if is_react else
        "请生成完整单文件 HTML 落地页，严格使用所有 props 内容，确保视觉精美、专业可用。"
    )
    user_msg = (
        f"## 产品背景\n{context_block}\n\n"
        f"## 用户补充说明\n{body.description or '（无）'}\n\n"
        f"## 页面布局（从上到下，按顺序实现每个模块）\n{layout_text}\n\n"
        f"{task_hint}"
    )

    try:
        system = _REACT_CODEGEN_SYSTEM if is_react else _CODEGEN_SYSTEM
        raw = await provider_router.chat(
            system=system,
            user=user_msg,
            provider=provider,
            model=model,
            json_mode=False,
        )
        html = _extract_html(raw)

        artifacts_dir = Path(settings.ARTIFACTS_DIR) / run_id
        artifacts_dir.mkdir(parents=True, exist_ok=True)
        filename = "ui_design_react.html" if is_react else "ui_design.html"
        (artifacts_dir / filename).write_text(html, encoding="utf-8")

        art = ArtifactModel(
            id=str(uuid.uuid4()),
            run_id=run_id,
            stage_key="ui_canvas",
            filename=filename,
            file_path=str(artifacts_dir / filename),
            content_type="text/html",
            size_bytes=len(html.encode()),
        )
        session.add(art)
        await session.commit()
        await session.refresh(art)

        return GenerateCodeResponse(artifact_id=art.id, filename=filename, html_content=html, framework=body.framework)
    except Exception as e:
        logger.exception("ui-canvas generate-code failed")
        raise HTTPException(500, f"代码生成失败: {e}")


@router.post("/runs/{run_id}/ui-canvas/refine", response_model=RefineResponse)
async def refine_code(
    run_id: str,
    body: RefineRequest,
    session: AsyncSession = Depends(get_session),
):
    """Apply user feedback to refine the current HTML iteratively."""
    provider, model, _ = await _get_pipeline_info(run_id, session)

    layout_summary = "\n".join(
        f"- [{m.type}] {m.name}" for m in body.layout
    ) or "（未指定布局）"

    is_react = body.framework == "react"
    user_msg = (
        f"## 用户反馈\n{body.feedback}\n\n"
        f"## 当前页面模块\n{layout_summary}\n\n"
        f"## 当前代码\n{body.current_html[:14000]}\n\n"
        + ("请根据用户反馈修改代码，保留 JSX_COMPONENT_START/END 标记，返回完整更新后的 HTML 文件。"
           if is_react else
           "请根据用户反馈修改 HTML，返回完整更新后的 HTML 文件。")
    )

    try:
        raw = await provider_router.chat(
            system=_REFINE_SYSTEM,
            user=user_msg,
            provider=provider,
            model=model,
            json_mode=False,
        )
        html = _extract_html(raw)

        artifacts_dir = Path(settings.ARTIFACTS_DIR) / run_id
        artifacts_dir.mkdir(parents=True, exist_ok=True)
        filename = "ui_design_react.html" if is_react else "ui_design.html"
        (artifacts_dir / filename).write_text(html, encoding="utf-8")

        return RefineResponse(html_content=html, message="已根据反馈更新页面", framework=body.framework)
    except Exception as e:
        logger.exception("ui-canvas refine failed")
        raise HTTPException(500, f"优化失败: {e}")
