from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from devflow.core.orchestrator import orchestrator
from devflow.core.state_machine import RunState
from devflow.db.engine import get_session
from devflow.db.models import Checkpoint, PipelineRun
from devflow.schemas.checkpoint import ApproveRequest, CheckpointRead, RejectRequest

router = APIRouter(tags=["Checkpoints"])


async def _get_cp_or_404(cp_id: str, session: AsyncSession) -> Checkpoint:
    cp = await session.get(Checkpoint, cp_id)
    if not cp:
        raise HTTPException(404, "Checkpoint not found")
    return cp


@router.get("/checkpoints/{checkpoint_id}", response_model=CheckpointRead)
async def get_checkpoint(checkpoint_id: str, session: AsyncSession = Depends(get_session)):
    return await _get_cp_or_404(checkpoint_id, session)


@router.get("/runs/{run_id}/checkpoints", response_model=list[CheckpointRead])
async def list_run_checkpoints(run_id: str, session: AsyncSession = Depends(get_session)):
    stmt = select(Checkpoint).where(Checkpoint.run_id == run_id).order_by(Checkpoint.checkpoint_number)
    rows = (await session.execute(stmt)).scalars().all()
    return list(rows)


@router.post("/checkpoints/{checkpoint_id}/approve", response_model=CheckpointRead)
async def approve_checkpoint(
    checkpoint_id: str,
    body: ApproveRequest,
    session: AsyncSession = Depends(get_session),
):
    cp = await _get_cp_or_404(checkpoint_id, session)
    if cp.status != "waiting":
        raise HTTPException(400, f"Checkpoint not in waiting state (current: {cp.status})")

    cp.status = "approved"
    cp.decision_by = body.decided_by
    cp.decision_reason = body.reason
    cp.decided_at = datetime.now(timezone.utc)
    await session.commit()

    # Update run status and wake orchestrator
    run = await session.get(PipelineRun, cp.run_id)
    if run:
        run.status = RunState.RUNNING.value
        await session.commit()

    orchestrator.resolve_checkpoint(cp.run_id, cp.checkpoint_number, "approved")
    await session.refresh(cp)
    return cp


@router.post("/checkpoints/{checkpoint_id}/reject", response_model=CheckpointRead)
async def reject_checkpoint(
    checkpoint_id: str,
    body: RejectRequest,
    session: AsyncSession = Depends(get_session),
):
    cp = await _get_cp_or_404(checkpoint_id, session)
    if cp.status != "waiting":
        raise HTTPException(400, f"Checkpoint not in waiting state (current: {cp.status})")

    # Allow caller to override the retry stage
    if body.retry_stage_key:
        from devflow.core.pipeline_definition import STAGE_BY_KEY
        if body.retry_stage_key not in STAGE_BY_KEY:
            raise HTTPException(400, f"Unknown retry_stage_key: {body.retry_stage_key}")
        cp.retry_stage_key = body.retry_stage_key

    cp.status = "rejected"
    cp.decision_by = body.decided_by
    cp.decision_reason = body.reason
    cp.decided_at = datetime.now(timezone.utc)
    await session.commit()

    # Update run status back to running (orchestrator will handle retry logic)
    run = await session.get(PipelineRun, cp.run_id)
    if run:
        run.status = RunState.RUNNING.value
        await session.commit()

    orchestrator.resolve_checkpoint(cp.run_id, cp.checkpoint_number, "rejected")
    await session.refresh(cp)
    return cp
