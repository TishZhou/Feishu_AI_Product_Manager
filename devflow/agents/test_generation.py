import json
from pathlib import Path
from typing import Any

from devflow.agents.base import AgentContext, AgentResult, BaseAgent
from devflow.agents.prompts import test_generation as prompts
from devflow.services.test_progress import get_test_progress_recorder
from devflow.tools.command_runner import COMMAND_TOOL_SCHEMAS, run_command
from devflow.tools.repo_tools import REPO_TOOL_SCHEMAS
from devflow.tools.test_runner import TEST_TOOL_SCHEMAS, run_test
from devflow.tools.test_selector import find_focused_tests, parse_changed_files


_DEFAULT_TEST_PATH = "tests/test_generated.py"
_MAX_EMBEDDED_TEST_BYTES = 50_000


class TestGenerationAgent(BaseAgent):
    required_inputs = [
        ("solution_architecture", "solution_contract.json"),
        ("detailed_spec", "detailed_spec.json"),
        ("code_generation", "implementation_summary.md"),
        ("code_generation", "generated_files_manifest.json"),
    ]
    output_artifacts = ["test_report.json"]

    def json_mode(self) -> bool:
        return True

    def max_tokens(self) -> int | None:
        return None

    async def run(self, ctx: AgentContext) -> AgentResult:
        manifest = self._get_artifact(ctx, "code_generation", "generated_files_manifest.json", {})
        if isinstance(manifest, str):
            try:
                manifest = json.loads(manifest)
            except json.JSONDecodeError:
                manifest = {}
        workspace = str(manifest.get("execution_workspace", "")) if isinstance(manifest, dict) else ""
        if not workspace or not manifest.get("patch_applied_to_workspace"):
            return self._fail(ctx, "Test generation requires a successfully patched execution workspace.")
        if Path(ctx.repo_path).resolve() != Path(workspace).resolve():
            return self._fail(ctx, "Test generation refused to write outside the isolated execution workspace.")

        preserved = list(getattr(ctx.pipeline, "preserved_test_files", []) or [])
        if preserved:
            ctx.pipeline.preserved_test_files = []
            return self._reuse_preserved_tests(ctx, preserved)

        # Pure-frontend changes can't be tested with pytest. Forcing the LLM
        # to produce pytest tests for React/Vue components yields garbage
        # JS-in-py files that crash on collection. Detect that case and run a
        # type-check / build instead — that's the equivalent "did this break
        # anything?" gate for a TS/JSX project.
        patch = self._get_artifact(ctx, "code_generation", "code_diff.patch", "")
        if isinstance(patch, str):
            scope = _classify_change_scope(patch)
            if scope == "frontend_only":
                return self._run_frontend_validation(ctx, patch)

        return await super().run(ctx)

    def _run_frontend_validation(self, ctx: AgentContext, patch: str) -> AgentResult:
        """Validate frontend-only changes with `tsc --noEmit` instead of pytest.

        Falls back to ``npm run build`` if no TypeScript config is present.
        Produces a normal-shaped ``test_report.json`` so the rest of the
        pipeline (review gate, delivery checkpoint) consumes it transparently.
        """
        repo_root = Path(ctx.repo_path).resolve()
        frontend_root = _find_frontend_root(repo_root, patch)
        if not frontend_root:
            return self._fail(
                ctx,
                "Frontend-only change but no frontend root (package.json) found in workspace.",
            )

        # node_modules is gitignored so create_workspace excludes it; symlink
        # the source repo's node_modules into the workspace so npm/tsc can run
        # without paying for a fresh `npm install`.
        source_repo = str(getattr(ctx.pipeline, "source_repo_path", "") or "")
        if source_repo:
            _ensure_frontend_node_modules(repo_root, frontend_root, Path(source_repo))

        commands_to_try, has_tsconfig = _frontend_validation_commands(frontend_root)
        runs: list[dict[str, Any]] = []
        succeeded = False
        for cmd in commands_to_try:
            result = run_command(cmd, str(frontend_root), timeout_seconds=180)
            runs.append(result)
            if result.get("success"):
                succeeded = True
                break

        # Build a synthetic test_report.json. The `test_files` field stays
        # empty because no actual test files are produced; the runner_validation
        # block carries the build/typecheck output for downstream consumers.
        rel_frontend = str(frontend_root.relative_to(repo_root)) or "."
        last_run = runs[-1] if runs else {"summary": "no commands attempted"}
        report: dict[str, Any] = {
            "test_file": "",
            "test_files": [],
            "test_command": last_run.get("command", "tsc --noEmit"),
            "validation_commands": [r.get("command", "") for r in runs if r.get("command")],
            "total": 1,
            "passed": 1 if succeeded else 0,
            "failed": 0 if succeeded else 1,
            "skipped": 0,
            "exit_code": 0 if succeeded else int(last_run.get("exit_code") or 1),
            "test_cases": [{
                "id": "TC-FRONTEND",
                "name": f"frontend type-check ({rel_frontend})",
                "status": "passed" if succeeded else "failed",
                "message": last_run.get("summary") or last_run.get("error") or "",
            }],
            "summary": (
                f"Frontend validation {'passed' if succeeded else 'failed'} "
                f"via {last_run.get('command', '')} in {rel_frontend}"
            ),
            "error_log": "" if succeeded else (last_run.get("stderr") or last_run.get("stdout") or last_run.get("error") or ""),
            "frontend_validation": {
                "frontend_root": rel_frontend,
                "has_tsconfig": has_tsconfig,
                "succeeded": succeeded,
            },
            "runner_validation": {"validated": True, "runs": runs, "commands": []},
            "generated_test_files": [],
        }
        response = json.dumps(report, ensure_ascii=False, indent=2)
        return self._ok(ctx, {"test_report.json": response}, response)

    def _reuse_preserved_tests(self, ctx: AgentContext, preserved: list[dict]) -> AgentResult:
        repo_root = Path(ctx.repo_path).resolve()
        restored_paths: list[str] = []
        for item in preserved:
            if not isinstance(item, dict):
                continue
            rel = str(item.get("path", "")).strip()
            content = item.get("content", "")
            if not rel or not isinstance(content, str):
                continue
            target = (repo_root / rel).resolve()
            try:
                target.relative_to(repo_root)
            except ValueError:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
            restored_paths.append(rel)

        if not restored_paths:
            return self._fail(ctx, "No preserved test files could be restored into the new workspace.")

        report: dict[str, Any] = {
            "test_file": restored_paths[0],
            "test_files": restored_paths,
            "test_command": f"pytest {' '.join(restored_paths)} -v",
            "test_cases": [],
            "summary": "Re-running preserved test files after code regeneration (LLM skipped).",
            "reused_preserved_tests": True,
        }
        report = _validate_and_enrich_report(report, ctx.repo_path, "", ctx.run_id)
        response = json.dumps(report, ensure_ascii=False, indent=2)
        return self._ok(ctx, {"test_report.json": response}, response)

    def build_system_prompt(self, ctx: AgentContext) -> str:
        return prompts.SYSTEM

    def build_user_prompt(self, ctx: AgentContext) -> str:
        spec = self._get_artifact(ctx, "detailed_spec", "detailed_spec.json", "{}")
        if isinstance(spec, dict):
            spec = json.dumps(spec, indent=2, ensure_ascii=False)

        summary = self._get_artifact(ctx, "code_generation", "implementation_summary.md", "")
        solution_contract = self._get_artifact(ctx, "solution_architecture", "solution_contract.json", "{}")
        if isinstance(solution_contract, dict):
            solution_contract = json.dumps(solution_contract, indent=2, ensure_ascii=False)

        patch = self._get_artifact(ctx, "code_generation", "code_diff.patch", "")
        focused_hint = _format_focused_tests_hint(
            find_focused_tests(parse_changed_files(patch if isinstance(patch, str) else ""), ctx.repo_path)
        )

        return (
            prompts.USER_TMPL.format(
                detailed_spec=spec,
                solution_contract=solution_contract,
                implementation_summary=summary,
                repo_path=ctx.repo_path,
            )
            + focused_hint
            + _format_test_failure_context(ctx)
        )

    def get_tools(self) -> list[dict]:
        # Read existing code/tests, write generated tests in the isolated workspace, then execute them.
        return [REPO_TOOL_SCHEMAS[i] for i in (0, 1, 2, 3, 4)] + TEST_TOOL_SCHEMAS + COMMAND_TOOL_SCHEMAS

    def parse_response(self, response: str, ctx: AgentContext) -> AgentResult:
        raw_response = response.strip()
        response = raw_response
        if response.startswith("```"):
            lines = response.splitlines()
            response = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

        parse_error = ""
        try:
            report = json.loads(response)
            if not isinstance(report, dict):
                raise json.JSONDecodeError("Top-level JSON must be an object", response, 0)
        except json.JSONDecodeError:
            parse_error = response[:2000]
            report = {
                "test_file": _DEFAULT_TEST_PATH,
                "test_command": f"pytest {_DEFAULT_TEST_PATH} -v",
                "total": 0,
                "passed": 0,
                "failed": 0,
                "skipped": 0,
                "exit_code": -1,
                "test_cases": [],
                "error_log": parse_error,
                "summary": "Test report parsing failed — raw output captured.",
            }

        report = _validate_and_enrich_report(report, ctx.repo_path, parse_error, ctx.run_id)
        response = json.dumps(report, ensure_ascii=False, indent=2)

        return self._ok(ctx, {"test_report.json": response}, response)


