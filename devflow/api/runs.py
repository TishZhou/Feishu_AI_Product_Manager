import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from devflow.artifacts.patch_materializer import build_patch_review_payload
from devflow.config import settings
from devflow.core.background import task_manager
from devflow.core.orchestrator import orchestrator
from devflow.core.state_machine import RunState
from devflow.db.engine import AsyncSessionLocal, get_session
from devflow.db.models import Artifact, PipelineRun, StageResult
from devflow.schemas.artifact import ArtifactRead
from devflow.schemas.run import ClarificationRequest, RunRead, StageResultRead
from devflow.services.source_apply import get_application_status, rollback_source
from devflow.services.test_progress import load_test_progress, progress_from_report

router = APIRouter(tags=["Runs"])


async def _get_run_or_404(run_id: str, session: AsyncSession) -> PipelineRun:
    run = await session.get(PipelineRun, run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    return run


@router.get("/runs/{run_id}", response_model=RunRead)
async def get_run(run_id: str, session: AsyncSession = Depends(get_session)):
    return await _get_run_or_404(run_id, session)


def _artifacts_dir_for(run_id: str) -> Path:
    return Path(settings.ARTIFACTS_DIR) / run_id


@router.get("/runs/{run_id}/source-application")
async def get_source_application_status(
    run_id: str, session: AsyncSession = Depends(get_session)
):
    """Whether this run's patch was applied to the source repo, and if so when."""
    await _get_run_or_404(run_id, session)
    return get_application_status(run_id, _artifacts_dir_for(run_id))


@router.post("/runs/{run_id}/rollback")
async def rollback_run(run_id: str, session: AsyncSession = Depends(get_session)):
    """Restore source files to the snapshot taken before delivery applied this run."""
    await _get_run_or_404(run_id, session)
    result = rollback_source(run_id, _artifacts_dir_for(run_id))
    if result.get("status") in {"failed", "not_found"}:
        raise HTTPException(404 if result["status"] == "not_found" else 500, detail=result)
    return result


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


@router.post("/runs/{run_id}/clarifications")
async def submit_clarification(
    run_id: str,
    body: ClarificationRequest,
    session: AsyncSession = Depends(get_session),
):
    run = await _get_run_or_404(run_id, session)
    if run.status != RunState.WAITING_FOR_CLARIFICATION.value:
        raise HTTPException(400, f"Run is not waiting for clarification (current: {run.status})")
    if not body.answers.strip():
        raise HTTPException(400, "answers cannot be empty")

    run.status = RunState.RUNNING.value
    await session.commit()
    orchestrator.resolve_clarification(run_id, f"回答人：{body.answered_by}\n{body.answers.strip()}")
    return {"run_id": run_id, "status": "running"}


@router.get("/runs/{run_id}/artifacts", response_model=list[ArtifactRead])
async def list_artifacts(run_id: str, session: AsyncSession = Depends(get_session)):
    await _get_run_or_404(run_id, session)
    stmt = select(Artifact).where(Artifact.run_id == run_id).order_by(Artifact.created_at)
    rows = (await session.execute(stmt)).scalars().all()
    return list(rows)


async def _read_run_artifact(run_id: str, filename: str, session: AsyncSession) -> str:
    stmt = select(Artifact).where(
        Artifact.run_id == run_id,
        Artifact.filename == filename,
    ).order_by(Artifact.created_at.desc())
    artifact = (await session.execute(stmt)).scalars().first()
    if not artifact:
        return ""

    path = Path(artifact.file_path)
    if not path.exists() or not path.is_file():
        return ""
    return path.read_text(encoding="utf-8", errors="replace")


@router.get("/runs/{run_id}/clarification")
async def get_run_clarification(run_id: str, session: AsyncSession = Depends(get_session)):
    await _get_run_or_404(run_id, session)

    content = await _read_run_artifact(run_id, "requirement_clarification.json", session)
    if content:
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            return {
                "title": "需求澄清",
                "summary": "",
                "open_questions": [content],
                "missing_critical_info": [],
                "ambiguities": [],
                "instruction": "请根据下方内容补充说明。",
            }

    requirement = await _read_run_artifact(run_id, "requirement_spec.json", session)
    if requirement:
        try:
            spec = json.loads(requirement)
        except json.JSONDecodeError:
            spec = {}
        quality_check = spec.get("quality_check") if isinstance(spec, dict) else {}
        if not isinstance(quality_check, dict):
            quality_check = {}
        return {
            "title": spec.get("title", "需求需要澄清") if isinstance(spec, dict) else "需求需要澄清",
            "summary": spec.get("summary", "") if isinstance(spec, dict) else "",
            "open_questions": spec.get("open_questions", []) if isinstance(spec, dict) else [],
            "missing_critical_info": quality_check.get("missing_critical_info", []),
            "ambiguities": quality_check.get("ambiguities", []),
            "confidence_score": spec.get("confidence_score") if isinstance(spec, dict) else None,
            "instruction": "请回答这些问题。提交后系统会带着你的补充说明重新执行需求分析。",
        }

    return {
        "title": "需求澄清",
        "summary": "",
        "open_questions": ["需求分析正在生成澄清问题。如果这里长时间没有变化，请刷新页面或检查后端日志。"],
        "missing_critical_info": [],
        "ambiguities": [],
        "instruction": "请补充会影响后续架构或验收判断的信息。",
    }


@router.get("/artifacts/{artifact_id}/content", response_class=PlainTextResponse)
async def get_artifact_content(artifact_id: str, session: AsyncSession = Depends(get_session)):
    artifact = await session.get(Artifact, artifact_id)
    if not artifact:
        raise HTTPException(404, "Artifact not found")

    path = Path(artifact.file_path)
    if not path.exists() or not path.is_file():
        raise HTTPException(404, "Artifact file not found on disk")

    return PlainTextResponse(path.read_text(encoding="utf-8", errors="replace"))


@router.get("/runs/{run_id}/code-review-files")
async def get_run_code_review_files(run_id: str, session: AsyncSession = Depends(get_session)):
    await _get_run_or_404(run_id, session)

    patch = await _read_run_artifact(run_id, "code_diff.patch", session)
    if not patch:
        return {
            "mode": "artifact_only",
            "applied_to_repo": False,
            "patch_applied_to_workspace": False,
            "workspace_apply_error": "",
            "execution_workspace": "",
            "source_artifacts": {},
            "file_count": 0,
            "files": [],
        }

    manifest: dict = {}
    manifest_text = await _read_run_artifact(run_id, "generated_files_manifest.json", session)
    if manifest_text:
        try:
            parsed = json.loads(manifest_text)
            if isinstance(parsed, dict):
                manifest = parsed
        except json.JSONDecodeError:
            manifest = {"workspace_apply_error": "generated_files_manifest.json is not valid JSON"}

    stmt = select(Artifact).where(
        Artifact.run_id == run_id,
        Artifact.filename == "code_diff.patch",
    ).order_by(Artifact.created_at.desc())
    patch_artifact = (await session.execute(stmt)).scalars().first()

    manifest_stmt = select(Artifact).where(
        Artifact.run_id == run_id,
        Artifact.filename == "generated_files_manifest.json",
    ).order_by(Artifact.created_at.desc())
    manifest_artifact = (await session.execute(manifest_stmt)).scalars().first()

    artifact_dir = Path(patch_artifact.file_path).parent if patch_artifact else Path("artifacts") / run_id
    payload = build_patch_review_payload(patch, manifest, artifact_dir)
    payload["source_artifacts"] = {
        "code_diff.patch": patch_artifact.id if patch_artifact else "",
        "generated_files_manifest.json": manifest_artifact.id if manifest_artifact else "",
    }
    return payload


@router.get("/runs/{run_id}/test-progress")
async def get_run_test_progress(run_id: str, session: AsyncSession = Depends(get_session)):
    await _get_run_or_404(run_id, session)

    progress = load_test_progress(run_id)
    if progress.get("status") != "idle":
        return progress

    report_text = await _read_run_artifact(run_id, "test_report.json", session)
    if report_text:
        try:
            report = json.loads(report_text)
        except json.JSONDecodeError:
            report = {}
        if isinstance(report, dict):
            return progress_from_report(run_id, report)
    return progress


def _sse_payload(stage_key: str, message: str, level: str = "info") -> str:
    data = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "time": datetime.now().strftime("%H:%M:%S"),
        "stage_key": stage_key,
        "message": message,
        "level": level,
    }
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def _stage_message(stage: StageResult) -> tuple[str, str]:
    label_by_status = {
        "pending": ("info", f"{stage.stage_key} 等待执行"),
        "running": ("start", f"{stage.stage_key} 正在执行"),
        "succeeded": ("success", f"{stage.stage_key} 执行完成"),
        "failed": ("fail", f"{stage.stage_key} 执行失败：{stage.error_message or 'unknown error'}"),
        "rejected": ("reject", f"{stage.stage_key} 已打回重试"),
        "skipped": ("info", f"{stage.stage_key} 已跳过"),
    }
    return label_by_status.get(stage.status, ("info", f"{stage.stage_key} 状态：{stage.status}"))


