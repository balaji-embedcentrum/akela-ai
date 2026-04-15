import uuid
import re
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from api.db.session import get_db
from api.dependencies import get_current_orchestrator
from api.models.orchestrator import Orchestrator
from api.models.project import AkelaProject, ProjectAgent
from api.models.agent import Agent
from api.schemas.project import (
    ProjectCreate, ProjectUpdate, ProjectResponse,
    ProjectAgentAdd, ProjectAgentResponse,
)

router = APIRouter(prefix="/projects", tags=["projects"])


def _derive_slug(name: str) -> str:
    """Auto-derive a 3-char uppercase slug from a project name."""
    base = re.sub(r'(?i)\bproject\b', '', name)
    base = re.sub(r'[^a-zA-Z0-9]', '', base).upper()
    if not base:
        base = re.sub(r'[^a-zA-Z0-9]', '', name).upper()
    if not base:
        base = 'PRJ'
    if len(base) == 1:
        base = base * 3
    elif len(base) == 2:
        base = base + base[-1]
    return base[:3]


# ── Projects CRUD ──────────────────────────────────────────────────────────────

@router.post("/", response_model=ProjectResponse)
async def create_project(
    data: ProjectCreate,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    slug = (data.slug or _derive_slug(data.name)).upper()[:3]
    project = AkelaProject(
        owner_id=orch.id,
        name=data.name,
        description=data.description,
        color=data.color,
        slug=slug,
    )
    db.add(project)
    await db.flush()  # get project.id before commit

    # Auto-create a linked Hunt project so Hunt/Prey work immediately
    from api.models.hunt import Project as HuntProject
    hunt_project = HuntProject(
        orchestrator_id=orch.id,
        name=data.name,
        project_id=project.id,
    )
    db.add(hunt_project)
    await db.commit()
    await db.refresh(project)
    return ProjectResponse.model_validate(project)


@router.get("/", response_model=List[ProjectResponse])
async def list_projects(
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AkelaProject)
        .where(AkelaProject.owner_id == orch.id)
        .order_by(AkelaProject.sort_order, AkelaProject.created_at)
    )
    return [ProjectResponse.model_validate(p) for p in result.scalars().all()]


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: uuid.UUID,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    project = await _get_owned(project_id, orch.id, db)
    return ProjectResponse.model_validate(project)


@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: uuid.UUID,
    data: ProjectUpdate,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    project = await _get_owned(project_id, orch.id, db)
    if data.name is not None:
        project.name = data.name
    if data.description is not None:
        project.description = data.description
    if data.color is not None:
        project.color = data.color
    if data.orchestrator_type is not None:
        project.orchestrator_type = data.orchestrator_type
    if data.orchestrator_id is not None:
        project.orchestrator_id = data.orchestrator_id
    if data.sort_order is not None:
        project.sort_order = data.sort_order
    await db.commit()
    await db.refresh(project)
    return ProjectResponse.model_validate(project)


@router.delete("/{project_id}")
async def delete_project(
    project_id: uuid.UUID,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    project = await _get_owned(project_id, orch.id, db)
    await db.delete(project)
    await db.commit()
    return {"detail": "Project deleted"}


# ── Agent Assignment ───────────────────────────────────────────────────────────

@router.get("/{project_id}/agents", response_model=List[ProjectAgentResponse])
async def list_project_agents(
    project_id: uuid.UUID,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    await _get_owned(project_id, orch.id, db)
    result = await db.execute(
        select(ProjectAgent).where(ProjectAgent.project_id == project_id)
    )
    return [ProjectAgentResponse.model_validate(pa) for pa in result.scalars().all()]


@router.post("/{project_id}/agents", response_model=ProjectAgentResponse)
async def add_agent_to_project(
    project_id: uuid.UUID,
    data: ProjectAgentAdd,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    await _get_owned(project_id, orch.id, db)

    # Verify agent belongs to this orchestrator
    agent_result = await db.execute(
        select(Agent).where(Agent.id == data.agent_id, Agent.orchestrator_id == orch.id)
    )
    if not agent_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Agent not found")

    # Idempotent — update role if already assigned
    existing = await db.execute(
        select(ProjectAgent).where(
            ProjectAgent.project_id == project_id,
            ProjectAgent.agent_id == data.agent_id,
        )
    )
    pa = existing.scalar_one_or_none()
    if pa:
        pa.role = data.role
    else:
        pa = ProjectAgent(project_id=project_id, agent_id=data.agent_id, role=data.role)
        db.add(pa)
    await db.commit()
    await db.refresh(pa)
    return ProjectAgentResponse.model_validate(pa)


@router.delete("/{project_id}/agents/{agent_id}")
async def remove_agent_from_project(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    orch: Orchestrator = Depends(get_current_orchestrator),
    db: AsyncSession = Depends(get_db),
):
    await _get_owned(project_id, orch.id, db)
    await db.execute(
        delete(ProjectAgent).where(
            ProjectAgent.project_id == project_id,
            ProjectAgent.agent_id == agent_id,
        )
    )
    await db.commit()
    return {"detail": "Agent removed from project"}


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _get_owned(project_id: uuid.UUID, owner_id: uuid.UUID, db: AsyncSession) -> AkelaProject:
    result = await db.execute(
        select(AkelaProject).where(
            AkelaProject.id == project_id,
            AkelaProject.owner_id == owner_id,
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project
