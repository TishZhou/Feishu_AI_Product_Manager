"""Manages asyncio background tasks for pipeline runs."""

import asyncio
from typing import Any


class BackgroundTaskManager:
    def __init__(self) -> None:
        self._tasks: dict[str, asyncio.Task] = {}

    def spawn(self, run_id: str, coro: Any) -> None:
        task = asyncio.create_task(coro, name=f"pipeline-run-{run_id}")
        task.add_done_callback(lambda t: self._tasks.pop(run_id, None))
        self._tasks[run_id] = task

    def cancel(self, run_id: str) -> bool:
        task = self._tasks.get(run_id)
        if task and not task.done():
            task.cancel()
            return True
        return False

    def is_running(self, run_id: str) -> bool:
        task = self._tasks.get(run_id)
        return task is not None and not task.done()

    def running_count(self) -> int:
        return sum(1 for t in self._tasks.values() if not t.done())


task_manager = BackgroundTaskManager()
