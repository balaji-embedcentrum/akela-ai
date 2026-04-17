"""
Endpoint Caller — dispatches tasks to agents and handles responses.

Flow per protocol:
  A2A   → tasks/sendSubscribe (streaming) → TaskState drives HuntTask status
  OpenAI → /v1/chat/completions streaming  → text pattern drives HuntTask status (legacy)

Task status mapping:
  A2A completed → HuntTask done
  A2A failed    → HuntTask blocked
  A2A working (stream dropped, poll inconclusive) → HuntTask blocked (timeout job catches it)
  OpenAI "done task: X" → HuntTask done
  OpenAI "blocked task: X" → HuntTask blocked
"""

import json
import re
import uuid
import asyncio
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from api.models.agent import Agent, AgentStatus, AgentProtocol
from api.models.message import Message, MentionType
from api.services import pubsub
from api.services.protocol_base import BaseAgentCaller
from api.schemas.agent import AgentCardResponse
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class OpenAICaller(BaseAgentCaller):
    """OpenAI-compatible protocol implementation (/v1/chat/completions)."""

    @classmethod
    async def fetch_card(cls, endpoint_url: str) -> AgentCardResponse | None:
        """OpenAI endpoints have no agent card; return None."""
        return None

    @classmethod
    async def ping(cls, endpoint_url: str) -> bool:
        return await ping_endpoint(endpoint_url, AgentProtocol.openai)


# Pattern matching for OpenAI-protocol agents only
_HUNT_DONE_PATTERN = re.compile(r"(?:task\s+done|done\s+task)[:\s]+(.+)", re.IGNORECASE)
_HUNT_BLOCKED_PATTERN = re.compile(r"(?:task\s+blocked|blocked\s+task)[:\s]+(.+)", re.IGNORECASE)
# Strip <think>...</think> blocks before pattern matching only
_THINK_PATTERN = re.compile(r"<think>.*?</think>", re.DOTALL)

# Active streaming tasks: keyed by "{agent_id}:{room}" → asyncio.Task
_active_tasks: dict[str, "asyncio.Task"] = {}


def _strip_think(text: str) -> str:
    """Remove <think>...</think> blocks — used only for pattern matching, not for display."""
    return _THINK_PATTERN.sub("", text).strip()


async def build_history(
    room: str,
    agent_name: str,
    db: AsyncSession,
    limit: int = 6,
) -> list[dict]:
    """Fetch last N messages in this room and build an OpenAI-compatible history.

    Each agent lives in its own private bubble per room: it sees messages
    from the orchestrator (``alpha``) and from its own prior turns, but never
    from other agents in the same room. This is intentional — if an agent
    saw other agents' messages, it would reference or @-mention them and
    trigger runaway cross-agent chatter. Dispatching decides who gets to
    speak; history only reconstructs what the called agent already lived.

    - Messages from ``alpha`` → ``user`` turns (even if addressed at another
      agent in the room — the orchestrator's voice is shared context).
    - Messages from *this* agent → ``assistant`` turns.
    - Messages from *other* agents → skipped entirely.
    - Consecutive same-role turns are merged by concatenation so the sequence
      strictly alternates user/assistant, which OpenAI-compatible endpoints
      require. This preserves content instead of dropping earlier messages
      (the old replace-on-collision logic lost rapid-fire orchestrator turns).
    - Leading assistant turns are dropped (OpenAI-compat expects user first).

    The default window is intentionally small (6 messages). Larger windows
    create a quadratic token-cost curve on long conversations because the
    full prefix is re-sent on every turn.
    """
    from sqlalchemy import select as sa_select
    result = await db.execute(
        sa_select(Message)
        .where(Message.room == room)
        .order_by(Message.created_at.desc())
        .limit(limit)
    )
    msgs = list(reversed(result.scalars().all()))

    raw: list[dict] = []
    for m in msgs:
        content = (m.content or "").strip()
        if not content:
            continue
        if m.sender_role == "alpha":
            raw.append({"role": "user", "content": content})
        elif m.sender_role == "agent" and m.sender_name == agent_name:
            raw.append({"role": "assistant", "content": content})
        # Other agents' messages and system messages are intentionally skipped.

    # Merge consecutive same-role turns by concatenation (not replacement).
    # This preserves rapid-fire messages from the orchestrator instead of
    # dropping all but the last one.
    history: list[dict] = []
    for turn in raw:
        if history and history[-1]["role"] == turn["role"]:
            history[-1]["content"] = history[-1]["content"] + "\n\n" + turn["content"]
        else:
            history.append(turn)

    while history and history[0]["role"] == "assistant":
        history.pop(0)

    return history


