import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from devflow.core.pipeline_definition import STAGE_REGISTRY
from devflow.providers.router import provider_router
from devflow.services.repo_safety import inspect_repo

router = APIRouter(tags=["Meta"])


@router.get("/workspace")
async def get_workspace():
    return {"path": str(Path(os.getcwd()).resolve())}


@router.get("/fs/list")
async def list_directory(path: Optional[str] = Query(default=None)):
    base = Path(path).expanduser() if path else Path(os.getcwd())
    base = base.resolve()
    cwd = Path(os.getcwd()).resolve()
    allowed_roots = [
        cwd,
        Path.home().resolve(),
        Path("/tmp"),
        Path("/private/tmp"),
    ]

    if not any(base == root or root in base.parents for root in allowed_roots):
        raise HTTPException(status_code=403, detail="Access to this path is not allowed")
    if not base.exists():
        raise HTTPException(status_code=404, detail=f"Path does not exist: {base}")
    if not base.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    entries = []
    try:
        for entry in sorted(base.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())):
            if entry.name.startswith(".") and entry.name != ".git":
                continue
            try:
                entries.append({
                    "name": entry.name,
                    "path": str(entry.resolve()),
                    "is_dir": entry.is_dir(),
                })
            except PermissionError:
                continue
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")

    parent_path = base.parent if base != base.parent else None
    parent = None
    if parent_path and any(parent_path == root or root in parent_path.parents for root in allowed_roots):
        parent = str(parent_path)

    return {"path": str(base), "parent": parent, "entries": entries}


@router.get("/repo-check")
async def check_repo(path: str = ""):
    """Inspect a candidate repo path so the UI can warn the user before submit.

    Returns ``{exists, is_self_repo, is_git_repo, ...}`` so the create-pipeline
    form can show inline feedback and pre-empt the 409 from POST /pipelines.
    """
    return inspect_repo(path)


@router.get("/providers")
async def list_providers():
    results = []
    for name in ("openai", "gemini", "volcano"):
        info = await provider_router.check_connectivity(name)
        results.append(info)
    return {"providers": results}


@router.get("/agents")
async def list_agents():
    stages = []
    for s in STAGE_REGISTRY:
        agent_class = s.get_agent_class()
        stages.append({
            "key": s.key,
            "index": s.index,
            "agent": s.agent_class_path.rsplit(".", 1)[-1],
            "required_inputs": [
                {"stage_key": stage_key, "filename": filename}
                for stage_key, filename in agent_class.required_inputs
            ],
            "output_artifacts": agent_class.output_artifacts,
            "reads_from": s.reads_from_stages,
            "checkpoint_after": s.checkpoint_after,
        })

    return {
        "stages": stages
    }
