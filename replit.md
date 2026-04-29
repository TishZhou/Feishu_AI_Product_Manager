# DevFlow Engine

An AI-driven development workflow engine that automates the entire software development lifecycle — from requirement analysis through code generation, testing, review, and delivery.

## Architecture

- **Backend**: FastAPI (Python) running on port 8000 via Uvicorn
- **Frontend**: Streamlit UI on port 5000 (the main user-facing interface)
- **Database**: PostgreSQL (via Replit's managed database, using asyncpg async driver)
- **AI Integration**: OpenAI Python SDK (supports OpenAI and ByteDance Volcano/Ark engine)

## Project Structure

```
devflow/
  api/          - FastAPI route handlers (checkpoints, pipelines, runs, meta)
  agents/       - AI agent implementations for each pipeline stage
  artifacts/    - ArtifactStore module (filesystem-backed artifact storage per run)
  core/         - Pipeline orchestration, state machine, background tasks
  db/           - SQLAlchemy models and async engine setup
  providers/    - LLM routing logic (OpenAI and Volcano Engine)
  schemas/      - Pydantic request/response models
  tools/        - Utility functions (repo search, patch apply, test runner)
  config.py     - Pydantic-settings configuration (auto-converts DB URL to async driver)
  main.py       - FastAPI app entry point
streamlit_app.py - Streamlit frontend UI
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

- **Start application** — Streamlit frontend on port 5000 (webview)
- **Backend API** — FastAPI backend on port 8000 (console)

## Key Notes

- The `devflow/config.py` automatically converts `postgresql://` URLs to `postgresql+asyncpg://` and strips `sslmode` query params (not supported by asyncpg)
- The `devflow/artifacts/` package was created during setup — it provides `ArtifactStore` for per-run filesystem artifact storage
- API keys (OPENAI_API_KEY, VOLCANO_API_KEY) must be set as environment variables or in a `.env` file to use AI features
- Artifacts are stored in the `artifacts/` directory (gitignored)
- Database is PostgreSQL via Replit's managed DB
