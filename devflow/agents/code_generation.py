import json
import shutil
import uuid
from difflib import unified_diff
from pathlib import Path

from devflow.agents.base import AgentContext, AgentResult, BaseAgent
from devflow.agents.prompts import code_generation as prompts
from devflow.config import settings
from devflow.providers.router import ToolDispatcher
from devflow.tools.repo_tools import REPO_TOOL_SCHEMAS
from devflow.tools.repo_tools import edit_file, list_dir, read_file, search_code, write_file

_SEPARATOR = "---IMPLEMENTATION_SUMMARY---"
_IGNORE_DIRS = {".git", "__pycache__", ".pytest_cache", "artifacts", "data", "uploads", "dist", "node_modules"}
_IGNORE_SUFFIXES = {".pyc", ".pyo", ".so", ".db", ".sqlite", ".sqlite3", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf"}


class CodeGenerationAgent(BaseAgent):
    required_inputs = [
        ("solution_architecture", "solution_design.md"),
        ("solution_architecture", "solution_contract.json"),
        ("detailed_spec", "detailed_spec.json"),
    ]
    output_artifacts = ["code_diff.patch", "implementation_summary.md", "generated_files_manifest.json"]

    async def run(self, ctx: AgentContext) -> AgentResult:
        missing_inputs = self._missing_required_inputs(ctx)
        if missing_inputs:
            formatted = ", ".join(f"{stage}/{filename}" for stage, filename in missing_inputs)
            return self._fail(ctx, f"Missing required input artifact(s): {formatted}")

        source_repo = Path(ctx.repo_path)
        workspace = Path(settings.ARTIFACTS_DIR) / ctx.run_id / f"codegen_workspace_{ctx.attempt}_{uuid.uuid4().hex[:8]}"
        if workspace.exists():
            shutil.rmtree(workspace)
        shutil.copytree(
            source_repo,
            workspace,
            ignore=shutil.ignore_patterns(*_IGNORE_DIRS),
        )

        dispatcher = ToolDispatcher()
        workspace_str = str(workspace)
        dispatcher.register("list_dir", lambda path: list_dir(path, workspace_str))
        dispatcher.register("read_file", lambda path: read_file(path, workspace_str))
        dispatcher.register("search_code", lambda query, path_glob="**/*": search_code(query, workspace_str, path_glob))
        dispatcher.register("write_file", lambda path, content: write_file(path, content, workspace_str))
        dispatcher.register("edit_file", lambda path, old_str, new_str: edit_file(path, old_str, new_str, workspace_str))

        raw_summary = await ctx.provider_router.chat(
            system=self.build_system_prompt(ctx),
            user=self.build_user_prompt_for_workspace(ctx, workspace_str),
            tools=self.get_tools(),
            model=ctx.pipeline.model or None,
            provider=ctx.pipeline.provider,
            tool_dispatcher=dispatcher,
            json_mode=False,
            max_tokens=self.max_tokens(),
        )

        patch = _build_workspace_patch(source_repo, workspace)
        if not patch.strip():
            return self._fail(ctx, "Code generation produced no file changes.", raw_summary)

        summary = raw_summary.strip() or "Implementation summary not provided."
        summary = f"{summary}\n\nGenerated in temporary workspace: `{workspace}`\n"

        return self._ok(ctx, {
            "code_diff.patch": patch,
            "implementation_summary.md": summary,
            "generated_files_manifest.json": json.dumps({
                "applied_to_repo": False,
                "mode": "artifact_only",
                "files": [],
                "status": "pending_materialization",
                "codegen_workspace": str(workspace),
            }, ensure_ascii=False, indent=2),
        }, raw_summary)

    def build_system_prompt(self, ctx: AgentContext) -> str:
        return prompts.SYSTEM

    def build_user_prompt(self, ctx: AgentContext) -> str:
        return self.build_user_prompt_for_workspace(ctx, ctx.repo_path)

    def build_user_prompt_for_workspace(self, ctx: AgentContext, repo_path: str) -> str:
        spec = self._get_artifact(ctx, "detailed_spec", "detailed_spec.json", "{}")
        if isinstance(spec, dict):
            spec = json.dumps(spec, indent=2, ensure_ascii=False)
        solution = self._get_artifact(ctx, "solution_architecture", "solution_design.md", "")
        solution_contract = self._get_artifact(ctx, "solution_architecture", "solution_contract.json", "{}")
        if isinstance(solution_contract, dict):
            solution_contract = json.dumps(solution_contract, indent=2, ensure_ascii=False)
        return prompts.USER_TMPL.format(
            detailed_spec=spec,
            solution_contract=solution_contract,
            solution_design=solution,
            repo_path=repo_path,
        )

    def get_tools(self) -> list[dict]:
        return [REPO_TOOL_SCHEMAS[i] for i in (0, 1, 2, 4, 3)]  # list/read/search/edit/write

    def parse_response(self, response: str, ctx: AgentContext) -> AgentResult:
        response = response.strip()
        if _SEPARATOR in response:
            parts = response.split(_SEPARATOR, 1)
            patch = parts[0].strip()
            summary = parts[1].strip()
        else:
            patch = response
            summary = "Implementation summary not provided."

        # Strip markdown fences from patch if present
        if patch.startswith("```"):
            lines = patch.splitlines()
            patch = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

        # git apply requires a trailing newline
        if patch and not patch.endswith("\n"):
            patch += "\n"

        return self._ok(ctx, {
            "code_diff.patch": patch,
            "implementation_summary.md": summary,
            "generated_files_manifest.json": json.dumps({
                "applied_to_repo": False,
                "mode": "artifact_only",
                "files": [],
                "status": "pending_materialization",
            }, ensure_ascii=False, indent=2),
        }, response)


def _build_workspace_patch(source_repo: Path, workspace: Path) -> str:
    hunks = []
    for rel_path in sorted(_collect_text_paths(source_repo) | _collect_text_paths(workspace)):
        source_file = source_repo / rel_path
        workspace_file = workspace / rel_path
        old_exists = source_file.exists()
        new_exists = workspace_file.exists()
        if not old_exists and not new_exists:
            continue

        old_lines = _read_lines(source_file) if old_exists else []
        new_lines = _read_lines(workspace_file) if new_exists else []
        if old_lines == new_lines:
            continue

        rel = rel_path.as_posix()
        header = [f"diff --git a/{rel} b/{rel}\n"]
        if not old_exists:
            header.append("new file mode 100644\n")
            diff_lines = unified_diff(old_lines, new_lines, fromfile="/dev/null", tofile=f"b/{rel}", lineterm="")
        elif not new_exists:
            header.append("deleted file mode 100644\n")
            diff_lines = unified_diff(old_lines, new_lines, fromfile=f"a/{rel}", tofile="/dev/null", lineterm="")
        else:
            diff_lines = unified_diff(old_lines, new_lines, fromfile=f"a/{rel}", tofile=f"b/{rel}", lineterm="")
        hunks.extend(header)
        hunks.extend(_with_newlines(diff_lines))
    return "".join(hunks)


def _collect_text_paths(root: Path) -> set[Path]:
    paths: set[Path] = set()
    if not root.exists():
        return paths
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        if any(part in _IGNORE_DIRS for part in rel.parts):
            continue
        if path.suffix.lower() in _IGNORE_SUFFIXES:
            continue
        paths.add(rel)
    return paths


def _read_lines(path: Path) -> list[str]:
    try:
        return path.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)
    except OSError:
        return []


def _with_newlines(lines) -> list[str]:
    result = []
    for line in lines:
        result.append(line if line.endswith("\n") else f"{line}\n")
    return result
