"""Hunt — Project management API endpoints."""
import uuid
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from sqlalchemy import update as sa_update
import redis.asyncio as aioredis
from api.db.session import get_db
from api.dependencies import get_current_orchestrator, get_current_agent, get_redis
from api.services import pubsub
from api.models.orchestrator import Orchestrator
from api.models.agent import Agent
from api.models.hunt import Project, Epic, Sprint, Story, HuntTask, Subtask
from api.models.project import AkelaProject
from api.schemas.hunt import (
    ProjectCreate, ProjectResponse,
    EpicCreate, EpicUpdate, EpicResponse,
    SprintCreate, SprintUpdate, SprintResponse,
    StoryCreate, StoryUpdate, StoryResponse,
    TaskCreate, TaskUpdate, TaskStatusUpdate, TaskResponse,
    SubtaskCreate, SubtaskUpdate, SubtaskResponse,
)

router = APIRouter(prefix="/hunt", tags=["hunt"])


async def _next_issue(db: AsyncSession, hunt_project_id: uuid.UUID) -> int:
    """Atomically increment and return the next issue number for the linked Akela project."""
    hp = await db.execute(select(Project).where(Project.id == hunt_project_id))
    hunt_proj = hp.scalar_one_or_none()
    if not hunt_proj or not hunt_proj.project_id:
        return 1001
    result = await db.execute(
        sa_update(AkelaProject)
        .where(AkelaProject.id == hunt_proj.project_id)
        .values(issue_counter=AkelaProject.issue_counter + 1)
        .returning(AkelaProject.issue_counter)
    )
    await db.flush()
    row = result.fetchone()
    return row[0] if row else 1001

WOLF_COLUMNS = [
    {"status": "todo",        "label": "Spotted",   "color": "#888"},
    {"status": "in_progress", "label": "Chasing",   "color": "#4a9eff"},
    {"status": "review",      "label": "Circling",  "color": "#f5a623"},
    {"status": "done",        "label": "Caught",    "color": "#4caf50"},
    {"status": "blocked",     "label": "Cornered",  "color": "#f44336"},
]


# ── Helpers ───────────────────────────────────────────────────────────
def task_to_dict(task: HuntTask) -> dict:
    data = TaskResponse.model_validate(task).model_dump()
    if task.assignee:
        data["assignee_name"] = task.assignee.name
    return data

def subtask_to_dict(sub: Subtask) -> dict:
    data = SubtaskResponse.model_validate(sub).model_dump()
    if sub.assignee:
        data["assignee_name"] = sub.assignee.name
    return data


# ══════════════════════════════════════════════════════════════════════
#  PROJECTS
# ══════════════════════════════════════════════════════════════════════

