"""
Log bus — async pub/sub for per-run real-time log streaming.

Design:
- Orchestrator and provider router call `log_bus.emit(run_id, ...)`.
- SSE consumers call `log_bus.subscribe(run_id)` to get an async generator.

Replay correctness:
  subscribe() registers a queue FIRST (so no new events are missed), then
  yields history items directly to the caller (bypassing the queue, so there
  is no queue-size overflow regardless of history length).  New events emitted
  after registration go into the queue and are yielded after history replay.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import AsyncGenerator

logger = logging.getLogger("devflow.log_bus")

_HISTORY_LIMIT = 2000   # max entries kept in memory per run


@dataclass
class LogEntry:
    time: str
    level: str
    stage_key: str
    message: str
    extra: dict = field(default_factory=dict)

    def to_json(self) -> str:
        return json.dumps({
            "time": self.time,
            "level": self.level,
            "stage_key": self.stage_key,
            "message": self.message,
            **self.extra,
        }, ensure_ascii=False)


def _now_str() -> str:
    return datetime.now(timezone.utc).strftime("%H:%M:%S")


class _RunBus:
    """State for a single run: history + active subscriber queues."""

    def __init__(self) -> None:
        self._history: list[LogEntry] = []
        self._queues: list[asyncio.Queue[LogEntry | None]] = []
        self._closed = False

    def emit(self, entry: LogEntry) -> None:
        if self._closed:
            return
        self._history.append(entry)
        if len(self._history) > _HISTORY_LIMIT:
            # Trim oldest entries; update all queue items are already dispatched
            self._history = self._history[-_HISTORY_LIMIT:]
        for q in list(self._queues):
            try:
                q.put_nowait(entry)
            except asyncio.QueueFull:
                # Drop on full — slow consumer; logged at module level
                logger.warning("log_bus: subscriber queue full, dropping entry level=%s", entry.level)

    def close(self) -> None:
        self._closed = True
        # Send sentinel None to each subscriber queue to signal end-of-stream
        for q in list(self._queues):
            try:
                q.put_nowait(None)
            except asyncio.QueueFull:
                pass

    async def subscribe(self) -> AsyncGenerator[LogEntry, None]:
        """
        Subscribe to this run's log stream.

        Step 1: Register queue (no awaits between snapshot + register, so no
                events can slip through the gap in asyncio cooperative scheduling).
        Step 2: Yield history items directly to the caller (not via queue),
                so there is no queue size limit on replay.
        Step 3: Consume new events from the queue until sentinel None or disconnect.
        """
        # --- Step 1: register queue before any yields so we don't miss events ---
        history_snapshot_len = len(self._history)  # snapshot length
        q: asyncio.Queue[LogEntry | None] = asyncio.Queue(maxsize=2000)
        if not self._closed:
            self._queues.append(q)

        try:
            # --- Step 2: replay history directly (bypass queue to avoid overflow) ---
            for entry in self._history[:history_snapshot_len]:
                yield entry

            # If the bus was already closed before we even subscribed, stop here.
            if self._closed:
                return

            # --- Step 3: consume new events from queue ---
            while True:
                try:
                    item = await asyncio.wait_for(q.get(), timeout=30.0)
                except asyncio.TimeoutError:
                    # Keep-alive: if the run is done and bus closed, exit
                    if self._closed:
                        break
                    continue
                if item is None:
                    break
                yield item
        finally:
            try:
                self._queues.remove(q)
            except ValueError:
                pass


class LogBus:
    """Application-wide log bus. Use the singleton `log_bus`."""

    def __init__(self) -> None:
        self._runs: dict[str, _RunBus] = {}

    def register(self, run_id: str) -> None:
        self._runs[run_id] = _RunBus()

    def emit(
        self,
        run_id: str,
        level: str,
        stage_key: str,
        message: str,
        **extra,
    ) -> None:
        bus = self._runs.get(run_id)
        if bus is None:
            return
        entry = LogEntry(
            time=_now_str(),
            level=level,
            stage_key=stage_key,
            message=message,
            extra=extra,
        )
        bus.emit(entry)

    def close(self, run_id: str) -> None:
        bus = self._runs.get(run_id)
        if bus:
            bus.close()

    def cleanup(self, run_id: str) -> None:
        self._runs.pop(run_id, None)

    async def subscribe(self, run_id: str) -> AsyncGenerator[LogEntry, None]:
        bus = self._runs.get(run_id)
        if bus is None:
            return
        async for entry in bus.subscribe():
            yield entry


# Application singleton
log_bus = LogBus()