async def call_endpoint_streaming(
    endpoint_url: str,
    content: str,
    agent_name: str,
    room: str,
    redis_client,
    history: list[dict] | None = None,
    orchestrator_id: str = "",
    attachments: list[dict] | None = None,
    bearer_token: str | None = None,
) -> tuple[str, dict, str]:
    """
    Call OpenAI-compatible /v1/chat/completions with stream=True.
    Returns (full_text, meta, stream_id).
    """
    url = f"{endpoint_url.rstrip('/')}/v1/chat/completions"
    stream_id = str(uuid.uuid4())[:8]
    start_ts = datetime.utcnow()

    # Build user message — multipart if attachments present
    if attachments:
        user_content: list[dict] = [{"type": "text", "text": content}]
        for att in attachments:
            mime = att.get("type", "")
            b64 = att.get("base64", "")
            name = att.get("name", "file")
            if mime.startswith("image/"):
                user_content.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime};base64,{b64}"},
                })
            else:
                # Non-image: decode and inline as text
                import base64 as _b64
                try:
                    text_content = _b64.b64decode(b64).decode("utf-8", errors="replace")
                except Exception:
                    text_content = b64
                user_content.append({
                    "type": "text",
                    "text": f"\n[Attachment: {name}]\n{text_content}",
                })
        user_msg: dict = {"role": "user", "content": user_content}
    else:
        user_msg = {"role": "user", "content": content}

    messages = list(history or []) + [user_msg]
    payload = {"messages": messages, "stream": True}

    full_text = ""
    tool_calls = []
    usage = {}
    model = ""
    # Track announced tool calls by index (standard OpenAI format)
    _announced_tool_idxs: set[int] = set()

    req_headers: dict[str, str] = {"Content-Type": "application/json"}
    if bearer_token:
        req_headers["Authorization"] = f"Bearer {bearer_token}"

    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream("POST", url, json=payload, headers=req_headers) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                if raw == "[DONE]":
                    break
                try:
                    chunk = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                if chunk.get("usage"):
                    usage = chunk["usage"]
                if chunk.get("model") and not model:
                    model = chunk["model"]

                choices = chunk.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}

                # Hermes-specific tool_use format
                if "tool_use" in delta:
                    tool_name = delta["tool_use"].get("name", "")
                    preview = delta["tool_use"].get("preview", "")
                    tool_calls.append({"name": tool_name, "preview": preview})
                    await redis_client.publish(
                        pubsub.chat_channel(orchestrator_id, room),
                        json.dumps({
                            "type": "tool_step",
                            "stream_id": stream_id,
                            "sender_name": agent_name,
                            "tool_name": tool_name,
                            "preview": preview,
                        }),
                    )
                    continue

                # Standard OpenAI tool_calls streaming format
                if delta.get("tool_calls"):
                    for tc in delta["tool_calls"]:
                        idx = tc.get("index", 0)
                        tool_name = (tc.get("function") or {}).get("name", "")
                        if tool_name and idx not in _announced_tool_idxs:
                            _announced_tool_idxs.add(idx)
                            tool_calls.append({"name": tool_name, "preview": ""})
                            await redis_client.publish(
                                pubsub.chat_channel(orchestrator_id, room),
                                json.dumps({
                                    "type": "tool_step",
                                    "stream_id": stream_id,
                                    "sender_name": agent_name,
                                    "tool_name": tool_name,
                                    "preview": "",
                                }),
                            )
                    continue

                text_delta = delta.get("content") or ""
                if not text_delta:
                    continue
                full_text += text_delta
                await redis_client.publish(
                    pubsub.chat_channel(orchestrator_id, room),
                    json.dumps({
                        "type": "stream_chunk",
                        "stream_id": stream_id,
                        "sender_name": agent_name,
                        "full_text": full_text,
                    }),
                )

    duration_ms = (datetime.utcnow() - start_ts).total_seconds() * 1000
    completion_tokens = usage.get("completion_tokens", 0)
    tokens_per_sec = round(completion_tokens / (duration_ms / 1000), 1) if completion_tokens and duration_ms > 0 else 0.0

    meta = {
        "usage": {**usage, "model": model},
        "tokens_per_sec": tokens_per_sec,
        "duration_ms": round(duration_ms),
        "model": model,
        "tool_calls": tool_calls,
    }
    return full_text, meta, stream_id


