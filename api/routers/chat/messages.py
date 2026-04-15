"""Message CRUD — create, fetch, and route chat messages."""
import json
import uuid
import re
from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import redis.asyncio as aioredis

from api.db.session import get_db
from api.dependencies import get_current_agent, get_current_orchestrator, get_redis
from api.models.agent import Agent
from api.models.orchestrator import Orchestrator
from api.models.message import Message, MentionType
from api.schemas.chat import MessageCreate, MessageResponse
from api.services import pubsub

router = APIRouter(tags=["chat"])

MENTION_PATTERN = re.compile(r"@([\w-]+)")
SLASH_PATTERN = re.compile(r"^/([\w-]+)(?:\s+(.*))?$")
HUNT_DONE_PATTERN = re.compile(r"(?:task\s+done|done\s+task)[:\s]+(.+)", re.IGNORECASE)
HUNT_BLOCKED_PATTERN = re.compile(r"(?:task\s+blocked|blocked\s+task)[:\s]+(.+)", re.IGNORECASE)

MAX_CHAIN_DEPTH = 3


def parse_message(content: str) -> dict:
    """Parse mentions and slash commands from message content."""
    stripped = content.strip()

    slash_match = SLASH_PATTERN.match(stripped)
    if slash_match:
        return {
            "mention_type": MentionType.normal,
            "mentions": [],
            "slash_command": slash_match.group(1),
            "slash_args": slash_match.group(2) or "",
        }

    if "@all" in stripped:
        mentions = [m for m in MENTION_PATTERN.findall(stripped) if m != "all"]
        return {"mention_type": MentionType.broadcast, "mentions": mentions, "slash_command": None}

    mentions = MENTION_PATTERN.findall(stripped)
    if mentions:
        return {"mention_type": MentionType.direct, "mentions": mentions, "slash_command": None}

    return {"mention_type": MentionType.normal, "mentions": [], "slash_command": None}


