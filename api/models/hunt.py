"""Hunt — Project management models (Projects, Epics, Sprints, Tasks)."""
import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, ForeignKey, Text, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from api.db.session import Base


# Status/priority are stored as plain strings to avoid PostgreSQL enum collisions
# with the legacy task system. Validation happens at the Pydantic schema layer.

TASK_STATUSES = ("todo", "in_progress", "review", "done", "blocked")
TASK_PRIORITIES = ("P0", "P1", "P2", "P3")
SPRINT_STATUSES = ("planning", "active", "closed")
EPIC_STATUSES = ("open", "in_progress", "done")


class Project(Base):
    __tablename__ = "hunt_projects"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    orchestrator_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("orchestrators.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_by: Mapped[str] = mapped_column(String, default="alpha")
    project_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    epics = relationship("Epic", back_populates="project", cascade="all, delete-orphan")
    sprints = relationship("Sprint", back_populates="project", cascade="all, delete-orphan")


class Epic(Base):
    __tablename__ = "hunt_epics"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("hunt_projects.id"), nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    status: Mapped[str] = mapped_column(String, default="open")
    priority: Mapped[str] = mapped_column(String, default="P2")
    due_date: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    issue_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="epics")
    stories = relationship("Story", back_populates="epic", cascade="all, delete-orphan")
    tasks = relationship("HuntTask", back_populates="epic", cascade="all, delete-orphan")


class Sprint(Base):
    __tablename__ = "hunt_sprints"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("hunt_projects.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    goal: Mapped[str] = mapped_column(Text, default="", server_default="")
    status: Mapped[str] = mapped_column(String, default="planning")
    start_date: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    end_date: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    issue_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="sprints")
    tasks = relationship("HuntTask", back_populates="sprint")


class Story(Base):
    __tablename__ = "hunt_stories"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    epic_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("hunt_epics.id"), nullable=False)
    sprint_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("hunt_sprints.id"), nullable=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    status: Mapped[str] = mapped_column(String, default="todo")
    priority: Mapped[str] = mapped_column(String, default="P2")
    story_points: Mapped[int] = mapped_column(nullable=True)
    due_date: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    issue_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    epic = relationship("Epic", back_populates="stories")
    tasks = relationship("HuntTask", back_populates="story", cascade="all, delete-orphan")


class HuntTask(Base):
    __tablename__ = "hunt_tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    epic_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("hunt_epics.id"), nullable=False)
    story_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("hunt_stories.id"), nullable=True)
    sprint_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("hunt_sprints.id"), nullable=True)
    # SET NULL on agent delete: preserves task history (title, status, comments)
    # and marks it as unassigned instead of blocking the agent's deletion.
    assignee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("agents.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    status: Mapped[str] = mapped_column(String, default="todo")
    priority: Mapped[str] = mapped_column(String, default="P2")
    due_date: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    labels: Mapped[list] = mapped_column(ARRAY(String), default=list)
    estimate: Mapped[str] = mapped_column(String, nullable=True)
    issue_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_by: Mapped[str] = mapped_column(String, default="alpha")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    epic = relationship("Epic", back_populates="tasks")
    story = relationship("Story", back_populates="tasks")
    sprint = relationship("Sprint", back_populates="tasks")
    assignee = relationship("Agent", foreign_keys=[assignee_id])
    subtasks = relationship("Subtask", back_populates="task", cascade="all, delete-orphan")


class Subtask(Base):
    __tablename__ = "hunt_subtasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("hunt_tasks.id"), nullable=False)
    # SET NULL on agent delete — same rationale as HuntTask.assignee_id.
    assignee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("agents.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    status: Mapped[str] = mapped_column(String, default="todo")
    due_date: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    issue_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    task = relationship("HuntTask", back_populates="subtasks")
    assignee = relationship("Agent", foreign_keys=[assignee_id])
