"""SSE streaming endpoints — room subscriptions, typing, stream chunks, tool steps."""
import asyncio
import json
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import redis.asyncio as aioredis

from api.db.session import get_db
from api.dependencies import get_current_agent, get_redis
from api.models.agent import Agent
from api.services import pubsub

router = APIRouter(tags=["chat"])

_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
}


@router.get("/chat/subscribe")
async def subscribe(
    room: str = Query(default="general"),
    redis_client: aioredis.Redis = Depends(get_redis),
    current: Agent = Depends(get_current_agent),
):
    """SSE stream — agents receive broadcasts, own @mentions, and system messages."""
    async def event_generator():
        pubsub_conn = redis_client.pubsub()
        await pubsub_conn.subscribe(pubsub.chat_channel(str(current.orchestrator_id), room))
        try:
            while True:
                message = await pubsub_conn.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message and message.get("data"):
                    data = message["data"]
                    try:
                        parsed = json.loads(data)
                        mt = parsed.get("mention_type", "normal")
                        mentions = parsed.get("mentions", [])
                        if mt in ("broadcast", "system", "normal") or mentions:
                            yield f"data: {data}\n\n"
                    except Exception:
                        yield f"data: {data}\n\n"
                await asyncio.sleep(0.05)
        finally:
            await pubsub_conn.unsubscribe()
            await pubsub_conn.close()

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/chat/subscribe/alpha")
async def subscribe_alpha(
    room: str = Query(default="general"),
    token: str = Query(default=""),
    redis_client: aioredis.Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db),
):
    """SSE for Alpha — receives ALL messages + typing events.
    Uses token query param because EventSource can't send headers.
    Sends keepalive every 15s to prevent proxy timeouts.
    """
    from api.services.auth_service import decode_jwt
    payload = decode_jwt(token) if token else None
    if not payload or "orchestrator_id" not in payload:
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Invalid token")

    async def event_generator():
        pubsub_conn = redis_client.pubsub()
        orchestrator_id = payload["orchestrator_id"]
        chat_ch = pubsub.chat_channel(orchestrator_id, room)
        typing_ch = f"typing:{room}"
        await pubsub_conn.subscribe(chat_ch, typing_ch)
        heartbeat_counter = 0
        try:
            while True:
                message = await pubsub_conn.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message and message.get("data"):
                    yield f"data: {message['data']}\n\n"
                    heartbeat_counter = 0
                else:
                    heartbeat_counter += 1
                    if heartbeat_counter >= 15:
                        yield ": heartbeat\n\n"
                        heartbeat_counter = 0
                await asyncio.sleep(0.05)
        finally:
            await pubsub_conn.unsubscribe()
            await pubsub_conn.close()

    return StreamingResponse(event_generator(), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.get("/chat/subscribe/dm-notifications")
async def subscribe_dm_notifications(
    token: str = Query(default=""),
    redis_client: aioredis.Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db),
):
    """SSE for Alpha — lightweight notifications from all DM rooms (for unread badges)."""
    from api.services.auth_service import decode_jwt
    payload = decode_jwt(token) if token else None
    if not payload or "orchestrator_id" not in payload:
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Invalid token")

    async def event_generator():
        pubsub_conn = redis_client.pubsub()
        await pubsub_conn.subscribe("dm:notifications")
        heartbeat_counter = 0
        try:
            while True:
                message = await pubsub_conn.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message and message.get("data"):
                    yield f"data: {message['data']}\n\n"
                    heartbeat_counter = 0
                else:
                    heartbeat_counter += 1
                    if heartbeat_counter >= 15:
                        yield ": heartbeat\n\n"
                        heartbeat_counter = 0
                await asyncio.sleep(0.05)
        finally:
            await pubsub_conn.unsubscribe()
            await pubsub_conn.close()

    return StreamingResponse(event_generator(), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.get("/chat/subscribe/agent")
async def subscribe_agent(
    token: str = Query(..., description="Agent API key for authentication"),
    db: AsyncSession = Depends(get_db),
    redis_client: aioredis.Redis = Depends(get_redis),
):
    """SSE endpoint for agent bridges — subscribe to per-agent notification channel."""
    result = await db.execute(select(Agent).where(Agent.api_key == token))
    agent = result.scalar_one_or_none()
    if not agent:
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Invalid agent API key")

    agent_id = str(agent.id)
    agent_name = agent.name
    notify_channel = f"agent:{agent_id}:notify"

    async def event_stream():
        from api.config import get_settings
        settings = get_settings()
        sub_redis = aioredis.from_url(settings.redis_url, decode_responses=True)
        sub_pubsub = sub_redis.pubsub()

        try:
            await sub_pubsub.subscribe(notify_channel)
            yield f"data: {json.dumps({'type': 'connected', 'agent_id': agent_id, 'agent_name': agent_name, 'channel': notify_channel})}\n\n"

            while True:
                msg = await sub_pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if msg and msg["type"] == "message":
                    yield f"data: {msg['data']}\n\n"
                else:
                    yield ": keepalive\n\n"
                await asyncio.sleep(0.1)

        except asyncio.CancelledError:
            pass
        finally:
            await sub_pubsub.unsubscribe(notify_channel)
            await sub_pubsub.close()
            await sub_redis.close()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@router.post("/chat/typing")
async def typing_indicator(
    current: Agent = Depends(get_current_agent),
    redis_client: aioredis.Redis = Depends(get_redis),
    room: str = "general",
):
    """Agent broadcasts a typing event."""
    event = json.dumps({"type": "typing", "agent_name": current.name, "agent_id": str(current.id)})
    await redis_client.publish(f"typing:{room}", event)
    return {"ok": True}


@router.post("/chat/typing/internal")
async def typing_indicator_internal(
    data: dict,
    redis_client: aioredis.Redis = Depends(get_redis),
):
    """Internal typing indicator for Docker agents — no auth required."""
    agent_name = data.get("agent_name", "unknown")
    room = data.get("room", "general")
    event = json.dumps({"type": "typing", "agent_name": agent_name, "agent_id": agent_name})
    await redis_client.publish(f"typing:{room}", event)
    return {"ok": True}


@router.post("/chat/stream-chunk")
async def stream_chunk_internal(
    data: dict,
    db: AsyncSession = Depends(get_db),
    redis_client: aioredis.Redis = Depends(get_redis),
):
    """Internal endpoint for Docker agents to publish streaming tokens."""
    agent_name = data.get("agent_name", "unknown")
    display_name = data.get("agent_display_name", agent_name)
    room = data.get("room", "general")
    stream_id = data.get("stream_id", "")
    token = data.get("token", "")
    full_text = data.get("full_text", "")

    agent_result = await db.execute(select(Agent).where(Agent.name == agent_name))
    agent = agent_result.scalar_one_or_none()
    orch_id = str(agent.orchestrator_id) if agent and agent.orchestrator_id else ""

    event = {
        "type": "stream_chunk",
        "sender_name": display_name,
        "sender_role": "agent",
        "stream_id": stream_id,
        "token": token,
        "full_text": full_text,
        "room": room,
    }
    await pubsub.publish(pubsub.chat_channel(orch_id, room), event, redis_client)
    return {"ok": True}


@router.post("/chat/stream-end")
async def stream_end_internal(
    data: dict,
    db: AsyncSession = Depends(get_db),
    redis_client: aioredis.Redis = Depends(get_redis),
):
    """Signal that an agent's streaming response is complete, with usage stats."""
    agent_name = data.get("agent_name", "unknown")
    display_name = data.get("agent_display_name", agent_name)
    room = data.get("room", "general")
    stream_id = data.get("stream_id", "")
    usage = data.get("usage", {})
    duration_ms = data.get("duration_ms", 0)
    tokens_per_sec = data.get("tokens_per_sec", 0)

    agent_result = await db.execute(select(Agent).where(Agent.name == agent_name))
    agent = agent_result.scalar_one_or_none()
    orch_id = str(agent.orchestrator_id) if agent and agent.orchestrator_id else ""

    event = {
        "type": "stream_end",
        "sender_name": display_name,
        "sender_role": "agent",
        "stream_id": stream_id,
        "room": room,
        "usage": usage,
        "duration_ms": duration_ms,
        "tokens_per_sec": tokens_per_sec,
    }
    await pubsub.publish(pubsub.chat_channel(orch_id, room), event, redis_client)
    return {"ok": True}


@router.post("/chat/tool-step")
async def tool_step_internal(
    data: dict,
    db: AsyncSession = Depends(get_db),
    redis_client: aioredis.Redis = Depends(get_redis),
):
    """Publish a tool step event (agent started executing a tool) to the room channel."""
    agent_name = data.get("agent_name", "unknown")
    display_name = data.get("agent_display_name", agent_name)
    room = data.get("room", "general")
    stream_id = data.get("stream_id", "")
    tool_name = data.get("tool_name", "")
    preview = data.get("preview", "")

    agent_result = await db.execute(select(Agent).where(Agent.name == agent_name))
    agent = agent_result.scalar_one_or_none()
    orch_id = str(agent.orchestrator_id) if agent and agent.orchestrator_id else ""

    event = {
        "type": "tool_step",
        "sender_name": display_name,
        "sender_role": "agent",
        "stream_id": stream_id,
        "tool_name": tool_name,
        "preview": preview,
        "room": room,
    }
    await pubsub.publish(pubsub.chat_channel(orch_id, room), event, redis_client)
    return {"ok": True}