@router.post("/projects", response_model=ProjectResponse)
async def create_project(data: ProjectCreate, orch: Orchestrator = Depends(get_current_orchestrator), db: AsyncSession = Depends(get_db)):
    project = Project(
        orchestrator_id=orch.id, name=data.name, description=data.description,
        created_by="alpha", project_id=data.akela_project_id,
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return ProjectResponse.model_validate(project)


@router.get("/projects", response_model=List[ProjectResponse])
async def list_projects(
    akela_project_id: Optional[uuid.UUID] = Query(None),
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    q = select(Project).where(Project.orchestrator_id == orch.id)
    if akela_project_id is not None:
        q = q.where(Project.project_id == akela_project_id)
    result = await db.execute(q.order_by(Project.created_at.desc()))
    return [ProjectResponse.model_validate(p) for p in result.scalars().all()]


@router.delete("/projects/{project_id}")
async def delete_project(project_id: uuid.UUID, orch: Orchestrator = Depends(get_current_orchestrator), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Project).where(Project.id == project_id, Project.orchestrator_id == orch.id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")
    await db.delete(project)
    await db.commit()
    return {"detail": "Project deleted"}


# ══════════════════════════════════════════════════════════════════════
#  EPICS
# ══════════════════════════════════════════════════════════════════════

@router.post("/projects/{project_id}/epics", response_model=EpicResponse)
async def create_epic(project_id: uuid.UUID, data: EpicCreate, orch: Orchestrator = Depends(get_current_orchestrator), db: AsyncSession = Depends(get_db)):
    proj = await db.execute(select(Project).where(Project.id == project_id, Project.orchestrator_id == orch.id))
    if not proj.scalar_one_or_none():
        raise HTTPException(404, "Project not found")
    num = await _next_issue(db, project_id)
    epic = Epic(project_id=project_id, title=data.title, description=data.description, priority=data.priority, due_date=data.due_date, issue_number=num)
    db.add(epic)
    await db.commit()
    await db.refresh(epic)
    return EpicResponse.model_validate(epic)


@router.get("/projects/{project_id}/epics", response_model=List[EpicResponse])
async def list_epics(project_id: uuid.UUID, orch: Orchestrator = Depends(get_current_orchestrator), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Epic).where(Epic.project_id == project_id).order_by(Epic.created_at))
    return [EpicResponse.model_validate(e) for e in result.scalars().all()]


@router.put("/epics/{epic_id}", response_model=EpicResponse)
async def update_epic(epic_id: uuid.UUID, data: EpicUpdate, orch: Orchestrator = Depends(get_current_orchestrator), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Epic).where(Epic.id == epic_id))
    epic = result.scalar_one_or_none()
    if not epic:
        raise HTTPException(404, "Epic not found")
    for field, val in data.model_dump(exclude_none=True).items():
        setattr(epic, field, val)
    await db.commit()
    await db.refresh(epic)
    return EpicResponse.model_validate(epic)


@router.delete("/epics/{epic_id}")
async def delete_epic(epic_id: uuid.UUID, orch: Orchestrator = Depends(get_current_orchestrator), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Epic).where(Epic.id == epic_id))
    epic = result.scalar_one_or_none()
    if not epic:
        raise HTTPException(404, "Epic not found")
    await db.delete(epic)
    await db.commit()
    return {"detail": "Epic deleted"}


# ══════════════════════════════════════════════════════════════════════
#  SPRINTS
# ══════════════════════════════════════════════════════════════════════

@router.post("/projects/{project_id}/sprints", response_model=SprintResponse)
async def create_sprint(project_id: uuid.UUID, data: SprintCreate, orch: Orchestrator = Depends(get_current_orchestrator), db: AsyncSession = Depends(get_db)):
    proj = await db.execute(select(Project).where(Project.id == project_id, Project.orchestrator_id == orch.id))
    if not proj.scalar_one_or_none():
        raise HTTPException(404, "Project not found")
    num = await _next_issue(db, project_id)
    sprint = Sprint(project_id=project_id, name=data.name, goal=data.goal, start_date=data.start_date, end_date=data.end_date, issue_number=num)
    db.add(sprint)
    await db.commit()
    await db.refresh(sprint)
    return SprintResponse.model_validate(sprint)


@router.get("/projects/{project_id}/sprints", response_model=List[SprintResponse])
async def list_sprints(project_id: uuid.UUID, orch: Orchestrator = Depends(get_current_orchestrator), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Sprint).where(Sprint.project_id == project_id).order_by(Sprint.created_at.desc()))
    return [SprintResponse.model_validate(s) for s in result.scalars().all()]


@router.put("/sprints/{sprint_id}", response_model=SprintResponse)
async def update_sprint(sprint_id: uuid.UUID, data: SprintUpdate, orch: Orchestrator = Depends(get_current_orchestrator), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Sprint).where(Sprint.id == sprint_id))
    sprint = result.scalar_one_or_none()
    if not sprint:
        raise HTTPException(404, "Sprint not found")
    for field, val in data.model_dump(exclude_none=True).items():
        setattr(sprint, field, val)
    await db.commit()
    await db.refresh(sprint)
    return SprintResponse.model_validate(sprint)


@router.delete("/sprints/{sprint_id}")
async def delete_sprint(sprint_id: uuid.UUID, orch: Orchestrator = Depends(get_current_orchestrator), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Sprint).where(Sprint.id == sprint_id))
    sprint = result.scalar_one_or_none()
    if not sprint:
        raise HTTPException(404, "Sprint not found")
    await db.delete(sprint)
    await db.commit()
    return {"detail": "Sprint deleted"}