def _format_focused_tests_hint(focused: list[str]) -> str:
    if not focused:
        return ""
    listed = "\n".join(f"  - {t}" for t in focused[:10])
    return (
        "\n\nFocused existing tests related to the changed files — run these with run_test "
        "in addition to your newly generated tests:\n" + listed + "\n"
    )


def _format_test_failure_context(ctx: AgentContext) -> str:
    context = str(getattr(ctx.pipeline, "test_failure_context", "") or "").strip()
    if not context:
        return ""
    return (
        "\n\nPrevious generated tests failed. "
        "IMPORTANT: read_file the existing test file first, run_test to confirm which cases fail, "
        "then use edit_file to fix ONLY the failing tests. "
        "Do NOT use write_file to rewrite the whole file — passing tests must not be touched. "
        "Do not invent modules, endpoints, or helper functions not present in the repository.\n\n"
        f"Failure output:\n{context}\n"
    )


_FRONTEND_SUFFIXES = frozenset({".tsx", ".jsx", ".ts", ".js", ".css", ".scss", ".sass", ".less", ".html", ".vue", ".svelte"})
_BACKEND_SUFFIXES = frozenset({".py", ".pyi", ".rs", ".go", ".rb", ".java", ".kt", ".scala"})


def _classify_change_scope(patch_text: str) -> str:
    """Classify a unified-diff patch's overall scope.

    Returns one of ``frontend_only``, ``backend_only``, ``mixed``, ``other``.
    Used to pick the right validation strategy in test_generation: pytest only
    makes sense for backend changes; frontend-only changes need ``tsc --noEmit``
    (or the equivalent build) instead.
    """
    paths = parse_changed_files(patch_text) if patch_text else []
    if not paths:
        return "other"
    has_frontend = False
    has_backend = False
    has_other = False
    for raw in paths:
        suffix = Path(raw).suffix.lower()
        if suffix in _FRONTEND_SUFFIXES:
            has_frontend = True
        elif suffix in _BACKEND_SUFFIXES:
            has_backend = True
        else:
            has_other = True
    if has_frontend and not has_backend:
        return "frontend_only"
    if has_backend and not has_frontend:
        return "backend_only"
    if has_frontend and has_backend:
        return "mixed"
    return "other" if has_other else "backend_only"


