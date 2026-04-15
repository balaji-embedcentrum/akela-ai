import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from api.db.session import Base


class PushSubscription(Base):
    """
    A Web Push subscription registered by a user's browser.

    One orchestrator can have multiple subscriptions (phone, laptop, tablet).
    The endpoint URL is unique — if the same browser re-subscribes we update
    the existing row instead of inserting a duplicate.
    """

    __tablename__ = "push_subscriptions"
    __table_args__ = (UniqueConstraint("endpoint", name="uq_push_endpoint"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    orchestrator_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orchestrators.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Push service endpoint URL — where we POST to deliver a message.
    endpoint: Mapped[str] = mapped_column(String, nullable=False)
    # Keys from the browser's PushSubscription.getKey() output (base64url).
    p256dh: Mapped[str] = mapped_column(String, nullable=False)
    auth: Mapped[str] = mapped_column(String, nullable=False)
    # Optional user-agent string for display in the settings UI ("iPhone — Safari").
    user_agent: Mapped[str] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
