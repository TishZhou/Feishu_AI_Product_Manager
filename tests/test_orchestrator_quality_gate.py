from devflow.core.orchestrator import orchestrator


def test_test_retry_stage_keeps_generated_test_collection_errors_in_test_generation():
    report = {
        "summary": "1 error in 0.41s",
        "error_log": "ERROR collecting tests/test_generated.py\nModuleNotFoundError: No module named 'devflow.api.server'",
    }

    assert orchestrator._choose_test_retry_stage(report) == "test_generation"


def test_test_retry_stage_sends_runtime_failures_back_to_code_generation():
    report = {
        "summary": "1 failed in 0.41s",
        "error_log": "FAILED tests/test_generated.py::test_behavior - AssertionError",
    }

    assert orchestrator._choose_test_retry_stage(report) == "code_generation"


def test_test_retry_stage_prefers_code_generation_when_some_tests_passed():
    # Mixed result: optional-dep test got skipped (logs say "collected 0 items / 1 skipped")
    # but other tests ran and one failed. The failing test must be a code bug, not a
    # broken test file — so we must retry from code_generation.
    report = {
        "passed": 3,
        "failed": 1,
        "skipped": 2,
        "exit_code": 1,
        "summary": "3 passed, 1 failed",
        "error_log": "collecting ... collected 0 items / 1 skipped",
        "test_cases": [
            {"id": "TC-01", "name": "test_a", "status": "passed"},
            {"id": "TC-04", "name": "test_b", "status": "failed"},
        ],
    }

    assert orchestrator._choose_test_retry_stage(report) == "code_generation"


def test_test_failure_context_gives_generation_agent_actionable_evidence():
    report = {
        "test_file": "tests/test_generated.py",
        "test_files": ["tests/test_generated.py"],
        "test_command": "pytest tests/test_generated.py -v",
        "summary": "1 failed, 1 passed in 0.41s",
        "error_log": "E       assert 200 == 403",
        "test_cases": [
            {"id": "TC-01", "name": "test_allows_owner", "status": "passed"},
            {
                "id": "TC-02",
                "name": "tests/test_generated.py::test_rejects_cross_tenant_access",
                "status": "failed",
                "message": "expected 403, got 200",
            },
        ],
        "generated_test_files": [{
            "path": "tests/test_generated.py",
            "content": "def test_rejects_cross_tenant_access(client):\n    assert response.status_code == 403\n",
            "truncated": False,
        }],
        "runner_validation": {
            "runs": [{
                "test_path": "tests/test_generated.py",
                "stdout": "FAILED tests/test_generated.py::test_rejects_cross_tenant_access - assert 200 == 403",
                "stderr": "",
            }]
        },
    }

    context = orchestrator._build_test_failure_context(report)

    assert "Recommended retry target: code_generation" in context
    assert "Fix production code; do not weaken, delete, or rewrite the generated tests." in context
    assert "tests/test_generated.py::test_rejects_cross_tenant_access" in context
    assert "expected 403, got 200" in context
    assert "pytest tests/test_generated.py -v" in context
    assert "Generated test source" in context
    assert "assert response.status_code == 403" in context


def test_test_failure_context_marks_collection_errors_as_test_repairs():
    report = {
        "test_file": "tests/test_generated.py",
        "summary": "1 error in 0.41s",
        "error_log": "ERROR collecting tests/test_generated.py\nSyntaxError: invalid syntax",
        "test_cases": [{"id": "TC-RUNNER", "name": "pytest execution", "status": "failed"}],
    }

    context = orchestrator._build_test_failure_context(report)

    assert "Recommended retry target: test_generation" in context
    assert "Fix the generated tests first" in context
    assert "SyntaxError: invalid syntax" in context
