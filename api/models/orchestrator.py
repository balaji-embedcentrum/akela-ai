import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from api.db.session import Base


class Orchestrator(Base):
    __tablename__ = "orchestrators"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    github_id: Mapped[str] = mapped_column(String, unique=True, nullable=True)
    username: Mapped[str] = mapped_column(String, unique=True, nullable=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    email: Mapped[str] = mapped_column(String, nullable=True)
    admin_api_key: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    agents = relationship("Agent", back_populates="orchestrator", cascade="all, delete-orphan")
    meetings = relationship("Meeting", back_populates="orchestrator", cascade="all, delete-orphan")
