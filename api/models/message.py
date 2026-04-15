import uuid
from datetime import datetime
from enum import Enum
from sqlalchemy import String, Text, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, ARRAY, JSONB
from api.db.session import Base


class MentionType(str, Enum):
    broadcast = "broadcast"   # @all
    direct = "direct"         # @agentname
    system = "system"         # system event
    normal = "normal"         # no mention


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    orchestrator_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("orchestrators.id", ondelete="CASCADE"), nullable=True)
    # sender can be agent_id or "orchestrator" for Alpha
    agent_id: Mapped[str] = mapped_column(String, nullable=True)
    sender_name: Mapped[str] = mapped_column(String, nullable=False, default="system")
    sender_role: Mapped[str] = mapped_column(String, nullable=False, default="agent")  # "alpha" | "agent" | "system"
    room: Mapped[str] = mapped_column(String, nullable=False, default="general")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    mentions: Mapped[list] = mapped_column(ARRAY(String), default=list)
    mention_type: Mapped[MentionType] = mapped_column(SAEnum(MentionType), default=MentionType.normal)
    slash_command: Mapped[str] = mapped_column(String, nullable=True)  # parsed command if any
    msg_metadata: Mapped[dict] = mapped_column(JSONB, nullable=True)  # usage stats: {tokens, t/s, model, duration}
    attachments: Mapped[list | None] = mapped_column(JSONB, nullable=True)   # [{name, type}] metadata only, no base64
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