async def _update_hunt_task(
    task_id: str,
    new_status: str,
    agent: Agent,
    room: str,
    orchestrator_id: str,
    db: AsyncSession,
    redis_client,
) -> None:
    """Mark a HuntTask done or blocked, post system message, advance queue if done."""
    from api.models.hunt import HuntTask
    from api.services.task_queue import advance_queue

    if not task_id:
        return

    try:
        task_uuid = uuid.UUID(task_id)
    except ValueError:
        return

    task_result = await db.execute(
        select(HuntTask).where(
            HuntTask.id == task_uuid,
            HuntTask.assignee_id == agent.id,
            HuntTask.status == "in_progress",
        )
    )
    task = task_result.scalar_one_or_none()
    if not task:
        return

    task_id_str = str(task.id)
    task.status = new_status
    await db.commit()

    # Notify Hunt board
    from api.services.task_queue import _publish_task_status
    await _publish_task_status(task, new_status, orchestrator_id, db, redis_client)

    status_emoji = "✅" if new_status == "done" else "🚫"
    status_label = "completed" if new_status == "done" else "blocked"
    sys_msg = Message(
        orchestrator_id=agent.orchestrator_id,
        agent_id=None,
        sender_name="system",
        sender_role="system",
        room=room,
        content=f"{status_emoji} **Task {status_label}:** {task.title}",
        mentions=[],
        mention_type=MentionType.system,
    )
    db.add(sys_msg)
    await db.commit()
    await db.refresh(sys_msg)

    await redis_client.publish(
        pubsub.chat_channel(orchestrator_id, room),
        json.dumps({
            "type": "system",
            "id": str(sys_msg.id),
            "sender_name": "system",
            "sender_role": "system",
            "content": sys_msg.content,
            "mention_type": "system",
            "mentions": [],
            "room": room,
            "created_at": sys_msg.created_at.strftime("%Y-%m-%dT%H:%M:%S") + "Z",
        }),
    )

    if new_status == "done":
        await advance_queue(agent.id, room, orchestrator_id, db, redis_client, task.title)


