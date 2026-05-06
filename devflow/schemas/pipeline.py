from datetime import datetime

from pydantic import BaseModel, Field


class PipelineCreate(BaseModel):
    name: str
    description: str
    task_type: str = "feature"
    repo_path: str
    reference_context: str = ""
    reference_sources: str = ""
    provider: str = "openai"
    model: str = ""
    # Set to true to acknowledge that the selected repo_path is DevFlow's own
    # source tree and that the caller intends to let the AI modify it.
    confirm_self_modification: bool = False


class PipelineRead(BaseModel):
    id: str
    name: str
    description: str
    task_type: str
    repo_path: str
    reference_context: str
    reference_sources: str
    provider: str
    model: str
    created_at: datetime

    model_config = {"from_attributes": True}
