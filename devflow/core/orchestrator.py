from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

logger = logging.getLogger("devflow.orchestrator")

from devflow.artifacts.store import ArtifactStore
from devflow.agents.base import AgentContext
from devflow.core.pipeline_definition import STAGE_REGISTRY, StageDefinition, stages_from
from devflow.core.state_machine import RunState, StageState
from devflow.db.engine import AsyncSessionLocal
from devflow.db.models import Artifact, Checkpoint, PipelineRun, StageResult
from devflow.providers.router import ProviderRouter, provider_router

if TYPE_CHECKING:
    from devflow.db.models import Pipeline


def _now() -> datetime:
    return datetime.now(timezone.utc)


class PipelineOrchestrator:
    """Drives the stage execution loop for a single pipeline run."""

    def __init__(self) -> None:
        # asyncio.Event per (run_id, checkpoint_number) — set when checkpoint resolved
        self._cp_events: dict[str, dict[int, asyncio.Event]] = {}
        # asyncio.Event per run_id — cleared=paused, set=running
        self._pause_events: dict[str, asyncio.Event] = {}
        # Stores the resolved checkpoint status after event is set
        self._cp_decisions: dict[str, dict[int, str]] = {}

    # ── Public control methods (called by API handlers) ───────────────────────

    def register_run(self, run_id: str) -> None:
        self._cp_events[run_id] = {}
        self._pause_events[run_id] = asyncio.Event()
        self._pause_events[run_id].set()  # not paused initially
        self._cp_decisions[run_id] = {}

    def pause(self, run_id: str) -> None:
        ev = self._pause_events.get(run_id)
        if ev:
            ev.clear()

    def resume(self, run_id: str) -> None:
        ev = self._pause_events.get(run_id)
        if ev:
            ev.set()

    def resolve_checkpoint(self, run_id: str, cp_number: int, decision: str) -> None:
        """Called by checkpoint service when approved or rejected."""
        self._cp_decisions.setdefault(run_id, {})[cp_number] = decision
        events = self._cp_events.get(run_id, {})
        ev = events.get(cp_number)
        if ev:
            ev.set()

    def _get_cp_event(self, run_id: str, cp_number: int) -> asyncio.Event:
        events = self._cp_events.setdefault(run_id, {})
        if cp_number not in events:
            events[cp_number] = asyncio.Event()
        return events[cp_number]

    def cleanup(self, run_id: str) -> None:
        self._cp_events.pop(run_id, None)
        self._pause_events.pop(run_id, None)
        self._cp_decisions.pop(run_id, None)

    # ── Main execution loop ────────────────────────────────────────────────────

    async def run_pipeline(self, run_id: str) -> None:
        t0 = _now()
        try:
            await self._run_pipeline_inner(run_id)
        except Exception as e:
            logger.exception("[RUN %s] ✗ unhandled crash: %s", run_id[:8], e)
            await self._set_run_status(run_id, RunState.FAILED, error=str(e))
            self.cleanup(run_id)
        else:
            total = (_now() - t0).total_seconds()
            logger.info("[RUN %s] ═══ pipeline finished in %.0fs ═══", run_id[:8], total)

    async def _run_pipeline_inner(self, run_id: str) -> None:
        from types import SimpleNamespace
        from devflow.db.models import Pipeline as PipelineModel

        # Load and immediately snapshot pipeline as a plain object so it stays
        # accessible after the DB session closes (avoids DetachedInstanceError).
        async with AsyncSessionLocal() as session:
            run: PipelineRun = await session.get(PipelineRun, run_id)
            if not run:
                logger.error("[RUN %s] run not found in DB", run_id[:8])
                return
            pipeline_orm = await session.get(PipelineModel, run.pipeline_id)
            if not pipeline_orm:
                logger.error("[RUN %s] pipeline not found in DB", run_id[:8])
                return
            # Snapshot all needed fields before session closes
            pipeline = SimpleNamespace(
                id=pipeline_orm.id,
                name=pipeline_orm.name,
                description=pipeline_orm.description,
                task_type=pipeline_orm.task_type,
                repo_path=pipeline_orm.repo_path,
                provider=pipeline_orm.provider,
                model=pipeline_orm.model,
            )

        logger.info(
            "[RUN %s] ══ START ══  pipeline=%s  provider=%s  model=%s\n"
            "           desc: %s",
            run_id[:8], pipeline.id[:8], pipeline.provider, pipeline.model or "default",
            (pipeline.description or "")[:120],
        )

        artifact_store = ArtifactStore(run_id)
        await self._set_run_status(run_id, RunState.RUNNING)

        # Determine start stage (support retry from mid-pipeline)
        start_key = await self._get_resume_stage(run_id)
        stage_list = stages_from(start_key)
        logger.info("[RUN %s] stages: %s", run_id[:8], " → ".join(s.key for s in stage_list))

        i = 0
        while i < len(stage_list):
            stage_def = stage_list[i]

            # ── Pause check ──────────────────────────────────────────────────
            pause_ev = self._pause_events.get(run_id)
            if pause_ev and not pause_ev.is_set():
                logger.info("[RUN %s] ⏸  paused — waiting for resume", run_id[:8])
                await pause_ev.wait()
                logger.info("[RUN %s] ▶  resumed", run_id[:8])

            # ── Check if terminated ──────────────────────────────────────────
            current_status = await self._get_run_status(run_id)
            if current_status == RunState.TERMINATED:
                logger.info("[RUN %s] ⏹  terminated", run_id[:8])
                return

            # ── Update current stage ─────────────────────────────────────────
            await self._update_run_stage(run_id, stage_def.key)

            # ── Load prior artifacts ─────────────────────────────────────────
            stage_artifact_map = {
                s: STAGE_REGISTRY[s_def.index - 1].output_artifacts
                for s in stage_def.reads_from_stages
                for s_def in [next((sd for sd in STAGE_REGISTRY if sd.key == s), None)]
                if s_def
            }
            # Simplified: load by known filenames
            prior = self._load_prior(artifact_store, stage_def.reads_from_stages)

            # ── Get attempt number ────────────────────────────────────────────
            attempt = await self._get_next_attempt(run_id, stage_def.key)

            # ── Create StageResult row ────────────────────────────────────────
            stage_result_id = await self._create_stage_result(
                run_id, stage_def, attempt, pipeline.provider, pipeline.model
            )
            await self._set_stage_status(stage_result_id, StageState.RUNNING)

            # ── Build context ─────────────────────────────────────────────────
            ctx = AgentContext(
                run_id=run_id,
                pipeline=pipeline,
                stage_key=stage_def.key,
                attempt=attempt,
                artifacts=prior,
                repo_path=pipeline.repo_path,
                provider_router=provider_router,
            )

            # ── Execute agent ─────────────────────────────────────────────────
            logger.info("[RUN %s] ▶ stage=%s  attempt=%d", run_id[:8], stage_def.key, attempt)
            start_time = _now()
            try:
                agent_class = stage_def.get_agent_class()
                agent = agent_class(stage_def)
                result = await agent.run(ctx)
            except Exception as e:
                duration = (_now() - start_time).total_seconds()
                logger.error("[RUN %s] ✗ stage=%s  error=%s", run_id[:8], stage_def.key, e)
                await self._fail_stage(stage_result_id, str(e), duration)
                await self._set_run_status(run_id, RunState.FAILED, error=str(e))
                self.cleanup(run_id)
                return

            duration = (_now() - start_time).total_seconds()

            if not result.success:
                logger.error("[RUN %s] ✗ stage=%s  agent_error=%s", run_id[:8], stage_def.key, result.error)
                await self._fail_stage(stage_result_id, result.error or "Agent failed", duration)
                await self._set_run_status(run_id, RunState.FAILED, error=result.error or "")
                self.cleanup(run_id)
                return

            # ── Save artifacts ────────────────────────────────────────────────
            saved_filenames = []
            for filename, content in result.artifacts.items():
                path = artifact_store.save(filename, content)
                await self._register_artifact(run_id, stage_def.key, filename, str(path), content)
                saved_filenames.append(filename)

            logger.info("[RUN %s] ✓ stage=%s  artifacts=%s  %.1fs",
                        run_id[:8], stage_def.key, saved_filenames, duration)
            await self._complete_stage(stage_result_id, saved_filenames, duration)

            # ── Auto-apply patch after code_generation ────────────────────────
            if stage_def.key == "code_generation":
                await self._auto_apply_patch(run_id, artifact_store, pipeline.repo_path)

            # ── Checkpoint check ──────────────────────────────────────────────
            if stage_def.checkpoint_after is not None:
                cp_number = stage_def.checkpoint_after
                cp_id, retry_key = await self._create_checkpoint(run_id, cp_number, stage_def)
                await self._set_run_status(run_id, RunState.WAITING_FOR_APPROVAL)
                logger.info("[RUN %s] ⏸  CHECKPOINT %d — waiting for human approval", run_id[:8], cp_number)

                # Wait for human decision
                cp_event = self._get_cp_event(run_id, cp_number)
                cp_event.clear()
                await cp_event.wait()

                decision = self._cp_decisions.get(run_id, {}).get(cp_number, "approved")
                logger.info("[RUN %s] ✋  CHECKPOINT %d decision: %s", run_id[:8], cp_number, decision.upper())

                if decision == "rejected":
                    # Fetch actual retry_stage from DB
                    retry_stage_key = await self._get_cp_retry_stage(cp_id, stage_def.checkpoint_default_retry)
                    logger.info("[RUN %s] ↩  retrying from stage=%s", run_id[:8], retry_stage_key)
                    # Mark subsequent stages as rejected
                    await self._reject_stages_from(run_id, retry_stage_key)
                    # Reset stage list from retry point
                    stage_list = stages_from(retry_stage_key)
                    i = 0
                    await self._set_run_status(run_id, RunState.RUNNING)
                    # Reset the checkpoint event for re-use
                    cp_event.clear()
                    continue
                else:
                    await self._set_run_status(run_id, RunState.RUNNING)
                    cp_event.clear()

            i += 1

        await self._set_run_status(run_id, RunState.COMPLETED)
        self.cleanup(run_id)

    # ── Private DB helpers ────────────────────────────────────────────────────

    async def _auto_apply_patch(self, run_id: str, store: ArtifactStore, repo_path: str) -> None:
        """Apply the code_diff.patch to the repo after code_generation succeeds."""
        from devflow.tools.patch_tools import apply_patch
        try:
            patch = store.load_parsed("code_diff.patch")
            if not patch or not isinstance(patch, str):
                return
            result = apply_patch(patch, repo_path)
            if result.get("success"):
                logger.info("[RUN %s] ✓ patch applied to repo", run_id[:8])
            else:
                # Already applied or conflicts — log but don't fail the pipeline
                logger.warning("[RUN %s] patch apply skipped: %s", run_id[:8], result.get("stderr", "")[:200])
        except Exception as e:
            logger.warning("[RUN %s] patch apply error (non-fatal): %s", run_id[:8], e)

    def _load_prior(self, store: ArtifactStore, stage_keys: list[str]) -> dict[str, dict]:
        from devflow.core.pipeline_definition import STAGE_BY_KEY
        result: dict[str, dict] = {}
        for key in stage_keys:
            stage_def = STAGE_BY_KEY.get(key)
            if not stage_def:
                continue
            result[key] = {}
            for filename in stage_def.output_artifacts:
                try:
                    result[key][filename] = store.load_parsed(filename)
                except FileNotFoundError:
                    pass
        return result

    async def _get_resume_stage(self, run_id: str) -> str:
        """Return the stage key to start/resume from."""
        from sqlalchemy import select
        from devflow.core.pipeline_definition import STAGE_REGISTRY as _SR
        async with AsyncSessionLocal() as session:
            stmt = (
                select(StageResult)
                .where(StageResult.run_id == run_id)
                .order_by(StageResult.stage_index.desc())
            )
            row = (await session.execute(stmt)).scalars().first()
            if row and row.status == StageState.SUCCEEDED:
                for s in _SR:
                    if s.index > row.stage_index:
                        return s.key
        return _SR[0].key

    async def _get_run_status(self, run_id: str) -> RunState:
        async with AsyncSessionLocal() as session:
            run = await session.get(PipelineRun, run_id)
            return RunState(run.status) if run else RunState.TERMINATED

    async def _set_run_status(self, run_id: str, status: RunState, error: str = "") -> None:
        async with AsyncSessionLocal() as session:
            run = await session.get(PipelineRun, run_id)
            if not run:
                return
            run.status = status.value
            if error:
                run.error_message = error
            if status == RunState.RUNNING and not run.started_at:
                run.started_at = _now()
            if status in (RunState.COMPLETED, RunState.FAILED, RunState.TERMINATED):
                run.completed_at = _now()
            await session.commit()

    async def _update_run_stage(self, run_id: str, stage_key: str) -> None:
        async with AsyncSessionLocal() as session:
            run = await session.get(PipelineRun, run_id)
            if run:
                run.current_stage = stage_key
                await session.commit()

    async def _get_next_attempt(self, run_id: str, stage_key: str) -> int:
        async with AsyncSessionLocal() as session:
            from sqlalchemy import func, select
            stmt = select(func.max(StageResult.attempt)).where(
                StageResult.run_id == run_id,
                StageResult.stage_key == stage_key,
            )
            result = (await session.execute(stmt)).scalar()
            return (result or 0) + 1

    async def _create_stage_result(
        self, run_id: str, stage_def: StageDefinition, attempt: int, provider: str, model: str
    ) -> str:
        async with AsyncSessionLocal() as session:
            sr = StageResult(
                id=str(uuid.uuid4()),
                run_id=run_id,
                stage_key=stage_def.key,
                stage_index=stage_def.index,
                status=StageState.PENDING.value,
                attempt=attempt,
                provider=provider,
                model=model,
                started_at=_now(),
            )
            session.add(sr)
            await session.commit()
            return sr.id

    async def _set_stage_status(self, stage_result_id: str, status: StageState) -> None:
        async with AsyncSessionLocal() as session:
            sr = await session.get(StageResult, stage_result_id)
            if sr:
                sr.status = status.value
                await session.commit()

    async def _fail_stage(self, stage_result_id: str, error: str, duration: float) -> None:
        async with AsyncSessionLocal() as session:
            sr = await session.get(StageResult, stage_result_id)
            if sr:
                sr.status = StageState.FAILED.value
                sr.error_message = error
                sr.completed_at = _now()
                sr.duration_seconds = duration
                await session.commit()

    async def _complete_stage(self, stage_result_id: str, filenames: list[str], duration: float) -> None:
        async with AsyncSessionLocal() as session:
            sr = await session.get(StageResult, stage_result_id)
            if sr:
                sr.status = StageState.SUCCEEDED.value
                sr.output_artifact_keys = json.dumps(filenames)
                sr.completed_at = _now()
                sr.duration_seconds = duration
                await session.commit()

    async def _register_artifact(
        self, run_id: str, stage_key: str, filename: str, file_path: str, content: str
    ) -> None:
        content_type = "application/json" if filename.endswith(".json") else (
            "text/x-patch" if filename.endswith(".patch") else "text/markdown"
        )
        async with AsyncSessionLocal() as session:
            art = Artifact(
                id=str(uuid.uuid4()),
                run_id=run_id,
                stage_key=stage_key,
                filename=filename,
                file_path=file_path,
                content_type=content_type,
                size_bytes=len(content.encode("utf-8")),
            )
            session.add(art)
            await session.commit()

    async def _create_checkpoint(
        self, run_id: str, cp_number: int, stage_def: StageDefinition
    ) -> tuple[str, str]:
        cp_labels = {1: "post_design_review", 2: "post_implementation_review"}
        async with AsyncSessionLocal() as session:
            cp = Checkpoint(
                id=str(uuid.uuid4()),
                run_id=run_id,
                checkpoint_number=cp_number,
                label=cp_labels.get(cp_number, f"checkpoint_{cp_number}"),
                required_stage_keys=json.dumps(stage_def.reads_from_stages + [stage_def.key]),
                retry_stage_key=stage_def.checkpoint_default_retry,
                status="waiting",
            )
            session.add(cp)
            await session.commit()
            return cp.id, cp.retry_stage_key

    async def _get_cp_retry_stage(self, cp_id: str, default: str) -> str:
        async with AsyncSessionLocal() as session:
            cp = await session.get(Checkpoint, cp_id)
            return cp.retry_stage_key if cp and cp.retry_stage_key else default

    async def _reject_stages_from(self, run_id: str, from_stage_key: str) -> None:
        from devflow.core.pipeline_definition import STAGE_BY_KEY, STAGE_REGISTRY
        start_index = STAGE_BY_KEY[from_stage_key].index
        keys_to_reject = {s.key for s in STAGE_REGISTRY if s.index >= start_index}

        async with AsyncSessionLocal() as session:
            from sqlalchemy import select, update
            await session.execute(
                update(StageResult)
                .where(StageResult.run_id == run_id, StageResult.stage_key.in_(keys_to_reject))
                .values(status=StageState.REJECTED.value)
            )
            await session.commit()


# Singleton used across the app
orchestrator = PipelineOrchestrator()
