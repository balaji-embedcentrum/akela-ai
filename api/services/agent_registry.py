from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import redis.asyncio as aioredis
from api.models.agent import Agent


async def get_agent_by_key(api_key: str, db: AsyncSession) -> Optional[Agent]:
    result = await db.execute(select(Agent).where(Agent.api_key == api_key))
    return result.scalar_one_or_none()


async def get_agent_by_id(agent_id: str, db: AsyncSession) -> Optional[Agent]:
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    return result.scalar_one_or_none()
