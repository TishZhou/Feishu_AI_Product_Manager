import os
from pathlib import Path

from fastapi import APIRouter

from devflow.core.pipeline_definition import STAGE_REGISTRY
from devflow.providers.router import provider_router

router = APIRouter(tags=["Meta"])


@router.get("/workspace")
async def get_workspace():
    return {"path": str(Path(os.getcwd()).resolve())}


@router.get("/providers")
async def list_providers():
    results = []
    for name in ("gemini", "volcano"):
        info = await provider_router.check_connectivity(name)
        results.append(info)
    return {"providers": results}


@router.get("/agents")
async def list_agents():
    return {
        "stages": [
            {
                "key": s.key,
                "index": s.index,
                "agent": s.agent_class_path.rsplit(".", 1)[-1],
                "output_artifacts": s.output_artifacts,
                "reads_from": s.reads_from_stages,
                "checkpoint_after": s.checkpoint_after,
            }
            for s in STAGE_REGISTRY
        ]
    }
