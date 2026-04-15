"""
Hunt Commands — slash command parser for The Hunt project management.

Called from chat.py when a message starts with '/'.
Returns (system_response, dispatch_info) or (None, None) if not recognized.

dispatch_info = {"agent_name": str, "agent_id": str, "task_id": str,
                 "task_title": str, "room": str} or None

Project is inferred from the current room (proj-{uuid}).
For DM chats (no project room), #project can be specified explicitly.

Supported commands:
  /create-project <name>
  /create-sprint "Name" [/start YYYY-MM-DD] [/end YYYY-MM-DD]
  /create-epic "Name" [/priority P0-P3] [/date YYYY-MM-DD]
  /create-story "Name" #epic [/points N] [/priority P0-P3] [/date YYYY-MM-DD]
  /create-task "Name" #story #agent [/priority P0-P3] [/date YYYY-MM-DD]
                Description on subsequent lines...
  /create-subtask "Name" #task [#agent]
  /assign #item #agent
  /status #item <todo|in_progress|review|done|blocked>
  /list-projects
  /list-sprints
  /list-epics
"""
import re
import uuid as uuid_lib
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from api.models.hunt import Project, Epic, Sprint, Story, HuntTask, Subtask
from api.models.agent import Agent, AgentProtocol


# ── Regex helpers ─────────────────────────────────────────────────────
def _quoted(text: str) -> str | None:
    m = re.search(r'"([^"]+)"', text)
    return m.group(1) if m else None

def _hashes(text: str) -> list[str]:
    """Return all #token values in order."""
    return re.findall(r'#(\S+)', text)

def _hash(text: str) -> str | None:
    m = re.search(r'#(\S+)', text)
    return m.group(1) if m else None

def _at(text: str) -> str | None:
    m = re.search(r'@(\w+)', text)
    return m.group(1) if m else None

def _flag(text: str, flag: str) -> str | None:
    m = re.search(rf'/{flag}\s+(\S+)', text)
    return m.group(1) if m else None

def _desc_flag(text: str) -> str | None:
    """Extract /desc "..." value."""
    m = re.search(r'/desc\s+"([^"]+)"', text)
    return m.group(1) if m else None

