"""
Task Queue — per-agent sequential task execution.

Each agent works on ONE task at a time. When assigned multiple tasks,
they're queued and auto-dispatched when the active task completes.

Queue is inferred from HuntTask status + assignee_id:
  - in_progress + assignee_id = active (currently working)
  - todo + assignee_id        = queued (waiting in line)
  
Order: priority ASC (P0 first), then created_at ASC (FIFO within same priority).
"""
import json
import uuid
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import redis.asyncio as aioredis

from api.models.hunt import HuntTask, Epic, Story, Project as HuntProject
from api.models.agent import Agent, AgentProtocol
from api.models.message import Message, MentionType
from api.services import pubsub


def _notify_channel(agent: Agent) -> str:
    """Return the Redis channel a given agent listens on for dispatch.

    Remote A2A agents are served by endpoint_caller.py's subscriber on
    ``agent:{id}:notify``. Local agents are served by the browser-side
    ``<LocalTaskWorker>`` subscribing to ``local-agent:{id}:notify`` via
    the SSE bridge at ``/api/hunt/local/subscribe``.
    """
    if agent.protocol == AgentProtocol.local:
        return f"local-agent:{agent.id}:notify"
    return f"agent:{agent.id}:notify"


async def _publish_task_status(task: HuntTask, status: str, orchestrator_id: str, db: AsyncSession, redis_client: aioredis.Redis):
    """Publish task_status event to the Hunt project room so the board updates in real time."""
    try:
        epic_r = await db.execute(select(Epic).where(Epic.id == task.epic_id))
        epic = epic_r.scalar_one_or_none()
        if epic:
            proj_r = await db.execute(select(HuntProject).where(HuntProject.id == epic.project_id))
            hp = proj_r.scalar_one_or_none()
            if hp and hp.project_id:
                ch = pubsub.chat_channel(orchestrator_id, f"proj-{hp.project_id}")
                await pubsub.publish(ch, {"type": "task_status", "task_id": str(task.id), "status": status}, redis_client)
    except Exception:
        pass


async def get_agent_active_task(agent_id: uuid.UUID, db: AsyncSession) -> HuntTask | None:
    """Get the agent's currently active (in_progress) task, if any."""
    result = await db.execute(
        select(HuntTask).where(
            HuntTask.assignee_id == agent_id,
            HuntTask.status == "in_progress",
        ).order_by(HuntTask.updated_at.desc()).limit(1)
    )
    return result.scalar_one_or_none()


async def get_agent_queue(agent_id: uuid.UUID, db: AsyncSession) -> list[HuntTask]:
    """Get the agent's queued tasks (todo + assigned), ordered by priority then created_at."""
    result = await db.execute(
        select(HuntTask).where(
            HuntTask.assignee_id == agent_id,
            HuntTask.status == "todo",
        ).order_by(HuntTask.priority, HuntTask.created_at)
    )
    return list(result.scalars().all())


def _build_dispatch_content(task: HuntTask, epic_title: str = "", story_title: str = "") -> str:
    """Build the rich dispatch message content for the agent."""
    lines = [f"🎯 **New Task: {task.title}**"]

    if task.description:
        lines.append("")
        lines.append("**Description:**")
        lines.append(task.description)

    if epic_title or story_title:
        context_parts = []
        if epic_title:
            context_parts.append(f"Epic: {epic_title}")
        if story_title:
            context_parts.append(f"Story: {story_title}")
        lines.append("")
        lines.append(f"**Context:** {' → '.join(context_parts)}")

    return "\n".join(lines)


async def dispatch_task(
    task: HuntTask,
    agent: Agent,
    room: str,
    orchestrator_id: str,
    db: AsyncSession,
    redis_client: aioredis.Redis,
) -> None:
    """Dispatch a task to an agent — post message + Redis notify + DB persist."""
    # Get context (epic/story titles)
    epic_title = ""
    story_title = ""
    if task.epic_id:
        epic_result = await db.execute(select(Epic).where(Epic.id == task.epic_id))
        epic = epic_result.scalar_one_or_none()
        if epic:
            epic_title = epic.title
    if task.story_id:
        story_result = await db.execute(select(Story).where(Story.id == task.story_id))
        story = story_result.scalar_one_or_none()
        if story:
            story_title = story.title

    dispatch_content = f"@{agent.name} " + _build_dispatch_content(task, epic_title, story_title)

    # Save dispatch as a message in the Den
    dispatch_msg = Message(
        orchestrator_id=uuid.UUID(orchestrator_id) if isinstance(orchestrator_id, str) else orchestrator_id,
        agent_id=None,
        sender_name="Akela",
        sender_role="system",
        room=room,
        content=dispatch_content,
        mentions=[agent.name],
        mention_type=MentionType.direct,
    )
    db.add(dispatch_msg)
    await db.commit()
    await db.refresh(dispatch_msg)

    # Publish to Den so everyone sees it
    dispatch_event = {
        "type": "message",
        "id": str(dispatch_msg.id),
        "sender_name": "Akela",
        "sender_role": "system",
        "content": dispatch_content,
        "mention_type": "direct",
        "mentions": [agent.name],
        "room": room,
        "created_at": dispatch_msg.created_at.strftime("%Y-%m-%dT%H:%M:%S") + "Z",
    }
    await pubsub.publish(pubsub.chat_channel(orchestrator_id, room), dispatch_event, redis_client)

    # For local agents: emit a 'typing' indicator immediately on dispatch.
    # Without this, Den has a visible dead zone between the dispatch message
    # and the first streaming artifact (which could be several seconds of
    # LLM latency). The /events endpoint re-emits typing on every chunk to
    # refresh Den.tsx:655's 45s auto-clear timer.
    # Remote agents don't need this here — endpoint_caller emits chunks
    # faster than the 45s timeout via its own streaming flow.
    if agent.protocol == AgentProtocol.local:
        typing_event = {
            "type": "typing",
            "agent_name": agent.name,
            "room": room,
        }
        await pubsub.publish(
            pubsub.chat_channel(orchestrator_id, room), typing_event, redis_client
        )

    # Notify the agent via Redis (real-time) — include task_id so handler can update HuntTask.
    # Local agents are subscribed to via the browser-side SSE bridge; remote
    # agents are subscribed to by endpoint_caller on the "agent:..." channel.
    # orchestrator_id is included in the payload so the SSE bridge can filter
    # by the current dashboard user without a DB query per event.
    notify_event = {
        **dispatch_event,
        "task_id": str(task.id),
        "agent_id": str(agent.id),
        "agent_name": agent.name,
        "orchestrator_id": str(orchestrator_id),
        "task_title": task.title,
        "task_description": task.description or "",
    }
    await redis_client.publish(_notify_channel(agent), json.dumps(notify_event))