# ══════════════════════════════════════════════════════════════════════
#  STORIES
# ══════════════════════════════════════════════════════════════════════

@router.post("/epics/{epic_id}/stories", response_model=StoryResponse)
async def create_story(epic_id: uuid.UUID, data: StoryCreate, orch: Orchestrator = Depends(get_current_orchestrator), db: AsyncSession = Depends(get_db)):
    epic_result = await db.execute(select(Epic).where(Epic.id == epic_id))
    epic = epic_result.scalar_one_or_none()
    if not epic:
        raise HTTPException(404, "Epic not found")
    num = await _next_issue(db, epic.project_id)
    story = Story(epic_id=epic_id, title=data.title, description=data.description, priority=data.priority,
                  story_points=data.story_points, due_date=data.due_date, sprint_id=data.sprint_id, issue_number=num)
    db.add(story)
    await db.commit()
    await db.refresh(story)
    return StoryResponse.model_validate(story)


@router.get("/epics/{epic_id}/stories", response_model=List[StoryResponse])
async def list_stories(epic_id: uuid.UUID, orch: Orchestrator = Depends(get_current_orchestrator), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Story).where(Story.epic_id == epic_id).order_by(Story.created_at))
    return [StoryResponse.model_validate(s) for s in result.scalars().all()]


@router.get("/projects/{project_id}/stories", response_model=List[StoryResponse])
async def list_project_stories(project_id: uuid.UUID, orch: Orchestrator = Depends(get_current_orchestrator), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Story).join(Epic).where(Epic.project_id == project_id).order_by(Story.created_at)
    )
    return [StoryResponse.model_validate(s) for s in result.scalars().all()]


@router.put("/stories/{story_id}", response_model=StoryResponse)
async def update_story(story_id: uuid.UUID, data: StoryUpdate, orch: Orchestrator = Depends(get_current_orchestrator), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Story).where(Story.id == story_id))
    story = result.scalar_one_or_none()
    if not story:
        raise HTTPException(404, "Story not found")
    for field, val in data.model_dump(exclude_none=True).items():
        setattr(story, field, val)
    await db.commit()
    await db.refresh(story)
    return StoryResponse.model_validate(story)


@router.delete("/stories/{story_id}")
async def delete_story(story_id: uuid.UUID, orch: Orchestrator = Depends(get_current_orchestrator), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Story).where(Story.id == story_id))
    story = result.scalar_one_or_none()
    if not story:
        raise HTTPException(404, "Story not found")
    await db.delete(story)
    await db.commit()
    return {"detail": "Story deleted"}


# ══════════════════════════════════════════════════════════════════════
#  TASKS
# ══════════════════════════════════════════════════════════════════════

@router.post("/epics/{epic_id}/tasks", response_model=TaskResponse)
async def create_task(epic_id: uuid.UUID, data: TaskCreate, orch: Orchestrator = Depends(get_current_orchestrator), db: AsyncSession = Depends(get_db)):
    epic_result = await db.execute(select(Epic).where(Epic.id == epic_id))
    epic = epic_result.scalar_one_or_none()
    if not epic:
        raise HTTPException(404, "Epic not found")
    num = await _next_issue(db, epic.project_id)
    task = HuntTask(epic_id=epic_id, story_id=data.story_id, sprint_id=data.sprint_id, issue_number=num,
                    assignee_id=data.assignee_id, title=data.title, description=data.description,
                    priority=data.priority, due_date=data.due_date, labels=data.labels,
                    estimate=data.estimate, created_by="alpha")
    db.add(task)
    await db.commit()
    result = await db.execute(select(HuntTask).options(selectinload(HuntTask.assignee)).where(HuntTask.id == task.id))
    return task_to_dict(result.scalar_one())