def _find_frontend_root(repo_root: Path, patch_text: str) -> Path | None:
    """Locate the directory holding ``package.json`` that owns the changed files.

    For most projects this is just ``repo_root`` or ``repo_root/frontend``.
    Walks up from each changed file's parent until it finds a ``package.json``.
    """
    paths = parse_changed_files(patch_text) if patch_text else []
    candidates: list[Path] = []
    for raw in paths:
        cur = (repo_root / raw).resolve().parent
        while cur != cur.parent and cur.is_relative_to(repo_root):
            if (cur / "package.json").is_file():
                candidates.append(cur)
                break
            cur = cur.parent
    if candidates:
        # Prefer the deepest (most specific) — handles monorepos with several apps.
        return max(candidates, key=lambda p: len(p.parts))
    # Fallbacks: <root>/package.json, <root>/frontend/package.json
    if (repo_root / "package.json").is_file():
        return repo_root
    if (repo_root / "frontend" / "package.json").is_file():
        return repo_root / "frontend"
    return None


def _ensure_frontend_node_modules(workspace_root: Path, frontend_root: Path, source_repo: Path) -> None:
    """Symlink the source repo's ``node_modules`` into the workspace if missing.

    create_workspace() ignores ``node_modules`` to avoid copying ~200MB per run,
    so a freshly created worktree has no installed deps and ``tsc``/``npm`` will
    fail. Symlinking is fast, cheap, and read-only — the validation only needs
    the source-installed deps to resolve modules.
    """
    target = frontend_root / "node_modules"
    if target.exists():
        return
    rel_frontend = frontend_root.relative_to(workspace_root)
    source_frontend = (source_repo / rel_frontend).resolve()
    source_modules = source_frontend / "node_modules"
    if not source_modules.is_dir():
        return  # nothing to link; tsc will fail with a clear error if invoked
    try:
        target.symlink_to(source_modules, target_is_directory=True)
    except OSError:
        # On some filesystems symlinks aren't allowed. Fail silently — the
        # frontend validation will report missing deps in its output anyway.
        pass


