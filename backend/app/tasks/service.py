"""任务业务逻辑。和项目一样，所有查询都带 user_id 条件，别人的任务一律返回 404。"""

import uuid
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date

from sqlalchemy import delete, func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import utcnow
from app.core.errors import ApiError
from app.core.ordering import key_after
from app.labels.models import Label, TaskLabel
from app.labels.service import get_label, label_not_found
from app.projects.models import Project
from app.projects.service import get_inbox, get_project
from app.tasks.models import Task, TaskStatus
from app.tasks.schemas import TaskCreate, TaskOut, TaskUpdate

# 「已完成」列表只返回最近的这么多条
DONE_LIST_LIMIT = 100


def _task_not_found() -> ApiError:
    return ApiError(404, "task_not_found", "Task not found")


# ---------- 输出 ----------


async def _label_ids_by_task(
    db: AsyncSession, task_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:
    ids = list(task_ids)
    result: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    if not ids:
        return result
    rows = await db.execute(
        select(TaskLabel.task_id, TaskLabel.label_id)
        .where(TaskLabel.task_id.in_(ids))
        .order_by(TaskLabel.task_id, TaskLabel.label_id)
    )
    for task_id, label_id in rows:
        result[task_id].append(label_id)
    return result


def _to_out(task: Task, label_ids: list[uuid.UUID]) -> TaskOut:
    fields = {name: getattr(task, name) for name in TaskOut.model_fields if name != "label_ids"}
    return TaskOut.model_validate({**fields, "label_ids": label_ids})


async def tasks_out(db: AsyncSession, tasks: Sequence[Task]) -> list[TaskOut]:
    labels = await _label_ids_by_task(db, (t.id for t in tasks))
    return [_to_out(t, labels.get(t.id, [])) for t in tasks]


async def task_out(db: AsyncSession, task: Task) -> TaskOut:
    [out] = await tasks_out(db, [task])
    return out


# ---------- 查询 ----------


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


@dataclass(frozen=True)
class TaskFilter:
    """列表筛选条件，可以组合。

    不指定项目时（「今天」「即将到来」、标签页）跨项目查询，不含已归档项目里的任务，
    按截止日期、时间、优先级排序；指定项目时按项目里的手动顺序（sort_key）。
    """

    project_id: uuid.UUID | None = None
    label_id: uuid.UUID | None = None
    # 截止日期在 [due_from, due_to] 内（含两端）；只给 due_to 就是「到这天为止，含逾期」
    due_from: date | None = None
    due_to: date | None = None
    done: bool = False


async def list_tasks(db: AsyncSession, user_id: uuid.UUID, f: TaskFilter) -> Sequence[Task]:
    # 先确认项目、标签属于当前用户：别人的返回 404，而不是一个空列表
    if f.project_id is not None:
        await get_project(db, user_id, f.project_id)
    if f.label_id is not None:
        await get_label(db, user_id, f.label_id)

    stmt = select(Task).where(Task.user_id == user_id, Task.deleted_at.is_(None))
    if f.project_id is not None:
        stmt = stmt.where(Task.project_id == f.project_id)
    else:
        active = select(Project.id).where(Project.user_id == user_id, Project.archived_at.is_(None))
        stmt = stmt.where(Task.project_id.in_(active))
    if f.label_id is not None:
        tagged = select(TaskLabel.task_id).where(TaskLabel.label_id == f.label_id)
        stmt = stmt.where(Task.id.in_(tagged))
    if f.due_from is not None:
        stmt = stmt.where(Task.due_date >= f.due_from)
    if f.due_to is not None:
        stmt = stmt.where(Task.due_date <= f.due_to)

    if f.done:
        stmt = (
            stmt.where(Task.status == TaskStatus.DONE)
            .order_by(Task.completed_at.desc(), Task.id)
            .limit(DONE_LIST_LIMIT)
        )
    elif f.project_id is not None:
        stmt = stmt.where(Task.status != TaskStatus.DONE).order_by(Task.sort_key, Task.id)
    else:
        # 没有截止日期/时间的排在后面（Postgres 升序时 NULL 默认在最后）
        stmt = stmt.where(Task.status != TaskStatus.DONE).order_by(
            Task.due_date, Task.due_time, Task.priority, Task.created_at, Task.id
        )
    return (await db.scalars(stmt)).all()


# ---------- 修改 ----------


async def _key_at_end(db: AsyncSession, project: Project) -> str:
    """项目末尾的新 key。调用方需已锁住项目行，避免并发追加时拿到相同的 key。

    已完成和已删除的任务也算在内：它们恢复后回到原来的位置，key 不能和新任务重复。
    """
    last = await db.scalar(select(func.max(Task.sort_key)).where(Task.project_id == project.id))
    return key_after(last)


async def _check_labels(
    db: AsyncSession, user_id: uuid.UUID, label_ids: Sequence[uuid.UUID]
) -> list[uuid.UUID]:
    """去重，并确认标签都属于当前用户（否则 404）。"""
    unique = list(dict.fromkeys(label_ids))
    if unique:
        found = await db.scalar(
            select(func.count()).where(Label.user_id == user_id, Label.id.in_(unique))
        )
        if found != len(unique):
            raise label_not_found()
    return unique


async def _replace_labels(db: AsyncSession, task: Task, label_ids: list[uuid.UUID]) -> None:
    await db.execute(delete(TaskLabel).where(TaskLabel.task_id == task.id))
    if label_ids:
        await db.execute(
            insert(TaskLabel),
            [{"task_id": task.id, "label_id": lid, "user_id": task.user_id} for lid in label_ids],
        )


async def create_task(db: AsyncSession, user_id: uuid.UUID, data: TaskCreate) -> Task:
    label_ids = await _check_labels(db, user_id, data.label_ids)
    if data.project_id is None:
        project = await get_inbox(db, user_id, for_update=True)
    else:
        project = await get_project(db, user_id, data.project_id, for_update=True)
    task = Task(
        user_id=user_id,
        project_id=project.id,
        title=data.title,
        description=data.description,
        priority=data.priority,
        due_date=data.due_date,
        due_time=data.due_time,
        sort_key=await _key_at_end(db, project),
    )
    db.add(task)
    await db.flush()
    await _replace_labels(db, task, label_ids)
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
    if data.priority is not None:
        task.priority = data.priority
    if data.due_changed:
        task.due_date = data.due_date
        task.due_time = data.due_time
    if data.label_ids is not None:
        await _replace_labels(db, task, await _check_labels(db, user_id, data.label_ids))
        # 只改标签时 tasks 行本身没有变化，手动更新修改时间
        task.updated_at = utcnow()
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
