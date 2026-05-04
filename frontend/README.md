# DevFlow React Console

这是 DevFlow Engine 的 React/Vite 前端控制台。它负责启动 pipeline、展示 run 状态、阶段进度、产物列表和 checkpoint 审核 UI。

## 架构

```
Browser (React/Vite)
        │  /api/*  (Vite proxy)
        ▼
Backend API (FastAPI :8000)
        │
        ▼
LLM Provider (OpenAI / Volcano)
```

前端所有后端请求都走 `/api/` 前缀。开发环境下，`vite.config.ts` 会把 `/api/*` 自动 proxy 到 `http://localhost:8000`。

## 启动

先启动后端：

```bash
uvicorn devflow.main:app --reload --reload-dir devflow
```

再启动前端：

```bash
cd frontend
npm install
npm run dev
```

默认地址是 http://localhost:5000。如果 5000 被占用，可以临时使用：

```bash
npx vite --host 127.0.0.1 --port 5173
```

## 本地后端兼容

该前端从 teammate 的 `前端` 分支移植而来，但接口以当前本地后端为准：

| 功能 | 当前行为 |
|------|----------|
| 创建 pipeline | `POST /api/pipelines` |
| 启动 run | `POST /api/pipelines/{pipeline_id}/runs` |
| RAG 参考文档 | `POST /api/reference-documents/extract`，支持 PDF / DOCX / DOC / TXT / MD |
| 状态轮询 | `/api/runs/{run_id}`、`/api/runs/{run_id}/stages` |
| 产物列表 | `GET /api/runs/{run_id}/artifacts` |
| Checkpoint 审核 | `POST /api/checkpoints/{checkpoint_id}/approve/reject` |
| 需求澄清 | `POST /api/runs/{run_id}/clarifications` |
| 默认仓库路径 | `GET /api/workspace`，失败时使用 `VITE_DEFAULT_REPO_PATH` 或本地仓库路径 |
| Artifact 内容预览 | `GET /api/artifacts/{artifact_id}/content` |
| 实时日志 | `GET /api/runs/{run_id}/logs/stream` |

支持的 provider 与本地后端一致：`openai`、`volcano`。

## 结构

```
frontend/
├── src/
│   ├── components/
│   │   ├── SetupView.tsx        # 启动页
│   │   ├── ConsoleView.tsx      # 主控台
│   │   ├── PipelineGraph.tsx    # 阶段时间线
│   │   ├── StageDetail.tsx      # 阶段详情
│   │   ├── LogStream.tsx        # 日志区域
│   │   ├── CheckpointModal.tsx  # 审核弹窗
│   │   └── ArtifactViewer.tsx   # 产物预览
│   ├── hooks/useDevFlow.ts      # React Query hooks
│   ├── lib/api.ts               # API client 和兼容层
│   └── types/api.ts             # API 类型和 stage 常量
├── public/
├── package.json
└── vite.config.ts
```

## 验证

```bash
npm run lint
npm run build
```
