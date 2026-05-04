import os
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text

from devflow.config import settings


def _ensure_data_dir() -> None:
    url = settings.DATABASE_URL
    # Extract path from sqlite+aiosqlite:///path
    if "sqlite" in url:
        path_part = url.split("///", 1)[-1]
        Path(path_part).parent.mkdir(parents=True, exist_ok=True)


_ensure_data_dir()

engine = create_async_engine(settings.DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def create_tables() -> None:
    from devflow.db import models  # noqa: F401 — registers all models

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        if "sqlite" in settings.DATABASE_URL:
            rows = await conn.execute(text("PRAGMA table_info(pipelines)"))
            columns = {row[1] for row in rows}
            if "reference_context" not in columns:
                await conn.execute(text("ALTER TABLE pipelines ADD COLUMN reference_context TEXT DEFAULT ''"))
            if "reference_sources" not in columns:
                await conn.execute(text("ALTER TABLE pipelines ADD COLUMN reference_sources TEXT DEFAULT ''"))


async def get_session() -> AsyncSession:  # type: ignore[misc]
    async with AsyncSessionLocal() as session:
        yield session
