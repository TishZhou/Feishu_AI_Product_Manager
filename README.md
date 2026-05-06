# DevFlow Engine

> 输入一句需求，AI 自动走完从文档到代码的完整开发流程，在两个关键节点由人工审核把关。
>
> **字节跳动黑客松参赛项目 — by Tish, Leander**

---

## 功能概览

| 功能 | 说明 |
|------|------|
| 🤖 7 阶段 AI 流水线 | 从需求分析到交付打包，全程自动化 |
| 👥 AI 角色系统 | 每个阶段由独立命名的 AI 角色执行，有专属配色 |
| ⏸ 人工审核检查点 | 阶段 3、6 各一次，支持通过/打回重跑 |
| 📡 实时日志流 | SSE 协议推送 LLM 输出、工具调用、阶段事件 |
| 🔢 Token 消耗统计 | 按阶段展示累计 Token 用量及模型信息 |
| ❓ 澄清问题流 | AI 遇到歧义时暂停，弹窗等待用户补充信息 |
| 🎨 UI 画板 | 用自然语言描述产品，AI 生成模块布局 → 可拖拽排序 → 一键生成 HTML 落地页 |
| 🔄 迭代反馈优化 | 预览页右侧 AI 对话面板，描述意见即时重新生成页面 |
| 📁 产物查看器 | 每阶段产物文件在线预览，文件名全中文 |
| 🔀 源码应用 & 回滚 | 将生成的代码 patch 写入目标仓库，支持一键撤销 |

---

## 工作流程

```
你输入需求
    │
    ▼
[阶段 1]  需求分析          → requirement_spec.md
    │
    ▼
[阶段 2]  架构设计          → solution_design.md
    │
    ▼
[阶段 3]  详细规格          → detailed_spec.md
    │
⏸  检查点 1 ── 审核方案，通过继续 / 打回重跑
    │
    ▼
[阶段 4]  代码生成          → code_diff.patch + implementation_summary.md
    │
    ▼
[阶段 5]  测试生成          → test_report.md
    │
    ▼
[阶段 6]  代码审查          → review_report.md
    │
⏸  检查点 2 ── 审核代码，通过继续 / 打回重跑
    │
    ▼
[阶段 7]  交付打包          → delivery_summary.md
```

---

## 系统架构

```
浏览器 (React/Vite :5000)
        │  /api/*  (Vite proxy)
        ▼
后端 API (FastAPI :8000)
        │
        ├─ PostgreSQL (Replit 托管)
        │
        └─ LLM Provider
             ├─ 火山引擎 / ByteDance Ark（主力）
             └─ Gemini（备用）
```

前端所有请求通过 `/api/` 前缀，Vite dev server 自动 proxy 到后端。

---

## 快速启动

### 环境变量

在项目根目录建立 `.env`：

```env
VOLCANO_API_KEY=your_volcano_key      # 火山引擎（主力 LLM）
GEMINI_API_KEY=your_gemini_key        # Gemini（备用）
DATABASE_URL=                         # Replit PostgreSQL 自动注入
```

### 启动后端

```bash
pip install -r requirements.txt
uvicorn devflow.main:app --host 0.0.0.0 --port 8000 --reload
```

Swagger 文档：http://localhost:8000/docs

### 启动前端

```bash
cd frontend
npm install
npm run dev      # 启动于 :5000，/api/* 自动 proxy → :8000
```

打开 http://localhost:5000 即可使用。

---

## 技术栈

### 后端
| 组件 | 版本/说明 |
|------|----------|
| FastAPI + Uvicorn | 异步 Web 框架 |
| SQLAlchemy (asyncpg) | 异步 ORM，PostgreSQL |
| OpenAI Python SDK | 统一路由到火山引擎 / Gemini |
| Pydantic Settings | 环境变量管理 |

