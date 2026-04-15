"""
Web Push subscription endpoints.

Frontend flow:
  1. GET  /push/vapid-public-key      → client uses key to build the
                                        PushSubscription object
  2. POST /push/subscribe             → client registers its subscription
  3. POST /push/test                  → client triggers a test notification
                                        to verify end-to-end
  4. POST /push/unsubscribe           → client removes its subscription
"""

from fastapi import APIRouter, Depends, HTTPException, status, Header
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from api.config import get_settings
from api.db.session import get_db
from api.dependencies import get_current_orchestrator
from api.models.orchestrator import Orchestrator
from api.models.push_subscription import PushSubscription
from api.services.push import send_to_orchestrator

router = APIRouter(prefix="/push", tags=["push"])
settings = get_settings()


class SubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class SubscribeRequest(BaseModel):
    endpoint: str
    keys: SubscriptionKeys


class UnsubscribeRequest(BaseModel):
    endpoint: str


def _check_enabled():
    if not (settings.vapid_public_key and settings.vapid_private_key):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Web Push is not configured on this server (VAPID keys missing).",
        )


@router.get("/vapid-public-key")
async def vapid_public_key():
    """
    Returns the VAPID public key so the client can use it when subscribing.
    Called unauthenticated so the Settings page can show the correct
    'Enable notifications' / 'Not configured' state without waking the
    subscription flow.
    """
    if not settings.vapid_public_key:
        return {"enabled": False, "public_key": None}
    return {"enabled": True, "public_key": settings.vapid_public_key}


@router.post("/subscribe", status_code=status.HTTP_201_CREATED)
async def subscribe(
    data: SubscribeRequest,
    user_agent: Optional[str] = Header(None, alias="User-Agent"),
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    """
    Register (or upsert) a push subscription for the logged-in orchestrator.
    Idempotent: re-subscribing the same endpoint updates the keys instead of
    creating a duplicate row.
    """
    _check_enabled()

    existing = await db.execute(
        select(PushSubscription).where(PushSubscription.endpoint == data.endpoint)
    )
    sub = existing.scalar_one_or_none()

    if sub:
        sub.p256dh = data.keys.p256dh
        sub.auth = data.keys.auth
        sub.orchestrator_id = orch.id
        sub.user_agent = user_agent
    else:
        sub = PushSubscription(
            orchestrator_id=orch.id,
            endpoint=data.endpoint,
            p256dh=data.keys.p256dh,
            auth=data.keys.auth,
            user_agent=user_agent,
        )
        db.add(sub)

    await db.commit()
    await db.refresh(sub)

    return {"id": str(sub.id), "created_at": sub.created_at.isoformat()}


@router.post("/unsubscribe")
async def unsubscribe(
    data: UnsubscribeRequest,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    """Remove a subscription. Scoped to the current orchestrator."""
    await db.execute(
        delete(PushSubscription).where(
            PushSubscription.endpoint == data.endpoint,
            PushSubscription.orchestrator_id == orch.id,
        )
    )
    await db.commit()
    return {"detail": "unsubscribed"}


@router.post("/test")
async def send_test(
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    """
    Deliver a test notification to every subscription registered by the
    current orchestrator. Useful to verify the full plumbing works after
    first-time setup.
    """
    _check_enabled()

    delivered = await send_to_orchestrator(
        orch.id,
        title="Akela — test notification",
        body="If you see this, Web Push is working. 🐺",
        url="/pack/",
        db=db,
    )

    return {"delivered": delivered}


@router.get("/subscriptions")
async def list_subscriptions(
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    """
    List the current orchestrator's subscriptions, for display in Settings.
    """
    result = await db.execute(
        select(PushSubscription).where(PushSubscription.orchestrator_id == orch.id)
    )
    subs = result.scalars().all()
    return [
        {
            "id": str(s.id),
            "user_agent": s.user_agent,
            "created_at": s.created_at.isoformat(),
        }
        for s in subs
    ]
