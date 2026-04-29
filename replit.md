# DevFlow Engine

An AI-driven development workflow engine that automates the entire software development lifecycle — from requirement analysis through code generation, testing, review, and delivery.

## Architecture

- **Backend**: FastAPI (Python) on port 8000 via Uvicorn (localhost binding)
- **Frontend**: React (Vite + TypeScript) on port 5000 (the main user-facing interface)
- **Database**: PostgreSQL via Replit's managed database (asyncpg async driver)
- **AI Integration**: OpenAI Python SDK (supports OpenAI and ByteDance Volcano/Ark engine)

## Project Structure

```
devflow/
  api/          - FastAPI route handlers (checkpoints, pipelines, runs, meta)
  agents/       - AI agent implementations for each pipeline stage
  artifacts/    - ArtifactStore module (filesystem-backed per-run artifact storage)
  core/         - Pipeline orchestration, state machine, background tasks
  db/           - SQLAlchemy models and async engine setup
  providers/    - LLM routing logic (OpenAI and Volcano Engine)
  schemas/      - Pydantic request/response models
  tools/        - Utility functions (repo search, patch apply, test runner)
  config.py     - Pydantic-settings (auto-converts DB URL to async driver)
  main.py       - FastAPI app entry point with CORS middleware

frontend/
  src/
    App.tsx              - Root component (setup view ↔ console view state)
    main.tsx             - Entry point with TanStack Query provider
    components/
      SetupView.tsx      - Pipeline creation form
      ConsoleView.tsx    - Active run console layout
      PipelineGraph.tsx  - ReactFlow 7-stage DAG visualizer
      StageDetail.tsx    - Current stage info + artifact chips
      LogStream.tsx      - Terminal-style synthetic log stream
      CheckpointModal.tsx - Frosted glass approval modal with Monaco Editor
      ArtifactViewer.tsx - Monaco Editor slide-in panel
    hooks/
      useDevFlow.ts      - TanStack Query hooks (2s polling for active runs)
    lib/
      api.ts             - Axios-based API client for all endpoints
    types/
      api.ts             - TypeScript interfaces + STAGES constant
  vite.config.ts         - Vite with Tailwind v4 plugin, port 5000, allowedHosts: true

streamlit_app.py - Legacy Streamlit UI (kept for reference, not used in main workflow)
```

## Pipeline Stages

1. Requirement Analysis → `requirement_spec.json`
2. Architecture Design → `solution_design.md`
3. Detailed Spec → `detailed_spec.json` *(Checkpoint 1: Human review)*
4. Code Generation → `code_diff.patch` (auto-applied)
5. Test Generation → `test_report.json`
6. Code Review → `review_report.md` *(Checkpoint 2: Human review)*
7. Delivery → `delivery_summary.md` + `final_diff.patch`

## Workflows

- **Start application** — React/Vite frontend on port 5000 (webview): `cd frontend && npm run dev`
- **Backend API** — FastAPI backend on port 8000 (console): `uvicorn devflow.main:app --host localhost --port 8000 --reload`

## Added API Endpoints

- `GET /api/artifacts/{artifact_id}/content` — Returns artifact file content as plain text (for Monaco Editor display)
- CORS middleware enabled on the backend for all origins (React frontend at port 5000)

## Key Notes

- `devflow/config.py` auto-converts `postgresql://` to `postgresql+asyncpg://` and strips `sslmode` params
- `devflow/artifacts/` package provides `ArtifactStore` for per-run filesystem artifact storage
- API keys (OPENAI_API_KEY, VOLCANO_API_KEY) must be set as environment variables or in a `.env` file
- Artifacts stored in `artifacts/` directory (gitignored)
- Database is PostgreSQL via Replit's managed DB
- Tailwind CSS v4 used (no tailwind.config.js — uses @tailwindcss/vite plugin)
- Frontend uses Inter for body text, JetBrains Mono for code/terminal displays
- Design system: bg-slate-950 base, #3370ff running/active, #00b42a success, #f59e0b warning, #ef4444 error