async def _post_message(
    content: str, room: str, sender_id: str, sender_name: str, sender_role: str,
    orchestrator_id: str, db: AsyncSession, redis_client: aioredis.Redis,
    attachments: list[dict] | None = None,
) -> Message:
    from api.routers.chat.dispatch import handle_slash_command

    parsed = parse_message(content)
    mention_type = parsed["mention_type"]
    mentions = parsed["mentions"]
    slash_command = parsed.get("slash_command")

    system_response = None
    slash_dispatch = None
    if slash_command:
        system_response, slash_dispatch = await handle_slash_command(
            slash_command, parsed.get("slash_args", ""),
            sender_name, sender_role, db, redis_client, room, orchestrator_id
        )

    attachment_meta = [{"name": a.get("name", ""), "type": a.get("type", "")} for a in (attachments or [])] or None

    msg = Message(
        orchestrator_id=uuid.UUID(orchestrator_id) if orchestrator_id else None,
        agent_id=sender_id,
        sender_name=sender_name,
        sender_role=sender_role,
        room=room,
        content=content,
        mentions=mentions,
        mention_type=mention_type,
        slash_command=slash_command,
        attachments=attachment_meta,
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)

    event = {
        "type": "message",
        "id": str(msg.id),
        "sender_name": sender_name,
        "sender_role": sender_role,
        "content": content,
        "mention_type": mention_type.value,
        "mentions": mentions,
        "room": room,
        "created_at": msg.created_at.strftime("%Y-%m-%dT%H:%M:%S") + "Z",
        "attachments": attachment_meta or [],
    }
    if attachments:
        event["attachments_full"] = attachments
    await pubsub.publish(pubsub.chat_channel(orchestrator_id, room), event, redis_client)

    if mention_type == MentionType.broadcast or (mentions and mention_type == MentionType.direct):
        from api.models.agent import Agent as AgentModel
        from api.models.project import ProjectAgent

        project_agent_ids: set | None = None
        if room.startswith("proj-"):
            try:
                project_id = uuid.UUID(room[5:])
                pa_result = await db.execute(
                    select(ProjectAgent.agent_id).where(ProjectAgent.project_id == project_id)
                )
                project_agent_ids = {row[0] for row in pa_result.all()}
            except (ValueError, Exception):
                project_agent_ids = set()

        if mention_type == MentionType.broadcast:
            if project_agent_ids is None:
                q = select(AgentModel).where(AgentModel.orchestrator_id == orchestrator_id)
                agents_result = await db.execute(q)
                for agent in agents_result.scalars().all():
                    await redis_client.publish(f"agent:{agent.id}:notify", json.dumps(event))
            elif project_agent_ids:
                q = select(AgentModel).where(
                    AgentModel.orchestrator_id == orchestrator_id,
                    AgentModel.id.in_(project_agent_ids),
                )
                agents_result = await db.execute(q)
                for agent in agents_result.scalars().all():
                    await redis_client.publish(f"agent:{agent.id}:notify", json.dumps(event))
        else:
            for name in mentions:
                q = select(AgentModel).where(AgentModel.name == name, AgentModel.orchestrator_id == orchestrator_id)
                agent_result = await db.execute(q)
                agent = agent_result.scalar_one_or_none()
                if agent and (project_agent_ids is None or agent.id in project_agent_ids):
                    await redis_client.publish(f"agent:{agent.id}:notify", json.dumps(event))

    if room.startswith("dm:"):
        from api.models.agent import Agent as AgentModel
        dm_target = room[3:]
        agent_result = await db.execute(
            select(AgentModel).where(AgentModel.name == dm_target, AgentModel.orchestrator_id == orchestrator_id)
        )
        agent = agent_result.scalar_one_or_none()
        if agent:
            dm_event = {**event, "mention_type": "direct", "mentions": [dm_target]}
            await redis_client.publish(f"agent:{agent.id}:notify", json.dumps(dm_event))

    if system_response:
        sys_msg = Message(
            orchestrator_id=uuid.UUID(orchestrator_id) if orchestrator_id else None,
            agent_id=None,
            sender_name="system",
            sender_role="system",
            room=room,
            content=system_response,
            mentions=[],
            mention_type=MentionType.system,
        )
        db.add(sys_msg)
        await db.commit()
        await db.refresh(sys_msg)
        await pubsub.publish(pubsub.chat_channel(orchestrator_id, room), {
            "type": "system",
            "id": str(sys_msg.id),
            "sender_name": "system",
            "sender_role": "system",
            "mention_type": "system",
            "mentions": [],
            "content": system_response,
            "room": room,
            "created_at": sys_msg.created_at.strftime("%Y-%m-%dT%H:%M:%S") + "Z",
        }, redis_client)

    if slash_dispatch:
        from api.services.task_queue import dispatch_or_queue
        from api.models.agent import Agent as AgentModel
        from api.models.hunt import HuntTask

        task_result = await db.execute(
            select(HuntTask).where(HuntTask.id == uuid.UUID(slash_dispatch["task_id"]))
        )
        task = task_result.scalar_one_or_none()
        agent_result = await db.execute(
            select(AgentModel).where(AgentModel.id == uuid.UUID(slash_dispatch["agent_id"]))
        )
        agent = agent_result.scalar_one_or_none()

        if task and agent:
            await dispatch_or_queue(task, agent, room, orchestrator_id, db, redis_client)

    return MessageResponse.model_validate(msg)


@router.post("/chat/messages", response_model=MessageResponse)
async def post_message_as_agent(
    data: MessageCreate,
    current: Agent = Depends(get_current_agent),
    db: AsyncSession = Depends(get_db),
    redis_client: aioredis.Redis = Depends(get_redis),
):
    return await _post_message(
        content=data.content,
        room=data.room,
        sender_id=str(current.id),
        sender_name=current.name,
        sender_role="agent",
        orchestrator_id=str(current.orchestrator_id),
        db=db,
        redis_client=redis_client,
    )


@router.post("/chat/messages/alpha", response_model=MessageResponse)
async def post_message_as_alpha(
    data: MessageCreate,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
    redis_client: aioredis.Redis = Depends(get_redis),
):
    """Alpha (Orchestrator) posting to the Den."""
    return await _post_message(
        content=data.content,
        room=data.room,
        sender_id=str(orch.id),
        sender_name=orch.name,
        sender_role="alpha",
        orchestrator_id=str(orch.id),
        db=db,
        redis_client=redis_client,
        attachments=data.attachments,
    )


