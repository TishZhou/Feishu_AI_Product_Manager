from __future__ import annotations

import asyncio
import json
import logging
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

logger = logging.getLogger("devflow.orchestrator")

from devflow.artifacts.store import ArtifactStore
from devflow.agents.base import AgentContext
from devflow.core.pipeline_definition import STAGE_BY_KEY, STAGE_REGISTRY, StageDefinition, stages_from
from devflow.core.state_machine import RunState, StageState
from devflow.db.engine import AsyncSessionLocal
from devflow.db.models import Artifact, Checkpoint, PipelineRun, StageResult
from devflow.providers.router import ProviderRouter, provider_router

if TYPE_CHECKING:
    from devflow.db.models import Pipeline

_MAX_TEST_REPAIR_ATTEMPTS = 2
_MAX_REVIEW_REPAIR_ATTEMPTS = 2
_HUMAN_TEST_RETRY_BUDGET = 2  # extra auto-attempts granted per human intervention
_TEST_INTERVENTION_CP_BASE = 1000  # checkpoint_number base for test-failure interventions


def _now() -> datetime:
    return datetime.now(timezone.utc)


class PipelineOrchestrator:
    """Drives the stage execution loop for a single pipeline run."""

    def __init__(self) -> None:
        # asyncio.Event per (run_id, checkpoint_number) — set when checkpoint resolved
        self._cp_events: dict[str, dict[int, asyncio.Event]] = {}
        # asyncio.Event per run_id — cleared=paused, set=running
        self._pause_events: dict[str, asyncio.Event] = {}
        self._clarification_events: dict[str, asyncio.Event] = {}
        self._clarification_answers: dict[str, str] = {}
        self._clarification_completed: set[str] = set()
        # Stores the resolved checkpoint status after event is set
        self._cp_decisions: dict[str, dict[int, str]] = {}
        # Provider overrides requested at checkpoint time {run_id: {provider, model}}
        self._provider_overrides: dict[str, dict[str, str]] = {}
        # Counts how many human interventions on test failures have been raised per run
        self._test_intervention_counter: dict[str, int] = {}

    # ── Public control methods (called by API handlers) ───────────────────────

    def register_run(self, run_id: str) -> None:
        self._cp_events[run_id] = {}
        self._pause_events[run_id] = asyncio.Event()
        self._pause_events[run_id].set()  # not paused initially
        self._clarification_events[run_id] = asyncio.Event()
        self._clarification_completed.discard(run_id)
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

    def set_provider_override(self, run_id: str, provider: str, model: str) -> None:
        """Schedule a provider/model switch to take effect after the next checkpoint."""
        if provider or model:
            self._provider_overrides[run_id] = {"provider": provider, "model": model}

    def _pop_provider_override(self, run_id: str) -> dict[str, str] | None:
        return self._provider_overrides.pop(run_id, None)

    def resolve_clarification(self, run_id: str, answers: str) -> None:
        self._clarification_answers[run_id] = answers
        ev = self._clarification_events.get(run_id)
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
        self._clarification_events.pop(run_id, None)
        self._clarification_answers.pop(run_id, None)
        self._clarification_completed.discard(run_id)
        self._cp_decisions.pop(run_id, None)
        self._provider_overrides.pop(run_id, None)
        self._test_intervention_counter.pop(run_id, None)

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
                source_repo_path=pipeline_orm.repo_path,
                provider=pipeline_orm.provider,
                model=pipeline_orm.model,
                reference_context=pipeline_orm.reference_context,
                reference_sources=pipeline_orm.reference_sources,
                clarification_answers="",
                test_failure_context="",
                review_blocker_context="",
                previous_review_report="",
                preserved_test_files=[],
                extra_test_attempts=0,
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
        if STAGE_BY_KEY[start_key].index > STAGE_BY_KEY["code_generation"].index:
            workspace_path = self._load_valid_execution_workspace(artifact_store)
            if workspace_path:
                pipeline.repo_path = workspace_path
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
            if stage_def.key == "test_generation":
                workspace_path = self._load_valid_execution_workspace(artifact_store)
                if not workspace_path:
                    error = "Test generation requires a valid isolated execution workspace from code_generation."
                    await self._fail_stage(stage_result_id, error, 0.0)
                    await self._set_run_status(run_id, RunState.FAILED, error=error)
                    self.cleanup(run_id)
                    return
                pipeline.repo_path = workspace_path

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

            if stage_def.key == "test_generation":
                test_report = self._load_optional_artifact(artifact_store, "test_report.json")
                if not self._tests_passed(test_report):
                    failure_context = self._build_test_failure_context(test_report)
                    auto_limit = _MAX_TEST_REPAIR_ATTEMPTS + getattr(pipeline, "extra_test_attempts", 0)
                    if attempt < auto_limit:
                        retry_key = self._choose_test_retry_stage(test_report)
                        pipeline.test_failure_context = failure_context
                        if retry_key == "code_generation":
                            pipeline.preserved_test_files = self._collect_preserved_test_files(
                                pipeline.repo_path, test_report
                            )
                            self._capture_previous_review(artifact_store, pipeline)
                        else:
                            pipeline.preserved_test_files = []
                        logger.info(
                            "[RUN %s] ✗ tests failed at attempt=%d/%d — retrying from %s (preserved_tests=%d)",
                            run_id[:8], attempt, auto_limit, retry_key, len(pipeline.preserved_test_files),
                        )
                        await self._fail_stage(stage_result_id, failure_context, duration)
                        await self._reject_stages_from(run_id, retry_key)
                        stage_list = stages_from(retry_key)
                        i = 0
                        await self._set_run_status(run_id, RunState.RUNNING)
                        if retry_key == "code_generation":
                            pipeline.repo_path = pipeline.source_repo_path
                        continue

                    # Auto-retry budget exhausted — request human intervention.
                    decision, guidance, retry_stage = await self._await_test_intervention(
                        run_id, attempt, failure_context, test_report, pipeline
                    )
                    if decision == "approved":
                        # SKIP: accept current (failing) tests, mark stage succeeded, move on.
                        logger.info(
                            "[RUN %s] ⏭  user SKIPPED failing tests at attempt=%d", run_id[:8], attempt,
                        )
                        await self._complete_stage(stage_result_id, saved_filenames, duration)
                        i += 1
                        continue

                    # REJECT with guidance: append guidance to context and grant a fresh budget.
                    pipeline.test_failure_context = (
                        failure_context
                        + (f"\n\nHuman guidance:\n{guidance}" if guidance.strip() else "")
                    )
                    pipeline.extra_test_attempts = (
                        getattr(pipeline, "extra_test_attempts", 0) + _HUMAN_TEST_RETRY_BUDGET
                    )
                    if retry_stage == "code_generation":
                        pipeline.preserved_test_files = self._collect_preserved_test_files(
                            pipeline.repo_path, test_report
                        )
                        self._capture_previous_review(artifact_store, pipeline)
                        pipeline.repo_path = pipeline.source_repo_path
                    else:
                        pipeline.preserved_test_files = []
                    logger.info(
                        "[RUN %s] ↺  human-guided retry from %s — extra_attempts=+%d",
                        run_id[:8], retry_stage, _HUMAN_TEST_RETRY_BUDGET,
                    )
                    await self._fail_stage(stage_result_id, failure_context, duration)
                    await self._reject_stages_from(run_id, retry_stage)
                    stage_list = stages_from(retry_stage)
                    i = 0
                    await self._set_run_status(run_id, RunState.RUNNING)
                    continue

            # ── Materialize generated files under artifacts only ──────────────
            if stage_def.key == "code_generation":
                workspace_path = await self._materialize_generated_files(run_id, artifact_store, pipeline.repo_path)
                if not workspace_path:
                    error = self._code_generation_workspace_error(artifact_store)
                    logger.error("[RUN %s] ✗ stage=%s  workspace_error=%s", run_id[:8], stage_def.key, error)
                    await self._fail_stage(stage_result_id, error, duration)
                    await self._set_run_status(run_id, RunState.FAILED, error=error)
                    self.cleanup(run_id)
                    return
                pipeline.repo_path = workspace_path

            await self._complete_stage(stage_result_id, saved_filenames, duration)

            if stage_def.key == "requirement_analysis" and self._can_request_clarification(run_id, result.artifacts):
                questions = self._build_clarification_payload(result.artifacts)
                path = artifact_store.save("requirement_clarification.json", json.dumps(questions, ensure_ascii=False, indent=2))
                await self._register_artifact(
                    run_id,
                    stage_def.key,
                    "requirement_clarification.json",
                    str(path),
                    json.dumps(questions, ensure_ascii=False, indent=2),
                )
                await self._set_run_status(run_id, RunState.WAITING_FOR_CLARIFICATION)
                logger.info("[RUN %s] ? requirement clarification needed", run_id[:8])

                ev = self._clarification_events.setdefault(run_id, asyncio.Event())
                ev.clear()
                await ev.wait()

                answer = self._clarification_answers.pop(run_id, "").strip()
                if answer:
                    self._clarification_completed.add(run_id)
                    pipeline.clarification_answers = (
                        f"{pipeline.clarification_answers}\n\n{answer}".strip()
                        if pipeline.clarification_answers else answer
                    )
                await self._reject_stages_from(run_id, "requirement_analysis")
                stage_list = stages_from("requirement_analysis")
                i = 0
                await self._set_run_status(run_id, RunState.RUNNING)
                ev.clear()
                continue

            # ── Review quality gate — auto-retry on BLOCKER findings ─────────
            if stage_def.key == "code_review":
                review_json = self._load_optional_artifact(artifact_store, "review_report.json")
                if self._has_review_blockers(review_json):
                    blocker_ctx = self._build_review_blocker_context(review_json)
                    if attempt <= _MAX_REVIEW_REPAIR_ATTEMPTS:
                        pipeline.review_blocker_context = blocker_ctx
                        self._capture_previous_review(artifact_store, pipeline)
                        pipeline.repo_path = pipeline.source_repo_path
                        logger.info(
                            "[RUN %s] ✗ review BLOCKER(s) at attempt=%d — auto-retrying from code_generation",
                            run_id[:8], attempt,
                        )
                        await self._fail_stage(stage_result_id, blocker_ctx, duration)
                        await self._reject_stages_from(run_id, "code_generation")
                        stage_list = stages_from("code_generation")
                        i = 0
                        await self._set_run_status(run_id, RunState.RUNNING)
                        continue
                    logger.warning(
                        "[RUN %s] review BLOCKER(s) remain after %d attempt(s) — proceeding to checkpoint",
                        run_id[:8], attempt,
                    )

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

                # Apply any provider/model override requested at approval/rejection time
                override = self._pop_provider_override(run_id)
                if override:
                    new_provider = override.get("provider", "").strip()
                    new_model = override.get("model", "").strip()
                    if new_provider:
                        pipeline.provider = new_provider
                        logger.info("[RUN %s] ⚙  provider switched → %s", run_id[:8], new_provider)
                    if new_model:
                        pipeline.model = new_model
                        logger.info("[RUN %s] ⚙  model switched → %s", run_id[:8], new_model)

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
                    if stage_def.key == "delivery":
                        await self._apply_to_source_delivery(run_id, artifact_store, pipeline)
                    await self._set_run_status(run_id, RunState.RUNNING)
                    cp_event.clear()

            i += 1

        await self._set_run_status(run_id, RunState.COMPLETED)
        self.cleanup(run_id)

    # ── Private DB helpers ────────────────────────────────────────────────────

    async def _materialize_generated_files(self, run_id: str, store: ArtifactStore, repo_path: str) -> str:
        """Write generated full-file snapshots to artifacts without touching the repo."""
        from devflow.artifacts.patch_materializer import materialize_patch_files
        from devflow.tools.patch_tools import apply_patch
        from devflow.tools.workspace import create_workspace
        try:
            patch = store.load_parsed("code_diff.patch")
            if not patch or not isinstance(patch, str):
                return ""
            manifest = materialize_patch_files(patch, repo_path, store.base_dir)
            workspace = store.base_dir / f"execution_workspace_{uuid.uuid4().hex[:8]}"
            create_workspace(Path(repo_path), workspace)
            apply_result = apply_patch(patch, str(workspace))
            manifest["execution_workspace"] = str(workspace)
            manifest["patch_applied_to_workspace"] = bool(apply_result.get("success"))
            manifest["workspace_apply_error"] = apply_result.get("stderr") or apply_result.get("error", "")
            store.artifact_path("generated_files_manifest.json").write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            manifest_text = json.dumps(manifest, ensure_ascii=False, indent=2)
            await self._register_artifact(
                run_id,
                "code_generation",
                "generated_files_manifest.json",
                str(store.artifact_path("generated_files_manifest.json")),
                manifest_text,
            )
            logger.info("[RUN %s] ✓ generated file snapshots saved to artifacts (%d files)",
                        run_id[:8], len(manifest.get("files", [])))
            return str(workspace) if apply_result.get("success") else ""
        except Exception as e:
            logger.warning("[RUN %s] generated file materialization error (non-fatal): %s", run_id[:8], e)
            return ""

    def _load_valid_execution_workspace(self, store: ArtifactStore) -> str:
        try:
            manifest = store.load_parsed("generated_files_manifest.json")
        except FileNotFoundError:
            return ""
        if not isinstance(manifest, dict):
            return ""
        workspace = manifest.get("execution_workspace", "")
        if not manifest.get("patch_applied_to_workspace") or not workspace:
            return ""
        if not Path(str(workspace)).exists():
            return ""
        return str(workspace)

    def _code_generation_workspace_error(self, store: ArtifactStore) -> str:
        default = "Generated patch could not be applied to the isolated execution workspace."
        try:
            manifest = store.load_parsed("generated_files_manifest.json")
        except FileNotFoundError:
            return default
        if not isinstance(manifest, dict):
            return default
        detail = manifest.get("workspace_apply_error") or manifest.get("error") or ""
        if detail:
            return f"{default} {detail}".strip()
        return default

    async def _apply_to_source_delivery(self, run_id: str, store: ArtifactStore, pipeline: object) -> None:
        """Apply the final patch directly to the user's source repo with a backup.

        Replaces the previous git-branch-based delivery. The user can revert via
        ``POST /api/runs/{run_id}/rollback`` — orchestrator stores per-file
        snapshots under ``artifacts/<run_id>/source_backup/``.
        """
        from devflow.services.source_apply import apply_to_source

        result: dict[str, object]
        try:
            test_report = store.load_parsed("test_report.json")
            if not self._tests_passed(test_report):
                result = {
                    "status": "skipped",
                    "run_id": run_id,
                    "error": "Test report is missing or not fully passing; source apply was skipped.",
                }
            else:
                patch = self._load_optional_artifact(store, "final_diff.patch")
                if not isinstance(patch, str) or not patch.strip():
                    patch = self._load_optional_artifact(store, "code_diff.patch")
                source_repo = str(getattr(pipeline, "source_repo_path", getattr(pipeline, "repo_path", "")))
                result = apply_to_source(
                    source_repo=source_repo,
                    patch_text=patch if isinstance(patch, str) else "",
                    run_id=run_id,
                    artifacts_dir=store.base_dir,
                )
        except Exception as exc:
            logger.exception("[RUN %s] source apply failed: %s", run_id[:8], exc)
            result = {"status": "failed", "run_id": run_id, "error": str(exc)}

        content = json.dumps(result, ensure_ascii=False, indent=2)
        path = store.save("source_application.json", content)
        await self._register_artifact(run_id, "delivery", "source_application.json", str(path), content)

    def _load_optional_artifact(self, store: ArtifactStore, filename: str) -> object:
        try:
            return store.load_parsed(filename)
        except FileNotFoundError:
            return ""

    def _tests_passed(self, report: object) -> bool:
        if not isinstance(report, dict):
            return False
        try:
            failed = int(report.get("failed", 0) or 0)
            exit_code = int(report.get("exit_code", 1) if report.get("exit_code") is not None else 1)
        except (TypeError, ValueError):
            return False
        return failed == 0 and exit_code == 0

    def _choose_test_retry_stage(self, report: object) -> str:
        # If at least one test passed, the test files are runnable → any failure
        # is a code bug, retry from code_generation. Only fall back to
        # test_generation when nothing ran AND the signal looks like a
        # collection/import error (i.e. the tests themselves are broken).
        if self._test_report_has_runnable_failure(report):
            return "code_generation"
        return "test_generation" if self._test_report_has_collection_failure(report) else "code_generation"

    def _build_test_failure_context(self, report: object) -> str:
        if not isinstance(report, dict):
            return "Test report is missing or invalid."

        retry_stage = self._choose_test_retry_stage(report)
        summary = str(report.get("summary") or "").strip()
        test_command = str(report.get("test_command") or "").strip()
        test_paths = self._extract_report_test_paths(report)
        failing_cases = self._extract_failing_test_cases(report)
        evidence = self._extract_runner_evidence(report)
        generated_sources = self._extract_generated_test_sources(report)

        if retry_stage == "test_generation":
            repair_instruction = (
                "Fix the generated tests first. The failure looks like a collection/import/syntax "
                "problem, so inspect the existing generated test file, repair only the broken test code, "
                "and preserve any passing tests."
            )
        else:
            repair_instruction = (
                "Fix production code; do not weaken, delete, or rewrite the generated tests. "
                "Treat the tests below as the executable specification that exposed the defect."
            )

        sections = [
            "Previous generated tests failed.",
            f"Recommended retry target: {retry_stage}",
            f"Repair instruction: {repair_instruction}",
        ]
        if test_command:
            sections.append(f"Failing command:\n{test_command}")
        if test_paths:
            sections.append("Generated test file(s):\n" + "\n".join(f"- {path}" for path in test_paths))
        if summary:
            sections.append(f"Runner summary:\n{summary}")
        if failing_cases:
            rows = []
            for case in failing_cases[:8]:
                label = str(case.get("name") or case.get("id") or "unnamed test").strip()
                message = str(case.get("message") or "").strip()
                rows.append(f"- {label}" + (f": {message}" if message else ""))
            sections.append("Failing test cases:\n" + "\n".join(rows))
        if evidence:
            sections.append("Key runner evidence:\n" + "\n\n".join(evidence))
        if generated_sources:
            sections.append("Generated test source (read-only evidence, preserved for rerun):\n" + "\n\n".join(generated_sources))

        return "\n\n".join(sections)[:12_000]

    def _test_report_has_runnable_failure(self, report: object) -> bool:
        if not isinstance(report, dict):
            return False
        if self._as_int(report.get("passed")) > 0:
            return True

        # TC-RUNNER is a synthetic "the runner itself failed" placeholder we
        # insert when pytest crashed before any real case ran. Treat it as a
        # runner-level signal (collection error / SyntaxError / etc.), not as
        # evidence of a real assertion failure caused by the code.
        return bool(self._extract_failing_test_cases(report))

    def _test_report_has_collection_failure(self, report: object) -> bool:
        text = self._raw_test_failure_text(report).lower()
        return any(
            marker in text
            for marker in (
                "error collecting",
                "modulenotfounderror",
                "importerror",
                "syntaxerror",
                "during collection",
            )
        )

    def _raw_test_failure_text(self, report: object) -> str:
        if not isinstance(report, dict):
            return ""
        summary = str(report.get("summary") or "").strip()
        error_log = str(report.get("error_log") or "").strip()
        chunks = [summary, error_log]
        runner = report.get("runner_validation", {})
        runs = runner.get("runs", []) if isinstance(runner, dict) else []
        if isinstance(runs, list):
            for run in runs:
                if not isinstance(run, dict):
                    continue
                for key in ("error", "stderr", "stdout", "summary"):
                    value = str(run.get(key) or "").strip()
                    if value:
                        chunks.append(value)
        return "\n\n".join(part for part in chunks if part)

    def _extract_failing_test_cases(self, report: dict) -> list[dict]:
        test_cases = report.get("test_cases")
        if not isinstance(test_cases, list):
            return []
        return [
            tc for tc in test_cases
            if isinstance(tc, dict)
            and str(tc.get("status", "")).lower() == "failed"
            and str(tc.get("id", "")).upper() != "TC-RUNNER"
        ]

    def _extract_report_test_paths(self, report: dict) -> list[str]:
        paths: list[str] = []

        def add(value: object) -> None:
            if isinstance(value, str) and value.strip():
                paths.append(value.strip())

        add(report.get("test_file"))
        test_files = report.get("test_files")
        if isinstance(test_files, list):
            for path in test_files:
                add(path)
        generated = report.get("generated_test_files")
        if isinstance(generated, list):
            for item in generated:
                if isinstance(item, dict):
                    add(item.get("path"))
        deduped = []
        seen = set()
        for path in paths:
            if path in seen:
                continue
            seen.add(path)
            deduped.append(path)
        return deduped

    def _extract_runner_evidence(self, report: dict) -> list[str]:
        evidence: list[str] = []
        error_log = str(report.get("error_log") or "").strip()
        if error_log:
            evidence.append(error_log[-3000:])
        runner = report.get("runner_validation", {})
        runs = runner.get("runs", []) if isinstance(runner, dict) else []
        if isinstance(runs, list):
            for run in runs[-2:]:
                if not isinstance(run, dict):
                    continue
                label = str(run.get("test_path") or run.get("command") or "runner").strip()
                text = str(run.get("error") or run.get("stderr") or run.get("stdout") or "").strip()
                if text:
                    evidence.append(f"[{label}]\n{text[-3000:]}")
        deduped = []
        seen = set()
        for item in evidence:
            if item in seen:
                continue
            seen.add(item)
            deduped.append(item)
        return deduped[:4]

    def _extract_generated_test_sources(self, report: dict) -> list[str]:
        generated = report.get("generated_test_files")
        if not isinstance(generated, list):
            return []
        sources = []
        for item in generated[:3]:
            if not isinstance(item, dict):
                continue
            path = str(item.get("path") or "generated test").strip()
            content = str(item.get("content") or "").strip()
            if not content:
                continue
            truncated = " [truncated]" if item.get("truncated") else ""
            sources.append(f"--- {path}{truncated} ---\n{content[:2500]}")
        return sources

    def _as_int(self, value: object) -> int:
        try:
            return int(value or 0)
        except (TypeError, ValueError):
            return 0

    def _collect_preserved_test_files(self, prev_workspace: str, test_report: object) -> list[dict]:
        """Read the just-generated test files from the previous workspace so a
        subsequent code_generation retry can reuse them without invoking the LLM.

        Skip preservation when the prior tests didn't actually run — preserving
        a SyntaxError/collection-error file would just cycle the same broken
        test through every retry. We require at least one test case to have
        executed (passed, failed assertion, or skipped) before considering the
        file safe to reuse.
        """
        if not isinstance(test_report, dict) or not prev_workspace:
            return []

        # If pytest crashed before collecting/running any case, the test file
        # itself is broken — let test_generation regenerate it next time.
        try:
            executed = (
                int(test_report.get("passed", 0) or 0)
                + int(test_report.get("skipped", 0) or 0)
            )
            real_failures = [
                tc for tc in (test_report.get("test_cases") or [])
                if isinstance(tc, dict)
                and str(tc.get("status", "")).lower() == "failed"
                and str(tc.get("id", "")).upper() != "TC-RUNNER"
            ]
            executed += len(real_failures)
            exit_code = int(test_report.get("exit_code", 1) if test_report.get("exit_code") is not None else 1)
        except (TypeError, ValueError):
            executed, exit_code = 0, 1
        # exit_code 2 is pytest's "interrupted during collection" / SyntaxError.
        if executed == 0 or exit_code in {-1, 2, 3, 4}:
            return []

        candidates: list[str] = []
        files_field = test_report.get("test_files")
        if isinstance(files_field, list):
            candidates.extend(str(p) for p in files_field if isinstance(p, str) and p.strip())
        single = test_report.get("test_file")
        if isinstance(single, str) and single.strip() and single not in candidates:
            candidates.append(single)
        if not candidates:
            return []
        root = Path(prev_workspace).resolve()
        if not root.exists():
            return []
        out: list[dict] = []
        seen: set[str] = set()
        for rel in candidates:
            rel = rel.strip()
            if rel in seen:
                continue
            seen.add(rel)
            target = (root / rel).resolve()
            try:
                target.relative_to(root)
            except ValueError:
                continue
            if not target.exists() or not target.is_file():
                continue
            try:
                content = target.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            out.append({"path": rel, "content": content})
        return out

    def _capture_previous_review(self, store: ArtifactStore, pipeline: object) -> None:
        """Snapshot the current review_report.json into pipeline state so the
        next code_review attempt can read what was previously flagged."""
        prior = self._load_optional_artifact(store, "review_report.json")
        if isinstance(prior, dict) and prior:
            try:
                pipeline.previous_review_report = json.dumps(
                    prior, ensure_ascii=False, indent=2
                )
            except (TypeError, ValueError):
                pipeline.previous_review_report = ""

    async def _await_test_intervention(
        self,
        run_id: str,
        attempt: int,
        failure_context: str,
        test_report: object,
        pipeline: object | None = None,
    ) -> tuple[str, str, str]:
        """Block the run until a human resolves persistent test failures.

        Returns a tuple ``(decision, guidance, retry_stage)`` where:
            decision      ∈ {"approved", "rejected"}  (approved = skip past failing tests)
            guidance      free-form reason supplied via the reject endpoint (may be empty)
            retry_stage   stage key to retry from when decision == "rejected"
        """
        self._test_intervention_counter[run_id] = (
            self._test_intervention_counter.get(run_id, 0) + 1
        )
        cp_number = _TEST_INTERVENTION_CP_BASE + self._test_intervention_counter[run_id]
        default_retry = self._choose_test_retry_stage(test_report) or "code_generation"

        async with AsyncSessionLocal() as session:
            cp = Checkpoint(
                id=str(uuid.uuid4()),
                run_id=run_id,
                checkpoint_number=cp_number,
                label="test_failure_intervention",
                required_stage_keys=json.dumps(["test_generation"]),
                retry_stage_key=default_retry,
                status="waiting",
                decision_reason=failure_context[:4000],
            )
            session.add(cp)
            await session.commit()
            cp_id = cp.id

        await self._set_run_status(run_id, RunState.WAITING_FOR_APPROVAL)
        logger.info(
            "[RUN %s] ⏸  TEST INTERVENTION cp=%d (attempt=%d) — awaiting human input",
            run_id[:8], cp_number, attempt,
        )

        cp_event = self._get_cp_event(run_id, cp_number)
        cp_event.clear()
        await cp_event.wait()
        decision = self._cp_decisions.get(run_id, {}).get(cp_number, "approved")
        cp_event.clear()

        # Apply any provider/model override the user attached to this decision.
        override = self._pop_provider_override(run_id)
        if override and pipeline is not None:
            new_provider = override.get("provider", "").strip()
            new_model = override.get("model", "").strip()
            if new_provider:
                pipeline.provider = new_provider
                logger.info("[RUN %s] ⚙  provider switched → %s", run_id[:8], new_provider)
            if new_model:
                pipeline.model = new_model
                logger.info("[RUN %s] ⚙  model switched → %s", run_id[:8], new_model)

        async with AsyncSessionLocal() as session:
            cp_row = await session.get(Checkpoint, cp_id)
            guidance = (cp_row.decision_reason or "") if cp_row else ""
            retry_stage = (cp_row.retry_stage_key if cp_row else "") or default_retry

        await self._set_run_status(run_id, RunState.RUNNING)
        return decision, guidance, retry_stage

    def _has_review_blockers(self, review_json: object) -> bool:
        if not isinstance(review_json, dict):
            return False
        if int(review_json.get("blocker_count", 0) or 0) > 0:
            return True
        verdict = str(review_json.get("verdict", "") or "")
        return verdict == "changes_required"

    def _build_review_blocker_context(self, review_json: object) -> str:
        if not isinstance(review_json, dict):
            return "Code review returned BLOCKER findings."
        findings = review_json.get("findings", [])
        blockers = [
            f for f in (findings if isinstance(findings, list) else [])
            if isinstance(f, dict) and str(f.get("severity", "")).upper() == "BLOCKER"
        ]
        if not blockers:
            return f"Review verdict: {review_json.get('verdict', 'changes_required')}."
        lines = [f"- [{f.get('file', '?')}:{f.get('line', '?')}] {f.get('description', '')} → {f.get('fix_suggestion', '')}"
                 for f in blockers]
        return "BLOCKER findings:\n" + "\n".join(lines)

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

    def _needs_requirement_clarification(self, artifacts: dict[str, str]) -> bool:
        try:
            spec = json.loads(artifacts.get("requirement_spec.json", "{}"))
        except json.JSONDecodeError:
            return False
        if not isinstance(spec, dict):
            return False

        if spec.get("open_questions"):
            return True
        quality_check = spec.get("quality_check") or {}
        if isinstance(quality_check, dict):
            if quality_check.get("missing_critical_info") or quality_check.get("ambiguities"):
                return True
            if quality_check.get("ready_for_stage2_architecture") is False:
                return True
        try:
            return float(spec.get("confidence_score", 1)) < 0.7
        except (TypeError, ValueError):
            return False

    def _can_request_clarification(self, run_id: str, artifacts: dict[str, str]) -> bool:
        return run_id not in self._clarification_completed and self._needs_requirement_clarification(artifacts)

    def _build_clarification_payload(self, artifacts: dict[str, str]) -> dict:
        try:
            spec = json.loads(artifacts.get("requirement_spec.json", "{}"))
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
            from sqlalchemy import delete
            await session.execute(
                delete(Artifact).where(
                    Artifact.run_id == run_id,
                    Artifact.stage_key == stage_key,
                    Artifact.filename == filename,
                )
            )
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
        cp_labels = {1: "post_design_review", 2: "post_implementation_review", 3: "pre_git_delivery"}
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
