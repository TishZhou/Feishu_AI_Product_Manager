"""
In-memory per-run, per-stage token usage tracker.
Written by provider router after each LLM call; read by the REST endpoint.
"""

import threading
from collections import defaultdict


class _TokenUsageStore:
    def __init__(self) -> None:
        self._data: dict[str, dict[str, int]] = {}
        self._lock = threading.Lock()

    def add(self, run_id: str, stage_key: str, tokens: int) -> None:
        with self._lock:
            if run_id not in self._data:
                self._data[run_id] = {}
            self._data[run_id][stage_key] = (
                self._data[run_id].get(stage_key, 0) + tokens
            )

    def get(self, run_id: str) -> dict[str, int]:
        with self._lock:
            return dict(self._data.get(run_id, {}))

    def reset(self, run_id: str) -> None:
        with self._lock:
            self._data.pop(run_id, None)


token_usage_store = _TokenUsageStore()
