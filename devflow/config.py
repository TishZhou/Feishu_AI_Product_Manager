from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # OpenAI
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    OPENAI_DEFAULT_MODEL: str = "gpt-4o"

    # Volcano Engine Trae (ByteDance) — OpenAI-compatible
    VOLCANO_API_KEY: str = ""
    VOLCANO_BASE_URL: str = "https://ark.cn-beijing.volces.com/api/v3"
    VOLCANO_DEFAULT_MODEL: str = "seed-v1.6"

    # App
    DEFAULT_PROVIDER: str = "openai"
    ARTIFACTS_DIR: str = "artifacts"
    DATABASE_URL: str = "sqlite+aiosqlite:///data/devflow.db"


settings = Settings()
