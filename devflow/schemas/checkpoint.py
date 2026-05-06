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
    # Optional: switch the LLM provider/model for all stages after this checkpoint
    next_provider: str = ""
    next_model: str = ""


class RejectRequest(BaseModel):
    decided_by: str = "api"
    reason: str
    retry_stage_key: str = ""  # overrides checkpoint default if provided
    # Optional: switch provider/model for the retry run
    next_provider: str = ""
    next_model: str = ""
