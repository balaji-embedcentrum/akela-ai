from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

async def mark_stale_agents_offline(db: AsyncSession):
    cutoff = datetime.utcnow() - timedelta(seconds=30)
    from api.models.agent import Agent, AgentStatus
    await db.execute(
        update(Agent)
        .where(Agent.last_seen_at < cutoff, Agent.status == AgentStatus.online)
        .values(status=AgentStatus.offline)
    )
    await db.commit()
