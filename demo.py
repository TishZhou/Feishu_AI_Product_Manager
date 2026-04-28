#!/usr/bin/env python3
"""
DevFlow Engine — End-to-end CLI demo.

Usage:
    python demo.py [--provider openai|volcano] [--requirement "..."] [--server http://localhost:8000]
"""

import argparse
import json
import os
import sys
import time

import httpx
from dotenv import load_dotenv

load_dotenv()

DEFAULT_SERVER = "http://localhost:8000"
DEFAULT_REQUIREMENT = (
    "Add a GET /api/runs endpoint that returns a paginated list of all pipeline runs "
    "across all pipelines, sorted by created_at descending. Include run_id, pipeline_id, "
    "status, current_stage, and created_at in each item."
)


def _api(server: str, method: str, path: str, **kwargs) -> dict:
    url = f"{server}{path}"
    resp = httpx.request(method, url, timeout=30, **kwargs)
    try:
        resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        print(f"\n[ERROR] {method} {path} → {e.response.status_code}: {e.response.text}")
        sys.exit(1)
    return resp.json()


def _poll_run(server: str, run_id: str, interval: float = 5.0) -> dict:
    terminal = {"completed", "failed", "terminated"}
    waiting = "waiting_for_approval"
    while True:
        run = _api(server, "GET", f"/api/runs/{run_id}")
        status = run["status"]
        stage = run.get("current_stage", "")
        print(f"  status={status:<25} stage={stage}", end="\r", flush=True)
        if status in terminal or status == waiting:
            print()
            return run
        time.sleep(interval)


def _print_artifact(server: str, run_id: str, filename: str) -> None:
    artifacts = _api(server, "GET", f"/api/runs/{run_id}/artifacts")
    for art in artifacts:
        if art["filename"] == filename:
            path = art["file_path"]
            if os.path.exists(path):
                content = open(path, encoding="utf-8").read()
                print(f"\n{'='*60}")
                print(f"  {filename}")
                print(f"{'='*60}")
                print(content[:3000])
                if len(content) > 3000:
                    print(f"  ... [{len(content) - 3000} more chars] ...")
            return
    print(f"  (artifact {filename} not found)")


def _handle_checkpoint(server: str, run_id: str) -> None:
    checkpoints = _api(server, "GET", f"/api/runs/{run_id}/checkpoints")
    waiting_cp = next((c for c in checkpoints if c["status"] == "waiting"), None)
    if not waiting_cp:
        print("  No waiting checkpoint found.")
        return

    cp_id = waiting_cp["id"]
    cp_num = waiting_cp["checkpoint_number"]
    print(f"\n[CHECKPOINT {cp_num}] {waiting_cp['label']}")
    print(f"  checkpoint_id: {cp_id}")

    # Show relevant artifacts
    if cp_num == 1:
        for f in ["requirement_spec.json", "solution_design.md", "detailed_spec.json"]:
            _print_artifact(server, run_id, f)
    else:
        for f in ["code_diff.patch", "test_report.json", "review_report.md"]:
            _print_artifact(server, run_id, f)

    print(f"\nCheckpoint {cp_num} requires your decision.")
    while True:
        choice = input("  Approve? [y/n]: ").strip().lower()
        if choice in ("y", "n"):
            break
        print("  Please enter 'y' or 'n'.")

    if choice == "y":
        decided_by = input("  Your name/id [enter to skip]: ").strip() or "demo-user"
        reason = input("  Reason (optional): ").strip()
        _api(server, "POST", f"/api/checkpoints/{cp_id}/approve",
             json={"decided_by": decided_by, "reason": reason})
        print(f"  ✓ Checkpoint {cp_num} APPROVED. Pipeline resuming...")
    else:
        reason = input("  Rejection reason: ").strip() or "Needs revision"
        retry_stage = input(
            "  Retry from stage (leave blank for default): "
        ).strip()
        body = {"decided_by": "demo-user", "reason": reason}
        if retry_stage:
            body["retry_stage_key"] = retry_stage
        _api(server, "POST", f"/api/checkpoints/{cp_id}/reject", json=body)
        print(f"  ✗ Checkpoint {cp_num} REJECTED. Pipeline retrying from stage...")


def main():
    parser = argparse.ArgumentParser(description="DevFlow Engine CLI Demo")
    parser.add_argument("--provider", default=os.getenv("DEFAULT_PROVIDER", "openai"))
    parser.add_argument("--model", default="")
    parser.add_argument("--requirement", default=DEFAULT_REQUIREMENT)
    parser.add_argument("--server", default=DEFAULT_SERVER)
    args = parser.parse_args()

    server = args.server
    repo_path = os.path.abspath(os.path.dirname(__file__))

    print(f"\n{'='*60}")
    print("  DevFlow Engine — End-to-end Demo")
    print(f"{'='*60}")
    print(f"  Server  : {server}")
    print(f"  Provider: {args.provider}")
    print(f"  Repo    : {repo_path}")
    print(f"  Task    : {args.requirement[:80]}...")
    print()

    # 1. Check providers
    print("[1/5] Checking provider connectivity...")
    providers = _api(server, "GET", "/api/providers")
    for p in providers.get("providers", []):
        status_icon = "✓" if p["status"] == "ok" else "✗"
        print(f"  {status_icon} {p['provider']}: {p['status']}")

    # 2. Create pipeline
    print("\n[2/5] Creating pipeline...")
    pipeline = _api(server, "POST", "/api/pipelines", json={
        "name": "Demo Run",
        "description": args.requirement,
        "task_type": "feature",
        "repo_path": repo_path,
        "provider": args.provider,
        "model": args.model,
    })
    pipeline_id = pipeline["id"]
    print(f"  pipeline_id: {pipeline_id}")

    # 3. Start run
    print("\n[3/5] Starting pipeline run...")
    run = _api(server, "POST", f"/api/pipelines/{pipeline_id}/runs")
    run_id = run["id"]
    print(f"  run_id: {run_id}")

    # 4. Poll + handle checkpoints
    print("\n[4/5] Running pipeline (polling every 5s)...")
    while True:
        run = _poll_run(server, run_id)
        status = run["status"]

        if status == "waiting_for_approval":
            _handle_checkpoint(server, run_id)
            # After decision, continue polling
            continue

        if status == "completed":
            print("  ✓ Pipeline completed successfully!")
            break
        elif status == "failed":
            print(f"  ✗ Pipeline failed: {run.get('error_message', '')}")
            sys.exit(1)
        elif status == "terminated":
            print("  Pipeline terminated.")
            sys.exit(0)

    # 5. Print delivery summary
    print("\n[5/5] Delivery Summary:")
    _print_artifact(server, run_id, "delivery_summary.md")

    print(f"\n{'='*60}")
    print(f"  All artifacts saved to: artifacts/{run_id}/")
    print(f"  View full run: {server}/api/runs/{run_id}")
    print(f"  OpenAPI docs: {server}/docs")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
