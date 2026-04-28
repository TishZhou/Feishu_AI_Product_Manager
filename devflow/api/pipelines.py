import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from devflow.db.engine import get_session
from devflow.db.models import Pipeline, PipelineRun
from devflow.schemas.pipeline import PipelineCreate, PipelineRead
from devflow.schemas.run import RunRead

router = APIRouter(tags=["Pipelines"])


@router.post("/pipelines", response_model=PipelineRead, status_code=201)
async def create_pipeline(body: PipelineCreate, session: AsyncSession = Depends(get_session)):
    repo = Path(body.repo_path)
    if not repo.exists():
        raise HTTPException(400, f"repo_path does not exist: {body.repo_path}")

    pipeline = Pipeline(
        id=str(uuid.uuid4()),
        name=body.name,
        description=body.description,
        task_type=body.task_type,
        repo_path=str(repo.resolve()),
        provider=body.provider,
        model=body.model,
    )
    session.add(pipeline)
    await session.commit()
    await session.refresh(pipeline)
    return pipeline


@router.get("/pipelines/{pipeline_id}", response_model=PipelineRead)
async def get_pipeline(pipeline_id: str, session: AsyncSession = Depends(get_session)):
    pipeline = await session.get(Pipeline, pipeline_id)
    if not pipeline:
        raise HTTPException(404, "Pipeline not found")
    return pipeline


@router.post("/pipelines/{pipeline_id}/runs", response_model=RunRead, status_code=201)
async def create_run(pipeline_id: str, session: AsyncSession = Depends(get_session)):
    pipeline = await session.get(Pipeline, pipeline_id)
    if not pipeline:
        raise HTTPException(404, "Pipeline not found")

    # Count existing runs for run_number
    stmt = select(PipelineRun).where(PipelineRun.pipeline_id == pipeline_id)
    existing = (await session.execute(stmt)).scalars().all()
    run_number = len(existing) + 1

    run = PipelineRun(
        id=str(uuid.uuid4()),
        pipeline_id=pipeline_id,
        run_number=run_number,
        status="created",
        current_stage="",
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)

    # Spawn background pipeline execution
    from devflow.core.background import task_manager
    from devflow.core.orchestrator import orchestrator

    orchestrator.register_run(run.id)
    task_manager.spawn(run.id, orchestrator.run_pipeline(run.id))

    return run
