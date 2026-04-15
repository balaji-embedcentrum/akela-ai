import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Text, Integer, DateTime, ForeignKey, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.db.session import Base


class AkelaProject(Base):
    """Top-level workstream. Scopes Den, Hunt, Prey, Howl and assigned agents."""
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("orchestrators.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    color: Mapped[str] = mapped_column(String, default="#4a9eff", server_default="#4a9eff")
    orchestrator_type: Mapped[str] = mapped_column(String, default="human", server_default="human")
    orchestrator_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    slug: Mapped[Optional[str]] = mapped_column(String(3), nullable=True, unique=True)
    issue_counter: Mapped[int] = mapped_column(Integer, default=1000, server_default="1000")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    project_agents: Mapped[list["ProjectAgent"]] = relationship(
        "ProjectAgent", back_populates="project", cascade="all, delete-orphan"
    )


class ProjectAgent(Base):
    """Join table — which agents are assigned to which projects."""
    __tablename__ = "project_agents"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    agent_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("agents.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[str] = mapped_column(String, default="worker", server_default="worker")
    added_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    project: Mapped["AkelaProject"] = relationship("AkelaProject", back_populates="project_agents")
