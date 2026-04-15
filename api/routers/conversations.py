import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func
from api.db.session import get_db
from api.dependencies import get_current_orchestrator
from api.models.orchestrator import Orchestrator
from api.models.conversation import Workspace, Conversation
from api.models.message import Message
from api.schemas.conversation import (
    WorkspaceCreate, WorkspaceResponse,
    ConversationCreate, ConversationUpdate, ConversationResponse,
)

router = APIRouter(prefix="/conversations", tags=["conversations"])

# ─── Workspaces ────────────────────────────────────────

@router.post("/workspaces", response_model=WorkspaceResponse)
async def create_workspace(
    data: WorkspaceCreate,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    ws = Workspace(orchestrator_id=orch.id, name=data.name, color=data.color)
    db.add(ws)
    await db.commit()
    await db.refresh(ws)
    return WorkspaceResponse.model_validate(ws)


@router.get("/workspaces", response_model=List[WorkspaceResponse])
async def list_workspaces(
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Workspace).where(Workspace.orchestrator_id == orch.id).order_by(Workspace.sort_order)
    )
    return [WorkspaceResponse.model_validate(w) for w in result.scalars().all()]


@router.delete("/workspaces/{workspace_id}")
async def delete_workspace(
    workspace_id: uuid.UUID,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Workspace).where(Workspace.id == workspace_id, Workspace.orchestrator_id == orch.id)
    )
    ws = result.scalar_one_or_none()
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    # Ungroup conversations in this workspace
    convos = await db.execute(
        select(Conversation).where(Conversation.workspace_id == workspace_id)
    )
    for c in convos.scalars().all():
        c.workspace_id = None
    await db.delete(ws)
    await db.commit()
    return {"detail": "Workspace deleted"}


# ─── Conversations ─────────────────────────────────────

@router.post("/", response_model=ConversationResponse)
async def create_conversation(
    data: ConversationCreate,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    room = f"chat-{uuid.uuid4().hex[:12]}"
    convo = Conversation(
        orchestrator_id=orch.id,
        workspace_id=data.workspace_id,
        title=data.title,
        room=room,
    )
    db.add(convo)
    await db.commit()
    await db.refresh(convo)
    return ConversationResponse.model_validate(convo)


@router.get("/", response_model=List[ConversationResponse])
async def list_conversations(
    project_id: Optional[uuid.UUID] = None,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    q = select(Conversation).where(Conversation.orchestrator_id == orch.id)
    if project_id is not None:
        q = q.where(Conversation.project_id == project_id)
    result = await db.execute(q.order_by(Conversation.updated_at.desc()))
    convos = result.scalars().all()


    # Fetch last message for each conversation
    responses = []
    for c in convos:
        last_msg_result = await db.execute(
            select(Message.content)
            .where(Message.room == c.room)
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        last_msg = last_msg_result.scalar_one_or_none()
        resp = ConversationResponse.model_validate(c)
        resp.last_message = last_msg[:80] if last_msg else None
        responses.append(resp)

    return responses


@router.put("/{convo_id}", response_model=ConversationResponse)
async def update_conversation(
    convo_id: uuid.UUID,
    data: ConversationUpdate,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Conversation).where(Conversation.id == convo_id, Conversation.orchestrator_id == orch.id)
    )
    convo = result.scalar_one_or_none()
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")

    if data.title is not None:
        convo.title = data.title
    if data.workspace_id is not None:
        convo.workspace_id = data.workspace_id if str(data.workspace_id) != "00000000-0000-0000-0000-000000000000" else None

    await db.commit()
    await db.refresh(convo)
    return ConversationResponse.model_validate(convo)


@router.delete("/{convo_id}")
async def delete_conversation(
    convo_id: uuid.UUID,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Conversation).where(Conversation.id == convo_id, Conversation.orchestrator_id == orch.id)
    )
    convo = result.scalar_one_or_none()
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Delete all messages in this room
    await db.execute(delete(Message).where(Message.room == convo.room))
    await db.delete(convo)
    await db.commit()
    return {"detail": "Conversation deleted"}
