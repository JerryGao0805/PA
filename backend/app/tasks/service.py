"""任务业务逻辑。和项目一样，所有查询都带 user_id 条件，别人的任务一律返回 404。"""

import uuid
from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import utcnow
from app.core.errors import ApiError
from app.core.ordering import key_after
from app.projects.models import Project
from app.projects.service import get_inbox, get_project
from app.tasks.models import Task, TaskStatus
from app.tasks.schemas import TaskCreate, TaskUpdate

# 「已完成」列表只返回最近的这么多条
DONE_LIST_LIMIT = 100


def _task_not_found() -> ApiError:
    return ApiError(404, "task_not_found", "Task not found")


async def get_task(
    db: AsyncSession, user_id: uuid.UUID, task_id: uuid.UUID, *, deleted: bool = False
) -> Task:
    deleted_cond = Task.deleted_at.is_not(None) if deleted else Task.deleted_at.is_(None)
    task = await db.scalar(
        select(Task).where(Task.id == task_id, Task.user_id == user_id, deleted_cond)
    )
    if task is None:
        raise _task_not_found()
    return task


async def list_tasks(
    db: AsyncSession, user_id: uuid.UUID, project_id: uuid.UUID, *, done: bool
) -> Sequence[Task]:
    # 先确认项目属于当前用户：别人的项目返回 404，而不是一个空列表
    await get_project(db, user_id, project_id)
    stmt = select(Task).where(
        Task.user_id == user_id, Task.project_id == project_id, Task.deleted_at.is_(None)
    )
    if done:
        stmt = (
            stmt.where(Task.status == TaskStatus.DONE)
            .order_by(Task.completed_at.desc(), Task.id)
            .limit(DONE_LIST_LIMIT)
        )
    else:
        stmt = stmt.where(Task.status != TaskStatus.DONE).order_by(Task.sort_key, Task.id)
    return (await db.scalars(stmt)).all()


async def _key_at_end(db: AsyncSession, project: Project) -> str:
    """项目末尾的新 key。调用方需已锁住项目行，避免并发追加时拿到相同的 key。

    已完成和已删除的任务也算在内：它们恢复后回到原来的位置，key 不能和新任务重复。
    """
    last = await db.scalar(select(func.max(Task.sort_key)).where(Task.project_id == project.id))
    return key_after(last)


async def create_task(db: AsyncSession, user_id: uuid.UUID, data: TaskCreate) -> Task:
    if data.project_id is None:
        project = await get_inbox(db, user_id, for_update=True)
    else:
        project = await get_project(db, user_id, data.project_id, for_update=True)
    task = Task(
        user_id=user_id,
        project_id=project.id,
        title=data.title,
        description=data.description,
        sort_key=await _key_at_end(db, project),
    )
    db.add(task)
    await db.flush()
    return task


async def update_task(
    db: AsyncSession, user_id: uuid.UUID, task_id: uuid.UUID, data: TaskUpdate
) -> Task:
    task = await get_task(db, user_id, task_id)
    if data.title is not None:
        task.title = data.title
    if data.description is not None:
        task.description = data.description
    if data.status is not None and data.status != task.status:
        task.status = data.status
        task.completed_at = utcnow() if data.status == TaskStatus.DONE else None
    if data.project_id is not None and data.project_id != task.project_id:
        target = await get_project(db, user_id, data.project_id, for_update=True)
        task.project_id = target.id
        task.sort_key = await _key_at_end(db, target)
    await db.flush()
    return task


async def delete_task(db: AsyncSession, user_id: uuid.UUID, task_id: uuid.UUID) -> None:
    """软删除，可以用 restore_task 撤销。"""
    task = await get_task(db, user_id, task_id)
    task.deleted_at = utcnow()


async def restore_task(db: AsyncSession, user_id: uuid.UUID, task_id: uuid.UUID) -> Task:
    task = await get_task(db, user_id, task_id, deleted=True)
    task.deleted_at = None
    await db.flush()
    return task
