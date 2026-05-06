# DevFlow Engine

输入一句需求，AI 自动走完从文档到代码的完整开发流程，在两个关键节点由人工审核把关。

**ByteDance Competition — by Tish, Leander**

---

## 最新版本说明

当前版本相对上一版的完整变更记录见：

- [2026-05-06 Version Update](docs/2026-05-06-version-update.md)

---

## 工作流程

```
你输入需求
    │
    ▼
[Stage 1]  📋 需求分析        → requirement_spec.prd.md + requirement_spec.json
    │         agents/requirement_analysis.py
    │         理解需求背景、目标和验收标准
    ▼
[Stage 2A] 🏗️  方案设计        → repo_context_summary.json + solution_design.md + solution_contract.json
    │         agents/solution_architecture.py
    │         生成 repo map，定位影响范围，设计技术方案和执行 contract
    ▼
[Stage 2B] 📝 Contract 精炼   → detailed_spec.json
    │         agents/detailed_spec.py
    │         生成可直接执行的实现规格
    │
⏸️  Checkpoint 1 — 审核方案文档（可切换 provider/model 再继续）
    │
    ▼
[Stage 3]  💻 代码生成        → code_diff.patch + generated_files/ + implementation_summary.md
    │         agents/code_generation.py
    ▼
[Stage 4]  🧪 测试生成        → test_report.json
    │         agents/test_generation.py
    ▼
[Stage 5]  🔍 代码审查        → review_report.json + review_report.md
    │         agents/code_review.py
    │
⏸️  Checkpoint 2 — 审核代码（可切换 provider/model 再继续）
    │
    ▼
[Stage 6]  🚀 交付打包        → delivery_summary.md + final_diff.patch
              agents/delivery.py
```

每次 run 的产物保存在 `artifacts/{run_id}/`。代码生成默认只写入 artifacts，不自动修改目标仓库。

---

## 架构设计策略

### 整体定位

DevFlow 采用 **固定 Stage Pipeline + 人工 Checkpoint** 架构，而非 Codex / Claude Code 的全自动单一 Agent Loop。两者的核心权衡：

| 维度 | DevFlow Pipeline | Codex / Claude Code |
|------|-----------------|---------------------|
| 人工介入 | 两个强制 Checkpoint | 全自动，无人工节点 |
| 上下文连续性 | Stage 间截断重建 | 单 session 持续推理 |
| 可调试性 | 每 stage 可独立重试 | 只能整体重跑 |
| Token 成本 | 每 stage 重注入上下文 | 单 session 累积 |
| 适合场景 | PM/产品审核流程 | 纯自动化 CI/CD |

人工 Checkpoint 是 DevFlow 的核心产品价值，因此不追求完全消除 stage 边界。

---

## Stage 3 / 4 / 5 — 编码阶段深度设计

### Stage 3 — 代码生成（Agentic Inner Loop）

**关键设计：**
- 用 `git worktree` 创建 `codegen_workspace_*`（无 git history 时 fallback 到 copytree）。git worktree 利用 hardlink，大仓库速度比 copytree 快 5-10x。
- Agent 拥有完整工具集：`list_dir / read_file / search_code / edit_file / write_file / run_command / run_test`，可在 workspace 内真实执行代码。
- **写完就跑**：prompt 要求 agent 每改一批文件后立即 `run_test` 跑相关测试，失败就修，不把失败带到下一步。
- 工具循环上限 **30 轮**（其他 stage 为 25 轮）。
- 系统从 workspace 变更自动生成 `code_diff.patch`（unified diff），不依赖模型手写 patch。
- AI / IDE 配置目录（`.claude/`、`.wolf/`、`.cursor/`）和 `.env` 系列文件**被排除在 diff 之外**，避免污染 patch。
- 如有 review 阶段发现的 BLOCKER，`review_blocker_context` 会注入 prompt，要求本次修复后重跑。

**自动重试流：**
```
code_generation → test_generation → code_review
      ↑                  │                │
      └──────────────────┘ 测试失败(≤3次)  │
      ↑                                   │
      └───────────────────────────────────┘ review BLOCKER(≤2次)
```

### Stage 4 — 测试生成（Surgical Repair Protocol）

**关键设计：**
- 在隔离 `execution_workspace_*`（同样用 git worktree）中运行，不污染原始仓库。
- **聚焦测试选择器**：从 `code_diff.patch` 提取变更文件列表，自动查找 `tests/test_<stem>.py` 等相关现有测试，在 prompt 中提示 agent 一并运行。
- **重试时严禁重写**：当 `test_failure_context` 存在时，agent 被强制要求：
  1. `read_file` 先读已有测试
  2. `run_test` 确认哪些 case 失败
  3. `edit_file` **只改失败的测试**
  4. 再跑验证
  
  不允许 `write_file` 整体替换文件（会破坏已通过的测试）。
- 常见测试 bug 防护：mock `os.path.isfile` 返回 True 时，必须同时 mock `builtins.open`，否则真实文件系统会 `FileNotFoundError`。
- 系统在 agent 结束后独立复跑 pytest（`_validate_and_enrich_report`），覆盖模型自述的结果。

