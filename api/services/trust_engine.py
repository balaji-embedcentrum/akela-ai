from typing import Optional
import json
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import redis.asyncio as aioredis
from api.config import get_settings
from api.models.trust_event import TrustEvent, AgentTrustScore
from api.models.agent import Agent, AgentRank

TRUST_EVENTS = {
    "task_completed": 5.0,
    "standup_responded": 1.0,
    "no_spam_24hr": 1.0,
    "task_failed": -3.0,
    "auth_failure": -5.0,
    "malformed_request": -2.0,
    "rate_limit_hit": -1.0,
    "no_heartbeat_24hr": -2.0,
}


def get_rank(score: float) -> AgentRank:
    cfg = get_settings()
    if score > cfg.trust_delta_max:
        return AgentRank.beta
    elif score > cfg.trust_omega_max:
        return AgentRank.delta
    else:
        return AgentRank.omega


async def record_event(
    agent_id: str,
    event_type: str,
    db: AsyncSession,
    redis_client: Optional[aioredis.Redis] = None,
    reason: Optional[str] = None,
) -> float:
    delta = TRUST_EVENTS.get(event_type, 0.0)

    # Get or create trust score
    result = await db.execute(
        select(AgentTrustScore).where(AgentTrustScore.agent_id == agent_id)
    )
    trust = result.scalar_one_or_none()
    if not trust:
        trust = AgentTrustScore(agent_id=agent_id, score=get_settings().trust_initial_score)
        db.add(trust)

    trust.score = max(0.0, min(100.0, trust.score + delta))
    trust.updated_at = datetime.utcnow()

    # Record event
    event = TrustEvent(
        agent_id=agent_id,
        event_type=event_type,
        delta=delta,
        reason=reason or event_type,
    )
    db.add(event)

    # Update agent rank
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if agent:
        agent.rank = get_rank(trust.score)

    await db.commit()

    # Update Redis cache
    if redis_client:
        await redis_client.setex(f"trust:{agent_id}", 300, str(trust.score))

    return trust.score
