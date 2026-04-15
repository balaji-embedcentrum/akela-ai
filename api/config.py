from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://akela:akela@localhost:5432/akela"
    redis_url: str = "redis://localhost:6379"
    secret_key: str = "changeme-use-a-real-secret"
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 24

    # Phase 1 simple auth — single orchestrator
    admin_username: str = "alpha"
    admin_password: str = "changeme"  # override via env

    # GitHub OAuth (Phase 2)
    github_client_id: str = ""
    github_client_secret: str = ""
    github_redirect_uri: str = "http://localhost:8200/akela-api/auth/github/callback"

    api_host: str = "0.0.0.0"
    api_port: int = 8200

    # Trust score thresholds (override via env: TRUST_DELTA_MAX=85)
    trust_initial_score: float = 50.0
    trust_restricted_max: float = 30.0
    trust_omega_max: float = 60.0
    trust_delta_max: float = 85.0

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
