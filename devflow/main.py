import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from devflow.api import checkpoints, meta, pipelines, runs
from devflow.db.engine import create_tables


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
    """Remove files that were written to the repo by previous pipeline runs."""
    import re
    from pathlib import Path
    from devflow.config import settings

    artifacts_root = Path(settings.ARTIFACTS_DIR)
    repo_root = Path(__file__).parent.parent
    removed = []

    for patch_file in artifacts_root.glob("*/code_diff.patch"):
        try:
            patch_text = patch_file.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        # Find every "new file" created by the patch
        for match in re.finditer(r"^\+\+\+ b/(.+)$", patch_text, re.MULTILINE):
            rel_path = match.group(1).strip()
            # Never delete source files — only clean up generated output files
            if rel_path.startswith("devflow/") or rel_path.startswith("devflow\\"):
                continue
            target = repo_root / rel_path
            if target.exists() and target.is_file():
                target.unlink()
                removed.append(rel_path)

    # Always clean up the generated test file
    test_generated = repo_root / "tests" / "test_generated.py"
    if test_generated.exists():
        test_generated.unlink()
        removed.append("tests/test_generated.py")

    if removed:
        logger.info("Cleaned up %d generated file(s): %s", len(removed), removed)


async def _migrate_legacy_openai_provider() -> None:
    """One-time migration: rename provider='openai' → 'volcano' in all Pipeline rows.

    Historically the column defaulted to 'openai', but those records actually
    used the Volcano endpoint.  Updating them ensures new code paths that rely
    on the provider value behave correctly for existing data.
    """
    from sqlalchemy import text
    from devflow.db.engine import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text("UPDATE pipelines SET provider = 'volcano' WHERE provider = 'openai'")
        )
        await session.commit()
        if result.rowcount:
            logger.info("Migrated %d pipeline(s): provider 'openai' → 'volcano'", result.rowcount)


async def _cancel_stale_runs() -> None:
    """On startup, mark any in-progress runs as failed (they lost their background task)."""
    from sqlalchemy import select, update
    from devflow.db.engine import AsyncSessionLocal
    from devflow.db.models import PipelineRun
    stale = ("created", "running", "waiting_for_approval", "paused")
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
    await _migrate_legacy_openai_provider()
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


@app.get("/", include_in_schema=False)
async def root():
    return {"service": "DevFlow Engine", "version": "0.1.0", "docs": "/docs"}
