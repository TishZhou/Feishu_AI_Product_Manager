from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from devflow.core.background import task_manager
from devflow.core.orchestrator import orchestrator
from devflow.core.state_machine import RunState
from devflow.db.engine import get_session
from devflow.db.models import Artifact, PipelineRun, StageResult
from devflow.schemas.artifact import ArtifactRead
from devflow.schemas.run import RunRead, StageResultRead

router = APIRouter(tags=["Runs"])


async def _get_run_or_404(run_id: str, session: AsyncSession) -> PipelineRun:
    run = await session.get(PipelineRun, run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    return run


@router.get("/runs/{run_id}", response_model=RunRead)
async def get_run(run_id: str, session: AsyncSession = Depends(get_session)):
    return await _get_run_or_404(run_id, session)


@router.get("/runs/{run_id}/stages", response_model=list[StageResultRead])
async def get_run_stages(run_id: str, session: AsyncSession = Depends(get_session)):
    await _get_run_or_404(run_id, session)
    stmt = select(StageResult).where(StageResult.run_id == run_id).order_by(StageResult.stage_index, StageResult.attempt)
    rows = (await session.execute(stmt)).scalars().all()
    return list(rows)


@router.post("/runs/{run_id}/pause")
async def pause_run(run_id: str, session: AsyncSession = Depends(get_session)):
    run = await _get_run_or_404(run_id, session)
    if run.status != RunState.RUNNING:
        raise HTTPException(400, f"Run is not in running state (current: {run.status})")
    orchestrator.pause(run_id)
    run.status = RunState.PAUSED.value
    await session.commit()
    return {"run_id": run_id, "status": "paused"}


@router.post("/runs/{run_id}/resume")
async def resume_run(run_id: str, session: AsyncSession = Depends(get_session)):
    run = await _get_run_or_404(run_id, session)
    if run.status != RunState.PAUSED:
        raise HTTPException(400, f"Run is not paused (current: {run.status})")
    orchestrator.resume(run_id)
    run.status = RunState.RUNNING.value
    await session.commit()
    return {"run_id": run_id, "status": "running"}


@router.post("/runs/{run_id}/terminate")
async def terminate_run(run_id: str, session: AsyncSession = Depends(get_session)):
    run = await _get_run_or_404(run_id, session)
    if run.status in (RunState.COMPLETED.value, RunState.FAILED.value, RunState.TERMINATED.value):
        raise HTTPException(400, f"Run already in terminal state: {run.status}")
    task_manager.cancel(run_id)
    orchestrator.cleanup(run_id)
    run.status = RunState.TERMINATED.value
    await session.commit()
    return {"run_id": run_id, "status": "terminated"}


@router.get("/runs/{run_id}/artifacts", response_model=list[ArtifactRead])
async def list_artifacts(run_id: str, session: AsyncSession = Depends(get_session)):
    await _get_run_or_404(run_id, session)
    stmt = select(Artifact).where(Artifact.run_id == run_id).order_by(Artifact.created_at)
    rows = (await session.execute(stmt)).scalars().all()
    return list(rows)