### 前端
| 组件 | 版本/说明 |
|------|----------|
| React 19 + Vite 8 | 现代前端框架 |
| TypeScript | 全类型覆盖 |
| Tailwind CSS v4 | 无配置文件，@tailwindcss/vite 插件 |
| Framer Motion v12 | 动画 |
| TanStack Query | 数据获取 + 2s 轮询 |
| Axios | HTTP 客户端 |
| Lucide React | 图标库 |

---

## 项目结构

```
devflow/                          # 后端
  api/                            # FastAPI 路由（pipelines/runs/checkpoints/artifacts/ui_canvas）
  agents/                         # 每阶段 AI Agent 实现（base.py 含工具注册）
  artifacts/                      # ArtifactStore + patch 生成
  core/                           # 编排器、状态机、background tasks、log_bus
  db/                             # SQLAlchemy 模型 + 异步引擎
  providers/                      # LLM 路由（火山引擎 / Gemini）；向 log_bus 发 token/llm/tool 事件
  schemas/                        # Pydantic 请求/响应模型
  services/                       # repo_safety, source_apply, token_usage, test_progress, repo_map
  tools/                          # edit_file, command_runner, workspace, patch_tools, test_runner
  config.py                       # 自动转换 DB URL 为 asyncpg，剥离 sslmode

frontend/src/
  App.tsx                         # 根组件：SetupView ↔ ConsoleView
  data/personas.ts                # AI 角色系统（7 个角色，色调 token）
  types/api.ts                    # TS 接口定义，STAGES（中文标签），CHECKPOINT_AFTER
  lib/
    api.ts                        # Axios 封装（全部 API 调用含 refineCanvas）
    artifactLabels.ts             # 产物文件名 → 中文标签映射（共享工具）
  hooks/useDevFlow.ts             # TanStack Query hooks（2s 轮询）；useRunTokenUsage
  components/
    SetupView.tsx                 # 深色玻璃风创建表单
    ConsoleView.tsx               # 浅色主题三视图（总览 ↔ 详情 ↔ 画板）
    UICanvasView.tsx              # UI 画板：自然语言 → AI 模块布局 → 拖拽排序 → HTML 生成 → 迭代反馈
    OverviewView.tsx              # 英雄卡片 + 统计 + 流水线进度条
    DetailView.tsx                # 标签页：阶段进度（实时流）/ 产物 / 日志；Token 消耗卡片
    PipelineGraph.tsx             # 浅色侧边栏阶段时间轴
    LogStream.tsx                 # SSE 实时日志（感知 AI 角色）
    CheckpointModal.tsx           # 毛玻璃审核弹窗 + 产物查看器（全中文）
    ClarificationModal.tsx        # 澄清问题弹窗（→ POST /clarifications）
    ArtifactViewer.tsx            # 滑出式产物查看面板（中文标签）
```

---

## REST API 概览

> 所有端点以 `/api` 为前缀，返回 JSON。

### 流水线 & 运行

```
POST /api/pipelines                          创建流水线
GET  /api/pipelines/{id}                     查询流水线
POST /api/pipelines/{id}/runs               启动一次运行
GET  /api/runs/{id}                          查询运行状态
GET  /api/runs/{id}/stages                   各阶段结果
GET  /api/runs/{id}/artifacts               产物列表
GET  /api/runs/{id}/checkpoints             检查点列表
GET  /api/runs/{id}/logs/stream             SSE 实时日志
POST /api/runs/{id}/pause                   暂停
POST /api/runs/{id}/resume                  继续
POST /api/runs/{id}/terminate               终止
POST /api/runs/{id}/clarifications          回答 AI 澄清问题
GET  /api/runs/{id}/token-usage             Token 消耗统计
POST /api/runs/{id}/rollback                回滚已应用的代码
```

### 检查点

```
POST /api/checkpoints/{id}/approve          通过审核
POST /api/checkpoints/{id}/reject           拒绝并指定重跑阶段
```

### 产物

```
GET  /api/artifacts/{id}/content            产物文件原始内容
```

### UI 画板

