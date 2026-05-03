# DevFlow Engine

輸入一句需求，AI 自動走完從文件到代碼的完整開發流程，在兩個關鍵節點由人工審核把關。

**ByteDance Competition — by Tish, Leander**

---

## 工作流程

```
你輸入需求
    │
    ▼
[Stage 1]  需求分析        → requirement_spec.json
    │
    ▼
[Stage 2]  架構設計        → solution_design.md
    │
    ▼
[Stage 3]  詳細規格        → detailed_spec.json
    │
⏸  Checkpoint 1 — 審核方案，通過繼續 / 打回從頭重跑
    │
    ▼
[Stage 4]  代碼生成        → code_diff.patch + implementation_summary.md
    │
    ▼
[Stage 5]  測試生成        → test_report.json
    │
    ▼
[Stage 6]  代碼審查        → review_report.md
    │
⏸  Checkpoint 2 — 審核代碼，通過繼續 / 打回從代碼生成重跑
    │
    ▼
[Stage 7]  交付打包        → delivery_summary.md
```

---

## 架構

```
Browser (React/Vite :5000)
        │  /api/*  (Vite proxy)
        ▼
Backend API (FastAPI :8000)
        │
        ▼
   LLM Provider (Volcano Engine / OpenAI / Gemini)
```

前端所有請求都走 `/api/` 前綴，Vite dev server 自動 proxy 到後端 `localhost:8000`。
生產環境需要將 `/api/*` 反向代理到後端服務。

---

## 快速啟動

### 環境變數

在項目根目錄建立 `.env`：

```env
VOLCANO_API_KEY=your_key_here      # 火山引擎（主要）
# OPENAI_API_KEY=sk-...            # OpenAI（備用）
# GEMINI_API_KEY=...               # Gemini（備用）
```

### 後端

```bash
pip install -r requirements.txt
uvicorn devflow.main:app --host 0.0.0.0 --port 8000 --reload
```

Swagger 文檔：http://localhost:8000/docs

### 前端

```bash
cd frontend
npm install
npm run dev       # 啟動於 :5000，/api/* 自動 proxy → :8000
```

打開 http://localhost:5000 即可使用。

---

## REST API 合約

> 所有端點都以 `/api` 為前綴，返回 JSON。

### Workspace

```
GET /api/workspace
→ { "path": string }        # 返回服務器端默認工作區路徑
```

### Pipelines

```
POST /api/pipelines
Body: {
  "name":        string,
  "description": string,      # 任務需求描述（自然語言）
  "repo_path":   string,      # 服務器端 repo 絕對路徑
  "task_type"?:  string,      # 默認 "development"
  "provider"?:   string,      # "volcano" | "openai" | "gemini"
  "model"?:      string       # 留空使用各 provider 默認模型
}
→ Pipeline

GET /api/pipelines/{pipeline_id}
→ Pipeline
```

### Runs

```
POST /api/pipelines/{pipeline_id}/runs
→ Run                         # 建立並立即啟動一次流水線執行

GET /api/runs/{run_id}
→ Run

GET /api/runs/{run_id}/stages
→ StageResult[]

GET /api/runs/{run_id}/artifacts
→ Artifact[]

GET /api/runs/{run_id}/checkpoints
→ Checkpoint[]

GET /api/runs/{run_id}/logs/stream
Content-Type: text/event-stream
→ SSE 實時日誌流

POST /api/runs/{run_id}/pause
POST /api/runs/{run_id}/resume
POST /api/runs/{run_id}/terminate
→ {}
```

### Checkpoints

```
POST /api/checkpoints/{checkpoint_id}/approve
Body: { "decided_by": string, "reason": string }
→ Checkpoint

POST /api/checkpoints/{checkpoint_id}/reject
Body: {
  "decided_by":      string,
  "reason":          string,
  "retry_stage_key": string    # 從哪個 stage 重試
}
→ Checkpoint
```

### Artifacts

```
GET /api/artifacts/{artifact_id}/content
→ string（文件原始內容）
```

---

## 數據類型

### Pipeline

```typescript
{
  id:          string
  name:        string
  description: string
  task_type:   string
  repo_path:   string
  provider:    string
  model:       string
  created_at:  string        // ISO 8601
}
```

### Run

```typescript
{
  id:            string
  pipeline_id:   string
  run_number:    number
  status:        RunStatus
  current_stage: string
  error_message: string
  started_at:    string | null
  completed_at:  string | null
  created_at:    string
}

type RunStatus =
  | "created"
  | "running"
  | "waiting_for_approval"   // 等待人工在 Checkpoint 審核
  | "paused"
  | "completed"
  | "failed"
  | "terminated"
```

### StageResult

