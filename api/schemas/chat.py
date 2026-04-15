from pydantic import BaseModel, Field, field_serializer
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from api.models.message import MentionType


class MessageCreate(BaseModel):
    room: str = Field(default="general")
    content: str
    attachments: list[dict] = Field(default_factory=list)  # [{name, type, base64}]


class MessageResponse(BaseModel):
    id: UUID
    agent_id: Optional[str]
    sender_name: str
    sender_role: str
    room: str
    content: str
    mentions: List[str]
    mention_type: MentionType
    slash_command: Optional[str]
    msg_metadata: Optional[dict] = None
    attachments: Optional[list] = None
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at")
    def serialize_created_at(self, v: datetime) -> str:
        # Always emit ISO 8601 with Z so browsers parse as UTC, not local time
        return v.strftime("%Y-%m-%dT%H:%M:%S") + "Z"
