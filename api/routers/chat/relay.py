"""
Relay endpoint — persists agent responses delivered by the browser.

When an agent runs on the user's local machine, the browser calls the
agent directly (browser → localhost:8634) instead of going through the
server-side endpoint_caller. After the browser finishes streaming the
response, it POSTs the full text here so it's saved in the database and
shows up in chat history on reload.

This endpoint does NOT publish to Redis pub/sub — the browser already
rendered the message in the Den. Broadcasting would cause a duplicate
delivery via SSE to other tabs, but `addMessage` deduplicates by `msg.id`
so it's harmless if it ever happens. Keeping it clean: relay → save → done.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from api.db.session import get_db
from api.dependencies import get_current_orchestrator
from api.models.orchestrator import Orchestrator
from api.models.agent import Agent
from api.models.message import Message, MentionType
from api.schemas.chat import MessageResponse

router = APIRouter(tags=["chat"])


class RelayRequest(BaseModel):
    agent_name: str
    content: str
    room: str = "general"
    msg_metadata: Optional[dict] = None


@router.post("/chat/relay", response_model=MessageResponse)
async def relay_local_agent_message(
    data: RelayRequest,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    """
    Persist a local agent's response.

    Called by the browser after streaming a response directly from a
    localhost agent. Authenticated via JWT (same as other chat endpoints).
    """
    if not data.content.strip():
        raise HTTPException(status_code=400, detail="Empty content")

    # Try to find the agent by name so we can link agent_id properly.
    # Tolerate not-found — local-only agents may not be registered on
    # the server at all.
    agent_id = None
    result = await db.execute(
        select(Agent).where(
            Agent.orchestrator_id == orch.id,
            Agent.name == data.agent_name,
        )
    )
    agent = result.scalar_one_or_none()
    if agent:
        agent_id = str(agent.id)

    msg = Message(
        orchestrator_id=orch.id,
        agent_id=agent_id,
        sender_name=data.agent_name,
        sender_role="agent",
        room=data.room,
        content=data.content,
        mentions=[],
        mention_type=MentionType.normal,
        msg_metadata=data.msg_metadata,
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)

    return MessageResponse.model_validate(msg)
