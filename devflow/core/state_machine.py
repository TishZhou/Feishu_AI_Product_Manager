from enum import Enum


class RunState(str, Enum):
    CREATED = "created"
    RUNNING = "running"
    WAITING_FOR_APPROVAL = "waiting_for_approval"
    PAUSED = "paused"
    FAILED = "failed"
    COMPLETED = "completed"
    TERMINATED = "terminated"


class StageState(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    REJECTED = "rejected"
    SKIPPED = "skipped"


VALID_RUN_TRANSITIONS: dict[RunState, set[RunState]] = {
    RunState.CREATED: {RunState.RUNNING},
    RunState.RUNNING: {RunState.WAITING_FOR_APPROVAL, RunState.FAILED, RunState.COMPLETED, RunState.PAUSED},
    RunState.WAITING_FOR_APPROVAL: {RunState.RUNNING, RunState.FAILED, RunState.TERMINATED},
    RunState.PAUSED: {RunState.RUNNING, RunState.TERMINATED},
    RunState.FAILED: set(),
    RunState.COMPLETED: set(),
    RunState.TERMINATED: set(),
}


def validate_run_transition(current: RunState, next_: RunState) -> None:
    if next_ not in VALID_RUN_TRANSITIONS.get(current, set()):
        raise ValueError(f"Invalid run state transition: {current} → {next_}")