def _frontend_validation_commands(frontend_root: Path) -> tuple[list[str], bool]:
    """Pick a shell command (or list of fallbacks) to validate a frontend project.

    Tries in order:
      1. ``npx tsc --noEmit -p tsconfig.json`` if a tsconfig is present
      2. ``npm run typecheck`` if package.json declares the script
      3. ``npm run build`` as last resort
    Returns ``(commands, has_tsconfig)``.
    """
    has_tsconfig = (frontend_root / "tsconfig.json").is_file()
    commands: list[str] = []
    if has_tsconfig:
        commands.append("npx --no-install tsc --noEmit -p tsconfig.json")

    pkg_path = frontend_root / "package.json"
    if pkg_path.is_file():
        try:
            scripts = (json.loads(pkg_path.read_text(encoding="utf-8")) or {}).get("scripts") or {}
        except (OSError, json.JSONDecodeError):
            scripts = {}
        for script_name in ("typecheck", "type-check", "tsc"):
            if script_name in scripts:
                commands.append(f"npm run {script_name}")
                break
        if "build" in scripts:
            commands.append("npm run build")

    if not commands:
        commands.append("npx --no-install tsc --noEmit")
    return commands, has_tsconfig


def _resolve_actual_test_paths(claimed: list[str], repo_path: str) -> list[str]:
    """Map LLM-claimed test paths to files that actually exist in the workspace.

    The LLM occasionally hallucinates a placeholder filename (e.g. copies
    ``tests/test_generated.py`` straight out of the prompt example) while the
    file it really wrote lives at ``tests/test_generated_stage_4.py``. When
    none of the claimed paths exist on disk, scan the ``tests/`` directory for
    plausible generated test files instead — using the on-disk truth keeps the
    pipeline from failing for purely cosmetic reasons.
    """
    root = Path(repo_path).resolve()
    existing = [p for p in claimed if p and (root / p).is_file()]
    if existing:
        return existing

    tests_dir = root / "tests"
    if not tests_dir.is_dir():
        return claimed or [_DEFAULT_TEST_PATH]

    # Prefer files that look generated (test_generated*.py), then any test_*.py
    # modified since this workspace was created. We can't know the exact
    # mtime cutoff, so just rank by filename match + recency.
    candidates: list[tuple[str, float]] = []
    for candidate in sorted(tests_dir.rglob("test_*.py")):
        try:
            rel = str(candidate.relative_to(root))
            mtime = candidate.stat().st_mtime
        except (OSError, ValueError):
            continue
        priority = 0.0
        if "test_generated" in candidate.name:
            priority += 1_000_000  # strongly prefer generated-looking names
        candidates.append((rel, priority + mtime))

    if not candidates:
        return claimed or [_DEFAULT_TEST_PATH]

    candidates.sort(key=lambda item: -item[1])
    return [candidates[0][0]]


def _validate_and_enrich_report(
    report: dict[str, Any],
    repo_path: str,
    parse_error: str = "",
    run_id: str = "",
) -> dict[str, Any]:
    claimed_paths = _extract_test_paths(report) or [_DEFAULT_TEST_PATH]
    # Self-heal: if the LLM hallucinated a test_file path that doesn't exist on
    # disk, fall back to whatever generated test files we can find in the
    # workspace. This rescues the common failure where the LLM copies the
    # placeholder path from the prompt instead of the filename it actually wrote.
    test_paths = _resolve_actual_test_paths(claimed_paths, repo_path)
    recorder = get_test_progress_recorder(run_id) if run_id else None
    if recorder:
        recorder.prepare()
    validation_runs = [
        run_test(path, repo_path, progress_callback=recorder.handle_event if recorder else None)
        for path in test_paths[:5]
    ]
    command_runs = [
        run_command(command, repo_path)
        for command in _extract_validation_commands(report, test_paths)[:3]
    ]
    aggregate = _aggregate_runs(validation_runs)

    report["test_file"] = test_paths[0]
    report["test_files"] = test_paths
    report.setdefault("test_command", f"pytest {' '.join(test_paths)} -v")
    report["total"] = aggregate["total"]
    report["passed"] = aggregate["passed"]
    report["failed"] = aggregate["failed"]
    report["skipped"] = aggregate["skipped"]
    report["exit_code"] = aggregate["exit_code"]
    report["summary"] = aggregate["summary"]
    report["error_log"] = _build_error_log(validation_runs, parse_error)
    report["generated_test_files"] = _read_generated_test_files(test_paths, repo_path)
    report["runner_validation"] = {
        "validated": True,
        "runs": validation_runs,
        "commands": command_runs,
    }

    test_cases = report.get("test_cases")
    if not isinstance(test_cases, list):
        report["test_cases"] = []
    if report["failed"] and not report["test_cases"]:
        report["test_cases"] = [{
            "id": "TC-RUNNER",
            "name": "pytest execution",
            "status": "failed",
            "message": report["summary"],
        }]
    return report