### Stage 5 — 代码审查（Structured Gate）

**关键设计：**
- 输出 **双格式产物**：`review_report.json`（结构化，驱动质量门禁）+ `review_report.md`（中文，人工阅读）。
- `review_report.json` schema：
  ```json
  {
    "verdict": "pass|conditional_pass|changes_required",
    "blocker_count": 0,
    "findings": [
      {"severity": "BLOCKER|MAJOR|MINOR|NIT", "file": "...", "line": 42,
       "description": "...", "fix_suggestion": "..."}
    ]
  }
  ```
- **自动质量门禁**：orchestrator 在 stage 5 完成后检查 `blocker_count`。若有 BLOCKER 且尝试次数 ≤ 2，自动打回 Stage 3 重新实现，并把 BLOCKER 列表注入 `review_blocker_context`。
- 工具循环上限 15 轮（只读审查，不需要太多轮次）。

---

## 潜在优化方向 — Hybrid Single Agent Loop

### 现状问题

Stage 3/4/5 是三次独立 LLM call，每次重建上下文：

```
Stage 3: [system] + [spec 8K] + [contract 3K] + [design 2K] → LLM call A
Stage 4: [system] + [spec 8K] + [contract 3K] + [manifest]  → LLM call B（重复注入！）
Stage 5: [system] + [spec 8K] + [contract 3K] + [diff] + [test_report] → LLM call C
```

上下文在 stage 间断裂，Stage 4 不知道 Stage 3 做了哪些权衡决策。

### 优化方案：Hybrid Pipeline

```
Stage 1-2 保持 Pipeline（规划阶段，需要结构化产物和人工 Checkpoint 1）
    ↓
单一 CodingAgent（合并 Stage 3+4+5）
  └── 内部 loop：
      实现代码 → 跑相关测试 → 修失败 → 自我 review → 没有 BLOCKER → 退出
  └── 模型全程看到自己的推理链，无上下文断裂
    ↓
Checkpoint 2（人工审核，可切 provider 重跑）
    ↓
Stage 6 交付
```

**预期收益：**
- Stage 3-5 总时间减少 **30-40%**（无 stage 重启 overhead）
- 模型可以在"写代码 → 发现测试问题 → 回头改实现"之间自由迭代
- Token 成本：需配合 context 压缩（每 N 轮摘要旧 tool results）或 Anthropic prompt caching

**实现成本：** 新建 `CodingAgent` 类 + 更新 `pipeline_definition.py`，约 400 行。不需要改 provider 层。

### Token 成本优化：Anthropic Prompt Caching

Anthropic 的 `cache_control` 可以把 spec / contract / system prompt 标记为缓存，命中后只收 **10% 价格**。

当前（OpenAI，无 cache）：
```
Stage 4-6 共享上下文约 36K tokens × 3 次 = 108K tokens 全价
```

加 Anthropic caching 后：
```
首次 36K tokens 全价 + 后续 2 次 × 36K × 10% = 43K tokens 等价
节省约 60%
```

配合 Hybrid Single Loop：spec / contract 在 session 内只注入一次，50+ tool rounds 都命中 cache，效果更显著。

**实现成本：** 需要添加 Anthropic SDK provider adapter（~250 行），Anthropic 消息格式与 OpenAI 不同（tool result 用 content block）。

---

## 快速开始

### 推荐：React 控制台

终端 1：启动 FastAPI 后端。

```bash
# 安装 Python 依赖
pip install -r requirements.txt

# 配置 API Key
cp .env.example .env
# 编辑 .env，填入 OPENAI_API_KEY 和/或 VOLCANO_API_KEY

# 启动后端
uvicorn devflow.main:app --reload --reload-dir devflow
```

终端 2：启动 React/Vite 前端。

```bash
cd frontend
npm install
npm run dev
```

打开 http://localhost:5000 即可使用。

> Swagger API 文档：http://localhost:8000/docs

### 备选：Streamlit 前端

```bash
streamlit run streamlit_app.py
```

打开 http://localhost:8501。

---

## LLM 配置

两个 provider 均使用 OpenAI Python SDK，只是 `base_url` 不同：

| Provider | 环境变量 | 默认模型 | 说明 |
|----------|---------|---------|------|
| `openai` | `OPENAI_API_KEY` | `gpt-5.4` | OpenAI 官方 |
| `volcano` | `VOLCANO_API_KEY` | `seed-v1.6` | 火山引擎，key 格式 `key_id:secret_key` |

`.env` 里设置 `DEFAULT_PROVIDER=volcano` 可全局切换。

创建 pipeline 时可在请求体里单独指定 `provider` 和 `model`。

**运行时切换：** 在任意 Checkpoint 的 approve 请求中传入 `next_provider` / `next_model`，后续 stage 立即使用新配置，无需重启。

