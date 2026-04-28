from datetime import datetime

from pydantic import BaseModel


class ArtifactRead(BaseModel):
    id: str
    run_id: str
    stage_key: str
    filename: str
    file_path: str
    content_type: str
    size_bytes: int
    created_at: datetime

    model_config = {"from_attributes": True}
