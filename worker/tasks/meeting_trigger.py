from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import redis.asyncio as aioredis

async def trigger_all_standups(db: AsyncSession, redis_client: aioredis.Redis):
    from api.models.orchestrator import Orchestrator
    result = await db.execute(select(Orchestrator))
    orchestrators = result.scalars().all()
    for orch in orchestrators:
        await redis_client.publish(
            f"akela:meetings:{orch.id}",
            '{"type": "standup_prompt", "message": "The Howl begins. Report your capacity and blockers."}'
        )
