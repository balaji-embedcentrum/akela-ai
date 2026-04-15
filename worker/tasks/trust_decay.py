from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

async def decay_inactive_agents(db: AsyncSession):
    cutoff = datetime.utcnow() - timedelta(hours=24)
    from api.models.agent import Agent, AgentStatus
    from api.models.trust_event import AgentTrustScore, TrustEvent

    result = await db.execute(
        select(Agent).where(
            Agent.last_seen_at < cutoff,
            Agent.status == AgentStatus.offline,
        )
    )
    agents = result.scalars().all()
    for agent in agents:
        score_result = await db.execute(
            select(AgentTrustScore).where(AgentTrustScore.agent_id == agent.id)
        )
        trust = score_result.scalar_one_or_none()
        if trust:
            trust.score = max(0.0, trust.score - 2.0)
            event = TrustEvent(
                agent_id=agent.id,
                event_type="no_heartbeat_24hr",
                delta=-2.0,
                reason="No heartbeat in 24 hours",
            )
            db.add(event)
    await db.commit()
