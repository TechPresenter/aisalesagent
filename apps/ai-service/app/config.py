"""Configuration for the AI / voice service.

Reads the same repository-root .env the Node apps read, so the three services cannot end
up pointing at different Redis instances because someone edited one copy of three.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# apps/ai-service/app/config.py -> repository root is three parents up.
REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    ai_service_port: int = 8000
    ai_service_cors_origins: str = "http://localhost:3000,http://localhost:4000"

    # The shared secret the NestJS API presents. Not optional in anything but local dev:
    # this service can start calls, which costs money and rings real phones.
    ai_service_api_key: str = "dev-ai-service-key-change-me"

    redis_url: str = "redis://localhost:6379"

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.ai_service_cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    """Cached so the .env file is read once per process, not once per request."""
    return Settings()
