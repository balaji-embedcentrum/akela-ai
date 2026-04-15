"""
Web Push delivery service.

Sends Web Push notifications to all of an orchestrator's registered
subscriptions using pywebpush + VAPID authentication. Subscriptions that
return 404/410 from the push service are automatically deleted — those
are permanently dead (user uninstalled the PWA, revoked permission, or
changed browsers).

Usage from other routers/services:

    from api.services.push import send_to_orchestrator
    await send_to_orchestrator(
        orchestrator_id,
        title="Task completed",
        body="Hermione finished task #42",
        url="/pack/hunt",
        db=db,
    )

If VAPID keys are not configured in settings, calls are no-ops (logged
at WARN level) — the rest of the app keeps working, push just doesn't
deliver. This mirrors the behavior where GitHub OAuth is optional.
"""

import json
import logging
import uuid
from typing import Optional

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import get_settings
from api.models.push_subscription import PushSubscription

logger = logging.getLogger(__name__)
settings = get_settings()


def _vapid_configured() -> bool:
    return bool(settings.vapid_private_key and settings.vapid_public_key)


async def send_to_orchestrator(
    orchestrator_id: uuid.UUID | str,
    *,
    title: str,
    body: str,
    url: str = "/pack/",
    tag: Optional[str] = None,
    require_interaction: bool = False,
    db: AsyncSession,
) -> int:
    """
    Deliver a push notification to every subscription owned by an
    orchestrator. Returns the number of successful deliveries.

    Dead subscriptions (404/410 from the push service) are removed from
    the database transparently — nothing calls this function needs to
    know about subscription lifecycle.
    """
    if not _vapid_configured():
        logger.warning(
            "push.send_to_orchestrator: VAPID keys not configured, skipping "
            "(title=%r orchestrator_id=%s)", title, orchestrator_id,
        )
        return 0

    # pywebpush is a sync library — import locally so the rest of the app
    # doesn't pay the cost if Web Push is never used.
    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        logger.warning("pywebpush not installed; run `pip install pywebpush`")
        return 0

    if isinstance(orchestrator_id, str):
        orchestrator_id = uuid.UUID(orchestrator_id)

    result = await db.execute(
        select(PushSubscription).where(PushSubscription.orchestrator_id == orchestrator_id)
    )
    subs = list(result.scalars().all())

    if not subs:
        return 0

    payload = json.dumps({
        "title": title,
        "body": body,
        "url": url,
        "tag": tag or "akela",
        "requireInteraction": require_interaction,
    })

    vapid_claims = {"sub": settings.vapid_subject}

    sent = 0
    dead_endpoints: list[str] = []

    for sub in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=payload,
                vapid_private_key=settings.vapid_private_key,
                vapid_claims=dict(vapid_claims),  # webpush mutates the dict
                ttl=86400,  # 24h — push service may hold briefly for offline devices
            )
            sent += 1
        except WebPushException as e:
            # 404/410 = gone permanently, remove from DB.
            # Other errors (network, 5xx) = transient, leave the subscription.
            status = getattr(getattr(e, "response", None), "status_code", None)
            if status in (404, 410):
                logger.info("push: dropping dead subscription %s (%s)", sub.id, status)
                dead_endpoints.append(sub.endpoint)
            else:
                logger.warning("push: delivery failed for %s: %s", sub.id, e)
        except Exception as e:
            logger.warning("push: unexpected error for %s: %s", sub.id, e)

    if dead_endpoints:
        await db.execute(
            delete(PushSubscription).where(PushSubscription.endpoint.in_(dead_endpoints))
        )
        await db.commit()

    return sent
