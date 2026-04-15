"""Slash command handling and agent stop control."""
import json
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import redis.asyncio as aioredis

from api.db.session import get_db
from api.dependencies import get_current_orchestrator, get_redis
from api.models.agent import Agent
from api.models.orchestrator import Orchestrator

router = APIRouter(tags=["chat"])


async def handle_slash_command(
    command: str, args: str, sender_name: str, sender_role: str,
    db: AsyncSession, redis_client: aioredis.Redis, room: str,
    orchestrator_id: str
) -> tuple[str, dict | None]:
    """Process slash commands and return (system_response, dispatch_info)."""
    cmd = command.lower()

    HUNT_CMDS = {"create-project", "create-sprint", "create-epic", "create-story",
                 "create-task", "create-subtask", "assign", "status", "sprint",
                 "list-projects", "list-sprints", "list-epics", "list-stories", "list-tasks"}
    if cmd in HUNT_CMDS:
        from api.services.hunt_commands import handle_hunt_command
        result, dispatch = await handle_hunt_command(cmd, args, orchestrator_id, sender_name, db, room=room)
        if result is not None:
            return result, dispatch

    if cmd == "help":
        return (
            "**Hunt (project management):**\n"
            "/create-project \"Name\"\n"
            "/create-sprint \"Name\" [/start YYYY-MM-DD] [/end YYYY-MM-DD]\n"
            "/create-epic \"Name\" [/priority P1] [/date YYYY-MM-DD]\n"
            "/create-story \"Name\" #epic [/points N] [/priority P2] [/date YYYY-MM-DD]\n"
            "/create-task \"Name\" #story [#agent] [/priority P2]\n"
            "  Description on subsequent lines (multi-line)\n"
            "/create-subtask \"Name\" #task [#agent]\n"
            "/assign #task #agent\n"
            "/status #task <todo|in_progress|review|done|blocked>\n"
            "/sprint #item #sprint-name — Assign epic/story/task to a sprint\n"
            "/list-projects · /list-sprints · /list-epics · /list-stories · /list-tasks\n\n"
            "**Pack & Standups:**\n"
            "/standup — Quick standup (all agents)\n"
            "/create-standup \"Name\" [#project] [/time HH:MM] [/days mon,...]\n"
            "/run-standup \"Name\" — Run a named standup now\n"
            "/agents — List online agents\n"
            "/help — Show this help"
        ), None

    if cmd == "agents":
        from api.models.agent import AgentStatus
        result = await db.execute(select(Agent).where(Agent.orchestrator_id == orchestrator_id))
        agents = result.scalars().all()
        lines = [f"🐺 Pack ({len(agents)} wolves):"]
        for a in agents:
            dot = "🟢" if a.status.value == "online" else "⚫"
            lines.append(f"  {dot} [{a.rank.value.upper()}] {a.name}")
        return "\n".join(lines), None

    if cmd == "standup":
        if sender_role != "alpha":
            return "Only Alpha can trigger the Howl.", None
        from api.services.meeting_scheduler import start_standup
        meeting = await start_standup(orchestrator_id, db, redis_client)
        return f"🐺 The Howl has begun! Meeting ID: {str(meeting.id)[:8]}...", None

    if cmd == "create-standup":
        if sender_role != "alpha":
            return "Only Alpha can create standup configs.", None
        import re as _re
        name_match = _re.search(r'"([^"]+)"', args)
        if not name_match:
            return "Usage: /create-standup \"Name\" [#project-name] [/time HH:MM] [/days mon,tue,wed,thu,fri]", None
        name = name_match.group(1)
        project_id = None
        schedule_time = None
        schedule_days = None
        proj_match = _re.search(r'#(\S+)', args)
        time_match = _re.search(r'/time\s+(\d{2}:\d{2})', args)
        days_match = _re.search(r'/days\s+([\w,]+)', args)
        if proj_match:
            from api.models.hunt import Project
            proj_name = proj_match.group(1).replace('-', ' ')
            res = await db.execute(
                select(Project).where(
                    Project.orchestrator_id == orchestrator_id,
                    Project.name.ilike(f"%{proj_name}%")
                ).limit(1)
            )
            p = res.scalar_one_or_none()
            if p:
                project_id = p.id
        if time_match:
            schedule_time = time_match.group(1)
        if days_match:
            schedule_days = days_match.group(1).lower()
        from api.models.meeting import StandupConfig
        cfg = StandupConfig(
            orchestrator_id=orchestrator_id,
            name=name,
            description="",
            project_id=project_id,
            schedule_time=schedule_time,
            schedule_days=schedule_days,
        )
        db.add(cfg)
        await db.commit()
        detail = f"'{name}'"
        if schedule_time:
            detail += f" at {schedule_time}"
        if schedule_days:
            detail += f" on {schedule_days}"
        return f"🐺 Standup config created: {detail}. Use /run-standup \"{name}\" to trigger it.", None

    if cmd == "run-standup":
        if sender_role != "alpha":
            return "Only Alpha can run a standup.", None
        import re as _re
        name_match = _re.search(r'"([^"]+)"', args)
        cfg_name = name_match.group(1) if name_match else args.strip()
        if not cfg_name:
            return "Usage: /run-standup \"Standup Name\"", None
        from api.models.meeting import StandupConfig
        res = await db.execute(
            select(StandupConfig).where(
                StandupConfig.orchestrator_id == orchestrator_id,
                StandupConfig.name.ilike(f"%{cfg_name}%")
            ).limit(1)
        )
        cfg = res.scalar_one_or_none()
        if not cfg:
            return f"No standup config found matching '{cfg_name}'. Use /create-standup to create one.", None
        from api.services.meeting_scheduler import run_standup_config
        meeting = await run_standup_config(cfg, orchestrator_id, db, redis_client)
        return f"🐺 The Howl begins — {cfg.name}! Meeting ID: {str(meeting.id)[:8]}...", None

    if cmd == "task":
        parts = args.split(" ", 1) if args else []
        sub = parts[0].lower() if parts else ""
        if sub == "list":
            from api.models.hunt import HuntTask
            result = await db.execute(
                select(HuntTask).where(
                    HuntTask.orchestrator_id == orchestrator_id,
                    HuntTask.status.in_(["todo", "in_progress", "review"])
                ).limit(10)
            )
            tasks = result.scalars().all()
            if not tasks:
                return "No active tasks. The pack rests.", None
            lines = ["📋 Active tasks:"]
            for t in tasks:
                lines.append(f"  [{t.status}] {t.title[:50]}")
            return "\n".join(lines), None

    return f"Unknown command: /{command}. Try /help", None


@router.post("/chat/stop")
async def stop_agents(
    data: dict = {},
    db: AsyncSession = Depends(get_db),
    redis_client: aioredis.Redis = Depends(get_redis),
    orch: Orchestrator = Depends(get_current_orchestrator),
):
    """Stop all agent activity in a room. Broadcasts a stop signal."""
    from api.services import pubsub
    room = data.get("room", "general") if data else "general"
    target_agent = data.get("agent_name", None) if data else None
    orchestrator_id = str(orch.id)

    all_agents_result = await db.execute(select(Agent).where(Agent.orchestrator_id == orch.id))
    for a in all_agents_result.scalars().all():
        if target_agent and a.name != target_agent:
            continue
        stop_event = json.dumps({"type": "stop", "room": room, "sender_name": "system"})
        await redis_client.publish(f"agent:{a.id}:notify", stop_event)

    await pubsub.publish(pubsub.chat_channel(orchestrator_id, room), {
        "type": "system",
        "content": f"🛑 Stop signal sent{' to ' + target_agent if target_agent else ' to all agents'}.",
        "room": room,
    }, redis_client)

    return {"ok": True, "stopped": target_agent or "all"}
