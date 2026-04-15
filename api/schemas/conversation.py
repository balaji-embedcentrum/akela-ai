from pydantic import BaseModel, Field
from typing import Optional, List
from uuid import UUID
from datetime import datetime


class WorkspaceCreate(BaseModel):
    name: str
    color: str = "#4a9eff"


class WorkspaceResponse(BaseModel):
    id: UUID
    name: str
    color: str
    sort_order: int
    created_at: datetime

    model_config = {"from_attributes": True}


class ConversationCreate(BaseModel):
    title: str = "New Chat"
    workspace_id: Optional[UUID] = None


class ConversationUpdate(BaseModel):
    title: Optional[str] = None
    workspace_id: Optional[UUID] = None


class ConversationResponse(BaseModel):
    id: UUID
    orchestrator_id: UUID
    workspace_id: Optional[UUID]
    title: str
    room: str
    created_at: datetime
    updated_at: datetime
    last_message: Optional[str] = None

    model_config = {"from_attributes": True}
