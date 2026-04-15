from fastapi import Depends, HTTPException, Header, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
import redis.asyncio as aioredis
from typing import Optional, AsyncGenerator
from api.db.session import get_db
from api.models.agent import Agent
from api.models.orchestrator import Orchestrator
from api.services.auth_service import decode_jwt, generate_api_key
from sqlalchemy import select
from api.config import get_settings

settings = get_settings()
_redis_client: Optional[aioredis.Redis] = None
bearer_scheme = HTTPBearer(auto_error=False)


async def get_redis() -> AsyncGenerator[aioredis.Redis, None]:
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
    yield _redis_client


async def get_current_agent(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    db: AsyncSession = Depends(get_db),
) -> Agent:
    """Agents authenticate with Bearer token or X-API-Key header."""
    api_key = None
    if credentials and credentials.credentials.startswith("akela_"):
        api_key = credentials.credentials
    elif x_api_key and x_api_key.startswith("akela_"):
        api_key = x_api_key

    if not api_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Valid agent API key required")

    result = await db.execute(select(Agent).where(Agent.api_key == api_key))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
    return agent


async def get_current_orchestrator_jwt(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> Orchestrator:
    """Orchestrators authenticate with JWT — native akela token OR akelahost NestJS token (SSO)."""
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    token = credentials.credentials
    payload = decode_jwt(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    # Native akela token (has orchestrator_id)
    if "orchestrator_id" in payload:
        result = await db.execute(
            select(Orchestrator).where(Orchestrator.id == payload["orchestrator_id"])
        )
        orch = result.scalar_one_or_none()
        if not orch:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Orchestrator not found")
        return orch

    # Akelahost NestJS SSO token (has sub + email) — auto-provision orchestrator
    if "sub" in payload and payload.get("email"):
        email = payload["email"]
        result = await db.execute(select(Orchestrator).where(Orchestrator.email == email))
        orch = result.scalar_one_or_none()
        if not orch:
            orch = Orchestrator(
                name=email.split("@")[0],
                email=email,
                admin_api_key=generate_api_key("alpha"),
                is_admin=bool(payload.get("isAdmin", False)),
            )
            db.add(orch)
            await db.commit()
            await db.refresh(orch)
        return orch

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


# Legacy alias for admin key auth (used by some older routes)
async def get_current_orchestrator(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    db: AsyncSession = Depends(get_db),
) -> Orchestrator:
    """Accepts JWT (native or akelahost SSO) and admin_api_key."""
    token = credentials.credentials if credentials else None

    # Try JWT first (native akela or akelahost SSO)
    if token and not token.startswith("alpha_"):
        payload = decode_jwt(token)
        if payload:
            # Native akela token
            if "orchestrator_id" in payload:
                result = await db.execute(
                    select(Orchestrator).where(Orchestrator.id == payload["orchestrator_id"])
                )
                orch = result.scalar_one_or_none()
                if orch:
                    return orch
            # Akelahost NestJS SSO token
            if "sub" in payload and payload.get("email"):
                email = payload["email"]
                result = await db.execute(select(Orchestrator).where(Orchestrator.email == email))
                orch = result.scalar_one_or_none()
                if not orch:
                    orch = Orchestrator(
                        name=email.split("@")[0],
                        email=email,
                        admin_api_key=generate_api_key("alpha"),
                        is_admin=bool(payload.get("isAdmin", False)),
                    )
                    db.add(orch)
                    await db.commit()
                    await db.refresh(orch)
                return orch

    # Try admin_api_key (Bearer alpha_xxxx or X-API-Key)
    admin_key = token if (token and token.startswith("alpha_")) else x_api_key
    if admin_key:
        result = await db.execute(
            select(Orchestrator).where(Orchestrator.admin_api_key == admin_key)
        )
        orch = result.scalar_one_or_none()
        if orch:
            return orch

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid admin credentials")
