import uuid
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel


class ProjectCreate(BaseModel):
    name: str
    description: str = ""
    color: str = "#4a9eff"
    slug: Optional[str] = None  # auto-derived from name if omitted


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    orchestrator_type: Optional[str] = None   # 'human' | 'agent'
    orchestrator_id: Optional[uuid.UUID] = None
    sort_order: Optional[int] = None


class ProjectResponse(BaseModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    name: str
    description: str
    color: str
    slug: Optional[str]
    orchestrator_type: str
    orchestrator_id: Optional[uuid.UUID]
    sort_order: int
    created_at: datetime

    model_config = {"from_attributes": True}


class ProjectAgentAdd(BaseModel):
    agent_id: uuid.UUID
    role: str = "worker"   # 'worker' | 'observer'


class ProjectAgentResponse(BaseModel):
    project_id: uuid.UUID
    agent_id: uuid.UUID
    role: str
    added_at: datetime

    model_config = {"from_attributes": True}