async def dispatch_or_queue(
    task: HuntTask,
    agent: Agent,
    room: str,
    orchestrator_id: str,
    db: AsyncSession,
    redis_client: aioredis.Redis,
) -> str:
    """
    Decide whether to dispatch immediately or queue.
    Updates task status and posts appropriate messages.
    
    Returns: "dispatched" or "queued"
    """
    active = await get_agent_active_task(agent.id, db)

    if active is None:
        # Agent is free — dispatch immediately
        task.status = "in_progress"
        task.updated_at = datetime.utcnow()
        await db.commit()
        await _publish_task_status(task, "in_progress", orchestrator_id, db, redis_client)
        await dispatch_task(task, agent, room, orchestrator_id, db, redis_client)
        return "dispatched"
    else:
        # Agent is busy — queue the task
        task.status = "todo"  # stays as todo (assigned but waiting)
        task.updated_at = datetime.utcnow()
        await db.commit()

        # Count position in queue
        queue = await get_agent_queue(agent.id, db)
        position = len(queue)

        # Post queue notification
        queue_msg_content = (
            f"⏳ **Task queued** — {agent.name} is working on *{active.title}*. "
            f"Your task *{task.title}* is position **#{position}** in queue."
        )
        queue_msg = Message(
            orchestrator_id=uuid.UUID(orchestrator_id) if isinstance(orchestrator_id, str) else orchestrator_id,
            agent_id=None,
            sender_name="system",
            sender_role="system",
            room=room,
            content=queue_msg_content,
            mentions=[],
            mention_type=MentionType.system,
        )
        db.add(queue_msg)
        await db.commit()
        await db.refresh(queue_msg)

        await pubsub.publish(pubsub.chat_channel(orchestrator_id, room), {
            "type": "system",
            "id": str(queue_msg.id),
            "sender_name": "system",
            "sender_role": "system",
            "content": queue_msg_content,
            "mention_type": "system",
            "mentions": [],
            "room": room,
            "created_at": queue_msg.created_at.strftime("%Y-%m-%dT%H:%M:%S") + "Z",
        }, redis_client)

        return "queued"


async def advance_queue(
    agent_id: uuid.UUID,
    room: str,
    orchestrator_id: str,
    db: AsyncSession,
    redis_client: aioredis.Redis,
    completed_title: str = "",
) -> HuntTask | None:
    """
    After a task completes, auto-dispatch the next queued task.
    Returns the next task if one was dispatched, else None.
    """
    # Get agent
    agent_result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = agent_result.scalar_one_or_none()
    if not agent:
        return None

    # Get next queued task
    queue = await get_agent_queue(agent_id, db)
    if not queue:
        return None

    next_task = queue[0]
    next_task.status = "in_progress"
    next_task.updated_at = datetime.utcnow()
    await db.commit()
    await _publish_task_status(next_task, "in_progress", orchestrator_id, db, redis_client)

    # Post transition message
    transition_content = (
        f"🐺 **{agent.name}** finished *{completed_title}*. "
        f"Auto-starting next task: *{next_task.title}*"
    )
    transition_msg = Message(
        orchestrator_id=uuid.UUID(orchestrator_id) if isinstance(orchestrator_id, str) else orchestrator_id,
        agent_id=None,
        sender_name="system",
        sender_role="system",
        room=room,
        content=transition_content,
        mentions=[],
        mention_type=MentionType.system,
    )
    db.add(transition_msg)
    await db.commit()
    await db.refresh(transition_msg)

    await pubsub.publish(pubsub.chat_channel(orchestrator_id, room), {
        "type": "system",
        "id": str(transition_msg.id),
        "sender_name": "system",
        "sender_role": "system",
        "content": transition_content,
        "mention_type": "system",
        "mentions": [],
        "room": room,
        "created_at": transition_msg.created_at.strftime("%Y-%m-%dT%H:%M:%S") + "Z",
    }, redis_client)

    # Dispatch the next task
    await dispatch_task(next_task, agent, room, orchestrator_id, db, redis_client)

    return next_task
