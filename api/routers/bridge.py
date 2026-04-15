"""
Akela Bridge Routes

These endpoints are what akela-adapter calls:

  GET  /chat/subscribe/agent   — SSE stream (adapter subscribes, Bearer akela_xxx)
  POST /chat/agent-message     — adapter posts agent's LLM response back
  PUT  /agents/bridge/heartbeat — keepalive (Bearer akela_xxx)

Authentication: Authorization: Bearer <akela_api_key>
The api_key is the agent's existing akela_ key, generated on registration.
User copies it from The Pack page and sets AKELA_API_KEY=akela_xxx on their VPS.
"""

import json
import asyncio
from fastapi import APIRouter, Request, Depends
from fastapi.responses import StreamingResponse, JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from api.db.session import get_db
from api.models.agent import Agent, AgentStatus
from api.dependencies import get_current_agent
from api.services.bridge import bridge, BridgeConnection
from datetime import datetime

router = APIRouter(prefix="/api", tags=["bridge"])


# ── SSE Subscribe ──────────────────────────────────────────────────────────────
@router.get("/chat/subscribe/agent")
async def subscribe_agent(
    request: Request,
    current: Agent = Depends(get_current_agent),
    db: AsyncSession = Depends(get_db),
):
    """Remote agent connects here with its akela_ API key to receive tasks over SSE."""
    api_key = current.api_key
    agent_id = str(current.id)
    agent_name = current.name

    # Mark agent online
    current.status = AgentStatus.online
    current.last_seen_at = datetime.utcnow()
    await db.commit()

    queue: asyncio.Queue = asyncio.Queue()

    def send(event: str, data: dict):
        queue.put_nowait(f"event: {event}\ndata: {json.dumps(data)}\n\n")

    conn = BridgeConnection(
        agent_id=agent_id,
        agent_name=agent_name,
        send=send,
        close=lambda: None,
    )
    bridge.register(api_key, conn)

    # Send connected confirmation
    send("message", {"type": "connected", "agent_id": agent_id, "agent_name": agent_name})

    async def event_stream():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    chunk = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield chunk
                except asyncio.TimeoutError:
                    # Keepalive ping
                    yield ": ping\n\n"
        finally:
            bridge.remove(api_key)
            # Mark agent offline
            try:
                result = await db.execute(select(Agent).where(Agent.id == current.id))
                agent = result.scalar_one_or_none()
                if agent:
                    agent.status = AgentStatus.offline
                    await db.commit()
            except Exception:
                pass

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ── Agent Message (response from adapter) ─────────────────────────────────────
@router.post("/chat/agent-message")
async def agent_message(
    request: Request,
    current: Agent = Depends(get_current_agent),
):
    """Remote agent posts its LLM response back after processing a task."""
    body = await request.json()
    task_id = body.get("task_id", "")
    content = body.get("content", "")

    if not content:
        return JSONResponse({"error": "Missing content"}, status_code=400)

    bridge.receive_response(current.api_key, task_id, content)
    return {"status": "received"}


# ── Bridge Heartbeat ──────────────────────────────────────────────────────────
@router.put("/agents/bridge/heartbeat")
async def bridge_heartbeat(
    current: Agent = Depends(get_current_agent),
    db: AsyncSession = Depends(get_db),
):
    """Keepalive from akela-adapter."""
    current.last_seen_at = datetime.utcnow()
    if current.status != AgentStatus.online:
        current.status = AgentStatus.online
    await db.commit()
    connected = bridge.is_connected(current.api_key)
    return {"status": "alive", "name": current.name, "connected": connected}
