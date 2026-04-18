from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
from pydantic import Field


class Settings(BaseSettings):
    # --- Required: no defaults, must be set in .env ---
    # Database connection URL.
    # Format: postgresql+asyncpg://USER:PASSWORD@HOST:PORT/DATABASE
    database_url: str = Field(
        ...,
        description="PostgreSQL connection URL. Required — no default.",
    )

    # Redis connection URL.
    # Format: redis://[:PASSWORD@]HOST:PORT[/DB]
    # REDIS_PASSWORD must be set for any non-local environment.
    redis_url: str = Field(
        ...,
        description="Redis connection URL. Required — no default.",
    )

    # JWT signing secret. Generate with: openssl rand -hex 32
    secret_key: str = Field(
        ...,
        description="Secret key for signing JWTs. Generate with: openssl rand -hex 32",
    )

    # Admin credentials for local auth (alpha / password login).
    # IMPORTANT: Change ADMIN_PASSWORD before first deployment.
    admin_username: str = Field(
        ...,
        description="Admin login username. Must be set in .env.",
    )
    admin_password: str = Field(
        ...,
        description="Admin login password. Must be set in .env — use a strong unique value.",
    )

    # --- Optional: safe defaults that are fine to commit ---
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 24

    # GitHub OAuth (optional — leave blank to disable GitHub login)
    github_client_id: str = ""
    github_client_secret: str = ""
    github_redirect_uri: str = "http://localhost:8200/akela-api/auth/github/callback"

    # Dashboard binding (usually fine at defaults)
    api_host: str = "0.0.0.0"
    api_port: int = 8200

    # Trust score thresholds
    trust_initial_score: float = 50.0
    trust_restricted_max: float = 30.0
    trust_omega_max: float = 60.0
    trust_delta_max: float = 85.0

    # Web Push / VAPID (optional — leave blank to disable push notifications)
    # To generate: docker compose -f docker-compose.prod.yml exec api vapid --gen
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:admin@example.com"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache()
def get_settings() -> Settings:
    return Settings()
