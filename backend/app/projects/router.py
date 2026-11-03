import uuid

from fastapi import APIRouter, status

from app.auth.deps import CurrentUser, DbSession
from app.core.errors import error_responses
from app.projects import service
from app.projects.schemas import ProjectCreate, ProjectMove, ProjectOut, ProjectUpdate

router = APIRouter(prefix="/projects", tags=["projects"], responses=error_responses(401))


@router.get("", response_model=list[ProjectOut])
async def list_projects(user: CurrentUser, db: DbSession) -> list[ProjectOut]:
    return await service.list_projects(db, user.id)


@router.post("", status_code=status.HTTP_201_CREATED, response_model=ProjectOut)
async def create_project(body: ProjectCreate, user: CurrentUser, db: DbSession) -> ProjectOut:
    project = await service.create_project(db, user.id, body)
    await db.commit()
    return service.to_out(project)


@router.patch("/{project_id}", response_model=ProjectOut, responses=error_responses(400, 404))
async def update_project(
    project_id: uuid.UUID, body: ProjectUpdate, user: CurrentUser, db: DbSession
) -> ProjectOut:
    project = await service.update_project(db, user.id, project_id, body)
    out = await service.project_out(db, project)
    await db.commit()
    return out


@router.post("/{project_id}/move", response_model=ProjectOut, responses=error_responses(400, 404))
async def move_project(
    project_id: uuid.UUID, body: ProjectMove, user: CurrentUser, db: DbSession
) -> ProjectOut:
    """拖拽排序，见 ProjectMove。"""
    project = await service.move_project(db, user.id, project_id, body.after_id)
    out = await service.project_out(db, project)
    await db.commit()
    return out


@router.delete(
    "/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(400, 404),
)
async def delete_project(project_id: uuid.UUID, user: CurrentUser, db: DbSession) -> None:
    await service.delete_project(db, user.id, project_id)
    await db.commit()
