# DevFlow Engine

输入一句需求，AI 自动走完从文档到代码的完整开发流程，在两个关键节点由人工审核把关。

**ByteDance Competition — by Tish, Leander**

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
⏸️  Checkpoint 1 — 你审核方案文档，通过继续 / 打回从头重跑
    │
    ▼
[Stage 3]  💻 代码生成        → code_diff.patch + generated_files/ + implementation_summary.md
    │         agents/code_generation.py
    │         按规格生成代码 diff，并在 artifacts 中保存生成后的文件快照
    ▼
[Stage 4]  🧪 测试生成        → test_report.json
    │         agents/test_generation.py
    │         自动写测试并运行
    ▼
[Stage 5]  🔍 代码审查        → review_report.md
    │         agents/code_review.py
    │         从安全 / 性能 / 规范角度审查代码
    │
⏸️  Checkpoint 2 — 你审核代码，通过继续 / 打回从代码生成重跑
    │
    ▼
[Stage 6]  🚀 交付打包        → delivery_summary.md + final_diff.patch
              agents/delivery.py
```

每次 run 的产物保存在 `artifacts/{run_id}/`。代码生成默认只写入 artifacts，不自动修改目标仓库。
为支持测试执行，系统会在 artifacts 下复制一个隔离的 `execution_workspace_*`，并只在该副本中应用 patch。

---

## 快速开始

### 推荐：React 控制台

终端 1：启动 FastAPI 后端。

```bash
# 安装 Python 依赖
pip install -r requirements.txt

# 配置 API Key
cp .env.example .env
# 编辑 .env，填入 OPENAI_API_KEY 或 VOLCANO_API_KEY