async def _run_snapshot(run_id: str) -> tuple[str, list[StageResult]]:
    async with AsyncSessionLocal() as session:
        run = await session.get(PipelineRun, run_id)
        if not run:
            raise HTTPException(404, "Run not found")
        stmt = select(StageResult).where(StageResult.run_id == run_id).order_by(StageResult.stage_index, StageResult.attempt)
        stages = (await session.execute(stmt)).scalars().all()
        return run.status, list(stages)


@router.get("/runs/{run_id}/logs/stream")
async def stream_run_logs(run_id: str, request: Request, session: AsyncSession = Depends(get_session)):
    await _get_run_or_404(run_id, session)

    async def event_generator():
        seen: set[tuple[str, int, str]] = set()
        terminal = {
            RunState.COMPLETED.value,
            RunState.FAILED.value,
            RunState.TERMINATED.value,
        }
        yield ": connected\n\n"

        while True:
            if await request.is_disconnected():
                break

            try:
                run_status, stages = await _run_snapshot(run_id)
            except HTTPException:
                yield _sse_payload("", "Run not found", "fail")
                break

            for stage in stages:
                key = (stage.stage_key, stage.attempt, stage.status)
                if key in seen:
                    continue
                seen.add(key)
                level, message = _stage_message(stage)
                yield _sse_payload(stage.stage_key, message, level)

            if run_status in terminal:
                yield _sse_payload("", f"Run {run_status}", "success" if run_status == RunState.COMPLETED.value else "fail")
                break

            await asyncio.sleep(1)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
