import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
import redis.asyncio as aioredis

from api.db.session import get_db
from api.dependencies import get_current_agent, get_current_orchestrator, get_redis
from api.models.agent import Agent
from api.models.meeting import Meeting, MeetingStatus, StandupConfig
from api.models.orchestrator import Orchestrator
from api.schemas.meeting import (
    MeetingResponse, MeetingRespond,
    StandupConfigCreate, StandupConfigUpdate, StandupConfigResponse,
)
from api.services.meeting_scheduler import run_standup_config, start_standup

router = APIRouter(prefix="/meetings", tags=["meetings"])


# ── Standup Configs ────────────────────────────────────────────────────────────

@router.post("/configs", response_model=StandupConfigResponse)
async def create_standup_config(
    data: StandupConfigCreate,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    cfg = StandupConfig(
        orchestrator_id=orch.id,
        name=data.name,
        description=data.description,
        project_id=data.project_id,
        schedule_time=data.schedule_time,
        schedule_days=data.schedule_days,
    )
    db.add(cfg)
    await db.commit()
    await db.refresh(cfg)
    return StandupConfigResponse.model_validate(cfg)


@router.get("/configs", response_model=List[StandupConfigResponse])
async def list_standup_configs(
    project_id: uuid.UUID | None = None,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    q = select(StandupConfig).where(StandupConfig.orchestrator_id == orch.id)
    if project_id is not None:
        q = q.where(StandupConfig.project_id_fk == project_id)
    result = await db.execute(q.order_by(StandupConfig.created_at.desc()))
    return [StandupConfigResponse.model_validate(c) for c in result.scalars().all()]


@router.put("/configs/{config_id}", response_model=StandupConfigResponse)
async def update_standup_config(
    config_id: uuid.UUID,
    data: StandupConfigUpdate,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StandupConfig).where(StandupConfig.id == config_id, StandupConfig.orchestrator_id == orch.id)
    )
    cfg = result.scalar_one_or_none()
    if not cfg:
        raise HTTPException(404, "Standup not found")
    if data.name is not None:
        cfg.name = data.name
    if data.description is not None:
        cfg.description = data.description
    if data.project_id is not None:
        cfg.project_id = data.project_id
    if data.schedule_time is not None:
        cfg.schedule_time = data.schedule_time
    if data.schedule_days is not None:
        cfg.schedule_days = data.schedule_days
    await db.commit()
    await db.refresh(cfg)
    return StandupConfigResponse.model_validate(cfg)


@router.delete("/configs/{config_id}")
async def delete_standup_config(
    config_id: uuid.UUID,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StandupConfig).where(StandupConfig.id == config_id, StandupConfig.orchestrator_id == orch.id)
    )
    cfg = result.scalar_one_or_none()
    if not cfg:
        raise HTTPException(404, "Standup not found")
    await db.delete(cfg)
    await db.commit()
    return {"detail": "Deleted"}


@router.post("/configs/{config_id}/run", response_model=MeetingResponse)
async def run_standup(
    config_id: uuid.UUID,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
    redis_client: aioredis.Redis = Depends(get_redis),
):
    result = await db.execute(
        select(StandupConfig).where(StandupConfig.id == config_id, StandupConfig.orchestrator_id == orch.id)
    )
    cfg = result.scalar_one_or_none()
    if not cfg:
        raise HTTPException(404, "Standup not found")
    meeting = await run_standup_config(cfg, str(orch.id), db, redis_client)
    return MeetingResponse.model_validate(meeting)


@router.get("/configs/{config_id}/runs", response_model=List[MeetingResponse])
async def list_standup_runs(
    config_id: uuid.UUID,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Meeting)
        .where(Meeting.standup_config_id == config_id, Meeting.orchestrator_id == orch.id)
        .order_by(Meeting.scheduled_at.desc())
        .limit(20)
    )
    return [MeetingResponse.model_validate(m) for m in result.scalars().all()]


# ── Legacy / Quick Standup ────────────────────────────────────────────────────

@router.post("/standup/start", response_model=MeetingResponse)
async def trigger_standup(
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
    redis_client: aioredis.Redis = Depends(get_redis),
):
    meeting = await start_standup(str(orch.id), db, redis_client)
    return MeetingResponse.model_validate(meeting)


@router.post("/{meeting_id}/respond")
async def respond_to_meeting(
    meeting_id: uuid.UUID,
    data: MeetingRespond,
    current: Agent = Depends(get_current_agent),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(404, "Meeting not found")
    if meeting.status != MeetingStatus.active:
        raise HTTPException(400, "Meeting is not active")
    meeting.transcript["responses"] = meeting.transcript.get("responses", [])
    meeting.transcript["responses"].append({
        "agent_id": str(current.id),
        "agent_name": current.name,
        "content": data.content,
        "capacity": data.capacity,
        "blockers": data.blockers,
    })
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(meeting, "transcript")
    await db.commit()
    return {"detail": "Response recorded"}


@router.put("/{meeting_id}/complete")
async def complete_meeting(
    meeting_id: uuid.UUID,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    from datetime import datetime
    result = await db.execute(
        select(Meeting).where(Meeting.id == meeting_id, Meeting.orchestrator_id == orch.id)
    )
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(404, "Meeting not found")
    meeting.status = MeetingStatus.complete
    meeting.completed_at = datetime.utcnow()
    await db.commit()
    return {"detail": "Meeting completed"}


@router.get("/", response_model=List[MeetingResponse])
async def list_meetings(
    db: AsyncSession = Depends(get_db),
    orch: Orchestrator = Depends(get_current_orchestrator),
):
    result = await db.execute(
        select(Meeting).where(Meeting.orchestrator_id == orch.id)
        .order_by(Meeting.scheduled_at.desc()).limit(50)
    )
    return [MeetingResponse.model_validate(m) for m in result.scalars().all()]