```bash
# Checkpoint 审批时切换到 volcano 继续后续 stage
curl -X POST /api/checkpoints/{id}/approve \
  -d '{"next_provider": "volcano", "next_model": "seed-v1.6"}'
```

---

## 产物清单

| 文件 | 来自阶段 | 内容 |
|------|---------|------|
| `requirement_spec.prd.md` | Stage 1 | PRD 需求文档 |
| `requirement_spec.json` | Stage 1 | 结构化需求数据 |
| `repo_context_summary.json` | Stage 2A | 代码库地图 |
| `solution_design.md` | Stage 2A | 技术方案设计 |
| `solution_contract.json` | Stage 2A | 方案 contract |
| `detailed_spec.json` | Stage 2B | 可执行实现规格 |
| `code_diff.patch` | Stage 3 | 代码 Diff |
| `generated_files_manifest.json` | Stage 3 | 生成文件清单 |
| `implementation_summary.md` | Stage 3 | 实现说明 |
| `test_report.json` | Stage 4 | 测试执行报告（含 runner_validation 复核） |
| `review_report.json` | Stage 5 | 结构化审查结果（驱动自动质量门禁） |
| `review_report.md` | Stage 5 | 中文代码审查报告 |
| `delivery_summary.md` | Stage 6 | 交付总结 |
| `final_diff.patch` | Stage 6 | 最终 Diff（可直接 `git apply`） |

---

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/workspace` | 返回后端默认工作区路径 |
| POST | `/api/reference-documents/extract` | 解析参考文档 |
| POST | `/api/pipelines` | 创建 pipeline |
| GET | `/api/pipelines/{id}` | 查询 pipeline |
| POST | `/api/pipelines/{id}/runs` | 启动运行 |
| GET | `/api/runs/{run_id}` | 查询运行状态 |
| GET | `/api/runs/{run_id}/stages` | 查询各阶段结果 |
| GET | `/api/runs/{run_id}/artifacts` | 列出所有产物 |
| GET | `/api/artifacts/{artifact_id}/content` | 读取产物内容 |
| GET | `/api/runs/{run_id}/code-review-files` | 代码审查文件视图 |
| GET | `/api/runs/{run_id}/test-progress` | 测试执行实时进度 |
| GET | `/api/runs/{run_id}/checkpoints` | 列出检查点 |
| GET | `/api/runs/{run_id}/logs/stream` | SSE 阶段状态事件流 |
| POST | `/api/runs/{run_id}/pause` | 暂停运行 |
| POST | `/api/runs/{run_id}/resume` | 继续运行 |
| POST | `/api/runs/{run_id}/terminate` | 终止运行 |
| POST | `/api/checkpoints/{id}/approve` | 通过检查点（可携带 `next_provider`/`next_model`） |
| POST | `/api/checkpoints/{id}/reject` | 拒绝并指定重跑起点 |
| GET | `/api/providers` | 查看 provider 连通状态 |
| GET | `/api/agents` | 查看 stage 注册表 |

---

## 项目结构

```
devflow/
├── main.py                  # FastAPI 入口
├── config.py                # 配置（读取 .env）
├── db/
│   ├── engine.py            # SQLAlchemy async 引擎（SQLite）
│   └── models.py            # Pipeline / PipelineRun / StageResult / Checkpoint / Artifact
├── api/                     # FastAPI 路由层
├── core/
│   ├── pipeline_definition.py  # Stage 注册表（7 个 stage）
│   ├── orchestrator.py         # 主编排循环 + Checkpoint + 质量门禁
│   ├── state_machine.py        # RunState / StageState 枚举
│   └── background.py           # asyncio 后台任务
├── agents/                  # 7 个 Agent 实现
│   ├── base.py
│   ├── requirement_analysis.py
│   ├── solution_architecture.py
│   ├── detailed_spec.py
│   ├── code_generation.py       # Stage 3：30轮 tool loop，git worktree，写完即跑测试
│   ├── test_generation.py       # Stage 4：聚焦测试，surgical repair on retry
│   ├── code_review.py           # Stage 5：JSON + MD 双产物，驱动质量门禁
│   ├── delivery.py
│   └── prompts/
├── artifacts/
│   ├── store.py
│   └── patch_materializer.py
├── providers/
│   └── router.py            # ProviderRouter（tool-use loop，max_tool_rounds 可配置）
└── tools/
    ├── repo_tools.py        # list_dir / read_file / search_code / write_file / edit_file
    ├── patch_tools.py       # apply_patch（git apply）
    ├── command_runner.py    # run_command（安全白名单：pytest/npm/ruff/mypy）
    ├── test_runner.py       # run_test（subprocess pytest + 流式输出）
    ├── test_selector.py     # 从 diff 提取变更文件 → 映射现有测试
    └── workspace.py         # git worktree + copytree fallback

artifacts/                   # 运行时产物（gitignored）
data/devflow.db              # SQLite 数据库（gitignored）
frontend/                    # React/Vite 前端控制台
```

---

## CLI Demo

```bash
python demo.py
python demo.py --provider volcano --requirement "Add a health-check endpoint GET /healthz"
```
