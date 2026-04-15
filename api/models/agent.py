import uuid
from datetime import datetime
from enum import Enum
from sqlalchemy import String, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB, ARRAY
from api.db.session import Base


class AgentStatus(str, Enum):
    online = "online"
    offline = "offline"
    busy = "busy"


class AgentRank(str, Enum):
    omega = "omega"
    delta = "delta"
    beta = "beta"
    alpha = "alpha"


class AgentProtocol(str, Enum):
    openai = "openai"    # OpenAI-compatible /v1/chat/completions (Hermes, LiteLLM, etc.)
    a2a = "a2a"          # Google A2A — JSON-RPC tasks/send + Agent Card discovery
    acp = "acp"          # IBM/BeeAI ACP — REST POST /runs endpoint
    adapter = "adapter"  # No endpoint — uses akela-adapter SSE bridge


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    orchestrator_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("orchestrators.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    display_name: Mapped[str] = mapped_column(String, nullable=True)
    api_key: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    endpoint_url: Mapped[str] = mapped_column(String, default="", server_default="")
    protocol: Mapped[AgentProtocol] = mapped_column(
        SAEnum(AgentProtocol, native_enum=False), default=AgentProtocol.openai, server_default="openai", nullable=False
    )
    soul: Mapped[dict] = mapped_column(JSONB, default=dict)
    skills: Mapped[list] = mapped_column(ARRAY(String), default=list)
    status: Mapped[AgentStatus] = mapped_column(SAEnum(AgentStatus), default=AgentStatus.offline)
    rank: Mapped[AgentRank] = mapped_column(SAEnum(AgentRank), default=AgentRank.omega)
    bearer_token: Mapped[str] = mapped_column(String, nullable=True)
    version: Mapped[str] = mapped_column(String, nullable=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    orchestrator = relationship("Orchestrator", back_populates="agents")
    trust_score = relationship("AgentTrustScore", back_populates="agent", uselist=False, cascade="all, delete-orphan")
    trust_events = relationship("TrustEvent", back_populates="agent", cascade="all, delete-orphan")
