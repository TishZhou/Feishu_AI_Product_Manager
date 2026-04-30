from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Google Gemini (OpenAI-compatible endpoint)
    GEMINI_API_KEY: str = ""
    GEMINI_BASE_URL: str = "https://generativelanguage.googleapis.com/v1beta/openai/"
    GEMINI_DEFAULT_MODEL: str = "gemini-2.0-flash"

    # Volcano Engine Trae (ByteDance) — OpenAI-compatible
    VOLCANO_API_KEY: str = ""
    VOLCANO_BASE_URL: str = "https://ark.cn-beijing.volces.com/api/v3"
    VOLCANO_DEFAULT_MODEL: str = "ep-20260423223203-k4sbx"

    # App
    DEFAULT_PROVIDER: str = "volcano"
    ARTIFACTS_DIR: str = "artifacts"
    DATABASE_URL: str = "sqlite+aiosqlite:///data/devflow.db"

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def ensure_async_driver(cls, v: str) -> str:
        """Ensure the DATABASE_URL uses an async driver compatible with SQLAlchemy asyncio."""
        if isinstance(v, str):
            if v.startswith("postgresql://") or v.startswith("postgres://"):
                v = v.replace("postgresql://", "postgresql+asyncpg://", 1)
                v = v.replace("postgres://", "postgresql+asyncpg://", 1)
                # asyncpg does not accept sslmode as a query param; strip it
                import re
                v = re.sub(r"[?&]sslmode=[^&]*", "", v).rstrip("?&")
            elif v.startswith("sqlite:///") and not v.startswith("sqlite+aiosqlite:///"):
                v = v.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
        return v


settings = Settings()