```typescript
{
  id:                   string
  run_id:               string
  stage_key:            string       // 見下表
  stage_index:          number       // 1–7
  status:               StageStatus
  attempt:              number
  provider:             string
  model:                string
  error_message:        string
  started_at:           string | null
  completed_at:         string | null
  duration_seconds:     number
  output_artifact_keys: string       // 逗號分隔的產物 filename
}

type StageStatus =
  | "pending" | "running" | "succeeded"
  | "failed"  | "rejected" | "skipped"
```

### Artifact

```typescript
{
  id:           string
  run_id:       string
  stage_key:    string
  filename:     string
  file_path:    string
  content_type: string
  size_bytes:   number
  created_at:   string
}
```

### Checkpoint

```typescript
{
  id:                  string
  run_id:              string
  checkpoint_number:   number          // 1 或 2
  label:               string
  required_stage_keys: string          // 逗號分隔
  retry_stage_key:     string          // 拒絕時從此 stage 重試
  status:              "waiting" | "approved" | "rejected"
  decision_by:         string
  decision_reason:     string
  decided_at:          string | null
  created_at:          string
}
```

---

## 流水線階段定義

```typescript
const STAGES = [
  { key: "requirement_analysis",  label: "需求分析", index: 1 },
  { key: "solution_architecture", label: "架構設計", index: 2 },
  { key: "detailed_spec",         label: "詳細規格", index: 3 },
  { key: "code_generation",       label: "代碼生成", index: 4 },
  { key: "test_generation",       label: "測試生成", index: 5 },
  { key: "code_review",           label: "代碼審查", index: 6 },
  { key: "delivery",              label: "交付打包", index: 7 },
]

// Checkpoint 位置：stage 完成後觸發
const CHECKPOINT_AFTER = {
  "detailed_spec": 1,   // Checkpoint 1
  "code_review":   2,   // Checkpoint 2
}
```

---

## Checkpoint 流程

當 Checkpoint 觸發時：
1. Run 的 `status` 變為 `"waiting_for_approval"`
2. `GET /api/runs/{id}/checkpoints` 會返回一條 `status: "waiting"` 的 Checkpoint
3. 前端輪詢到後彈出審核 Modal
4. 用戶點「通過」→ `POST /api/checkpoints/{id}/approve`
5. 用戶點「拒絕」→ `POST /api/checkpoints/{id}/reject`（需指定 `retry_stage_key`）

---

## 實時日誌（SSE）

前端通過 SSE 接收實時日誌：

```
GET /api/runs/{run_id}/logs/stream
Content-Type: text/event-stream

每條事件（JSON 格式）：
{
  "timestamp": string,
  "stage_key": string,
  "message":   string,
  "level":     "info" | "llm" | "tool" | "error"
}
```

---

## 輪詢策略

前端採用輪詢（SSE 僅用於日誌流）：

| 資源 | 間隔 | 條件 |
|------|------|------|
| Run 狀態 | 2s | 僅 `created` / `running` 時 |
| Stages | 2s | 始終 |
| Artifacts | 2s | 始終 |
| Checkpoints | 2s | 始終 |

---

## 前端結構

```
frontend/
├── src/
│   ├── components/
│   │   ├── SetupView.tsx        # 啟動頁：填寫需求、選 provider
│   │   ├── ConsoleView.tsx      # 主控台：整體佈局
│   │   ├── PipelineGraph.tsx    # 左側時間軸
│   │   ├── StageDetail.tsx      # 右側階段詳情
│   │   ├── LogStream.tsx        # 底部實時日誌
│   │   ├── CheckpointModal.tsx  # 人工審核 Modal
│   │   └── ArtifactViewer.tsx   # 產物預覽
│   ├── hooks/useDevFlow.ts      # 所有 React Query hooks
│   ├── lib/api.ts               # Axios 封裝（全部 API 調用）
│   └── types/api.ts             # TypeScript 類型 + Stage 常量
├── package.json
└── vite.config.ts               # /api proxy → localhost:8000
```

---

## 後端結構

```
devflow/
├── main.py                      # FastAPI 入口
├── config.py                    # 環境變量配置
├── db/
│   ├── engine.py                # SQLAlchemy async（SQLite）
│   └── models.py                # Pipeline / Run / Stage / Checkpoint / Artifact
├── api/                         # FastAPI 路由
├── core/
│   ├── pipeline_definition.py   # Stage 註冊表
│   ├── orchestrator.py          # 主編排循環 + Checkpoint 暫停
│   └── background.py            # asyncio 後台任務
├── agents/                      # 7 個 Agent 實現
│   ├── base.py
│   └── *.py
└── providers/
    └── router.py                # LLM Provider 路由（Volcano / OpenAI / Gemini）
```

---

## 技術棧

**前端**：React 19、Vite 8、Tailwind CSS v4、@tanstack/react-query、framer-motion、axios

**後端**：FastAPI、SQLAlchemy async、SQLite、OpenAI Python SDK 兼容接口
