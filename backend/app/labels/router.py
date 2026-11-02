import uuid

from fastapi import APIRouter, status

from app.auth.deps import CurrentUser, DbSession
from app.core.errors import error_responses
from app.labels import service
from app.labels.schemas import LabelCreate, LabelOut, LabelUpdate

router = APIRouter(prefix="/labels", tags=["labels"], responses=error_responses(401))


@router.get("", response_model=list[LabelOut])
async def list_labels(user: CurrentUser, db: DbSession) -> list[LabelOut]:
    """按名字排序。"""
    return [LabelOut.model_validate(label) for label in await service.list_labels(db, user.id)]


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=LabelOut,
    responses=error_responses(409),
)
async def create_label(body: LabelCreate, user: CurrentUser, db: DbSession) -> LabelOut:
    label = await service.create_label(db, user.id, body)
    await db.commit()
    return LabelOut.model_validate(label)


@router.patch("/{label_id}", response_model=LabelOut, responses=error_responses(404, 409))
async def update_label(
    label_id: uuid.UUID, body: LabelUpdate, user: CurrentUser, db: DbSession
) -> LabelOut:
    label = await service.update_label(db, user.id, label_id, body)
    await db.commit()
    return LabelOut.model_validate(label)


@router.delete(
    "/{label_id}", status_code=status.HTTP_204_NO_CONTENT, responses=error_responses(404)
)
async def delete_label(label_id: uuid.UUID, user: CurrentUser, db: DbSession) -> None:
    """删除标签，任务保留。"""
    await service.delete_label(db, user.id, label_id)
    await db.commit()
