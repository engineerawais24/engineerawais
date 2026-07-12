"""Application configuration (Sprint 16).

Settings load from environment / a local .env file. No secrets are
hardcoded. The database URL is the ONLY thing that changes to move
from SQLite to PostgreSQL later.
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "CareerPilot Backend"
    api_version: str = "0.1.0"
    environment: str = "development"

    # SQLite now; swap to `postgresql+psycopg://...` later — no code changes.
    database_url: str = "sqlite:///./careerpilot.db"
    storage_provider: str = "sqlite"

    # Comma-separated allowed CORS origins (local frontend only).
    cors_origins: str = (
        "http://localhost:5500,http://127.0.0.1:5500,"
        "http://localhost:8000,http://127.0.0.1:8000,"
        "http://localhost:3000,null"
    )

    # Local single-user development session (no auth this sprint).
    dev_user_email: str = "dev@careerpilot.local"
    dev_user_name: str = "CareerPilot Developer"

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()
