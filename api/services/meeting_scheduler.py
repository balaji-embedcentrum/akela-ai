import uuid
import asyncio
import json
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified
import redis.asyncio as aioredis

from api.models.meeting import Meeting, MeetingType, MeetingStatus, StandupConfig
from api.models.agent import Agent
from api.services import pubsub


STANDUP_PROMPT = (
    "🐺 **The Howl — {name}**{project_line}\n\n"
    "Standup time! Please report:\n"
    "1. What did you complete since the last standup?\n"
    "2. What are you working on right now?\n"
    "3. Any blockers or help needed?"
)


async def run_standup_config(
    config: StandupConfig,
    orchestrator_id: str,
    db: AsyncSession,
    redis_client: aioredis.Redis,
) -> Meeting:
    """Create a Meeting run from a StandupConfig and notify all relevant agents."""
    project_name = ""
    if config.project_id:
        from api.models.hunt import Project
        proj = await db.execute(select(Project).where(Project.id == config.project_id))
        p = proj.scalar_one_or_none()
        if p:
            project_name = p.name

    project_line = f" — {project_name}" if project_name else ""
    prompt = STANDUP_PROMPT.format(name=config.name, project_line=project_line)

    meeting = Meeting(
        id=uuid.uuid4(),
        orchestrator_id=orchestrator_id,
        standup_config_id=config.id,
        project_id=config.project_id,
        name=config.name,
        type=MeetingType.standup,
        status=MeetingStatus.active,
        transcript={"responses": [], "started_at": datetime.utcnow().isoformat()},
        scheduled_at=datetime.utcnow(),
    )
    db.add(meeting)
    config.last_run_at = datetime.utcnow()
    await db.commit()
    await db.refresh(meeting)

    # Announce in general room
    await redis_client.publish(
        pubsub.chat_channel(orchestrator_id, "general"),
        json.dumps({
            "type": "message",
            "id": str(uuid.uuid4()),
            "sender_name": "system",
            "sender_role": "system",
            "content": f"🐺 **The Howl begins** — *{config.name}*{project_line}",
            "mention_type": "system",
            "mentions": [],
            "room": "general",
            "created_at": datetime.utcnow().isoformat(),
        }),
    )

    # Notify each agent with endpoint_url
    result = await db.execute(select(Agent).where(Agent.orchestrator_id == orchestrator_id))
    agents = result.scalars().all()
    for agent in agents:
        if agent.endpoint_url:
            await redis_client.publish(
                f"agent:{agent.id}:notify",
                json.dumps({
                    "content": prompt,
                    "room": "general",
                    "sender_name": "system",
                    "sender_role": "system",
                    "mention_type": "direct",
                    "mentions": [agent.name],
                    "meeting_id": str(meeting.id),
                }),
            )

    asyncio.create_task(_auto_complete_meeting(str(meeting.id), orchestrator_id, redis_client))
    return meeting


async def _auto_complete_meeting(meeting_id: str, orchestrator_id: str, redis_client):
    await asyncio.sleep(300)
    await redis_client.publish(
        pubsub.meeting_channel(orchestrator_id),
        json.dumps({"type": "standup_complete", "meeting_id": meeting_id}),
    )


async def start_standup(orchestrator_id: str, db: AsyncSession, redis_client: aioredis.Redis) -> Meeting:
    """Legacy quick standup (backwards compat with /standup command)."""
    meeting = Meeting(
        id=uuid.uuid4(),
        orchestrator_id=orchestrator_id,
        name="Quick Howl",
        type=MeetingType.standup,
        status=MeetingStatus.active,
        transcript={"responses": [], "started_at": datetime.utcnow().isoformat()},
        scheduled_at=datetime.utcnow(),
    )
    db.add(meeting)
    await db.commit()
    await db.refresh(meeting)

    result = await db.execute(select(Agent).where(Agent.orchestrator_id == orchestrator_id))
    agents = result.scalars().all()
    prompt = STANDUP_PROMPT.format(name="Quick Howl", project_line="")
    for agent in agents:
        if agent.endpoint_url:
            await redis_client.publish(
                f"agent:{agent.id}:notify",
                json.dumps({
                    "content": prompt,
                    "room": "general",
                    "sender_name": "system",
                    "sender_role": "system",
                    "mention_type": "direct",
                    "mentions": [agent.name],
                    "meeting_id": str(meeting.id),
                }),
            )

    await pubsub.publish(
        pubsub.meeting_channel(orchestrator_id),
        {"type": "standup_started", "meeting_id": str(meeting.id), "prompt": prompt},
        redis_client,
    )
    return meeting


async def append_meeting_response(meeting_id: str, agent_name: str, content: str, db: AsyncSession):
    """Called by endpoint_caller when a standup response arrives."""
    result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
    meeting = result.scalar_one_or_none()
    if not meeting or meeting.status != MeetingStatus.active:
        return
    responses = meeting.transcript.get("responses", [])
    if any(r["agent_name"] == agent_name for r in responses):
        return
    responses.append({
        "agent_name": agent_name,
        "content": content,
        "timestamp": datetime.utcnow().isoformat(),
    })
    meeting.transcript = {**meeting.transcript, "responses": responses}
    flag_modified(meeting, "transcript")
    await db.commit()
