"""
Browser-resident local-agent bridge.

Hunt task dispatch for agents with ``protocol == "local"`` cannot go through
endpoint_caller.py (that code is server-side; the user's local agent URL is
in browser localStorage, unreachable from the API server). Instead we route
those dispatches to any open dashboard tab:

    task_queue.py publishes JSON to redis channel  local-agent:{id}:notify
             │
             ▼
    GET  /api/hunt/local/subscribe   (SSE)     ← dashboard <LocalTaskWorker>
             │
             ▼
    Worker receives {task_id, agent_name, ...}, looks up localStorage
    localAgents[agent_name] = {url, bearerToken}, calls
    ${url}/  message/stream  with the task prompt.
             │
             ▼
    POST /api/hunt/local/tasks/{id}/events   ← streamed artifact deltas
    POST /api/hunt/local/tasks/{id}/done     ← terminal state (completed/failed)

Both write-backs publish to the Den chat channel via pubsub so the response
appears in Den as a message from the agent, and update the HuntTask row so
the Hunt board reflects the terminal status.

Auth: user Bearer JWT (same as other dashboard routes). The SSE endpoint
reads the Authorization header via Depends(get_current_orchestrator_jwt).
EventSource can't set headers, so the dashboard worker uses fetch-based
SSE (response.body.getReader()) — which supports arbitrary headers.

Known limitation (tracked in akela-ai#12): no claim lock between multiple
browser tabs. Both tabs will execute the same task. That's acceptable for v1.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid as uuid_lib
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.session import get_db
from api.dependencies import get_current_orchestrator_jwt, get_redis
from api.models.agent import Agent, AgentProtocol  # noqa: F401 — AgentProtocol used in docstring
from api.models.hunt import Epic, HuntTask, Project as HuntProject
from api.models.message import Message, MentionType
from api.models.orchestrator import Orchestrator
from api.services import pubsub


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/hunt/local", tags=["hunt-local"])


# ---------------------------------------------------------------------------
# GET /api/hunt/local/subscribe  (SSE)
# ---------------------------------------------------------------------------

@router.get("/subscribe")
async def subscribe(
    request: Request,
    current: Orchestrator = Depends(get_current_orchestrator_jwt),
    redis_client = Depends(get_redis),
):
    """Subscribe to task_assigned events for the current user's local agents.

    Emits one SSE event per Hunt dispatch:

        event: task_assigned
        data: {"task_id": "...", "agent_id": "...", "agent_name": "...",
               "task_title": "...", "task_description": "...",
               "dispatch_content": "@alpha 🎯 New Task: ...",
               "room": "proj-<pid>"}

    A ": ping\\n\\n" comment is emitted every 25s so proxies don't kill idle
    connections.
    """
    orchestrator_id = str(current.id)

    async def event_stream():
        pubsub_conn = redis_client.pubsub()
        await pubsub_conn.psubscribe("local-agent:*:notify")
        logger.info("[hunt-local] %s subscribed to local-agent:*:notify", orchestrator_id)

        # Initial event so the client knows it's connected.
        yield "event: connected\ndata: {}\n\n"

        last_ping = asyncio.get_event_loop().time()
        try:
            while True:
                if await request.is_disconnected():
                    break

                msg = await pubsub_conn.get_message(
                    ignore_subscribe_messages=True, timeout=5.0
                )
                now = asyncio.get_event_loop().time()

                if msg is not None and msg.get("type") == "pmessage":
                    raw = msg.get("data")
                    if isinstance(raw, bytes):
                        raw = raw.decode()
                    try:
                        event = json.loads(raw)
                    except Exception:
                        continue
                    # Only forward events for agents owned by this orchestrator.
                    if event.get("orchestrator_id") != orchestrator_id:
                        continue
                    payload = {
                        "task_id": event.get("task_id"),
                        "agent_id": event.get("agent_id"),
                        "agent_name": event.get("agent_name"),
                        "task_title": event.get("task_title", ""),
                        "task_description": event.get("task_description", ""),
                        "dispatch_content": event.get("content", ""),
                        "room": event.get("room"),
                    }
                    yield f"event: task_assigned\ndata: {json.dumps(payload)}\n\n"

                # 25s keepalive so reverse proxies don't cull the stream.
                if now - last_ping > 25:
                    yield ": ping\n\n"
                    last_ping = now
        finally:
            try:
                await pubsub_conn.punsubscribe("local-agent:*:notify")
                await pubsub_conn.close()
            except Exception:
                pass
            logger.info("[hunt-local] %s disconnected", orchestrator_id)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ---------------------------------------------------------------------------
# helpers: load + authz a Hunt task belonging to the current orchestrator
# ---------------------------------------------------------------------------

async def _load_owned_task(
    task_id: str,
    orchestrator_id: uuid_lib.UUID,
    db: AsyncSession,
) -> tuple[HuntTask, Agent, str]:
    """Fetch task + agent + the Den room, or 404 if not found / not owned.

    We resolve the room via an explicit query on Epic + HuntProject rather
    than the ``task.epic`` relationship: under SQLAlchemy async, lazy-loaded
    relationships accessed outside the original load raise MissingGreenlet.
    The explicit query is how the rest of the codebase already does it
    (see task_queue._publish_task_status).
    """
    try:
        task_uuid = uuid_lib.UUID(task_id)
    except ValueError:
        raise HTTPException(400, "Invalid task_id")

    task_r = await db.execute(select(HuntTask).where(HuntTask.id == task_uuid))
    task = task_r.scalar_one_or_none()
    if not task or not task.assignee_id:
        raise HTTPException(404, "Task not found")

    agent_r = await db.execute(select(Agent).where(Agent.id == task.assignee_id))
    agent = agent_r.scalar_one_or_none()
    if not agent or agent.orchestrator_id != orchestrator_id:
        raise HTTPException(404, "Task not found")

    # Resolve the Den room for this task (proj-<hp.project_id>) without
    # touching task.epic / epic.project (async-lazy hazard).
    room = ""
    if task.epic_id:
        epic_r = await db.execute(select(Epic).where(Epic.id == task.epic_id))
        epic = epic_r.scalar_one_or_none()
        if epic:
            hp_r = await db.execute(
                select(HuntProject).where(HuntProject.id == epic.project_id)
            )
            hp = hp_r.scalar_one_or_none()
            if hp and hp.project_id:
                room = f"proj-{hp.project_id}"

    return task, agent, room


# ---------------------------------------------------------------------------
# POST /api/hunt/local/tasks/{id}/events
# ---------------------------------------------------------------------------

class EventPayload(BaseModel):
    """A single delta posted by the browser worker while the task runs."""

    artifact_text: str | None = Field(
        default=None,
        description="Accumulated assistant text so far. Each POST replaces the previous delta.",
    )
    tool_call: str | None = Field(
        default=None,
        description="Name of a tool the agent just invoked (shown as a status marker in Den).",
    )
    seq: int = Field(default=0, description="Monotonic sequence within this task.")


@router.post("/tasks/{task_id}/events")
async def post_event(
    task_id: str,
    payload: EventPayload,
    current: Orchestrator = Depends(get_current_orchestrator_jwt),
    db: AsyncSession = Depends(get_db),
    redis_client = Depends(get_redis),
):
    """Forward a streamed artifact delta to Den so users see live progress."""
    task, agent, room = await _load_owned_task(task_id, current.id, db)

    if not (payload.artifact_text or payload.tool_call):
        return {"status": "noop"}

    # We intentionally DON'T persist every delta as a DB Message — too chatty.
    # The final text lands in Den via /done. Here we publish a lightweight
    # ephemeral event so any open Den tab can show "alpha is typing…"-style
    # progress if it wants to.
    if room:
        chunk_event = {
            "type": "agent_chunk",
            "agent_id": str(agent.id),
            "agent_name": agent.name,
            "task_id": str(task.id),
            "text": payload.artifact_text or "",
            "tool_call": payload.tool_call or "",
            "seq": payload.seq,
            "room": room,
        }
        await pubsub.publish(
            pubsub.chat_channel(str(current.id), room), chunk_event, redis_client
        )

    return {"status": "ok"}


# ---------------------------------------------------------------------------
# POST /api/hunt/local/tasks/{id}/done
# ---------------------------------------------------------------------------

class DonePayload(BaseModel):
    """Terminal status for a local-agent task.

    ``state`` follows A2A v0.4.x: ``completed`` maps to Hunt status ``done``,
    anything else (``failed``, ``cancelled``) maps to ``blocked``.
    """

    state: str = Field(..., description="A2A-style terminal state")
    final_text: str = Field(default="", description="Full assistant response")
    error: str = Field(default="", description="Failure reason if state != completed")


@router.post("/tasks/{task_id}/done")
async def post_done(
    task_id: str,
    payload: DonePayload,
    current: Orchestrator = Depends(get_current_orchestrator_jwt),
    db: AsyncSession = Depends(get_db),
    redis_client = Depends(get_redis),
):
    """Mark a local-agent Hunt task as terminal and post its response to Den."""
    task, agent, room = await _load_owned_task(task_id, current.id, db)

    # 1. Persist the final assistant response as a Message from the agent
    #    so the Den conversation shows the answer.
    if payload.final_text and room:
        resp_msg = Message(
            orchestrator_id=current.id,
            agent_id=agent.id,
            sender_name=agent.name,
            sender_role="agent",
            room=room,
            content=payload.final_text,
            mentions=[],
            mention_type=MentionType.normal,
        )
        db.add(resp_msg)
        await db.commit()
        await db.refresh(resp_msg)

        await pubsub.publish(
            pubsub.chat_channel(str(current.id), room),
            {
                "type": "message",
                "id": str(resp_msg.id),
                "agent_id": str(agent.id),
                "sender_name": agent.name,
                "sender_role": "agent",
                "content": payload.final_text,
                "mention_type": "normal",
                "mentions": [],
                "room": room,
                "created_at": resp_msg.created_at.strftime("%Y-%m-%dT%H:%M:%S") + "Z",
            },
            redis_client,
        )

    # 2. Update the HuntTask + post the "✅ Task completed" system message
    #    — exactly what endpoint_caller does for remote agents. Keeps the
    #    board in sync and advances the queue to the next task for this agent.
    from api.services.endpoint_caller import _update_hunt_task

    new_status = "done" if payload.state == "completed" else "blocked"
    await _update_hunt_task(
        task_id=str(task.id),
        new_status=new_status,
        agent=agent,
        room=room,
        orchestrator_id=str(current.id),
        db=db,
        redis_client=redis_client,
    )

    return {"status": "ok", "task_status": new_status}
