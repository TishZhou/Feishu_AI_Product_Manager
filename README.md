# DevFlow Engine

> 输入一句需求，AI 自动走完从产品文档到代码交付的完整研发流程；只在两个产品决策点由人工把关。

 — Tish, Leander

---

## 目录

1. [项目概览](#1-项目概览)
2. [核心技术亮点](#2-核心技术亮点)
3. [Pipeline 流水线](#3-pipeline-流水线)
4. [架构设计](#4-架构设计)
5. [实现的基本功能](#5-实现的基本功能)
6. [前后端技术栈](#6-前后端技术栈)
7. [快速开始](#7-快速开始)
8. [参考](#8-参考)

---

## 1. 项目概览

DevFlow 是一个 **多 Agent 流水线编排引擎**：把"PM 写 PRD → 架构师设计 → 开发实现 → QA 写测试 → Code Review → 交付上线"这条原本以周为单位的研发链路，在 5–15 分钟内由 AI 端到端跑完，**只在两个产品决策点（方案审核 / 实现审核）插入强制人工 checkpoint**，再加一个交付前的写入确认。

它解决的核心问题：

- **AI 写代码的不可控** → 用 7 阶段强契约 Pipeline + 自动质量门禁约束
- **大模型容易虚构 API** → 用 Aider 式仓库地图 + Personalised PageRank 把真实仓库结构压进 prompt
- **失败兜底缺失** → 多层重试 + 人工介入 checkpoint，任何 stage 不会"默默死掉"
- **写入源仓库的风险** → 默认只写 `artifacts/{run_id}/`，最后一个 checkpoint 才落到源仓库且自动备份

每次 run 的所有产物（PRD、方案、代码 patch、测试报告、审查报告、最终 diff）都保存在 [artifacts/{run_id}/](artifacts/) 下，完整可审计、可重放、可回滚。

---

## 2. 核心技术亮点

### 2.1 需求分析的问题澄清机制

需求 Stage 1 不是"一句话进、PRD 出"的单向生成，而是带 **confidence-gated clarification loop**：

```
用户一句需求
    ▼
RequirementAnalysisAgent (json_mode, max_tokens=12000)
    ├── 输出 requirement_spec.json，包含：
    │     • confidence_score   (0.0–1.0)
    │     • confidence_reason
    │     • open_questions     (list[str])
    │     • assumptions / risks / scope_in / scope_out / ...
    ▼
Orchestrator._needs_requirement_clarification(artifacts):
    if spec.open_questions  →  True
    if spec.confidence_score < 0.7  →  True
    ▼  (else 直接进 stage 2)
落盘 requirement_clarification.json
状态切到 RunState.WAITING_FOR_CLARIFICATION
asyncio.Event 阻塞主循环
    ▼
前端 ClarificationModal 拉取 → 用户填答案
POST /api/runs/{id}/clarification → orchestrator.resolve_clarification(answers)
    ▼
pipeline.clarification_answers 累加，重跑 Stage 1
self._clarification_completed.add(run_id)   ← 每个 run 只阻塞一次
    ▼
Stage 2 (方案设计) 开始
```

技术要点：
- **结构化置信度驱动**：模型自评 `confidence_score` 和 `open_questions`，而不是用启发式判断输入完整性
- **每个 run 最多阻塞一次**：避免 LLM 反复"低置信度"导致死循环；二次依然不达标也会强制走完全流程
- **答案累加进 prompt**：下一次 Stage 1 prompt 注入 `clarification_answers`，模型在已澄清基础上重写 PRD
- **状态机隔离**：`WAITING_FOR_CLARIFICATION` 是 `RunState` 的独立状态，前端可用其判断渲染哪种 modal

### 2.2 RepoMap：Aider 式仓库地图 + Personalised PageRank

[devflow/services/repo_map.py](devflow/services/repo_map.py) 解决"LLM 写代码爱虚构 API"和"全量喂代码爆 context"两个矛盾：

**核心算法**：
1. `scan_source_files` 抽取 Python / TypeScript 的 **符号定义、import 引用、API routes、SQLAlchemy models、测试文件**
2. 建 `file -> file` 的 symbol reference graph（A 引用了 B 定义的 symbol，则 A→B 有边）
3. 用需求关键词构造 **personalised PageRank** 的 teleport vector（关键词在 file 路径 / 符号名 / 注释里命中越多，teleport 概率越高）
4. 跑 PageRank 拿到全局重要性 + 需求相关性的综合排序

**双层产出**：

| 层 | 内容 | 体量 |
|---|---|---|
| 全量 `repo_context_summary.json` | 所有 file + score + symbols + routes + models + tests | 30–80 KB（落盘 audit） |
| Compact prompt 版 | top-N 文件 + 语言配额补齐 + 关联 symbols/routes/models/tests | ≤ 8 KB（喂 prompt） |

**关键设计**：
- **language quota**：避免后端 Python 引用密度高把前端 `.tsx` / `package.json` 挤掉，强制保留 frontend 配额
- **char-budget 渐进降级**：超 `max_chars` 时按优先级丢 sections，但永远保留 `project_kinds` / `relevant_files`
- **效果**：架构 stage 几乎不会要求改不存在的文件，`solution_contract.files_to_modify` 命中率显著高于裸喂代码

### 2.3 Coding / Test / Review：Single-Loop Tool-Use 架构

外层是 7 阶段固定 Pipeline，但 Stage 4-6（最需要"探索"的阶段）内部都是 **single-loop agentic tool use**——模型自己决定读哪些文件、改什么、跑什么验证。

**统一 tool loop**（[devflow/providers/router.py](devflow/providers/router.py) `ProviderRouter.chat()`）：

```python
for round_idx in range(max_tool_rounds):    # cap 25–30 轮
    resp = await client.chat.completions.create(messages=..., tools=...)
    msg = resp.choices[0].message
    record_token_usage(...)                 # 每轮都计入 token

    if not msg.tool_calls:
        return msg.content                  # 出口 1：模型答完了

    for call in msg.tool_calls:
        output = await tool_dispatcher.invoke(call.function.name, **args)
        messages.append({"role": "tool", "tool_call_id": call.id, "content": ...})

return last_assistant_text                  # 出口 2：轮数耗尽
```

**每个 stage 暴露不同 toolset**（白名单）：

| Stage | 工具盘 | 关键约束 |
|---|---|---|
| code_generation | `list_dir` `read_file` `search_code` `write_file` `edit_file` `apply_patch` | cwd 锁在 codegen workspace；30 轮上限 |
| test_generation | `read_file` `edit_file` + `run_test` + `run_command` (allowlist) | cwd 锁在 execution workspace；patch 已应用；surgical repair 模式禁用 `write_file` 全量覆盖 |
| code_review | 只读：`list_dir` `read_file` `search_code` + `run_command` | 输出含 `blocker_count` 的结构化 JSON 驱动控制流 |

**Frontend-only 智能路由**（test_generation）：检测 patch 全是前端文件时跳过 pytest，直接跑 `npx --no-install tsc --noEmit` 或 `npm run build`，再合成符合后续 stage 期待形状的 `test_report.json`——避免强逼 LLM 用 pytest 测 React 组件产出垃圾。

**为什么是混合架构**：

| 维度 | 外层 Pipeline | 阶段内 Single Loop |
|---|---|---|
| 价值 | 可审、可回退、可暂停、可换 model | 让 AI 自主探索代码、调用工具、跑测试 |
| 控制方式 | stage registry + artifact contract + checkpoint | tool dispatcher + max_tool_rounds + allowlist |
| 代价 | stage 间需重复注入 spec/contract，token 更贵 | 单 trace 长，需工具 allowlist 防失控 |

人工 checkpoint 是这个产品的核心价值——所以接受外层 pipeline 的上下文断裂，换流程上的可审、可回退、可换 model。

### 2.4 Compact Context：节省 Token 消耗

token 消耗的"大头"在 stage 间反复注入 spec/repo 上下文。三层优化：

1. **RepoMap compact**（见 2.2）：8K char 上限 + language quota
2. **OpenAI prompt cache key**：每个 stage 调 LLM 时带稳定的 `cache_key=f"devflow:{stage_key}"`，让 provider-side prompt cache 命中长 system/spec 前缀（OpenAI 自动 cache）
3. **Per-stage `max_tokens` 调节**：detailed_spec 提到 16K（输出最大），其他 stage 8K 或不限；reasoning model（gpt-5.x / o-系列）自动用 `max_completion_tokens` 而非 `max_tokens`

**Token 全链路计量**：每次 `client.chat.completions.create` 返回的 `resp.usage` 都按 `(run_id, stage_key)` 落盘到 `token_usage` 表，前端 OverviewView 实时汇总展示。这让"哪个 stage 烧钱"可量化，是后续优化的基础。

### 2.5 Workspace 隔离：3 类 workspace 各司其职

实现于 [devflow/tools/workspace.py](devflow/tools/workspace.py) + [devflow/services/source_apply.py](devflow/services/source_apply.py)。

```
源仓库
   │
   ├── git worktree add --detach（hardlink，比 shutil.copytree 快 5–10×）
   │       │
   │       ├──► artifacts/{run}/codegen_workspace_*/      ← Stage 4 改这里
   │       │     └── frontend/node_modules → 源仓库（symlink，省 200MB+ install）
   │       │
   │       └──► artifacts/{run}/execution_workspace_*/    ← Stage 5-6 跑测试 / 审查
   │             └── frontend/node_modules → symlink；patch 已 git apply
   │
   └──► 源仓库本身                                         ← 仅在 Stage 7 + Checkpoint 3 通过后写入
            └── apply_to_source 写入 + artifacts/{run}/source_backup/ 快照
```

技术要点：

- **git worktree 而非 copytree**：`shutil.copytree` 全 inode 复制，大仓库慢；`git worktree add --detach` 用 hardlink 快 5–10×
- **node_modules symlink**：避免每个 workspace 各自 `npm install`（200MB+ × N），同时让 `npx --no-install tsc/eslint/prettier/vitest` 直接可用；prompt 显式告诉 LLM "npm install 是平台限制不是 BUG"
- **command_runner allowlist**：`pytest` / `npm` / `npx` / `ruff` / `mypy` 白名单内可跑，其余 reject——防止 LLM `rm -rf` / `curl` 之类失控调用
- **路径绑定**：每个工具调用的 `cwd` 都锁在该 stage 自己的 workspace，禁止 `..` 路径越界（`run_test_rejects_parent_traversal` 等专门测试）
- **写入源仓库 = 一次性操作**：默认所有 stage 都不动源仓库；Checkpoint 3 通过 → `apply_to_source` 同时建 `source_backup/`，UI 上一个按钮即可回滚
- **gitignore 范围控制**：`data/` `dist/` `node_modules/` 等只在**根目录**忽略，**不是任意层级**——避免 `frontend/src/data/personas.ts` 这类源码被 workspace 创建过滤误吞（这是踩过的坑）

### 2.6 UI Canvas：产品文档驱动的页面原型生成

实现于 [devflow/api/ui_canvas.py](devflow/api/ui_canvas.py)。除研发流水线，项目还做了一个轻量 **Canvas 子系统**：复用同一个 run 的产品文档生成可拖拽迭代的页面原型。

**三步链路**：

```
1) suggest_layout(run_id, description)
   读 artifacts: requirement_spec.prd.md + .json + solution_design.md + detailed_spec.json
   ▼
   UI_LAYOUT_DESIGNER_SYSTEM prompt + json_mode + 12K tokens
   ▼
   返回结构化 layout: list[CanvasModule]   ← 不是直接生 HTML

2) 用户在前端拖拽 / 编辑模块顺序和 props（人负责结构 + 审美）

3) generate_code(run_id, layout, framework)
   按用户编辑后的 layout → REACT_CODEGEN_SYSTEM 或 HTML_CODEGEN_SYSTEM
   ▼
   落盘 ui_design_react.html 或 ui_design.html
   ▼
   refine_code(run_id, current_html, feedback)   ← 后续修改
       把当前 HTML + 用户反馈一起喂模型，做局部迭代而非整页重生
```

**关键设计**：
- **结构先行，代码后行**：先输出可控的模块化 layout，避免"一次性大页面生成"风格漂移
- **复用产品文档**：Canvas 不是孤立页面工具，它读同一 run 的 PRD / 方案 / 详细规格，保持产品一致性
- **JSON 自动 repair**：layout 输出走 json_mode，失败时调 `_repair_json` 一轮专门修复
- **HTML 提取容错**：`_extract_html` 同时识别 ` ```html `、` ```<!DOCTYPE` 和裸输出三种格式
- **局部迭代而非重生**：refine 阶段把当前 HTML（截断到 14K 字符）+ 反馈一起送，保留用户已认可的结构

---

## 3. Pipeline 流水线

### 3.1 7 阶段全景

```
你输入一句需求
    │
    ▼
[Stage 1]  📋 需求分析        → requirement_spec.prd.md + requirement_spec.json
    ▼
[Stage 2]  🏗️  方案设计        → repo_context_summary.json + solution_design.md + solution_contract.json
    ▼
[Stage 3]  📝 详细规格         → detailed_spec.json
    │
⏸️  Checkpoint 1 — 审核方案（可切换 provider/model 再继续）
    │
    ▼
[Stage 4]  💻 代码生成        → code_diff.patch + generated_files_manifest.json + implementation_summary.md
    ▼
[Stage 5]  🧪 测试生成        → test_report.json
    ▼
[Stage 6]  🔍 代码审查        → review_report.json + review_report.md
    │
⏸️  Checkpoint 2 — 审核代码（可切换 provider/model）
    │
    ▼
[Stage 7]  🚀 交付集成        → delivery_summary.md + final_diff.patch
    │
⏸️  Checkpoint 3 — 交付前确认 → apply_to_source（写入源仓库 + 生成回滚快照）
    │
    ▼
🌿 Git 集成弹窗（可选）
        建分支 + commit + push + 创建 PR/MR（独立勾选）
```

### 3.2 每一阶段的契约

每个 stage 在 [devflow/core/pipeline_definition.py](devflow/core/pipeline_definition.py) 中以 `StageDefinition` 注册，包含强契约字段：

| 字段 | 含义 |
|---|---|
| `output_artifacts` | 该 stage 必须落盘的产物文件名（缺一即失败） |
| `reads_from_stages` | 依赖哪些上游 stage 的产物（启动前做输入门禁） |
| `checkpoint_after` | 完成后是否阻塞等待人工（1 / 2 / 3） |
| `checkpoint_default_retry` | 被 reject 时默认从哪个 stage 重跑 |

Agent 类启动时做契约校验：`output_artifacts` 必须和 stage 注册的一致，`required_inputs` 必须是 `reads_from_stages` 的子集，否则直接 raise——让"我以为我产出了 X，但 stage 表里写的是 Y"这种 bug 在加载阶段就死掉。

### 3.3 阶段流转控制

主编排器 [devflow/core/orchestrator.py](devflow/core/orchestrator.py) 实现：

- **暂停 / 恢复 / 终止**：异步事件驱动，任意 stage 边界可中断
- **从指定 stage 重跑**：保留前序产物，只重跑你选的部分
- **自动质量门禁**：
  - Stage 5 后判断 `test_report.json`，失败时智能选择回 `code_generation` 还是 `test_generation` 重跑
  - Stage 6 后判断 `review_report.json.blocker_count`，BLOCKER 存在时自动重跑 code_generation
- **重试预算耗尽 → 人工介入 checkpoint**：弹 modal 让用户 skip / 带指引重生 / 切 model
- **Provider/Model 运行时覆盖**：在任一 checkpoint 里切换模型，下一 stage 立即生效，不重启 run

---

## 4. 架构设计

### 4.1 系统分层

```
┌────────────────────────────────────────────────────────────────┐
│ Frontend: React 19 + Vite + TanStack Query + Tailwind v4       │
│  SetupView → OverviewView/DetailView/ConsoleView → Modals      │
└────────────────────────────────┬───────────────────────────────┘
                                 │ REST + SSE
┌────────────────────────────────▼───────────────────────────────┐
│ API Layer (FastAPI)                                            │
│  pipelines · runs · checkpoints · meta · ui_canvas             │
└────────────────────────────────┬───────────────────────────────┘
                                 │
┌────────────────────────────────▼───────────────────────────────┐
│ Core: Orchestrator + StageRegistry + StateMachine              │
│  生命周期管理 · 输入门禁 · 质量门禁 · 介入升级 · checkpoint    │
└──────┬──────────────────┬──────────────────┬──────────────────┘
       │                  │                  │
┌──────▼─────┐   ┌────────▼────────┐   ┌─────▼──────────┐
│ 7 Agents   │   │ Provider Router │   │ Services       │
│ Base+子类  │──>│ OpenAI/Gemini/  │   │ repo_map       │
│ Tool loop  │   │ Volcano 统一    │   │ source_apply   │
│            │   │ tool-use 循环   │   │ git_integration│
└──────┬─────┘   └─────────────────┘   └────────────────┘
       │
┌──────▼──────────────────────────────────────────────────────────┐
│ Tools (allowlist): repo_tools · patch_tools · command_runner    │
│                    test_runner · workspace                      │
└──────┬──────────────────────────────────────────────────────────┘
       │
┌──────▼──────────────────────────────────────────────────────────┐
│ Storage: SQLite (async) + artifacts/{run_id}/ 文件落盘           │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Agent 抽象

[BaseAgent](devflow/agents/base.py) 统一定义：

- **声明式 IO 契约**：`required_inputs` / `output_artifacts` 类变量
- **输入门禁**：上游产物缺失提前失败，不浪费 LLM 调用
- **隔离 dispatcher**：每个工具的 cwd 锁在该 stage 的 workspace
- **Per-stage Provider/Model 覆盖**：子类可重写 `provider_override(ctx)` / `model_override(ctx)`
- **JSON 自动 repair**：JSON 模式失败时自动调一轮 repair，prompt 强制"修复 JSON，别改语义"
- **Token 计量**：每次 LLM 调用通过 ProviderRouter 落盘 usage，按 stage 聚合

7 个子类：[requirement_analysis](devflow/agents/requirement_analysis.py)、[solution_architecture](devflow/agents/solution_architecture.py)、[detailed_spec](devflow/agents/detailed_spec.py)、[code_generation](devflow/agents/code_generation.py)、[test_generation](devflow/agents/test_generation.py)、[code_review](devflow/agents/code_review.py)、[delivery](devflow/agents/delivery.py)。

### 4.3 Workspace 隔离

```
源仓库 /Users/.../Feishu_AI_Product_Manager
   │
   ├── git worktree（hardlink，~10× 比 copytree 快）
   │   ↓
   ├──► artifacts/{run}/codegen_workspace_*/      ← Stage 4 改这里
   │       └── frontend/node_modules → 源仓库 node_modules（symlink）
   │
   ├──► artifacts/{run}/execution_workspace_*/    ← Stage 5-6 跑测试/审查
   │       └── frontend/node_modules → symlink；已 git apply patch
   │
   └──► 源仓库本身                                 ← Stage 7 + Checkpoint 3 才写入
            └── apply_to_source 写入 + 备份到 artifacts/{run}/source_backup/
```

实现于 [devflow/tools/workspace.py](devflow/tools/workspace.py) 和 [devflow/services/source_apply.py](devflow/services/source_apply.py)。

**关键设计**：
- `git worktree add --detach` 比 `shutil.copytree` 快 5–10x
- `node_modules` symlink 避免每个 workspace 各自 `npm install`，同时让 `npx --no-install tsc/eslint/prettier/vitest` 直接可用
- 直到最后 checkpoint 用户点确认才动源仓库；备份保留，可一键回滚

### 4.4 Patch-as-Source-of-Truth

我们不让 LLM 自己手写 patch（容易格式坏），而是：

1. Agent 在 workspace 里用 `edit_file` / `write_file` 真实修改文件
2. 系统遍历 workspace 和源仓库做 diff，**自动生成 unified diff** 落到 `code_diff.patch`
3. 后续 `apply_to_source` / `git_publish` 都基于这个 patch
4. 前端用自实现的 `PatchDiffView` 解析 hunk，按文件分组展示绿/红行

这意味着**任何 stage 的产出都是结构化、可 diff、可回滚、可重放**的，不依赖工作树残留状态。

### 4.5 RepoMap：让 LLM 真的"懂"你的仓库

为什么要做：LLM 写代码最大的失败模式是**虚构 API**——猜你有 `User.find_by_email`，但你这工程里实际是 `get_user_by_email`。直接把所有源码塞进 prompt 又会瞬间爆 context。

[devflow/services/repo_map.py](devflow/services/repo_map.py) 的方案是 **"Aider 式符号图 + Prompt 压缩"**：

| 层 | 内容 | 体量 |
|---|---|---|
| 全量 `repo_context_summary.json` | 全部文件 + PageRank 分数 + 符号 + 路由 + 模型 + 测试 | 30–80 KB（落盘 audit 用） |
| Compact prompt 版 | top-N 相关文件 + 语言配额补齐 + 关键 symbols/routes/models/tests | ≤ 8 KB（喂进 prompt） |

排序逻辑：
1. 抽取 Python/TypeScript 的定义和引用，建立 `file -> file` 的 symbol reference graph
2. 用需求关键词构造 personalised PageRank 的 teleport vector
3. 输出按图重要性 + 需求相关性排序后的仓库上下文
4. compact 阶段加 language quota，避免后端 Python 文件引用更密导致前端 `.tsx`/`package.json` 消失

效果：**架构设计 stage 几乎不会要求改不存在的文件**，`solution_contract.files_to_modify` 命中率显著高于"裸喂代码"。

### 4.6 失败兜底体系

| 失败类型 | 防御层 1 | 防御层 2 | 防御层 3 |
|---|---|---|---|
| LLM 输出不是合法 JSON | json_mode 强制 | `_should_repair_json_result` 自动 repair 一轮 | stage failed |
| 测试不过 | 自动重试 ≤ 2 次（智能选回 code_gen 还是 test_gen） | `test_failure_intervention` checkpoint：skip / 带指引 / 切 model | 用户取消 |
| Code review BLOCKER | 自动重 code_gen ≤ 2 次（带 blocker_context） | `review_blocker_intervention` checkpoint | 用户取消 |
| Stage 在重试中硬失败 | 升级到 review intervention（不直接 FAILED） | 用户给指引 + 换 model 重跑 | 放弃 run |
| 整个 run 失败 | DetailView 「重试此阶段」按钮 | 沿用前序产物，只重跑你选的部分 | 重新建 run |

---

## 5. 实现的基本功能

### 5.1 流水线核心

- ✅ 7 阶段全自动 Pipeline（需求分析 → 方案 → 详细规格 → 代码 → 测试 → 审查 → 交付）
- ✅ 3 个强制人工 Checkpoint，可批准 / 拒绝 / 带指引重跑
- ✅ Stage 输入门禁 + 输出契约校验
- ✅ 任意 stage 暂停 / 恢复 / 终止
- ✅ 从指定 stage 重跑（保留前序产物）
- ✅ Run 级别的 ATTEMPT 计数 + 重试上下文累积

### 5.2 AI 工程能力

- ✅ Tool-use 多轮 agentic loop（25–30 轮上限，模型自决调用顺序）
- ✅ 多 Provider（OpenAI / Gemini / Volcano）统一 OpenAI-compatible 接口
- ✅ 运行时切换 provider/model（任一 checkpoint 内）
- ✅ JSON mode 强制 + 自动 repair
- ✅ OpenAI prompt cache key 路由（每个 stage 稳定 key）
- ✅ Per-stage `max_tokens` 调节（detailed_spec 16K，code_gen 更长 tool budget）
- ✅ Reasoning model 兼容（gpt-5.x / o-系列自动用 `max_completion_tokens`）
- ✅ Aider 式 RepoMap + Compact context for prompt

### 5.3 质量保障

- ✅ 自动质量门禁（test_report 失败、review_report BLOCKER 自动打回）
- ✅ Surgical test repair protocol（禁止 write_file 全量替换，只改失败的）
- ✅ 失败升级到人工介入 checkpoint
- ✅ 工具 allowlist（`pytest` / `npm` / `npx --no-install tsc/eslint/prettier/vitest` / `ruff` / `mypy`）

### 5.4 交付与集成

- ✅ Patch-as-Source-of-Truth（unified diff 落盘）
- ✅ 写入源仓库前自动备份 `source_backup/`
- ✅ 一键回滚源仓库到 run 之前
- ✅ Git 集成弹窗：建分支 / commit / push / 开 PR/MR 独立勾选
- ✅ Patch-aware 工作树识别（区分"delivery 已写"vs"用户其它本地改动"）
- ✅ GitHub (`gh`) / GitLab (`glab`) 双适配，自动创建 draft PR/MR

### 5.5 可观测性

- ✅ SSE 事件流 `/api/runs/{run_id}/logs/stream`
- ✅ Token 用量按 stage 聚合实时上报
- ✅ Pipeline graph 显示每个 stage 实时状态 + 第几次 attempt
- ✅ Patch GitHub 风格 +/- 行级 diff
- ✅ 测试报告 / 需求文档 / 审查报告 markdown 一致渲染
- ✅ Console 实时工具调用 trace

### 5.6 衍生子系统：UI Canvas

- ✅ 复用同一 run 的 PRD / 方案 / 详细规格生成页面 layout
- ✅ 用户可拖拽 / 编辑模块，再生成 HTML 或 React 单页预览
- ✅ `refine_code` 局部迭代（保留用户已认可的结构）

---

## 6. 前后端技术栈

### 6.1 后端

| 层 | 技术 / 库 | 用途 |
|---|---|---|
| Web 框架 | **FastAPI** + Uvicorn | REST + SSE，自动 Swagger 文档 |
| 数据库 | **SQLAlchemy 2.0 (async)** + **aiosqlite** + SQLite | Pipeline / Run / Stage / Checkpoint / Artifact 持久化 |
| Schema 校验 | **Pydantic v2** + pydantic-settings | API 入参出参契约 + `.env` 配置 |
| LLM SDK | **OpenAI Python SDK** | 通过 OpenAI-compatible endpoint 接 OpenAI / Gemini / Volcano |
| HTTP | httpx | provider 探活 / git remote API |
| 文档解析 | pypdf | reference document 上下文提取 |
| 上传 | python-multipart | 文件上传（reference docs） |
| 测试 | pytest + pytest-asyncio + pytest-json-report | 自家测试 + 给 agent 用的 runner |
| 配置 | python-dotenv | `.env` 读取 |
| Process | subprocess + shutil + git CLI | workspace / git_integration |

完整依赖见 [requirements.txt](requirements.txt)。

### 6.2 前端

| 层 | 技术 / 库 | 用途 |
|---|---|---|
| 框架 | **React 19** + **TypeScript** | UI 组件 |
| 构建 | **Vite 8** + `@vitejs/plugin-react` | dev server 热更新 + 生产构建 |
| 状态 / 数据 | **TanStack Query 5** | API 缓存、轮询、失效控制 |
| HTTP | axios | REST client |
| 样式 | **Tailwind CSS v4**（`@tailwindcss/vite`）+ tailwind-merge + clsx | utility-first 样式 + 动态 className |
| 动画 | framer-motion | modal / 状态过渡 |
| 图标 | lucide-react | UI 图标 |
| Lint | ESLint 10 + typescript-eslint + react-hooks | 类型 + 规范 |

完整依赖见 [frontend/package.json](frontend/package.json)。

### 6.3 主要前端组件

| 组件 | 作用 |
|---|---|
| [SetupView.tsx](frontend/src/components/SetupView.tsx) | 创建 pipeline 表单 + provider/model 选择 + reference doc 上传 |
| [OverviewView.tsx](frontend/src/components/OverviewView.tsx) | run 概览：进度、token 消耗、运行时长、完成卡片 |
| [DetailView.tsx](frontend/src/components/DetailView.tsx) | 单 stage 详情 + artifact 切换 + 重试按钮 |
| [ConsoleView.tsx](frontend/src/components/ConsoleView.tsx) | 实时 SSE 日志流 + 工具调用 trace |
| [PipelineGraph.tsx](frontend/src/components/PipelineGraph.tsx) | 7 stage 状态图 + attempt 计数 |
| [CheckpointModal.tsx](frontend/src/components/CheckpointModal.tsx) | 审批 / 拒绝 + 切换 provider/model + 指定重跑起点 |
| [GitIntegrationModal.tsx](frontend/src/components/GitIntegrationModal.tsx) | Git push / PR 弹窗，三独立勾选 + patch-aware precheck |
| [ArtifactContentView.tsx](frontend/src/components/ArtifactContentView.tsx) | Patch / Markdown / JSON 统一渲染 |
| [TestReportView.tsx](frontend/src/components/TestReportView.tsx) | 测试报告结构化展示 |

---

## 7. 快速开始

### 推荐：React 控制台

```bash
# 终端 1：后端
pip install -r requirements.txt
cp .env.example .env                     # 填 OPENAI_API_KEY
uvicorn devflow.main:app --reload --reload-dir devflow

# 终端 2：前端
cd frontend && npm install && npm run dev
```

打开 http://localhost:5000 即可使用。
> Swagger API 文档：http://localhost:8000/docs

### 备选：Streamlit 前端

```bash
streamlit run streamlit_app.py        # http://localhost:8501
```

### CLI Demo

```bash
python demo.py
python demo.py --provider volcano --requirement "Add a health-check endpoint GET /healthz"
```

---

## 8. 参考

### 8.1 LLM 配置

| Provider | 环境变量 | 默认模型 | 说明 |
|----------|---------|---------|------|
| `openai` | `OPENAI_API_KEY` | `gpt-5.4` | 主推；支持 prompt cache、JSON mode、tool calling |
| `gemini` | `GEMINI_API_KEY` | `gemini-2.0-flash` | 通过 Google OpenAI-compatible endpoint 接入 |
| `volcano` | `VOLCANO_API_KEY` | `seed-v1.6` | 火山引擎 / 方舟 OpenAI-compatible endpoint，可填自定义模型 |

`.env` 设 `DEFAULT_PROVIDER=volcano` 或 `gemini` 全局切换；创建 pipeline 或 checkpoint approve/reject 时也可单独指定下一阶段的 provider/model。

### 8.2 产物清单

| 文件 | 来自阶段 | 内容 |
|------|---------|------|
| `requirement_spec.prd.md` | Stage 1 | PRD 需求文档（人读） |
| `requirement_spec.json` | Stage 1 | 结构化需求数据（机器消费） |
| `repo_context_summary.json` | Stage 2 | 仓库地图（全量） |
| `solution_design.md` | Stage 2 | 技术方案（人读） |
| `solution_contract.json` | Stage 2 | 方案 contract（机器消费） |
| `detailed_spec.json` | Stage 3 | 可执行实现规格 |
| `code_diff.patch` | Stage 4 | unified diff |
| `generated_files_manifest.json` | Stage 4 | 生成文件清单 |
| `implementation_summary.md` | Stage 4 | 实现说明 |
| `test_report.json` | Stage 5 | 测试执行报告 |
| `review_report.json` / `.md` | Stage 6 | 结构化 / 中文双产物 |
| `delivery_summary.md` | Stage 7 | 交付总结 |
| `final_diff.patch` | Stage 7 | 最终 diff（直接 `git apply`） |
| `source_backup/` | Stage 7 + CP3 | 源仓库回滚快照 |
| `git_publication.json` | Git 推送 | push / PR 结果存档 |

### 8.3 主要 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/pipelines` | 创建 pipeline |
| POST | `/api/pipelines/{id}/runs` | 启动运行 |
| GET | `/api/runs/{run_id}` | 查询运行状态 |
| GET | `/api/runs/{run_id}/stages` | 查询各阶段 / attempt |
| GET | `/api/runs/{run_id}/artifacts` | 列出所有产物 |
| GET | `/api/runs/{run_id}/logs/stream` | SSE 阶段事件流 |
| POST | `/api/runs/{run_id}/pause` / `resume` / `terminate` | 运行控制 |
| POST | `/api/runs/{run_id}/retry` | 从指定 stage 重跑（带前序产物） |
| POST | `/api/checkpoints/{id}/approve` | 通过（可携带 `next_provider`/`next_model`） |
| POST | `/api/checkpoints/{id}/reject` | 拒绝并指定重跑起点 |
| GET | `/api/runs/{run_id}/source-application` | 查应用 / 回滚状态 |
| POST | `/api/runs/{run_id}/rollback` | 回滚源仓库 |
| GET | `/api/runs/{run_id}/git-status` | Git 模态 precheck（含 patch-aware safe 判定） |
| POST | `/api/runs/{run_id}/git-publish` | 建分支/push/PR（独立 toggle） |
| POST | `/api/ui-canvas/{run_id}/suggest` | UI Canvas：依据产品文档推荐页面 layout |
| POST | `/api/ui-canvas/{run_id}/generate` | UI Canvas：layout → HTML/React 预览 |

### 8.4 项目结构

```
devflow/
├── main.py                       # FastAPI 入口
├── config.py
├── db/                           # SQLAlchemy async + SQLite
├── api/                          # FastAPI 路由
│   ├── pipelines.py / runs.py / checkpoints.py / meta.py
│   ├── reference_documents.py
│   └── ui_canvas.py              # UI Canvas 子系统
├── core/
│   ├── pipeline_definition.py    # 7 stage 注册表
│   ├── orchestrator.py           # 主循环 + checkpoint + 介入 + 质量门禁
│   ├── state_machine.py
│   └── background.py
├── agents/                       # 7 个 Agent + prompts
│   ├── base.py                   # provider/model override hook + JSON repair
│   ├── requirement_analysis.py
│   ├── solution_architecture.py
│   ├── detailed_spec.py
│   ├── code_generation.py        # 30 轮 tool loop
│   ├── test_generation.py        # surgical repair protocol
│   ├── code_review.py            # JSON + MD 双产物
│   └── delivery.py
├── providers/router.py           # 统一 chat + tool loop + token 计量
├── services/
│   ├── repo_map.py               # 仓库地图（PageRank）
│   ├── source_apply.py           # 写入源仓库 + 备份
│   ├── git_integration.py        # 推送 / PR / patch-aware precheck
│   ├── repo_safety.py
│   ├── document_context.py
│   ├── test_progress.py
│   └── token_usage.py
└── tools/
    ├── repo_tools.py             # list_dir / read_file / search_code / write/edit
    ├── patch_tools.py
    ├── command_runner.py         # 安全 allowlist
    ├── test_runner.py
    └── workspace.py              # git worktree + node_modules symlink

frontend/                         # React 19 + Vite 8 + Tailwind v4 控制台
artifacts/                        # 运行时产物（gitignored）
data/devflow.db                   # SQLite（gitignored）
```

---

**License**: MIT  ·  **Status**: Active competition entry  ·  **Authors**: Tish, Leander