@router.get("/chat/messages", response_model=List[MessageResponse])
async def get_messages(
    room: str = Query(default="general"),
    limit: int = Query(default=50, le=200),
    db: AsyncSession = Depends(get_db),
    current: Agent = Depends(get_current_agent),
):
    result = await db.execute(
        select(Message)
        .where(Message.room == room, Message.orchestrator_id == current.orchestrator_id)
        .order_by(Message.created_at.desc()).limit(limit)
    )
    return [MessageResponse.model_validate(m) for m in result.scalars().all()]


@router.get("/chat/messages/alpha")
async def get_messages_as_alpha(
    room: str = Query(default="general"),
    limit: int = Query(default=100, le=500),
    db: AsyncSession = Depends(get_db),
    orch: Orchestrator = Depends(get_current_orchestrator),
):
    """Alpha sees ALL messages."""
    result = await db.execute(
        select(Message)
        .where(Message.room == room, Message.orchestrator_id == orch.id)
        .order_by(Message.created_at.desc()).limit(limit)
    )
    return [MessageResponse.model_validate(m) for m in result.scalars().all()]


@router.post("/chat/agent-message")
async def agent_message_internal(
    data: dict,
    db: AsyncSession = Depends(get_db),
    redis_client: aioredis.Redis = Depends(get_redis),
):
    """Internal endpoint for Docker agents to post messages back to chat.
    No auth required — accessible only within Docker network.
    Parses @mentions in agent responses to enable agent-to-agent collaboration.
    """
    agent_name = data.get("agent_name", "unknown")
    display_name = data.get("agent_display_name", agent_name)
    room = data.get("room", "general")
    content = data.get("content", "")
    chain_depth = data.get("chain_depth", 0)
    msg_metadata = data.get("metadata")

    result = await db.execute(select(Agent).where(Agent.name == agent_name))
    agent = result.scalar_one_or_none()
    agent_id = str(agent.id) if agent else agent_name
    orchestrator_id = str(agent.orchestrator_id) if agent and agent.orchestrator_id else ""

    parsed = parse_message(content)
    mentions = parsed["mentions"]
    mention_type = parsed["mention_type"]

    if not mentions:
        mention_type = MentionType.normal

    msg = Message(
        orchestrator_id=uuid.UUID(orchestrator_id) if orchestrator_id else None,
        agent_id=agent_id,
        sender_name=display_name,
        sender_role="agent",
        room=room,
        content=content,
        mentions=mentions,
        mention_type=mention_type,
        msg_metadata=msg_metadata,
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)

    event = {
        "type": "message",
        "id": str(msg.id),
        "sender_name": display_name,
        "sender_role": "agent",
        "content": content,
        "mention_type": mention_type.value if hasattr(mention_type, 'value') else str(mention_type),
        "mentions": mentions,
        "room": room,
        "created_at": msg.created_at.strftime("%Y-%m-%dT%H:%M:%S") + "Z",
        "metadata": msg_metadata,
    }
    await pubsub.publish(pubsub.chat_channel(orchestrator_id, room), event, redis_client)

    if room.startswith("dm:"):
        dm_notify = json.dumps({
            "type": "dm_message",
            "room": room,
            "sender_name": display_name,
            "agent_name": agent_name,
        })
        await redis_client.publish("dm:notifications", dm_notify)

    if agent:
        done_match = HUNT_DONE_PATTERN.search(content)
        blocked_match = HUNT_BLOCKED_PATTERN.search(content)

        if done_match or blocked_match:
            from api.models.hunt import HuntTask
            from api.services.task_queue import advance_queue

            title_search = (done_match or blocked_match).group(1).strip()
            new_status = "done" if done_match else "blocked"
            status_emoji = "✅" if done_match else "🚫"
            status_label = "completed" if done_match else "blocked"

            task_result = await db.execute(
                select(HuntTask).where(
                    HuntTask.assignee_id == agent.id,
                    HuntTask.title.ilike(f"%{title_search}%"),
                    HuntTask.status == "in_progress",
                ).limit(1)
            )
            task = task_result.scalar_one_or_none()
            if task:
                task_id_for_pub = str(task.id)
                task.status = new_status
                await db.commit()

                hunt_response = f"{status_emoji} **Task {status_label}:** {task.title}"
                hunt_msg = Message(
                    orchestrator_id=uuid.UUID(orchestrator_id) if orchestrator_id else None,
                    agent_id=None, sender_name="system", sender_role="system",
                    room=room, content=hunt_response,
                    mentions=[], mention_type=MentionType.system,
                )
                db.add(hunt_msg)
                await db.commit()
                await db.refresh(hunt_msg)
                await pubsub.publish(pubsub.chat_channel(orchestrator_id, room), {
                    "type": "system", "content": hunt_response, "room": room,
                    "id": str(hunt_msg.id), "sender_name": "system",
                    "sender_role": "system", "mention_type": "system", "mentions": [],
                    "created_at": hunt_msg.created_at.strftime("%Y-%m-%dT%H:%M:%S") + "Z",
                }, redis_client)

                await advance_queue(agent.id, room, orchestrator_id, db, redis_client, task.title)

                # Notify Hunt board on the project room
                from api.models.hunt import Epic
                from api.models.hunt import Project as HuntProject
                epic_r = await db.execute(select(Epic).where(Epic.id == task.epic_id))
                epic = epic_r.scalar_one_or_none()
                if epic:
                    proj_r = await db.execute(select(HuntProject).where(HuntProject.id == epic.project_id))
                    hunt_proj = proj_r.scalar_one_or_none()
                    if hunt_proj and hunt_proj.project_id:
                        proj_channel = pubsub.chat_channel(orchestrator_id, f"proj-{hunt_proj.project_id}")
                        await pubsub.publish(proj_channel, {"type": "task_status", "task_id": task_id_for_pub, "status": new_status}, redis_client)

    if room.startswith("dm:"):
        pass  # DM rooms are private — no agent-to-agent routing
    elif mentions and mention_type in (MentionType.direct, MentionType.broadcast):
        if chain_depth >= MAX_CHAIN_DEPTH:
            limit_msg = f"⚠️ Agent chain limit reached (depth {chain_depth}). Stopping further agent-to-agent routing."
            await pubsub.publish(pubsub.chat_channel(orchestrator_id, room), {
                "type": "system", "content": limit_msg, "room": room,
            }, redis_client)
        else:
            for mentioned_name in mentions:
                if mentioned_name == agent_name:
                    continue
                mentioned_result = await db.execute(
                    select(Agent).where(Agent.name == mentioned_name)
                )
                mentioned_agent = mentioned_result.scalar_one_or_none()
                if mentioned_agent:
                    notify_event = {
                        **event,
                        "mention_type": "direct",
                        "mentions": [mentioned_name],
                        "chain_depth": chain_depth + 1,
                    }
                    await redis_client.publish(
                        f"agent:{mentioned_agent.id}:notify",
                        json.dumps(notify_event),
                    )

    if mention_type == MentionType.broadcast and chain_depth < MAX_CHAIN_DEPTH:
        all_agents_result = await db.execute(
            select(Agent).where(Agent.orchestrator_id == uuid.UUID(orchestrator_id)) if orchestrator_id else select(Agent)
        )
        for a in all_agents_result.scalars().all():
            if str(a.id) != agent_id:
                broadcast_event = {**event, "chain_depth": chain_depth + 1}
                await redis_client.publish(f"agent:{a.id}:notify", json.dumps(broadcast_event))

    return {"ok": True, "message_id": str(msg.id)}


@router.post("/chat/feedback")
async def submit_feedback(
    data: dict,
    db: AsyncSession = Depends(get_db),
):
    """Record thumbs up/down feedback on a message."""
    from api.models.feedback import MessageFeedback
    from sqlalchemy import delete

    message_id = data.get("message_id")
    rating = data.get("rating")

    if not message_id or rating not in ("up", "down"):
        return {"error": "message_id and rating (up/down) required"}, 400

    await db.execute(delete(MessageFeedback).where(MessageFeedback.message_id == message_id))
    feedback = MessageFeedback(message_id=message_id, rating=rating, created_by="alpha")
    db.add(feedback)
    await db.commit()

    return {"ok": True, "rating": rating}
