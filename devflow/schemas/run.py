from datetime import datetime, timezone

from pydantic import BaseModel, field_serializer


def _serialize_utc_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


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

    @field_serializer("started_at", "completed_at", "created_at", when_used="json")
    def serialize_datetime(self, value: datetime | None) -> str | None:
        return _serialize_utc_datetime(value)

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

    @field_serializer("started_at", "completed_at", when_used="json")
    def serialize_datetime(self, value: datetime | None) -> str | None:
        return _serialize_utc_datetime(value)

    model_config = {"from_attributes": True}


class ClarificationRequest(BaseModel):
    answered_by: str = "user"
    answers: str
