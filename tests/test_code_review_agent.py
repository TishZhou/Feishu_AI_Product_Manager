from types import SimpleNamespace

from devflow.agents.base import AgentContext
from devflow.agents.code_review import CodeReviewAgent
from devflow.agents.prompts import code_review as code_review_prompts
from devflow.config import settings
from devflow.core.pipeline_definition import STAGE_BY_KEY


def test_code_review_prompt_includes_generated_file_payload(tmp_path, monkeypatch):
    run_id = "run-1"
    artifact_dir = tmp_path / run_id
    generated_dir = artifact_dir / "generated_files"
    generated_dir.mkdir(parents=True)
    (generated_dir / "app.py").write_text("def answer():\n    return 42\n", encoding="utf-8")
    monkeypatch.setattr(settings, "ARTIFACTS_DIR", str(tmp_path))

    patch = "\n".join([
        "diff --git a/app.py b/app.py",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/app.py",
        "@@ -0,0 +1,2 @@",
        "+def answer():",
        "+    return 42",
        "",
    ])
    manifest = {
        "applied_to_repo": False,
        "mode": "artifact_only",
        "patch_applied_to_workspace": True,
        "execution_workspace": str(tmp_path / "workspace"),
        "files": [{
            "path": "app.py",
            "action": "create",
            "artifact_path": "generated_files/app.py",
        }],
    }
    ctx = AgentContext(
        run_id=run_id,
        pipeline=SimpleNamespace(model="", provider="openai"),
        stage_key="code_review",
        attempt=1,
        artifacts={
            "solution_architecture": {"solution_contract.json": "{}"},
            "detailed_spec": {"detailed_spec.json": "{}"},
            "code_generation": {
                "code_diff.patch": patch,
                "generated_files_manifest.json": manifest,
            },
            "test_generation": {"test_report.json": "{}"},
        },
        repo_path=str(tmp_path / "workspace"),
        provider_router=object(),
    )
    agent = CodeReviewAgent(STAGE_BY_KEY["code_review"])

    prompt = agent.build_user_prompt(ctx)

    assert "Generated file review payload" in prompt
    assert '"path": "app.py"' in prompt
    assert "def answer()" in prompt


def test_code_review_tools_are_read_only_plus_tests():
    agent = CodeReviewAgent(STAGE_BY_KEY["code_review"])
    tool_names = [tool["function"]["name"] for tool in agent.get_tools()]

    assert tool_names == ["list_dir", "read_file", "search_code", "run_test", "run_command"]


def test_code_review_prompt_uses_hypothesis_driven_framework():
    prompt = code_review_prompts.SYSTEM

    assert "不是 checklist" in prompt
    assert "约 5 个" in prompt
    assert "小范围改动只列 2-3 个" in prompt
    assert "后续 retry 不要重新发散风险" in prompt
    assert "不要为了凑数量" in prompt
    assert "risk_brainstorm" in prompt
    assert "previous_findings_check" in prompt
    assert "verification_log" in prompt
    assert "read_file" in prompt
    assert "search_code" in prompt
    assert "run_test" in prompt
    assert "前端变更重点想" in prompt
    assert "后端变更重点想" in prompt
