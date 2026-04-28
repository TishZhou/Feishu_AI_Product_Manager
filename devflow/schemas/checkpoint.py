from datetime import datetime

from pydantic import BaseModel


class CheckpointRead(BaseModel):
    id: str
    run_id: str
    checkpoint_number: int
    label: str
    required_stage_keys: str
    retry_stage_key: str
    status: str
    decision_by: str
    decision_reason: str
    decided_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ApproveRequest(BaseModel):
    decided_by: str = "api"
    reason: str = ""


class RejectRequest(BaseModel):
    decided_by: str = "api"
    reason: str
    retry_stage_key: str = ""  # overrides checkpoint default if provided
