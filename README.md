# DevFlow Engine

输入一句需求，AI 自动走完从文档到代码的完整开发流程，在两个关键节点由人工审核把关。

**ByteDance Competition — by Tish, Leander**

---

## 工作流程

```
你输入需求
    │
    ▼
[Stage 1]  📋 需求分析        → requirement_spec.json
    │         agents/requirement_analysis.py
    │         理解需求背景、目标和验收标准
    ▼
[Stage 2A] 🏗️  架构设计        → solution_design.md
    │         agents/solution_architecture.py
    │         主动读取代码库，设计技术方案
    ▼
[Stage 2B] 📝 详细规格        → detailed_spec.json
    │         agents/detailed_spec.py
    │         生成可直接执行的实现规格
    │
⏸️  Checkpoint 1 — 你审核方案文档，通过继续 / 打回从头重跑
    │
    ▼
[Stage 3]  💻 代码生成        → code_diff.patch + implementation_summary.md
    │         agents/code_generation.py
    │         按规格生成代码 diff，自动 git apply 到仓库
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

每次 run 的产物保存在 `artifacts/{run_id}/`，代码变更在 Stage 3 后自动写入仓库。

---

## 快速开始

```bash
# 1. 安装依赖
pip install -r requirements.txt

# 2. 配置 API Key
cp .env.example .env
# 编辑 .env，填入 OPENAI_API_KEY 或 VOLCANO_API_KEY

# 3. 启动后端（终端 1）
uvicorn devflow.main:app --reload --reload-dir devflow

# 4. 启动前端（终端 2）
streamlit run streamlit_app.py
```

打开 http://localhost:8501 即可使用。

> Swagger API 文档：http://localhost:8000/docs

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
| `requirement_spec.json` | Stage 1 | 结构化需求文档 |
| `solution_design.md` | Stage 2A | 技术方案设计 |
| `detailed_spec.json` | Stage 2B | 可执行实现规格 |
| `code_diff.patch` | Stage 3 | 原始代码变更（已自动 git apply） |
| `implementation_summary.md` | Stage 3 | 实现说明 |
| `test_report.json` | Stage 4 | 测试执行报告 |
| `review_report.md` | Stage 5 | 代码审查报告 |
| `delivery_summary.md` | Stage 6 | 交付总结 |
| `final_diff.patch` | Stage 6 | 最终干净 Diff（含审查修订，可直接 `git apply`） |

---

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/pipelines` | 创建 pipeline 配置 |
| GET | `/api/pipelines/{id}` | 查询 pipeline |
| POST | `/api/pipelines/{id}/runs` | 启动一次运行 |
| GET | `/api/runs/{run_id}` | 查询运行状态和当前阶段 |
| GET | `/api/runs/{run_id}/stages` | 查询各阶段结果 |
| GET | `/api/runs/{run_id}/artifacts` | 列出所有产物 |
| GET | `/api/runs/{run_id}/checkpoints` | 列出检查点 |
| POST | `/api/runs/{run_id}/pause` | 暂停运行 |
| POST | `/api/runs/{run_id}/resume` | 继续运行 |
| POST | `/api/runs/{run_id}/terminate` | 终止运行 |
| POST | `/api/checkpoints/{id}/approve` | 通过检查点 |
| POST | `/api/checkpoints/{id}/reject` | 拒绝并指定重跑起点 |
| GET | `/api/providers` | 查看 LLM provider 连通状态 |
| GET | `/api/agents` | 查看 stage 注册表 |

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
streamlit_app.py             # 前端 UI
demo.py                      # CLI 端到端 demo
```
