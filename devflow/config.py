from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # OpenAI
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    OPENAI_DEFAULT_MODEL: str = "gpt-5.4"

    # Google Gemini (OpenAI-compatible endpoint)
    GEMINI_API_KEY: str = ""
    GEMINI_BASE_URL: str = "https://generativelanguage.googleapis.com/v1beta/openai/"
    GEMINI_DEFAULT_MODEL: str = "gemini-2.0-flash"

    # Volcano Engine Trae (ByteDance) — OpenAI-compatible
    VOLCANO_API_KEY: str = ""
    VOLCANO_BASE_URL: str = "https://ark.cn-beijing.volces.com/api/v3"
    VOLCANO_DEFAULT_MODEL: str = "seed-v1.6"

    # App
    DEFAULT_PROVIDER: str = "openai"
    ARTIFACTS_DIR: str = "artifacts"
    UPLOADS_DIR: str = "uploads"
    DATABASE_URL: str = "sqlite+aiosqlite:///data/devflow.db"


settings = Settings()
