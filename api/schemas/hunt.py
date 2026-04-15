"""Hunt — Pydantic schemas for Projects, Epics, Sprints, Stories, Tasks, Subtasks."""
from pydantic import BaseModel, Field
from typing import Optional, List
from uuid import UUID
from datetime import datetime


# ── Projects ─────────────────────────────────────────────────────────
class ProjectCreate(BaseModel):
    name: str
    description: str = ""
    akela_project_id: Optional[UUID] = None   # link to Akela project on create

class ProjectResponse(BaseModel):
    id: UUID
    name: str
    description: str
    created_by: str
    created_at: datetime
    model_config = {"from_attributes": True}


# ── Epics ────────────────────────────────────────────────────────────
class EpicCreate(BaseModel):
    title: str
    description: str = ""
    priority: str = "P2"
    due_date: Optional[datetime] = None

class EpicUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    due_date: Optional[datetime] = None

class EpicResponse(BaseModel):
    id: UUID
    project_id: UUID
    title: str
    description: str
    status: str
    priority: str
    due_date: Optional[datetime] = None
    issue_number: Optional[int] = None
    created_at: datetime
    model_config = {"from_attributes": True}


# ── Sprints ──────────────────────────────────────────────────────────
class SprintCreate(BaseModel):
    name: str
    goal: str = ""
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None

class SprintUpdate(BaseModel):
    name: Optional[str] = None
    goal: Optional[str] = None
    status: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None

class SprintResponse(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    goal: str
    status: str
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    issue_number: Optional[int] = None
    created_at: datetime
    model_config = {"from_attributes": True}


# ── Stories ──────────────────────────────────────────────────────────
class StoryCreate(BaseModel):
    title: str
    description: str = ""
    priority: str = "P2"
    story_points: Optional[int] = None
    due_date: Optional[datetime] = None
    sprint_id: Optional[UUID] = None

class StoryUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    story_points: Optional[int] = None
    due_date: Optional[datetime] = None
    sprint_id: Optional[UUID] = None

class StoryResponse(BaseModel):
    id: UUID
    epic_id: UUID
    sprint_id: Optional[UUID] = None
    title: str
    description: str
    status: str
    priority: str
    story_points: Optional[int] = None
    due_date: Optional[datetime] = None
    issue_number: Optional[int] = None
    created_at: datetime
    model_config = {"from_attributes": True}


# ── Tasks ────────────────────────────────────────────────────────────
class TaskCreate(BaseModel):
    title: str
    description: str = ""
    priority: str = "P2"
    assignee_id: Optional[UUID] = None
    sprint_id: Optional[UUID] = None
    story_id: Optional[UUID] = None
    due_date: Optional[datetime] = None
    labels: List[str] = Field(default_factory=list)
    estimate: Optional[str] = None

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    assignee_id: Optional[UUID] = None
    sprint_id: Optional[UUID] = None
    story_id: Optional[UUID] = None
    due_date: Optional[datetime] = None
    labels: Optional[List[str]] = None
    estimate: Optional[str] = None

class TaskStatusUpdate(BaseModel):
    status: str  # todo, in_progress, review, done, blocked

class TaskResponse(BaseModel):
    id: UUID
    epic_id: UUID
    story_id: Optional[UUID] = None
    sprint_id: Optional[UUID] = None
    assignee_id: Optional[UUID] = None
    assignee_name: Optional[str] = None
    title: str
    description: str
    status: str
    priority: str
    due_date: Optional[datetime] = None
    labels: List[str]
    estimate: Optional[str] = None
    issue_number: Optional[int] = None
    created_by: str
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


# ── Subtasks ─────────────────────────────────────────────────────────
class SubtaskCreate(BaseModel):
    title: str
    description: str = ""
    assignee_id: Optional[UUID] = None
    due_date: Optional[datetime] = None

class SubtaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    assignee_id: Optional[UUID] = None
    due_date: Optional[datetime] = None

class SubtaskResponse(BaseModel):
    id: UUID
    task_id: UUID
    assignee_id: Optional[UUID] = None
    assignee_name: Optional[str] = None
    title: str
    description: str
    status: str
    due_date: Optional[datetime] = None
    issue_number: Optional[int] = None
    created_at: datetime
    model_config = {"from_attributes": True}