```
POST /api/runs/{id}/ui-canvas/suggest       自然语言 → 模块布局建议
POST /api/runs/{id}/ui-canvas/generate-code 模块布局 → HTML 代码
POST /api/runs/{id}/ui-canvas/refine        用户反馈 → 迭代优化 HTML
```

---

## UI 画板详解

**完整工作流：**

```
1. 输入产品描述（支持中文自然语言）
         ↓
2. AI 读取当前流水线产物（需求规格 / 架构设计 / 详细规格）作为上下文
         ↓
3. 返回模块布局建议（导航栏、英雄区、功能列表、定价等）
         ↓
4. 可视化画板：拖拽排序 / 展开编辑 props / 从组件库添加模块
         ↓
5. 点击「生成前端代码」→ AI 产出完整 HTML（AOS 动效、毛玻璃 Navbar、响应式）
         ↓
6. 预览页右侧「AI 迭代优化」面板：
   • 输入修改意见（或点击快捷提示）
   • AI 立即更新页面，保留满意部分
   • 无限次迭代，记录对话历史
         ↓
7. 下载 HTML 文件
```

**快捷提示示例：**「改成深色主题」「添加用户评价区块」「蓝色系配色」「让设计更简洁现代」

---

## 实时日志事件格式（SSE）

```jsonc
// 每条 SSE 事件（JSON）
{
  "timestamp": "2025-01-01T12:00:00Z",
  "stage_key": "code_generation",
  "message":   "正在生成 user_service.py ...",
  "level":     "info"   // "info" | "token" | "llm" | "tool" | "error"
}
```

`level: "token"` 为 LLM 流式输出片段，前端实时拼接显示。

---

## AI 角色系统

每个流水线阶段对应一个具名 AI 角色，拥有专属渐变配色：

| 阶段 | 角色名 | 职责 |
|------|--------|------|
| 需求分析 | 析需师 | 解读需求，输出规格文档 |
| 架构设计 | 架构师 | 设计系统架构方案 |
| 详细规格 | 规格师 | 细化接口与数据结构 |
| 代码生成 | 码神 | 编写实现代码 |
| 测试生成 | 测试官 | 生成单元/集成测试 |
| 代码审查 | 审查官 | 发现问题，给出建议 |
| 交付打包 | 交付师 | 整理交付物，生成报告 |

---

## 注意事项

- Tailwind v4：无 `tailwind.config.js`，使用 `@tailwindcss/vite` 插件，所有自定义 token 在 `frontend/src/index.css`
- Token 消耗数据为内存存储，后端重启后清零（不持久化到 DB）
- `devflow/config.py` 自动将 DB URL 转为 `postgresql+asyncpg://` 并剥离 `sslmode`
- 后端必须绑定 `0.0.0.0`（非 `localhost`）才能被 Replit 代理访问
- UI 画板的「重新生成」按钮会清空当前 HTML 并重置对话历史

---

## 数据类型参考

### RunStatus

```typescript
type RunStatus =
  | "created"
  | "running"
  | "waiting_for_approval"       // 等待人工在检查点审核
  | "waiting_for_clarification"  // 等待用户回答 AI 澄清问题
  | "paused"
  | "completed"
  | "failed"
  | "terminated"
```

### StageStatus

```typescript
type StageStatus =
  | "pending" | "running" | "succeeded"
  | "failed"  | "rejected" | "skipped"
```

### 流水线阶段定义

```typescript
const STAGES = [
  { key: "requirement_analysis",  label: "需求分析", index: 1 },
  { key: "solution_architecture", label: "架构设计", index: 2 },
  { key: "detailed_spec",         label: "详细规格", index: 3 },
  { key: "code_generation",       label: "代码生成", index: 4 },
  { key: "test_generation",       label: "测试生成", index: 5 },
  { key: "code_review",           label: "代码审查", index: 6 },
  { key: "delivery",              label: "交付打包", index: 7 },
]

// 检查点触发位置（阶段完成后触发）
const CHECKPOINT_AFTER = {
  "detailed_spec": 1,   // 检查点 1
  "code_review":   2,   // 检查点 2
}
```