async def handle_agent_notify(
    agent_id: str,
    event: dict,
    db: AsyncSession,
    redis_client,
):
    """Called when a message is published to agent:{id}:notify."""
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent or not agent.endpoint_url:
        return

    orchestrator_id = str(agent.orchestrator_id) if agent.orchestrator_id else ""
    content = event.get("content", "")
    room = event.get("room", "general")
    meeting_id = event.get("meeting_id")
    msg_id = event.get("id", "")
    hunt_task_id = event.get("task_id", "")
    attachments = event.get("attachments_full") or []

    # Handle stop signal: cancel any active streaming task for this agent/room
    if event.get("type") == "stop":
        task_key = f"{agent_id}:{room}"
        task = _active_tasks.get(task_key)
        if task and not task.done():
            task.cancel()
            logger.info(f"endpoint_caller: cancelled active task for agent {agent_id} in room {room}")
        return

    if not content.strip():
        return

    # Dedup: skip if we already processed this exact message for this agent
    if msg_id:
        dedup_key = f"agent_notified:{agent_id}:{msg_id}"
        already = await redis_client.set(dedup_key, "1", nx=True, ex=120)
        if not already:
            logger.info(f"endpoint_caller: skipping duplicate notify for msg {msg_id} agent {agent_id}")
            return

    # Typing indicator
    await redis_client.publish(
        pubsub.chat_channel(orchestrator_id, room),
        json.dumps({"type": "typing", "agent_name": agent.name, "room": room}),
    )

    # Build history for any non-meeting room — DMs and project/group rooms
    # both benefit from context. Meetings are one-shot broadcast prompts and
    # intentionally get no prior context.
    history = None
    if not meeting_id:
        history = await build_history(room, agent.name, db)

    full_text = ""
    meta = {}
    stream_id = str(uuid.uuid4())[:8]
    final_a2a_state = None

    task_key = f"{agent_id}:{room}"
    _active_tasks[task_key] = asyncio.current_task()
    try:
        if agent.protocol == AgentProtocol.a2a:
            from api.services.a2a_caller import call_a2a
            full_text, meta, stream_id, final_a2a_state = await call_a2a(
                agent, content, room, redis_client, history, orchestrator_id,
                hunt_task_id=hunt_task_id, attachments=attachments,
            )
        else:
            # openai-compatible (Hermes gateway, LiteLLM, etc.)
            full_text, meta, stream_id = await call_endpoint_streaming(
                agent.endpoint_url, content, agent.name, room, redis_client, history, orchestrator_id,
                attachments=attachments, bearer_token=agent.bearer_token,
            )
    except asyncio.CancelledError:
        logger.info(f"endpoint_caller: streaming cancelled for agent {agent_id} in room {room}")
        await redis_client.publish(
            pubsub.chat_channel(orchestrator_id, room),
            json.dumps({"type": "stream_end", "stream_id": stream_id, "usage": {}, "duration_ms": 0, "tokens_per_sec": 0}),
        )
        return
    except Exception as e:
        logger.warning(f"endpoint_caller: failed to call {agent.endpoint_url} (protocol={agent.protocol}): {e}")
        return
    finally:
        _active_tasks.pop(task_key, None)

    if not full_text:
        return

    # Normalize model name
    soul_model = (agent.soul or {}).get("model", "")
    streaming_model = meta.get("model", "")
    if soul_model:
        meta["model"] = soul_model
        meta["usage"]["model"] = soul_model
    elif not streaming_model or streaming_model.lower() in ("hermes-agent", "hermes"):
        meta["model"] = ""
        meta["usage"]["model"] = ""

    # Publish stream_end
    await redis_client.publish(
        pubsub.chat_channel(orchestrator_id, room),
        json.dumps({
            "type": "stream_end",
            "stream_id": stream_id,
            "usage": meta.get("usage", {}),
            "duration_ms": meta.get("duration_ms", 0),
            "tokens_per_sec": meta.get("tokens_per_sec", 0),
        }),
    )

    # Save message to DB (full_text with <think> tags intact — shown in Den)
    msg = Message(
        orchestrator_id=agent.orchestrator_id,
        agent_id=str(agent.id),
        sender_name=agent.name,
        sender_role="agent",
        room=room,
        content=full_text,
        mentions=[],
        mention_type=MentionType.normal,
        msg_metadata=meta,
    )
    db.add(msg)

    if meeting_id:
        from api.services.meeting_scheduler import append_meeting_response
        await append_meeting_response(meeting_id, agent.name, full_text, db)

    agent.status = AgentStatus.online
    agent.last_seen_at = datetime.utcnow()
    await db.commit()
    await db.refresh(msg)

    # Publish final message to Den
    await redis_client.publish(
        pubsub.chat_channel(orchestrator_id, room),
        json.dumps({
            "type": "message",
            "id": str(msg.id),
            "sender_name": agent.name,
            "sender_role": "agent",
            "content": full_text,
            "mention_type": "normal",
            "mentions": [],
            "room": room,
            "created_at": msg.created_at.strftime("%Y-%m-%dT%H:%M:%S") + "Z",
            "msg_metadata": meta,
        }),
    )

    # ── Update HuntTask status ──────────────────────────────────────────────
    if hunt_task_id:
        if agent.protocol == AgentProtocol.a2a:
            # A2A: use protocol task state
            if final_a2a_state == "completed":
                await _update_hunt_task(hunt_task_id, "done", agent, room, orchestrator_id, db, redis_client)
            elif final_a2a_state == "failed":
                await _update_hunt_task(hunt_task_id, "blocked", agent, room, orchestrator_id, db, redis_client)
            # "working" or "unknown" → timeout job will catch it if it stays too long
        else:
            # OpenAI: detect completion via text patterns (strip <think> first)
            matchable = _strip_think(full_text)
            done_match = _HUNT_DONE_PATTERN.search(matchable)
            blocked_match = _HUNT_BLOCKED_PATTERN.search(matchable)
            if done_match:
                await _update_hunt_task(hunt_task_id, "done", agent, room, orchestrator_id, db, redis_client)
            elif blocked_match:
                await _update_hunt_task(hunt_task_id, "blocked", agent, room, orchestrator_id, db, redis_client)


