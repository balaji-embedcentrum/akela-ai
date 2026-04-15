from pydantic import BaseModel, Field
from typing import Optional, List
from uuid import UUID
from datetime import datetime
from api.models.agent import AgentStatus, AgentRank, AgentProtocol


class AgentRegister(BaseModel):
    name: str
    soul: dict = Field(default_factory=dict)
    skills: List[str] = Field(default_factory=list)
    endpoint_url: str = ""
    protocol: AgentProtocol = AgentProtocol.openai


class AgentUpdate(BaseModel):
    display_name: Optional[str] = None
    skills: Optional[List[str]] = None
    rank: Optional[str] = None
    endpoint_url: Optional[str] = None
    soul: Optional[dict] = None
    protocol: Optional[AgentProtocol] = None
    bearer_token: Optional[str] = None


class AgentResponse(BaseModel):
    id: UUID
    orchestrator_id: UUID
    name: str
    display_name: Optional[str] = None
    endpoint_url: str = ""
    protocol: AgentProtocol = AgentProtocol.openai
    bearer_token: Optional[str] = None
    soul: dict
    skills: List[str]
    status: AgentStatus
    rank: AgentRank
    last_seen_at: Optional[datetime]
    created_at: datetime

    model_config = {"from_attributes": True}


class AgentRegistered(AgentResponse):
    api_key: str


class AgentCardResponse(BaseModel):
    """Parsed A2A Agent Card fields useful for auto-populating agent config."""
    name: str = ""
    description: str = ""
    skills: List[str] = Field(default_factory=list)
    model: str = ""
    streaming: bool = False
    raw: dict = Field(default_factory=dict)

