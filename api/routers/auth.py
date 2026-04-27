import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from api.db.session import get_db
from api.models.orchestrator import Orchestrator
from api.services.auth_service import (
    generate_api_key, get_github_user, get_google_user, create_jwt,
    verify_admin_credentials
)
from api.dependencies import get_current_orchestrator
from api.config import get_settings

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Phase 1: Simple username/password login for the Orchestrator (Alpha)."""
    if not verify_admin_credentials(data.username, data.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # Get or create the admin orchestrator
    result = await db.execute(select(Orchestrator).where(Orchestrator.username == data.username))
    orch = result.scalar_one_or_none()

    if not orch:
        orch = Orchestrator(
            username=data.username,
            name="Alpha",
            admin_api_key=generate_api_key("alpha"),
            is_admin=True,
        )
        db.add(orch)
        await db.commit()
        await db.refresh(orch)

    token = create_jwt({"orchestrator_id": str(orch.id), "username": orch.username, "role": "alpha"})
    return {
        "access_token": token,
        "token_type": "bearer",
        "orchestrator_id": str(orch.id),
        "name": orch.name,
        "admin_api_key": orch.admin_api_key,
        "role": "alpha",
    }


@router.get("/me")
async def get_me(orch: Orchestrator = Depends(get_current_orchestrator)):
    return {
        "id": str(orch.id),
        "name": orch.name,
        "username": orch.username,
        "role": "alpha",
        "admin_api_key": orch.admin_api_key,
    }


@router.post("/logout")
async def logout():
    # JWT is stateless; client discards token
    return {"detail": "Logged out. The Alpha rests."}


# Phase 2: GitHub OAuth
@router.get("/github")
async def github_login():
    url = (
        f"https://github.com/login/oauth/authorize"
        f"?client_id={settings.github_client_id}"
        f"&redirect_uri={settings.github_redirect_uri}"
        f"&scope=read:user,user:email"
    )
    return RedirectResponse(url)


@router.get("/github/callback")
async def github_callback(code: str, db: AsyncSession = Depends(get_db)):
    from urllib.parse import urlencode
    try:
        user = await get_github_user(code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    github_id = str(user.get("id"))
    result = await db.execute(select(Orchestrator).where(Orchestrator.github_id == github_id))
    orch = result.scalar_one_or_none()

    if not orch:
        orch = Orchestrator(
            github_id=github_id,
            name=user.get("name") or user.get("login", "Unknown"),
            username=user.get("login", ""),
            email=user.get("email"),
            admin_api_key=generate_api_key("alpha"),
        )
        db.add(orch)
        await db.commit()
        await db.refresh(orch)

    token = create_jwt({"orchestrator_id": str(orch.id), "role": "alpha"})
    params = urlencode({
        "token": token,
        "orchestrator_id": str(orch.id),
        "name": orch.name or "",
        "username": orch.username or "",
        "admin_api_key": orch.admin_api_key,
    })
    return RedirectResponse(url=f"/pack/login?{params}")


# Google OAuth
@router.get("/google")
async def google_login():
    from urllib.parse import urlencode
    params = urlencode({
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "online",
        "prompt": "select_account",
    })
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{params}")


@router.get("/google/callback")
async def google_callback(code: str, db: AsyncSession = Depends(get_db)):
    from urllib.parse import urlencode
    try:
        user = await get_google_user(code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    google_id = str(user.get("sub", ""))
    if not google_id:
        raise HTTPException(status_code=400, detail="Google account missing identifier")

    result = await db.execute(select(Orchestrator).where(Orchestrator.google_id == google_id))
    orch = result.scalar_one_or_none()

    if not orch:
        email = user.get("email") or ""
        # Derive a username — Google has no handle, so use the email local-part.
        username = email.split("@", 1)[0] if email else f"google_{google_id[:8]}"
        orch = Orchestrator(
            google_id=google_id,
            name=user.get("name") or username,
            username=username,
            email=email or None,
            admin_api_key=generate_api_key("alpha"),
        )
        db.add(orch)
        await db.commit()
        await db.refresh(orch)

    token = create_jwt({"orchestrator_id": str(orch.id), "role": "alpha"})
    params = urlencode({
        "token": token,
        "orchestrator_id": str(orch.id),
        "name": orch.name or "",
        "username": orch.username or "",
        "admin_api_key": orch.admin_api_key,
    })
    return RedirectResponse(url=f"/pack/login?{params}")
