import uuid
from datetime import datetime
from enum import Enum
from sqlalchemy import String, Text, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
from api.db.session import Base


class MeetingType(str, Enum):
    standup = "standup"
    retro = "retro"
    weekly = "weekly"


class MeetingStatus(str, Enum):
    scheduled = "scheduled"
    active = "active"
    complete = "complete"


class StandupConfig(Base):
    """A named standup schedule — the template that spawns Meeting runs."""
    __tablename__ = "standup_configs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    orchestrator_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("orchestrators.id"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("hunt_projects.id"), nullable=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    schedule_time: Mapped[str] = mapped_column(String, nullable=True)   # e.g. "09:00"
    schedule_days: Mapped[str] = mapped_column(String, nullable=True)   # e.g. "mon,tue,wed,thu,fri"
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_run_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)

    orchestrator = relationship("Orchestrator")
    runs = relationship("Meeting", back_populates="standup_config", cascade="all, delete-orphan")


class Meeting(Base):
    __tablename__ = "meetings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    orchestrator_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("orchestrators.id"), nullable=False)
    standup_config_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("standup_configs.id"), nullable=True)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("hunt_projects.id"), nullable=True)
    name: Mapped[str] = mapped_column(String, nullable=True)
    type: Mapped[MeetingType] = mapped_column(SAEnum(MeetingType), nullable=False)
    status: Mapped[MeetingStatus] = mapped_column(SAEnum(MeetingStatus), default=MeetingStatus.scheduled)
    transcript: Mapped[dict] = mapped_column(JSONB, default=dict)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    completed_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)

    orchestrator = relationship("Orchestrator", back_populates="meetings")
    standup_config = relationship("StandupConfig", back_populates="runs")
