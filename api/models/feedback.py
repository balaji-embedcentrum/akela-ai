import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from api.db.session import Base


class MessageFeedback(Base):
    __tablename__ = "message_feedbacks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id"), nullable=False)
    rating: Mapped[str] = mapped_column(String, nullable=False)  # "up" | "down"
    created_by: Mapped[str] = mapped_column(String, nullable=False, default="alpha")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