@router.get("/tasks")
async def list_tasks(
    project_id: Optional[uuid.UUID] = Query(None),
    epic_id: Optional[uuid.UUID] = Query(None),
    story_id: Optional[uuid.UUID] = Query(None),
    sprint_id: Optional[uuid.UUID] = Query(None),
    assignee_id: Optional[uuid.UUID] = Query(None),
    status: Optional[str] = Query(None),
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    query = select(HuntTask).options(selectinload(HuntTask.assignee))
    if epic_id:
        query = query.where(HuntTask.epic_id == epic_id)
    if story_id:
        query = query.where(HuntTask.story_id == story_id)
    if sprint_id:
        query = query.where(HuntTask.sprint_id == sprint_id)
    if assignee_id:
        query = query.where(HuntTask.assignee_id == assignee_id)
    if status:
        query = query.where(HuntTask.status == status)
    if project_id:
        query = query.join(Epic).where(Epic.project_id == project_id)
    result = await db.execute(query.order_by(HuntTask.created_at.desc()))
    return [task_to_dict(t) for t in result.scalars().all()]


@router.get("/projects/{project_id}/board")
async def project_board(
    project_id: uuid.UUID,
    sprint_id: Optional[uuid.UUID] = Query(None),
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    """Return tasks grouped by wolf-theme kanban columns for the board view."""
    proj = await db.execute(select(Project).where(Project.id == project_id, Project.orchestrator_id == orch.id))
    if not proj.scalar_one_or_none():
        raise HTTPException(404, "Project not found")

    query = select(HuntTask).options(selectinload(HuntTask.assignee)).join(Epic).where(Epic.project_id == project_id)
    if sprint_id:
        query = query.where(HuntTask.sprint_id == sprint_id)
    result = await db.execute(query.order_by(HuntTask.priority, HuntTask.created_at))
    tasks = [task_to_dict(t) for t in result.scalars().all()]

    return {
        "columns": WOLF_COLUMNS,
        "tasks": tasks,
    }


@router.get("/tasks/mine")
async def my_tasks(current: Agent = Depends(get_current_agent), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(HuntTask).options(selectinload(HuntTask.assignee))
        .where(HuntTask.assignee_id == current.id, HuntTask.status.in_(["todo", "in_progress", "review"]))
        .order_by(HuntTask.priority, HuntTask.created_at)
    )
    return [task_to_dict(t) for t in result.scalars().all()]


@router.put("/tasks/{task_id}", response_model=TaskResponse)
async def update_task(task_id: uuid.UUID, data: TaskUpdate, orch: Orchestrator = Depends(get_current_orchestrator), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(HuntTask).options(selectinload(HuntTask.assignee)).where(HuntTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Task not found")
    for field, val in data.model_dump(exclude_none=True).items():
        setattr(task, field, val)
    task.updated_at = datetime.utcnow()
    await db.commit()
    result = await db.execute(select(HuntTask).options(selectinload(HuntTask.assignee)).where(HuntTask.id == task.id))
    return task_to_dict(result.scalar_one())


@router.put("/tasks/{task_id}/status")
async def update_task_status(task_id: uuid.UUID, data: TaskStatusUpdate, db: AsyncSession = Depends(get_db), redis_client: aioredis.Redis = Depends(get_redis)):
    result = await db.execute(select(HuntTask).options(selectinload(HuntTask.assignee)).where(HuntTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Task not found")
    old_status = task.status
    epic_id = task.epic_id
    task_id_str = str(task.id)
    task_title = task.title
    task.status = data.status
    task.updated_at = datetime.utcnow()
    await db.commit()

    # Publish real-time task status update to the project room
    epic_result = await db.execute(select(Epic).where(Epic.id == epic_id))
    epic = epic_result.scalar_one_or_none()
    if epic:
        proj_result = await db.execute(select(Project).where(Project.id == epic.project_id))
        hunt_project = proj_result.scalar_one_or_none()
        if hunt_project and hunt_project.project_id:
            channel = pubsub.chat_channel(str(hunt_project.orchestrator_id), f"proj-{hunt_project.project_id}")
            await pubsub.publish(channel, {"type": "task_status", "task_id": task_id_str, "status": data.status}, redis_client)

    return {"id": task_id_str, "title": task_title, "old_status": old_status, "new_status": data.status}


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: uuid.UUID, orch: Orchestrator = Depends(get_current_orchestrator), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(HuntTask).where(HuntTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Task not found")
    await db.delete(task)
    await db.commit()
    return {"detail": "Task deleted"}


# ══════════════════════════════════════════════════════════════════════
#  SUBTASKS
# ══════════════════════════════════════════════════════════════════════

@router.post("/tasks/{task_id}/subtasks", response_model=SubtaskResponse)
async def create_subtask(task_id: uuid.UUID, data: SubtaskCreate, orch: Orchestrator = Depends(get_current_orchestrator), db: AsyncSession = Depends(get_db)):
    task_result = await db.execute(select(HuntTask).where(HuntTask.id == task_id))
    task = task_result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Task not found")
    epic_result = await db.execute(select(Epic).where(Epic.id == task.epic_id))
    epic = epic_result.scalar_one_or_none()
    num = await _next_issue(db, epic.project_id) if epic else 1001
    sub = Subtask(task_id=task_id, title=data.title, description=data.description,
                  assignee_id=data.assignee_id, due_date=data.due_date, issue_number=num)
    db.add(sub)
    await db.commit()
    result = await db.execute(select(Subtask).options(selectinload(Subtask.assignee)).where(Subtask.id == sub.id))
    return subtask_to_dict(result.scalar_one())


@router.get("/tasks/{task_id}/subtasks")
async def list_subtasks(task_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Subtask).options(selectinload(Subtask.assignee)).where(Subtask.task_id == task_id).order_by(Subtask.created_at))
    return [subtask_to_dict(s) for s in result.scalars().all()]


@router.put("/subtasks/{subtask_id}", response_model=SubtaskResponse)
async def update_subtask(subtask_id: uuid.UUID, data: SubtaskUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Subtask).options(selectinload(Subtask.assignee)).where(Subtask.id == subtask_id))
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(404, "Subtask not found")
    for field, val in data.model_dump(exclude_none=True).items():
        setattr(sub, field, val)
    await db.commit()
    result = await db.execute(select(Subtask).options(selectinload(Subtask.assignee)).where(Subtask.id == sub.id))
    return subtask_to_dict(result.scalar_one())


@router.delete("/subtasks/{subtask_id}")
async def delete_subtask(subtask_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Subtask).where(Subtask.id == subtask_id))
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(404, "Subtask not found")
    await db.delete(sub)
    await db.commit()
    return {"detail": "Subtask deleted"}


# ── Pending Task Dispatch (DB-backed fallback for offline agents) ────

@router.get("/tasks/pending", response_model=List[TaskResponse])
async def get_pending_tasks(
    agent: Agent = Depends(get_current_agent),
    db: AsyncSession = Depends(get_db),
):
    """Get tasks assigned to this agent that are waiting to be worked on.
    
    Agents poll this on startup/reconnect to pick up tasks they missed
    while offline (Redis pubsub is fire-and-forget).
    
    Returns tasks with status 'todo' assigned to the agent, ordered by
    priority (P0 first) then created_at (FIFO).
    """
    result = await db.execute(
        select(HuntTask)
        .options(selectinload(HuntTask.assignee))
        .where(
            HuntTask.assignee_id == agent.id,
            HuntTask.status == "todo",
        )
        .order_by(HuntTask.priority, HuntTask.created_at)
    )
    tasks = result.scalars().all()
    return [
        TaskResponse(
            **{c.name: getattr(t, c.name) for c in HuntTask.__table__.columns},
            assignee_name=t.assignee.name if t.assignee else None,
        )
        for t in tasks
    ]


@router.get("/tasks/active", response_model=Optional[TaskResponse])
async def get_active_task(
    agent: Agent = Depends(get_current_agent),
    db: AsyncSession = Depends(get_db),
):
    """Get the agent's currently active (in_progress) task, if any."""
    result = await db.execute(
        select(HuntTask)
        .options(selectinload(HuntTask.assignee))
        .where(
            HuntTask.assignee_id == agent.id,
            HuntTask.status == "in_progress",
        )
        .order_by(HuntTask.updated_at.desc())
        .limit(1)
    )
    task = result.scalar_one_or_none()
    if not task:
        return None
    return TaskResponse(
        **{c.name: getattr(task, c.name) for c in HuntTask.__table__.columns},
        assignee_name=task.assignee.name if task.assignee else None,
    )

