import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from devflow.api import checkpoints, meta, pipelines, reference_documents, runs, ui_canvas
from devflow.db.engine import create_tables

FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"


def _setup_logging() -> None:
    fmt = logging.Formatter("%(asctime)s  %(name)-28s  %(message)s", datefmt="%H:%M:%S")
    handler = logging.StreamHandler()
    handler.setFormatter(fmt)
    # Attach to devflow root so all devflow.* loggers inherit it
    devflow_log = logging.getLogger("devflow")
    devflow_log.setLevel(logging.INFO)
    if not devflow_log.handlers:
        devflow_log.addHandler(handler)
    devflow_log.propagate = False  # don't double-print via uvicorn root logger


_setup_logging()


logger = logging.getLogger("devflow")


def _cleanup_generated_files() -> None:
    """Remove only known temporary generated files from older runs.

    Generated code is now stored under artifacts and applied only to an
    artifacts-local execution workspace. Never scan historical patches and
    unlink source files from the main repo.
    """
    from pathlib import Path

    repo_root = Path(__file__).parent.parent
    removed = []

    # Always clean up the generated test file
    test_generated = repo_root / "tests" / "test_generated.py"
    if test_generated.exists():
        test_generated.unlink()
        removed.append("tests/test_generated.py")

    if removed:
        logger.info("Cleaned up %d generated file(s): %s", len(removed), removed)


async def _cancel_stale_runs() -> None:
    """On startup, mark any in-progress runs as failed (they lost their background task)."""
    from sqlalchemy import select, update
    from devflow.db.engine import AsyncSessionLocal
    from devflow.db.models import PipelineRun
    stale = ("created", "running", "waiting_for_approval", "waiting_for_clarification", "paused")
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(PipelineRun).where(PipelineRun.status.in_(stale))
        )
        runs = result.scalars().all()
        if runs:
            ids = [r.id[:8] for r in runs]
            logger.warning("Cancelling %d stale run(s) from previous session: %s", len(runs), ids)
            await session.execute(
                update(PipelineRun)
                .where(PipelineRun.status.in_(stale))
                .values(status="failed", error_message="Server restarted — run was lost. Please start a new run.")
            )
            await session.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_tables()
    _cleanup_generated_files()
    await _cancel_stale_runs()
    logger.info("=" * 60)
    logger.info("  DevFlow Engine  —  ready at http://localhost:8000")
    logger.info("  Swagger docs  →  http://localhost:8000/docs")
    logger.info("=" * 60)
    yield
    logger.info("DevFlow Engine shutting down")


app = FastAPI(
    title="DevFlow Engine",
    description="AI-driven development workflow engine — from requirement to code delivery.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(pipelines.router, prefix="/api")
app.include_router(runs.router, prefix="/api")
app.include_router(checkpoints.router, prefix="/api")
app.include_router(meta.router, prefix="/api")
app.include_router(reference_documents.router, prefix="/api")
app.include_router(ui_canvas.router, prefix="/api")


if FRONTEND_DIST.exists():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        index = FRONTEND_DIST / "index.html"
        if index.exists():
            return FileResponse(str(index))
        return {"service": "DevFlow Engine", "version": "0.1.0", "docs": "/docs"}
else:
    @app.get("/", include_in_schema=False)
    async def root():
        return {"service": "DevFlow Engine", "version": "0.1.0", "docs": "/docs"}