# 启动后端
uvicorn devflow.main:app --reload --reload-dir devflow
```

终端 2：启动 teammate 设计的 React/Vite 前端。

```bash
cd frontend
npm install
npm run dev
```

打开 http://localhost:5000 即可使用。

如果 5000 端口已被占用，改用：

```bash
cd frontend
npx vite --host 127.0.0.1 --port 5173
```

然后打开 http://127.0.0.1:5173。

> Swagger API 文档：http://localhost:8000/docs

### 备选：Streamlit 前端

```bash
# 先按上面的步骤启动 FastAPI 后端，然后另开终端运行：
streamlit run streamlit_app.py
```

打开 http://localhost:8501 即可使用。

### React/Vite 前端

仓库也包含 teammate 设计的 React 控制台，位于 `frontend/`。它通过 Vite proxy 把 `/api/*` 转发到本地 FastAPI 后端。

React 前端以当前本地后端 API 为准，支持创建 pipeline、启动 run、轮询状态、查看阶段、产物内容和 checkpoint 审核。teammate README 中前端依赖的接口已补齐到本地后端：

| 接口 | 说明 |
|------|------|
| `GET /api/workspace` | 返回后端进程的默认工作区路径 |
| `POST /api/reference-documents/extract` | 解析上传参考文档，生成 RAG 上下文 |
| `GET /api/artifacts/{artifact_id}/content` | 返回 artifact 文件原始文本内容 |
| `GET /api/runs/{run_id}/logs/stream` | 返回 SSE 阶段状态事件流 |

React 启动页支持上传参考文档（PDF / DOCX / DOC / TXT / MD）。后端会复用 `devflow.services.document_context.extract_reference_documents()` 提取文本，并把结果写入 pipeline 的 `reference_context` / `reference_sources`，供需求分析 Agent 作为 RAG 参考上下文使用。

运行所需视觉资源在 `frontend/public/` 和 `frontend/src/assets/`。`attached_assets/` 保留 teammate 的截图、错误记录和设计调试素材，不参与构建。

---

## LLM 配置

两个 provider 均使用 OpenAI Python SDK，只是 `base_url` 不同：

| Provider | 环境变量 | 默认模型 | 说明 |
|----------|---------|---------|------|
| `openai` | `OPENAI_API_KEY` | `gpt-4o` | OpenAI 官方 |
| `volcano` | `VOLCANO_API_KEY` | `seed-v1.6` | 火山引擎，key 格式为 `key_id:secret_key` |

在 `.env` 里设置 `DEFAULT_PROVIDER=volcano` 可全局切换为火山引擎。

创建 pipeline 时也可以在请求体里单独指定 `provider` 和 `model`，覆盖全局默认值。

---

## 产物清单

| 文件 | 来自阶段 | 内容 |
|------|---------|------|
| `requirement_spec.prd.md` | Stage 1 | 面向人工审核的 PRD 需求文档 |
| `requirement_spec.json` | Stage 1 | 面向后续 agent 的结构化需求数据 |
| `repo_context_summary.json` | Stage 2A | 压缩后的代码库地图、关键符号、相关文件和测试位置 |
| `solution_design.md` | Stage 2A | 面向人工审核的技术方案设计 |
| `solution_contract.json` | Stage 2A | 面向后续 agent 的方案 contract，含影响范围、文件清单、API 设计和测试映射 |
| `detailed_spec.json` | Stage 2B | 精炼后的可执行实现规格，兼容代码生成输入 |
| `code_diff.patch` | Stage 3 | 原始代码变更 Diff |
| `generated_files_manifest.json` | Stage 3 | 生成文件清单，指向 artifacts 下的完整文件快照 |
| `generated_files/` | Stage 3 | 根据 diff 物化出的完整文件副本，不修改目标仓库 |
| `execution_workspace_*` | Stage 3 | 用于测试执行的隔离工作区副本，patch 只应用到这里 |
| `implementation_summary.md` | Stage 3 | 实现说明 |
| `test_report.json` | Stage 4 | 测试执行报告 |
| `review_report.md` | Stage 5 | 代码审查报告 |
| `delivery_summary.md` | Stage 6 | 交付总结 |
| `final_diff.patch` | Stage 6 | 最终干净 Diff（含审查修订，可直接 `git apply`） |

---

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/workspace` | 返回后端进程默认工作区路径 |
| POST | `/api/reference-documents/extract` | 解析参考文档并返回 `reference_context` / `reference_sources` |
| POST | `/api/pipelines` | 创建 pipeline 配置 |
| GET | `/api/pipelines/{id}` | 查询 pipeline |
| POST | `/api/pipelines/{id}/runs` | 启动一次运行 |
| GET | `/api/runs/{run_id}` | 查询运行状态和当前阶段 |
| GET | `/api/runs/{run_id}/stages` | 查询各阶段结果 |
| GET | `/api/runs/{run_id}/artifacts` | 列出所有产物 |
| GET | `/api/artifacts/{artifact_id}/content` | 读取产物原始文本内容 |
| GET | `/api/runs/{run_id}/checkpoints` | 列出检查点 |
| GET | `/api/runs/{run_id}/logs/stream` | SSE 阶段状态事件流 |
| POST | `/api/runs/{run_id}/pause` | 暂停运行 |
| POST | `/api/runs/{run_id}/resume` | 继续运行 |
| POST | `/api/runs/{run_id}/terminate` | 终止运行 |
| POST | `/api/checkpoints/{id}/approve` | 通过检查点 |
| POST | `/api/checkpoints/{id}/reject` | 拒绝并指定重跑起点 |
| GET | `/api/providers` | 查看 LLM provider 连通状态 |
| GET | `/api/agents` | 查看 stage 注册表 |

---

### React 前端数据类型

React 前端的类型定义集中在 `frontend/src/types/api.ts`，和本地后端 schema 对齐：

```typescript
type RunStatus =
  | "created"
  | "running"
  | "waiting_for_approval"
  | "waiting_for_clarification"
  | "paused"
  | "completed"
  | "failed"
  | "terminated"

type StageStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "rejected"
  | "skipped"
```

前端轮询策略：

| 资源 | 间隔 |
|------|------|
| Run 状态 | 运行中每 2s |
| Stages | 2s |
| Artifacts | 2s |
| Checkpoints | 2s |

---

## CLI Demo

不用前端，直接命令行跑完整个流程：

```bash
python demo.py
# 或指定 provider 和需求
python demo.py --provider volcano --requirement "Add a health-check endpoint GET /healthz"
```

demo 会自动轮询状态，在每个 Checkpoint 暂停并提示你输入 `y/n`。

---

## 项目结构

```
devflow/
├── main.py                  # FastAPI 入口 + 启动清理逻辑
├── config.py                # 配置（读取 .env）
├── db/
│   ├── engine.py            # SQLAlchemy async 引擎（SQLite）
│   └── models.py            # ORM 模型：Pipeline / PipelineRun / StageResult / Checkpoint / Artifact
├── api/                     # FastAPI 路由层
├── core/
│   ├── pipeline_definition.py  # Stage 注册表（7 个 stage 的定义）
│   ├── orchestrator.py         # 主编排循环 + Checkpoint pause/resume
│   ├── state_machine.py        # RunState / StageState 枚举
│   └── background.py           # asyncio 后台任务管理
├── agents/                  # 7 个 Agent 实现
│   ├── base.py                      # BaseAgent / AgentContext / AgentResult
│   ├── requirement_analysis.py      # Stage 1 — 需求分析
│   ├── solution_architecture.py     # Stage 2A — 架构设计
│   ├── detailed_spec.py             # Stage 2B — 详细规格
│   ├── code_generation.py           # Stage 3 — 代码生成
│   ├── test_generation.py           # Stage 4 — 测试生成
│   ├── code_review.py               # Stage 5 — 代码审查
│   ├── delivery.py                  # Stage 6 — 交付打包
│   └── prompts/                     # 各 Agent 对应的 prompt 模板
├── providers/
│   └── router.py            # ProviderRouter（OpenAI + 火山引擎，含 tool-use 循环）
├── tools/
│   ├── repo_tools.py        # list_dir / read_file / search_code / write_file
│   ├── patch_tools.py       # apply_patch（git apply 封装）
│   └── test_runner.py       # run_test（subprocess pytest）
└── artifacts/store.py       # ArtifactStore（按 run_id 分目录读写）

artifacts/                   # 运行时产物（gitignored）
data/devflow.db              # SQLite 数据库（gitignored）
streamlit_app.py             # Streamlit 前端 UI
frontend/                    # React/Vite 前端控制台
attached_assets/             # teammate 设计/调试素材
demo.py                      # CLI 端到端 demo
```

## 前端结构

```
frontend/
├── src/
│   ├── components/
│   │   ├── SetupView.tsx        # 启动页：填写需求、选择 provider
│   │   ├── ConsoleView.tsx      # 主控台：整体布局
│   │   ├── PipelineGraph.tsx    # 左侧阶段时间线
│   │   ├── StageDetail.tsx      # 阶段详情和产物入口
│   │   ├── LogStream.tsx        # 底部日志区域
│   │   ├── CheckpointModal.tsx  # 人工审核 Modal
│   │   └── ArtifactViewer.tsx   # 产物预览
│   ├── hooks/useDevFlow.ts      # React Query hooks
│   ├── lib/api.ts               # Axios 封装和本地兼容层
│   └── types/api.ts             # TypeScript 类型 + Stage 常量
├── public/                      # 背景图、favicon、icons
├── package.json
└── vite.config.ts               # /api proxy → localhost:8000
```

**前端技术栈**：React 19、Vite 8、Tailwind CSS v4、@tanstack/react-query、framer-motion、axios。