async def get_real_model_name(endpoint_url: str) -> str:
    """Fetch real model name from /v1/models."""
    try:
        url = f"{endpoint_url.rstrip('/')}/v1/models"
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("data"):
                    return data["data"][0].get("id", "")
    except Exception:
        pass
    return ""


async def ping_endpoint(endpoint_url: str, protocol: AgentProtocol = AgentProtocol.openai, bearer_token: str | None = None) -> bool:
    """Check if an endpoint is reachable."""
    if protocol == AgentProtocol.a2a:
        from api.services.a2a_caller import ping_a2a_endpoint
        return await ping_a2a_endpoint(endpoint_url, bearer_token=bearer_token)
    try:
        url = f"{endpoint_url.rstrip('/')}/v1/models"
        headers: dict[str, str] = {}
        if bearer_token:
            headers["Authorization"] = f"Bearer {bearer_token}"
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url, headers=headers)
            return resp.status_code < 500
    except Exception:
        return False


async def start_health_checker(db_factory, redis_client):
    """Periodically ping all agents with endpoint_url to keep status fresh."""
    await asyncio.sleep(10)
    while True:
        try:
            async with db_factory() as db:
                result = await db.execute(select(Agent).where(Agent.endpoint_url.isnot(None)))
                agents = result.scalars().all()
                for agent in agents:
                    if not agent.endpoint_url or agent.endpoint_url.startswith("fb:"):
                        continue
                    reachable = await ping_endpoint(agent.endpoint_url, agent.protocol, bearer_token=agent.bearer_token)
                    new_status = AgentStatus.online if reachable else AgentStatus.offline
                    if agent.status != new_status or (reachable and agent.last_seen_at is None):
                        agent.status = new_status
                        if reachable:
                            agent.last_seen_at = datetime.utcnow()
                        await redis_client.publish("agent:status:update", json.dumps({
                            "agent_id": str(agent.id),
                            "agent_name": agent.name,
                            "status": new_status.value,
                        }))
                await db.commit()
        except Exception as e:
            logger.warning(f"health_checker: error: {e}")
        await asyncio.sleep(60)


async def _handle_notify_task(agent_id: str, event: dict, db_factory, redis_client):
    """Run handle_agent_notify with its own DB session (background task)."""
    try:
        async with db_factory() as db:
            await handle_agent_notify(agent_id, event, db, redis_client)
    except Exception as e:
        logger.warning(f"endpoint_caller: error in notify task for agent {agent_id}: {e}")


async def start_endpoint_listener(db_factory, redis_client):
    """Subscribe to all agent notify channels. Reconnects on Redis drop."""
    while True:
        try:
            logger.info("endpoint_caller: starting listener")
            ps = redis_client.pubsub()
            await ps.psubscribe("agent:*:notify")

            async for raw in ps.listen():
                if raw["type"] != "pmessage":
                    continue
                try:
                    channel = raw["channel"]
                    parts = channel.split(":")
                    if len(parts) != 3:
                        continue
                    agent_id = parts[1]
                    event = json.loads(raw["data"])
                    asyncio.create_task(
                        _handle_notify_task(agent_id, event, db_factory, redis_client)
                    )
                except Exception as e:
                    logger.warning(f"endpoint_caller: error handling notify: {e}")
        except Exception as e:
            logger.warning(f"endpoint_caller: listener error, reconnecting in 5s: {e}")
            await asyncio.sleep(5)
