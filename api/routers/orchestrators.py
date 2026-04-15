from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from api.db.session import get_db
from api.models.orchestrator import Orchestrator
from api.models.agent import Agent, AgentStatus
from api.models.hunt import HuntTask
from api.dependencies import get_current_orchestrator

router = APIRouter(prefix="/orchestrators", tags=["orchestrators"])


@router.get("/me")
async def get_my_profile(orch: Orchestrator = Depends(get_current_orchestrator)):
    return {
        "id": str(orch.id),
        "name": orch.name,
        "username": orch.username,
        "email": orch.email,
        "admin_api_key": orch.admin_api_key,
        "created_at": orch.created_at,
        "role": "alpha",
    }


@router.get("/stats")
async def get_stats(
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    """Dashboard stats."""
    total_agents = await db.scalar(select(func.count(Agent.id)).where(Agent.orchestrator_id == orch.id))
    online_agents = await db.scalar(select(func.count(Agent.id)).where(
        Agent.orchestrator_id == orch.id,
        Agent.status == AgentStatus.online
    ))
    active_tasks = await db.scalar(select(func.count(HuntTask.id)).where(
        HuntTask.orchestrator_id == orch.id,
        HuntTask.status.in_(["todo", "in_progress", "review"])
    ))
    done_tasks = await db.scalar(select(func.count(HuntTask.id)).where(
        HuntTask.orchestrator_id == orch.id,
        HuntTask.status == "done"
    ))
    return {
        "total_agents": total_agents or 0,
        "online_agents": online_agents or 0,
        "active_tasks": active_tasks or 0,
        "done_tasks": done_tasks or 0,
    }
