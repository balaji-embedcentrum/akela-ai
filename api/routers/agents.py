import uuid
from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import redis.asyncio as aioredis
from api.db.session import get_db
from api.dependencies import get_current_orchestrator, get_current_agent, get_redis
from api.models.agent import Agent, AgentStatus, AgentProtocol
from api.models.orchestrator import Orchestrator
from api.models.trust_event import AgentTrustScore
from api.schemas.agent import AgentRegister, AgentResponse, AgentRegistered, AgentUpdate, AgentCardResponse
from api.services.auth_service import generate_api_key

router = APIRouter(prefix="/agents", tags=["agents"])


@router.post("/register", response_model=AgentRegistered)
async def register_agent(
    data: AgentRegister,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    # Idempotent: return existing agent if same name for this orchestrator
    existing = await db.execute(
        select(Agent).where(Agent.orchestrator_id == orch.id, Agent.name == data.name)
    )
    found = existing.scalar_one_or_none()
    if found:
        return AgentRegistered.model_validate(found)

    agent = Agent(
        orchestrator_id=orch.id,
        name=data.name,
        api_key=generate_api_key("akela"),
        endpoint_url=data.endpoint_url,
        protocol=data.protocol,
        soul=data.soul,
        skills=data.skills,
        status=AgentStatus.offline,
    )
    db.add(agent)
    await db.flush()

    trust = AgentTrustScore(agent_id=agent.id, score=50.0)
    db.add(trust)
    await db.commit()
    await db.refresh(agent)

    return AgentRegistered.model_validate(agent)


@router.get("/", response_model=List[AgentResponse])
async def list_agents(
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Agent).where(Agent.orchestrator_id == orch.id))
    return [AgentResponse.model_validate(a) for a in result.scalars().all()]


@router.get("/{agent_id}", response_model=AgentResponse)
async def get_agent(
    agent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: Agent = Depends(get_current_agent),
):
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return AgentResponse.model_validate(agent)


@router.put("/{agent_id}/heartbeat")
async def heartbeat(
    agent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current: Agent = Depends(get_current_agent),
    redis_client: aioredis.Redis = Depends(get_redis),
):
    if current.id != agent_id:
        raise HTTPException(status_code=403, detail="Can only send your own heartbeat")
    current.status = AgentStatus.online
    current.last_seen_at = datetime.utcnow()
    await db.commit()
    await redis_client.setex(f"agent:{agent_id}:online", 30, "1")
    return {"status": "alive", "rank": current.rank}


@router.put("/internal/heartbeat/{agent_name}")
async def internal_heartbeat(
    agent_name: str,
    files_port: int = Query(default=0),
    endpoint_url: str = Query(default=""),
    db: AsyncSession = Depends(get_db),
    redis_client: aioredis.Redis = Depends(get_redis),
):
    """Internal heartbeat for Docker agents — no auth required (network-only access)."""
    result = await db.execute(select(Agent).where(Agent.name == agent_name))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_name}' not found")
    agent.status = AgentStatus.online
    agent.last_seen_at = datetime.utcnow()
    if endpoint_url:
        agent.endpoint_url = endpoint_url
    elif files_port > 0:
        agent.endpoint_url = f"fb:{files_port}"
    await db.commit()
    await redis_client.setex(f"agent:{agent.id}:online", 60, "1")
    return {"status": "alive", "agent_id": str(agent.id), "name": agent.name}


@router.delete("/{agent_id}")
async def deregister_agent(
    agent_id: uuid.UUID,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Agent).where(Agent.id == agent_id, Agent.orchestrator_id == orch.id)
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    await db.delete(agent)
    await db.commit()
    return {"detail": "Agent removed from the pack"}


@router.put("/{agent_id}", response_model=AgentResponse)
async def update_agent(
    agent_id: uuid.UUID,
    data: AgentUpdate,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Agent).where(Agent.id == agent_id, Agent.orchestrator_id == orch.id)
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    if data.display_name is not None:
        agent.display_name = data.display_name
    if data.skills is not None:
        agent.skills = data.skills
    if data.rank is not None:
        agent.rank = data.rank
    if data.endpoint_url is not None:
        agent.endpoint_url = data.endpoint_url
    if data.soul is not None:
        agent.soul = data.soul
    if data.protocol is not None:
        agent.protocol = data.protocol
    if data.bearer_token is not None:
        agent.bearer_token = data.bearer_token or None  # empty string → NULL

    await db.commit()
    await db.refresh(agent)
    return AgentResponse.model_validate(agent)


@router.post("/discover-url", response_model=AgentCardResponse)
async def discover_url(
    body: dict,
    orch: Orchestrator = Depends(get_current_orchestrator),
):
    """Discover agent metadata from any URL — tries A2A, then ACP."""
    url = (body.get("url") or "").strip()
    protocol = (body.get("protocol") or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="url is required")

    # If protocol is specified, try only that one
    if protocol == "acp":
        from api.services.acp_caller import fetch_acp_agent_card
        card = await fetch_acp_agent_card(url)
    elif protocol == "a2a":
        from api.services.a2a_caller import fetch_agent_card
        card = await fetch_agent_card(url)
    else:
        # Auto-detect: try A2A first, then ACP
        from api.services.a2a_caller import fetch_agent_card
        from api.services.acp_caller import fetch_acp_agent_card
        card = await fetch_agent_card(url) or await fetch_acp_agent_card(url)

    if card is None:
        raise HTTPException(status_code=502, detail="Could not fetch Agent Card from endpoint")
    return card


@router.get("/{agent_id}/discover", response_model=AgentCardResponse)
async def discover_agent_card(
    agent_id: uuid.UUID,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    """Fetch agent card from the agent's endpoint, using its configured protocol."""
    result = await db.execute(
        select(Agent).where(Agent.id == agent_id, Agent.orchestrator_id == orch.id)
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if not agent.endpoint_url:
        raise HTTPException(status_code=400, detail="Agent has no endpoint URL configured")

    if agent.protocol == AgentProtocol.acp:
        from api.services.acp_caller import fetch_acp_agent_card
        card = await fetch_acp_agent_card(agent.endpoint_url)
    else:
        from api.services.a2a_caller import fetch_agent_card
        card = await fetch_agent_card(agent.endpoint_url)

    if card is None:
        raise HTTPException(status_code=502, detail="Could not fetch Agent Card from endpoint")
    return card


@router.post("/{agent_id}/regenerate-key", response_model=AgentRegistered)
async def regenerate_key(
    agent_id: uuid.UUID,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Agent).where(Agent.id == agent_id, Agent.orchestrator_id == orch.id)
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    agent.api_key = generate_api_key("akela")
    await db.commit()
    await db.refresh(agent)
    return AgentRegistered.model_validate(agent)
