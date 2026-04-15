from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import datetime
from api.models.meeting import MeetingType, MeetingStatus


class StandupConfigCreate(BaseModel):
    name: str
    description: str = ""
    project_id: Optional[UUID] = None
    schedule_time: Optional[str] = None   # "09:00"
    schedule_days: Optional[str] = None   # "mon,tue,wed,thu,fri"


class StandupConfigUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    project_id: Optional[UUID] = None
    schedule_time: Optional[str] = None
    schedule_days: Optional[str] = None


class StandupConfigResponse(BaseModel):
    id: UUID
    orchestrator_id: UUID
    project_id: Optional[UUID]
    name: str
    description: str
    schedule_time: Optional[str]
    schedule_days: Optional[str]
    created_at: datetime
    last_run_at: Optional[datetime]

    model_config = {"from_attributes": True}


class MeetingResponse(BaseModel):
    id: UUID
    orchestrator_id: UUID
    standup_config_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    name: Optional[str] = None
    type: MeetingType
    status: MeetingStatus
    transcript: dict
    scheduled_at: datetime
    completed_at: Optional[datetime]

    model_config = {"from_attributes": True}


class MeetingRespond(BaseModel):
    content: str
    capacity: Optional[str] = None
    blockers: Optional[str] = None
