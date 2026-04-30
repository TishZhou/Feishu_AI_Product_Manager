from datetime import datetime

from pydantic import BaseModel, Field

from devflow.config import settings


class PipelineCreate(BaseModel):
    name: str
    description: str
    task_type: str = "feature"
    repo_path: str
    provider: str = settings.DEFAULT_PROVIDER
    model: str = ""


class PipelineRead(BaseModel):
    id: str
    name: str
    description: str
    task_type: str
    repo_path: str
    provider: str
    model: str
    created_at: datetime

    model_config = {"from_attributes": True}
