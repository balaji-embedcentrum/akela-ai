from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import redis.asyncio as aioredis
from api.db.session import get_db
from api.dependencies import get_current_agent, get_redis
from api.models.agent import Agent
from api.models.trust_event import AgentTrustScore

router = APIRouter(prefix="/trust", tags=["trust"])


@router.get("/me")
async def my_trust(
    current: Agent = Depends(get_current_agent),
    db: AsyncSession = Depends(get_db),
    redis_client: aioredis.Redis = Depends(get_redis),
):
    cached = await redis_client.get(f"trust:{current.id}")
    if cached:
        score = float(cached)
    else:
        result = await db.execute(select(AgentTrustScore).where(AgentTrustScore.agent_id == current.id))
        trust = result.scalar_one_or_none()
        score = trust.score if trust else 50.0

    return {"agent_id": str(current.id), "score": score, "rank": current.rank}


@router.get("/leaderboard")
async def leaderboard(
    current: Agent = Depends(get_current_agent),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Agent, AgentTrustScore)
        .join(AgentTrustScore, Agent.id == AgentTrustScore.agent_id)
        .where(Agent.orchestrator_id == current.orchestrator_id)
        .order_by(AgentTrustScore.score.desc())
    )
    rows = result.all()
    return [
        {"agent": a.name, "rank": a.rank, "score": t.score}
        for a, t in rows
    ]