def _extract_validation_commands(report: dict[str, Any], generated_test_paths: list[str]) -> list[str]:
    commands: list[str] = []

    def add(value: Any) -> None:
        if isinstance(value, str) and value.strip():
            commands.append(value.strip())

    values = report.get("validation_commands")
    if isinstance(values, list):
        for item in values:
            add(item)
    add(report.get("test_command"))

    deduped = []
    seen = set()
    for command in commands:
        if _duplicates_generated_pytest(command, generated_test_paths):
            continue
        if command not in seen:
            seen.add(command)
            deduped.append(command)
    return deduped


def _duplicates_generated_pytest(command: str, generated_test_paths: list[str]) -> bool:
    lowered = command.lower()
    if "pytest" not in lowered:
        return False
    return any(path and path in command for path in generated_test_paths)


def _extract_test_paths(report: dict[str, Any]) -> list[str]:
    paths: list[str] = []

    def add(value: Any) -> None:
        if isinstance(value, str) and value.strip() and value.strip() != "unknown":
            paths.append(value.strip())

    add(report.get("test_file"))
    test_files = report.get("test_files", [])
    if isinstance(test_files, list):
        for value in test_files:
            add(value)
    generated = report.get("generated_test_files", [])
    if isinstance(generated, list):
        for item in generated:
            if isinstance(item, dict):
                add(item.get("path"))
            else:
                add(item)

    deduped = []
    seen = set()
    for path in paths:
        if path not in seen:
            seen.add(path)
            deduped.append(path)
    return deduped


def _aggregate_runs(runs: list[dict[str, Any]]) -> dict[str, Any]:
    passed = failed = skipped = total = 0
    exit_code = 0
    summaries = []

    for run in runs:
        counts = run.get("counts") if isinstance(run.get("counts"), dict) else {}
        run_passed = int(counts.get("passed", 0) or 0)
        run_failed = int(counts.get("failed", 0) or 0) + int(counts.get("errors", 0) or 0)
        run_skipped = int(counts.get("skipped", 0) or 0)
        run_total = int(run.get("total", 0) or 0)

        if not run.get("success") and run_total == 0:
            run_failed = max(run_failed, 1)
            run_total = max(run_total, 1)

        passed += run_passed
        failed += run_failed
        skipped += run_skipped
        total += run_total
        run_exit_code = int(run.get("exit_code", 1) if run.get("exit_code") is not None else 1)
        if run_exit_code != 0:
            exit_code = run_exit_code
        if run.get("summary"):
            summaries.append(str(run["summary"]))
        elif run.get("error"):
            summaries.append(str(run["error"]))

    return {
        "passed": passed,
        "failed": failed,
        "skipped": skipped,
        "total": total,
        "exit_code": exit_code,
        "summary": "; ".join(summaries) if summaries else "No pytest execution summary available.",
    }


def _build_error_log(runs: list[dict[str, Any]], parse_error: str) -> str:
    chunks = []
    if parse_error:
        chunks.append(f"LLM JSON parse error/raw output:\n{parse_error}")
    for run in runs:
        if run.get("success"):
            continue
        detail = run.get("error") or run.get("stderr") or run.get("stdout") or ""
        if detail:
            chunks.append(str(detail)[-4000:])
    return "\n\n".join(chunks)


def _read_generated_test_files(test_paths: list[str], repo_path: str) -> list[dict[str, Any]]:
    root = Path(repo_path).resolve()
    files = []
    for test_path in test_paths[:5]:
        target = (root / test_path).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            files.append({"path": test_path, "content": "", "truncated": False, "error": "path escapes repo root"})
            continue
        if not target.exists() or not target.is_file():
            files.append({"path": test_path, "content": "", "truncated": False, "error": "file not found"})
            continue
        content = target.read_text(encoding="utf-8", errors="replace")
        truncated = len(content.encode("utf-8")) > _MAX_EMBEDDED_TEST_BYTES
        if truncated:
            content = content[:_MAX_EMBEDDED_TEST_BYTES]
        files.append({"path": test_path, "content": content, "truncated": truncated})
    return files
