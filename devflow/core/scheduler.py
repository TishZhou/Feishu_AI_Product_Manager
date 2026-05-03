from typing import Optional
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
import uuid

from devflow.core.email_scanner import run_scan

_scheduler: Optional[AsyncIOScheduler] = None


def get_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if not _scheduler:
        _scheduler = AsyncIOScheduler()
    return _scheduler


def start_scheduler() -> None:
    scheduler = get_scheduler()
    if not scheduler.running:
        scheduler.start()


def add_scheduled_scan(account_id: str, cron_expression: str) -> str:
    """Registers new scheduled scan job with APScheduler, returns schedule ID"""
    scheduler = get_scheduler()
    schedule_id = str(uuid.uuid4())

    # Parse cron expression
    try:
        trigger = CronTrigger.from_crontab(cron_expression)
    except ValueError:
        raise ValueError(f"Invalid cron expression: {cron_expression}")

    # Add job to scheduler
    scheduler.add_job(
        run_scan,
        trigger=trigger,
        id=schedule_id,
        args=[account_id, "scheduled"],
        coalesce=True,
        max_instances=1
    )
    return schedule_id
