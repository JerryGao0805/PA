"""标签业务逻辑。和项目一样，所有查询都带 user_id 条件，别人的标签一律返回 404。"""

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.labels.models import Label
from app.labels.schemas import LabelCreate, LabelUpdate


def label_not_found() -> ApiError:
    return ApiError(404, "label_not_found", "Label not found")


def _name_taken() -> ApiError:
    return ApiError(409, "label_name_taken", "A label with this name already exists")


async def get_label(db: AsyncSession, user_id: uuid.UUID, label_id: uuid.UUID) -> Label:
    label = await db.scalar(select(Label).where(Label.id == label_id, Label.user_id == user_id))
    if label is None:
        raise label_not_found()
    return label


async def list_labels(db: AsyncSession, user_id: uuid.UUID) -> Sequence[Label]:
    stmt = select(Label).where(Label.user_id == user_id).order_by(Label.name, Label.id)
    return (await db.scalars(stmt)).all()


async def _flush_unique(db: AsyncSession) -> None:
    """名字重复时由唯一约束拦下（不区分大小写，并发时也可靠），转成 409。

    出错后这个事务就不能再用了；调用方直接把错误返回给客户端，不会再提交。
    """
    try:
        await db.flush()
    except IntegrityError as exc:
        raise _name_taken() from exc


async def create_label(db: AsyncSession, user_id: uuid.UUID, data: LabelCreate) -> Label:
    label = Label(user_id=user_id, name=data.name, color=data.color)
    db.add(label)
    await _flush_unique(db)
    return label


async def update_label(
    db: AsyncSession, user_id: uuid.UUID, label_id: uuid.UUID, data: LabelUpdate
) -> Label:
    label = await get_label(db, user_id, label_id)
    if data.name is not None:
        label.name = data.name
    if data.color is not None:
        label.color = data.color
    await _flush_unique(db)
    return label


async def delete_label(db: AsyncSession, user_id: uuid.UUID, label_id: uuid.UUID) -> None:
    """删除标签；任务本身不受影响，只是不再带这个标签（关联行由外键级联删除）。"""
    label = await get_label(db, user_id, label_id)
    await db.delete(label)