def _parse_date(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d")
    except ValueError:
        return None

def _fuzzy(name: str, items, attr: str = "name"):
    """Case-insensitive match — strips spaces/hyphens for comparison."""
    needle = name.lower().replace("-", "").replace(" ", "")
    for item in items:
        val = getattr(item, attr, "").lower().replace(" ", "").replace("-", "")
        if val.startswith(needle) or needle in val or val == needle:
            return item
    return None

def _project_id_from_room(room: str) -> str | None:
    """Extract project UUID from room name like 'proj-{uuid}'."""
    if room and room.startswith("proj-"):
        candidate = room[5:]
        try:
            uuid_lib.UUID(candidate)
            return candidate
        except ValueError:
            return None
    return None


# Type alias for the return tuple
CommandResult = tuple[str | None, dict | None]


# ══════════════════════════════════════════════════════════════════════
#  Entry point
# ══════════════════════════════════════════════════════════════════════

async def handle_hunt_command(
    command: str,
    args: str,
    orchestrator_id: str,
    sender_name: str,
    db: AsyncSession,
    room: str = "",
) -> CommandResult:
    """Return (system_response, dispatch_info), or (None, None) if not a hunt command."""
    cmd = command.lower()

    # Try to infer project from room; fall back to #project in args
    room_project_id = _project_id_from_room(room)

    if cmd == "create-project":
        return await _create_project(args, orchestrator_id, sender_name, db), None
    if cmd == "create-sprint":
        return await _create_sprint(args, orchestrator_id, db, room_project_id), None
    if cmd == "create-epic":
        return await _create_epic(args, orchestrator_id, db, room_project_id), None
    if cmd == "create-story":
        return await _create_story(args, orchestrator_id, db, room_project_id), None
    if cmd == "create-task":
        return await _create_task(args, orchestrator_id, db, room_project_id, room)
    if cmd == "create-subtask":
        return await _create_subtask(args, orchestrator_id, db, room_project_id, room)
    if cmd == "assign":
        return await _assign(args, orchestrator_id, db, room_project_id, room)
    if cmd == "status":
        return await _set_status(args, orchestrator_id, db, room_project_id), None
    if cmd == "list-projects":
        return await _list_projects(orchestrator_id, db), None
    if cmd == "list-sprints":
        return await _list_sprints(args, orchestrator_id, db, room_project_id), None
    if cmd == "list-epics":
        return await _list_epics(args, orchestrator_id, db, room_project_id), None
    if cmd == "list-stories":
        return await _list_stories(args, orchestrator_id, db, room_project_id), None
    if cmd == "list-tasks":
        return await _list_tasks(args, orchestrator_id, db, room_project_id), None
    if cmd == "sprint":
        return await _assign_sprint(args, orchestrator_id, db, room_project_id), None
    return None, None  # Not a hunt command


# ══════════════════════════════════════════════════════════════════════
#  Project resolution helper
# ══════════════════════════════════════════════════════════════════════

async def _resolve_project(
    args: str, orchestrator_id: str, db: AsyncSession,
    room_project_id: str | None
) -> "tuple[Project | None, str | None]":
    """
    Returns (project, error_message).
    Rules:
    - In a project Den: room project is authoritative. If #different-project specified → error.
    - In DM/general: #project-name in args is required.
    """
    projects = (await db.execute(
        select(Project).where(Project.orchestrator_id == orchestrator_id)
    )).scalars().all()

    # Identify the room's project (if any)
    room_project = None
    if room_project_id:
        # room_project_id is an AkelaProject.id (from room name "proj-{uuid}").
        # Match it against Project.project_id (the FK to AkelaProject), not Project.id.
        room_project = next((p for p in projects if str(p.project_id) == room_project_id), None)

    # Check for explicit #project-name override in args
    proj_name = _hash(args)
    if proj_name:
        named = _fuzzy(proj_name, projects)
        if named:
            if room_project and str(named.id) != str(room_project.id):
                return None, f"❌ You're in **{room_project.name}**'s Den. Cannot create items in *{named.name}* from here. Switch to that project's Den."
            return named, None

    # Default: use room project
    if room_project:
        return room_project, None

    return None, None


# ══════════════════════════════════════════════════════════════════════
#  Agent resolution helper (uses # not @)
# ══════════════════════════════════════════════════════════════════════

async def _resolve_agent_by_hash(
    args: str, orchestrator_id: str, db: AsyncSession,
    skip_first: bool = False
) -> "Agent | None":
    """
    Find agent by #name token. When skip_first=True, skip the first #token
    (used when the first # is a story/epic/task reference).
    """
    hashes = _hashes(args)
    if skip_first:
        hashes = hashes[1:]
    if not hashes:
        return None
    agent_name = hashes[0]
    result = await db.execute(
        select(Agent).where(Agent.name == agent_name, Agent.orchestrator_id == orchestrator_id)
    )
    return result.scalar_one_or_none()


# ══════════════════════════════════════════════════════════════════════
#  Handlers
# ══════════════════════════════════════════════════════════════════════

async def _create_project(args: str, orchestrator_id: str, sender_name: str, db: AsyncSession) -> str:
    name = _quoted(args) or args.strip()
    if not name:
        return '❌ Project name required.\nUsage: `/create-project "Name"`'
    project = Project(orchestrator_id=orchestrator_id, name=name, created_by=sender_name)
    db.add(project)
    await db.commit()
    return f"🎯 **Project created:** {name}"


async def _create_sprint(args: str, orchestrator_id: str, db: AsyncSession, room_project_id: str | None) -> str:
    name = _quoted(args) or _flag(args, "name") or ""
    if not name:
        return '❌ Sprint name required.\nUsage: `/create-sprint "Name" [/start YYYY-MM-DD] [/end YYYY-MM-DD]`'

    project, proj_err = await _resolve_project(args, orchestrator_id, db, room_project_id)
    if proj_err: return proj_err
    if not project:
        return '❌ No project context. Use this command from a project Den, or specify #project-name.'

    start = _parse_date(_flag(args, "start"))
    end = _parse_date(_flag(args, "end"))
    sprint = Sprint(project_id=project.id, name=name, start_date=start, end_date=end)
    db.add(sprint)
    await db.commit()
    detail = f" ({start.strftime('%b %d')} → {end.strftime('%b %d')})" if start and end else ""
    return f"🏃 **Sprint created:** {name} in *{project.name}*{detail}"


async def _create_epic(args: str, orchestrator_id: str, db: AsyncSession, room_project_id: str | None) -> str:
    name = _quoted(args) or ""
    if not name:
        return '❌ Epic name required — wrap it in quotes.\nUsage: `/create-epic "Name" [/priority P0-P3] [/date YYYY-MM-DD]`'

    project, proj_err = await _resolve_project(args, orchestrator_id, db, room_project_id)
    if proj_err: return proj_err
    if not project:
        return '❌ No project context. Use this command from a project Den, or specify #project-name.'

    priority = _flag(args, "priority") or "P2"
    due = _parse_date(_flag(args, "date"))
    epic = Epic(project_id=project.id, title=name, priority=priority, due_date=due)
    db.add(epic)
    await db.commit()

    # Return all epics so agent context stays fresh
    all_epics = (await db.execute(select(Epic).where(Epic.project_id == project.id).order_by(Epic.created_at))).scalars().all()
    epic_list = ", ".join(f"*{e.title}*" for e in all_epics)
    return f"🟣 **Epic created:** {name} in *{project.name}*\n📋 All epics: {epic_list}"


async def _create_story(args: str, orchestrator_id: str, db: AsyncSession, room_project_id: str | None) -> str:
    name = _quoted(args) or ""
    epic_name = _hash(args)
    if not name:
        return '❌ Story name required — wrap it in quotes.\nUsage: `/create-story "Name" #epic [/points N] [/priority P2]`'
    if not epic_name:
        return '❌ Epic reference required — use #epic-name.\nUsage: `/create-story "Name" #epic [/points N] [/priority P2]`'

    project, proj_err = await _resolve_project(args, orchestrator_id, db, room_project_id)

    # Look up epic — scoped to project if known, else across orchestrator
    if project:
        epics = (await db.execute(
            select(Epic).where(Epic.project_id == project.id)
        )).scalars().all()
    else:
        epics = (await db.execute(
            select(Epic).join(Project).where(Project.orchestrator_id == orchestrator_id)
        )).scalars().all()

    epic = _fuzzy(epic_name, epics, attr="title")
    if not epic:
        available = ", ".join(f"*{e.title}*" for e in epics[:5])
        return f"❌ Epic not found: **{epic_name}**. Available: {available or 'none'}"

    points_str = _flag(args, "points")
    points = int(points_str) if points_str and points_str.isdigit() else None
    priority = _flag(args, "priority") or "P2"
    due = _parse_date(_flag(args, "date"))
    story = Story(epic_id=epic.id, title=name, priority=priority, story_points=points, due_date=due)
    db.add(story)
    await db.commit()
    pts = f" · {points}pts" if points else ""

    # Return all stories in the epic so agent context stays fresh
    all_stories = (await db.execute(select(Story).where(Story.epic_id == epic.id).order_by(Story.created_at))).scalars().all()
    story_list = ", ".join(f"*{s.title}*" for s in all_stories)
    return f"📖 **Story created:** {name} in epic *{epic.title}*{pts}\n📋 Stories in epic: {story_list}"


async def _create_task(
    args: str, orchestrator_id: str, db: AsyncSession,
    room_project_id: str | None, room: str,
) -> CommandResult:
    """Create a task. Returns (response, dispatch_info).
    
    Supports multi-line: first line = command args, rest = description.
    Also supports /desc "..." flag for inline description.
    """
    # Split first line (command args) from remaining lines (description)
    lines = args.split("\n")
    first_line = lines[0].strip()
    multiline_desc = "\n".join(lines[1:]).strip() if len(lines) > 1 else ""

    name = _quoted(first_line) or ""
    if not name:
        return '❌ Task name required — wrap it in quotes.\nUsage: `/create-task "Name" #story [#agent] [/priority P2]`\nDescription on subsequent lines.', None

    hashes = _hashes(first_line)
    story_or_epic_name = hashes[0] if hashes else None
    # Agent is the second # token (first is story/epic)
    agent_name = hashes[1] if len(hashes) > 1 else None

    # Description: multi-line takes priority, then /desc flag
    description = multiline_desc or _desc_flag(first_line) or ""

    # Story/epic lookup
    story = None
    epic = None
    if story_or_epic_name:
        project, proj_err = await _resolve_project(first_line, orchestrator_id, db, room_project_id)

        if project:
            stories = (await db.execute(
                select(Story).join(Epic).where(Epic.project_id == project.id)
            )).scalars().all()
        else:
            stories = (await db.execute(
                select(Story).join(Epic).join(Project).where(Project.orchestrator_id == orchestrator_id)
            )).scalars().all()

        story = _fuzzy(story_or_epic_name, stories, attr="title")
        if story:
            epic_result = await db.execute(select(Epic).where(Epic.id == story.epic_id))
            epic = epic_result.scalar_one_or_none()
        else:
            # Try matching an epic
            if project:
                epics = (await db.execute(
                    select(Epic).where(Epic.project_id == project.id)
                )).scalars().all()
            else:
                epics = (await db.execute(
                    select(Epic).join(Project).where(Project.orchestrator_id == orchestrator_id)
                )).scalars().all()
            epic = _fuzzy(story_or_epic_name, epics, attr="title")

    if not epic and not story:
        return f"❌ Story or Epic not found: **{story_or_epic_name or '(none given)'}**. Use #story-name or #epic-name.", None

    epic_id = epic.id if epic else story.epic_id

    # Agent lookup by #name (second hash token)
    assignee_id = None
    agent = None
    if agent_name:
        agent_result = await db.execute(
            select(Agent).where(Agent.name == agent_name, Agent.orchestrator_id == orchestrator_id)
        )
        agent = agent_result.scalar_one_or_none()
        if not agent:
            all_agents = (await db.execute(
                select(Agent).where(Agent.orchestrator_id == orchestrator_id)
            )).scalars().all()
            available = ", ".join(f"*{a.name}*" for a in all_agents[:5])
            return f"❌ Agent not found: **{agent_name}**. Available: {available or 'none'}", None

        # Only A2A agents can receive task dispatch
        if agent.protocol != AgentProtocol.a2a:
            return f"❌ **{agent_name}** uses the `{agent.protocol.value}` protocol. Only A2A agents support task dispatch. Configure their endpoint as A2A in Pack settings.", None

        # Validate agent is assigned to this project (if we're in a project room)
        if room_project_id:
            from api.models.project import ProjectAgent
            pa_result = await db.execute(
                select(ProjectAgent).where(
                    ProjectAgent.project_id == uuid_lib.UUID(room_project_id),
                    ProjectAgent.agent_id == agent.id,
                )
            )
            if not pa_result.scalar_one_or_none():
                return f"❌ **{agent_name}** is not assigned to this project. Add them via Dashboard → Project → Pack first.", None

        assignee_id = agent.id

    priority = _flag(first_line, "priority") or "P2"
    due = _parse_date(_flag(first_line, "date"))
    task = HuntTask(
        epic_id=epic_id,
        story_id=story.id if story else None,
        assignee_id=assignee_id,
        title=name,
        description=description,
        priority=priority,
        due_date=due,
        created_by="system",
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    # Build response
    assigned = f" → assigned to **{agent_name}**" if agent else ""
    desc_preview = f"\n> {description[:100]}{'...' if len(description) > 100 else ''}" if description else ""
    response = f"☐ **Task created:** {name}{assigned} [{priority}]{desc_preview}"

    # Build dispatch info if agent was assigned
    dispatch_info = None
    if agent:
        dispatch_info = {
            "agent_name": agent.name,
            "agent_id": str(agent.id),
            "task_id": str(task.id),
            "task_title": name,
            "room": room,
        }

    return response, dispatch_info


async def _create_subtask(
    args: str, orchestrator_id: str, db: AsyncSession,
    room_project_id: str | None, room: str,
) -> CommandResult:
    name = _quoted(args) or ""
    hashes = _hashes(args)
    task_name = hashes[0] if hashes else None
    agent_name = hashes[1] if len(hashes) > 1 else None

    if not name:
        return '❌ Subtask name required — wrap it in quotes.\nUsage: `/create-subtask "Name" #task [#agent]`', None
    if not task_name:
        return '❌ Task reference required — use #task-name.\nUsage: `/create-subtask "Name" #task [#agent]`', None

    project, proj_err = await _resolve_project(args, orchestrator_id, db, room_project_id)
    if project:
        tasks = (await db.execute(
            select(HuntTask).join(Epic).where(Epic.project_id == project.id)
        )).scalars().all()
    else:
        tasks = (await db.execute(
            select(HuntTask).join(Epic).join(Project).where(Project.orchestrator_id == orchestrator_id)
        )).scalars().all()

    task = _fuzzy(task_name, tasks, attr="title")
    if not task:
        available = ", ".join(f"*{t.title}*" for t in tasks[:5])
        return f"❌ Task not found: **{task_name}**. Available: {available or 'none'}", None

    assignee_id = None
    agent = None
    if agent_name:
        agent_result = await db.execute(
            select(Agent).where(Agent.name == agent_name, Agent.orchestrator_id == orchestrator_id)
        )
        agent = agent_result.scalar_one_or_none()
        if agent:
            assignee_id = agent.id

    sub = Subtask(task_id=task.id, title=name, assignee_id=assignee_id)
    db.add(sub)
    await db.commit()

    response = f"↳ **Subtask created:** {name} under *{task.title}*"
    # No dispatch for subtasks (they don't trigger agent work independently)
    return response, None


async def _assign(
    args: str, orchestrator_id: str, db: AsyncSession,
    room_project_id: str | None, room: str,
) -> CommandResult:
    hashes = _hashes(args)
    item_name = hashes[0] if hashes else None
    agent_name = hashes[1] if len(hashes) > 1 else None

    if not item_name or not agent_name:
        return "❌ Both task and agent required.\nUsage: `/assign #task-name #agent`", None

    agent_result = await db.execute(
        select(Agent).where(Agent.name == agent_name, Agent.orchestrator_id == orchestrator_id)
    )
    agent = agent_result.scalar_one_or_none()
    if not agent:
        all_agents = (await db.execute(
            select(Agent).where(Agent.orchestrator_id == orchestrator_id)
        )).scalars().all()
        available = ", ".join(f"*{a.name}*" for a in all_agents[:5])
        return f"❌ Agent not found: **{agent_name}**. Available: {available or 'none'}", None

    # Only A2A agents can receive task dispatch
    if agent.protocol != AgentProtocol.a2a:
        return f"❌ **{agent_name}** uses the `{agent.protocol.value}` protocol. Only A2A agents support task dispatch. Configure their endpoint as A2A in Pack settings.", None

    # Validate agent is assigned to this project (if we're in a project room)
    if room_project_id:
        from api.models.project import ProjectAgent
        pa_result = await db.execute(
            select(ProjectAgent).where(
                ProjectAgent.project_id == uuid_lib.UUID(room_project_id),
                ProjectAgent.agent_id == agent.id,
            )
        )
        if not pa_result.scalar_one_or_none():
            return f"❌ **{agent_name}** is not assigned to this project. Add them via Dashboard → Project → Pack first.", None

    # Try task first
    project, proj_err = await _resolve_project(args, orchestrator_id, db, room_project_id)
    if project:
        tasks = (await db.execute(
            select(HuntTask).join(Epic).where(Epic.project_id == project.id)
        )).scalars().all()
    else:
        tasks = (await db.execute(
            select(HuntTask).join(Epic).join(Project).where(Project.orchestrator_id == orchestrator_id)
        )).scalars().all()

    task = _fuzzy(item_name, tasks, attr="title")
    if task:
        task.assignee_id = agent.id
        await db.commit()

        dispatch_info = {
            "agent_name": agent.name,
            "agent_id": str(agent.id),
            "task_id": str(task.id),
            "task_title": task.title,
            "room": room,
        }
        return f"✅ **{task.title}** assigned to **{agent_name}**", dispatch_info

    available = ", ".join(f"*{t.title}*" for t in tasks[:5])
    return f"❌ Task not found: **{item_name}**. Available: {available or 'none'}", None


async def _set_status(args: str, orchestrator_id: str, db: AsyncSession, room_project_id: str | None) -> str:
    item_name = _hash(args)
    # Last word is the status
    parts = args.strip().split()
    new_status = parts[-1] if parts else ""
    valid = ("todo", "in_progress", "in-progress", "review", "done", "blocked")
    if new_status not in valid:
        return "❌ Invalid status.\nUsage: `/status #task-name <todo|in_progress|review|done|blocked>`"
    if new_status == "in-progress":
        new_status = "in_progress"
    if not item_name:
        return "❌ Task reference required.\nUsage: `/status #task-name <status>`"

    project, proj_err = await _resolve_project(args, orchestrator_id, db, room_project_id)
    if project:
        tasks = (await db.execute(
            select(HuntTask).join(Epic).where(Epic.project_id == project.id)
        )).scalars().all()
    else:
        tasks = (await db.execute(
            select(HuntTask).join(Epic).join(Project).where(Project.orchestrator_id == orchestrator_id)
        )).scalars().all()

    task = _fuzzy(item_name, tasks, attr="title")
    if not task:
        available = ", ".join(f"*{t.title}*" for t in tasks[:5])
        return f"❌ Task not found: **{item_name}**. Available: {available or 'none'}"

    task.status = new_status
    task.updated_at = datetime.utcnow()
    await db.commit()
    labels = {"todo": "Spotted", "in_progress": "Chasing", "review": "Circling", "done": "Caught", "blocked": "Cornered"}
    return f"🔄 **{task.title}** → {labels.get(new_status, new_status)}"


async def _list_projects(orchestrator_id: str, db: AsyncSession) -> str:
    projects = (await db.execute(
        select(Project).where(Project.orchestrator_id == orchestrator_id).order_by(Project.created_at)
    )).scalars().all()
    if not projects:
        return "No projects yet. Use `/create-project \"Name\"` to start."
    lines = ["🎯 **Projects:**"]
    for p in projects:
        lines.append(f"  · {p.name}")
    return "\n".join(lines)


async def _list_sprints(args: str, orchestrator_id: str, db: AsyncSession, room_project_id: str | None) -> str:
    project, proj_err = await _resolve_project(args, orchestrator_id, db, room_project_id)
    if proj_err: return proj_err
    if not project:
        return "❌ No project context. Use this command from a project Den, or specify #project-name."

    sprints = (await db.execute(
        select(Sprint).where(Sprint.project_id == project.id).order_by(Sprint.created_at)
    )).scalars().all()
    if not sprints:
        return f"No sprints in *{project.name}* yet."
    lines = [f"🏃 **Sprints in {project.name}:**"]
    for s in sprints:
        dates = f" ({s.start_date.strftime('%b %d')} → {s.end_date.strftime('%b %d')})" if s.start_date and s.end_date else ""
        lines.append(f"  · [{s.status}] {s.name}{dates}")
    return "\n".join(lines)


async def _list_epics(args: str, orchestrator_id: str, db: AsyncSession, room_project_id: str | None) -> str:
    project, proj_err = await _resolve_project(args, orchestrator_id, db, room_project_id)
    if proj_err: return proj_err
    if not project:
        return "❌ No project context. Use this command from a project Den, or specify #project-name."

    epics = (await db.execute(
        select(Epic).where(Epic.project_id == project.id).order_by(Epic.created_at)
    )).scalars().all()
    if not epics:
        return f"No epics in *{project.name}* yet."
    lines = [f"🟣 **Epics in {project.name}:**"]
    for e in epics:
        due = f" · due {e.due_date.strftime('%b %d')}" if e.due_date else ""
        lines.append(f"  · [{e.status}] {e.title} [{e.priority}]{due}")
    return "\n".join(lines)


async def _list_stories(args: str, orchestrator_id: str, db: AsyncSession, room_project_id: str | None) -> str:
    project, proj_err = await _resolve_project(args, orchestrator_id, db, room_project_id)
    if proj_err: return proj_err
    if not project:
        return "❌ No project context. Use this command from a project Den, or specify #project-name."

    stories = (await db.execute(
        select(Story).join(Epic).where(Epic.project_id == project.id).order_by(Epic.title, Story.created_at)
    )).scalars().all()
    if not stories:
        return f"No stories in *{project.name}* yet."
    lines = [f"📖 **Stories in {project.name}:**"]
    # Group by epic
    epic_ids = list(dict.fromkeys(s.epic_id for s in stories))
    epics_map = {}
    for eid in epic_ids:
        r = await db.execute(select(Epic).where(Epic.id == eid))
        e = r.scalar_one_or_none()
        if e:
            epics_map[str(eid)] = e.title
    for s in stories:
        epic_name = epics_map.get(str(s.epic_id), "?")
        pts = f" · {s.story_points}pts" if s.story_points else ""
        lines.append(f"  · [{epic_name}] {s.title} [{s.priority}]{pts}")
    return "\n".join(lines)


async def _list_tasks(args: str, orchestrator_id: str, db: AsyncSession, room_project_id: str | None) -> str:
    project, proj_err = await _resolve_project(args, orchestrator_id, db, room_project_id)
    if proj_err: return proj_err
    if not project:
        return "❌ No project context. Use this command from a project Den, or specify #project-name."

    tasks = (await db.execute(
        select(HuntTask).join(Epic).where(Epic.project_id == project.id).order_by(HuntTask.status, HuntTask.created_at)
    )).scalars().all()
    if not tasks:
        return f"No tasks in *{project.name}* yet."
    lines = [f"☐ **Tasks in {project.name}:** ({len(tasks)} total)"]
    for t in tasks:
        assignee = f" → {t.assignee_id}" if t.assignee_id else ""
        lines.append(f"  · [{t.status}] {t.title} [{t.priority}]{assignee}")
    return "\n".join(lines)


async def _assign_sprint(args: str, orchestrator_id: str, db: AsyncSession, room_project_id: str | None) -> str:
    """
    /sprint #item-name #sprint-name
    Assigns an epic, story, or task to the named sprint.
    """
    hashes = _hashes(args)
    if len(hashes) < 2:
        return "❌ Usage: `/sprint #item-name #sprint-name`"

    item_name = hashes[0]
    sprint_name = hashes[1]

    project, proj_err = await _resolve_project(args, orchestrator_id, db, room_project_id)
    if proj_err: return proj_err
    if not project:
        return "❌ No project context."

    # Find sprint
    sprints = (await db.execute(select(Sprint).where(Sprint.project_id == project.id))).scalars().all()
    sprint = _fuzzy(sprint_name, sprints)
    if not sprint:
        available = ", ".join(f"*{s.name}*" for s in sprints)
        return f"❌ Sprint not found: **{sprint_name}**. Available: {available or 'none'}"

    # Try task first
    tasks = (await db.execute(select(HuntTask).join(Epic).where(Epic.project_id == project.id))).scalars().all()
    task = _fuzzy(item_name, tasks, attr="title")
    if task:
        task.sprint_id = sprint.id
        await db.commit()
        return f"✅ Task **{task.title}** → sprint *{sprint.name}*"

    # Try story
    stories = (await db.execute(select(Story).join(Epic).where(Epic.project_id == project.id))).scalars().all()
    story = _fuzzy(item_name, stories, attr="title")
    if story:
        story.sprint_id = sprint.id
        await db.commit()
        return f"✅ Story **{story.title}** → sprint *{sprint.name}*"

    # Try epic — assign all tasks in the epic to the sprint
    epics = (await db.execute(select(Epic).where(Epic.project_id == project.id))).scalars().all()
    epic = _fuzzy(item_name, epics, attr="title")
    if epic:
        epic_tasks = (await db.execute(select(HuntTask).where(HuntTask.epic_id == epic.id))).scalars().all()
        epic_stories = (await db.execute(select(Story).where(Story.epic_id == epic.id))).scalars().all()
        for t in epic_tasks:
            t.sprint_id = sprint.id
        for s in epic_stories:
            s.sprint_id = sprint.id
        await db.commit()
        return f"✅ Epic **{epic.title}** ({len(epic_tasks)} tasks, {len(epic_stories)} stories) → sprint *{sprint.name}*"

    return f"❌ Item not found: **{item_name}**. Use the exact name (hyphens for spaces)."
