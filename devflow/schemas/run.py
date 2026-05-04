from datetime import datetime

from pydantic import BaseModel


class RunRead(BaseModel):
    id: str
    pipeline_id: str
    run_number: int
    status: str
    current_stage: str
    error_message: str
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class StageResultRead(BaseModel):
    id: str
    run_id: str
    stage_key: str
    stage_index: int
    status: str
    attempt: int
    provider: str
    model: str
    error_message: str
    started_at: datetime | None
    completed_at: datetime | None
    duration_seconds: float
    output_artifact_keys: str

    model_config = {"from_attributes": True}


class ClarificationRequest(BaseModel):
    answered_by: str = "user"
    answers: str
