"""任务业务逻辑。和项目一样，所有查询都带 user_id 条件，别人的任务一律返回 404。

子任务只有一层，并且保持这几条规则（下面的函数负责维护）：
- 父任务被删除时，子任务一起删除；恢复时，和它一起删除的子任务也恢复
- 父任务完成时，未完成的子任务一起完成；重新打开时，和它一起完成的子任务也重新打开
- 已完成的父任务下不会有未完成的子任务：重新打开（或恢复）子任务时，父任务也重新打开
"""

import uuid
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date

from sqlalchemy import ColumnElement, and_, delete, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import utcnow
from app.core.errors import ApiError
from app.core.ordering import key_after, key_between
from app.labels.models import Label, TaskLabel
from app.labels.service import get_label, label_not_found
from app.projects.models import Project
from app.projects.service import get_inbox, get_project
from app.tasks.models import Task, TaskStatus
from app.tasks.schemas import TaskCreate, TaskMove, TaskOut, TaskUpdate

# 「已完成」列表只返回最近的这么多条
DONE_LIST_LIMIT = 100


def _task_not_found() -> ApiError:
    return ApiError(404, "task_not_found", "Task not found")


def _invalid_parent() -> ApiError:
    return ApiError(
        400,
        "invalid_parent",
        "Subtasks can only be added to an open top-level task in the same project",
    )


def _invalid_move() -> ApiError:
    return ApiError(400, "invalid_move", "Tasks can only be reordered within the same list")


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


async def _subtask_counts(
    db: AsyncSession, task_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, tuple[int, int]]:
    """每个任务的（子任务数，已完成的子任务数），不含已删除的。"""
    ids = list(task_ids)
    if not ids:
        return {}
    rows = await db.execute(
        select(
            Task.parent_id,
            func.count(),
            func.count().filter(Task.status == TaskStatus.DONE),
        )
        .where(Task.parent_id.in_(ids), Task.deleted_at.is_(None))
        .group_by(Task.parent_id)
    )
    return {parent_id: (total, done) for parent_id, total, done in rows if parent_id is not None}


_COMPUTED_FIELDS = {"label_ids", "subtask_count", "done_subtask_count"}


def _to_out(task: Task, label_ids: list[uuid.UUID], subtasks: tuple[int, int]) -> TaskOut:
    fields = {name: getattr(task, name) for name in TaskOut.model_fields.keys() - _COMPUTED_FIELDS}
    return TaskOut.model_validate(
        {
            **fields,
            "label_ids": label_ids,
            "subtask_count": subtasks[0],
            "done_subtask_count": subtasks[1],
        }
    )


async def tasks_out(db: AsyncSession, tasks: Sequence[Task]) -> list[TaskOut]:
    labels = await _label_ids_by_task(db, (t.id for t in tasks))
    # 子任务没有下一层，不用查
    counts = await _subtask_counts(db, (t.id for t in tasks if t.parent_id is None))
    return [_to_out(t, labels.get(t.id, []), counts.get(t.id, (0, 0))) for t in tasks]


async def task_out(db: AsyncSession, task: Task) -> TaskOut:
    [out] = await tasks_out(db, [task])
    return out


# ---------- 查询 ----------


async def get_task(
    db: AsyncSession,
    user_id: uuid.UUID,
    task_id: uuid.UUID,
    *,
    deleted: bool = False,
    for_update: bool = False,
) -> Task:
    deleted_cond = Task.deleted_at.is_not(None) if deleted else Task.deleted_at.is_(None)
    stmt = select(Task).where(Task.id == task_id, Task.user_id == user_id, deleted_cond)
    if for_update:
        stmt = stmt.with_for_update()
    task = await db.scalar(stmt)
    if task is None:
        raise _task_not_found()
    return task


async def _lock_parent(db: AsyncSession, task: Task) -> Task:
    """锁住子任务的父任务行并返回它（父任务一定存在：外键保证，同一用户由项目保证）。"""
    parent = await db.scalar(select(Task).where(Task.id == task.parent_id).with_for_update())
    assert parent is not None
    return parent


@dataclass(frozen=True)
class TaskFilter:
    """列表筛选条件，可以组合。

    - parent_id：这个任务的子任务，按手动顺序（sort_key）
    - project_id：项目里的顶层任务（不含子任务），按手动顺序
    - 都不指定（「今天」「即将到来」、标签页）：跨项目查询，包括子任务，不含已归档项目里的任务，
      按截止日期、时间、优先级排序
    """

    project_id: uuid.UUID | None = None
    parent_id: uuid.UUID | None = None
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
    if f.parent_id is not None:
        await get_task(db, user_id, f.parent_id)

    stmt = select(Task).where(Task.user_id == user_id, Task.deleted_at.is_(None))
    manual_order = f.parent_id is not None or f.project_id is not None
    if f.parent_id is not None:
        stmt = stmt.where(Task.parent_id == f.parent_id)
    if f.project_id is not None:
        stmt = stmt.where(Task.project_id == f.project_id)
        if f.parent_id is None:
            stmt = stmt.where(Task.parent_id.is_(None))
    if not manual_order:
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
    elif manual_order:
        stmt = stmt.where(Task.status != TaskStatus.DONE).order_by(Task.sort_key, Task.id)
    else:
        # 没有截止日期/时间的排在后面（Postgres 升序时 NULL 默认在最后）
        stmt = stmt.where(Task.status != TaskStatus.DONE).order_by(
            Task.due_date, Task.due_time, Task.priority, Task.created_at, Task.id
        )
    return (await db.scalars(stmt)).all()


# ---------- 修改 ----------


def _siblings(project_id: uuid.UUID, parent_id: uuid.UUID | None) -> ColumnElement[bool]:
    """同一个排序范围里的任务：同一父任务的子任务，或同一项目的顶层任务。"""
    if parent_id is not None:
        return Task.parent_id == parent_id
    return and_(Task.project_id == project_id, Task.parent_id.is_(None))


async def _lock_siblings(db: AsyncSession, user_id: uuid.UUID, task: Task) -> None:
    """锁住排序范围（父任务行或项目行），避免并发追加或拖动时拿到相同的 key。"""
    if task.parent_id is not None:
        await _lock_parent(db, task)
    else:
        await get_project(db, user_id, task.project_id, for_update=True)


async def _key_at_end(
    db: AsyncSession, project_id: uuid.UUID, parent_id: uuid.UUID | None = None
) -> str:
    """排序范围末尾的新 key。调用方需已锁住这个范围。

    已完成和已删除的任务也算在内：它们恢复后回到原来的位置，key 不能和新任务重复。
    """
    last = await db.scalar(select(func.max(Task.sort_key)).where(_siblings(project_id, parent_id)))
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
    if data.parent_id is not None:
        parent = await get_task(db, user_id, data.parent_id, for_update=True)
        if (
            parent.parent_id is not None
            or parent.status == TaskStatus.DONE
            or data.project_id not in (None, parent.project_id)
        ):
            raise _invalid_parent()
        project_id = parent.project_id
    elif data.project_id is None:
        project_id = (await get_inbox(db, user_id, for_update=True)).id
    else:
        project_id = (await get_project(db, user_id, data.project_id, for_update=True)).id
    task = Task(
        user_id=user_id,
        project_id=project_id,
        parent_id=data.parent_id,
        title=data.title,
        description=data.description,
        status=data.status,
        priority=data.priority,
        due_date=data.due_date,
        due_time=data.due_time,
        sort_key=await _key_at_end(db, project_id, data.parent_id),
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
        await _set_status(db, task, data.status)
    if data.project_id is not None and data.project_id != task.project_id:
        target = await get_project(db, user_id, data.project_id, for_update=True)
        # 先算好 key 再改字段：查询前的 autoflush 不会写入一半的修改
        sort_key = await _key_at_end(db, target.id)
        # 父任务的子任务由外键 ON UPDATE CASCADE 一起移过去；子任务单独移走时变成顶层任务
        task.project_id = target.id
        task.parent_id = None
        task.sort_key = sort_key
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


async def _set_status(db: AsyncSession, task: Task, status: TaskStatus) -> None:
    was_done = task.status == TaskStatus.DONE
    completed_at = task.completed_at
    now = utcnow()
    task.status = status
    task.completed_at = now if status == TaskStatus.DONE else None

    if task.parent_id is not None:
        if was_done:
            await _reopen_parent(db, task)
        return
    children = and_(Task.parent_id == task.id, Task.deleted_at.is_(None))
    if status == TaskStatus.DONE:
        # 用同一个时间戳，重新打开时据此找回一起完成的子任务
        await db.execute(
            update(Task)
            .where(children, Task.status != TaskStatus.DONE)
            .values(status=TaskStatus.DONE, completed_at=now)
        )
    elif was_done:
        await db.execute(
            update(Task)
            .where(children, Task.status == TaskStatus.DONE, Task.completed_at == completed_at)
            .values(status=TaskStatus.TODO, completed_at=None)
        )


async def _reopen_parent(db: AsyncSession, subtask: Task) -> None:
    """子任务变回未完成时，已完成的父任务也重新打开（只打开父任务本身，不连带其他子任务）。"""
    parent = await _lock_parent(db, subtask)
    if parent.status == TaskStatus.DONE:
        parent.status = TaskStatus.TODO
        parent.completed_at = None


async def move_task(
    db: AsyncSession, user_id: uuid.UUID, task_id: uuid.UUID, data: TaskMove
) -> Task:
    """拖拽：需要时只给这一个任务生成新 key，同时可以修改状态（看板上换列）。

    放下的位置只约束任务在目标列里的先后（列表视图里就是所有未完成的任务）：
    - 任务现在的 key 已经在 after_id 和目标列里的下一个任务之间：不改 key。例如拖到空的一列、
      或者原地放下，这样在看板上换列不会打乱列表视图里的顺序
    - 否则紧挨着 after_id 放；after_id 为空（放到最前）时紧挨着目标列里的第一个任务放

    「紧挨着」是相对数据库里所有的任务（包括已完成、已删除的，以及看板上其他列的）：
    前端看不到的任务也在同一个 key 空间里，新 key 不能和它们重复。
    """
    task = await get_task(db, user_id, task_id)
    await _lock_siblings(db, user_id, task)
    lower: str | None = None
    if data.after_id is not None:
        if data.after_id == task.id:
            raise _invalid_move()
        anchor = await get_task(db, user_id, data.after_id)
        if (anchor.project_id, anchor.parent_id) != (task.project_id, task.parent_id):
            raise _invalid_move()
        lower = anchor.sort_key

    # 先算 key 再改状态：改状态不影响同一列表里的其他任务，查询前的 autoflush 也不会
    # 先把这一行写一遍
    others = and_(_siblings(task.project_id, task.parent_id), Task.id != task.id)
    in_column = and_(
        others,
        Task.deleted_at.is_(None),
        Task.status == data.status if data.status is not None else Task.status != TaskStatus.DONE,
    )
    upper_stmt = select(func.min(Task.sort_key)).where(in_column)
    if lower is not None:
        upper_stmt = upper_stmt.where(Task.sort_key > lower)
    upper = await db.scalar(upper_stmt)

    key = task.sort_key
    if not ((lower is None or lower < key) and (upper is None or key < upper)):
        if lower is not None:
            after_lower = await db.scalar(
                select(func.min(Task.sort_key)).where(others, Task.sort_key > lower)
            )
            task.sort_key = key_between(lower, after_lower)
        else:
            before_upper = await db.scalar(
                select(func.max(Task.sort_key)).where(others, Task.sort_key < upper)
            )
            task.sort_key = key_between(before_upper, upper)

    if data.status is not None and data.status != task.status:
        await _set_status(db, task, data.status)
    await db.flush()
    return task


async def delete_task(db: AsyncSession, user_id: uuid.UUID, task_id: uuid.UUID) -> None:
    """软删除，可以用 restore_task 撤销。子任务一起删除，用同一个时间戳。"""
    task = await get_task(db, user_id, task_id)
    now = utcnow()
    task.deleted_at = now
    if task.parent_id is None:
        await db.execute(
            update(Task)
            .where(Task.parent_id == task.id, Task.deleted_at.is_(None))
            .values(deleted_at=now)
        )


async def restore_task(db: AsyncSession, user_id: uuid.UUID, task_id: uuid.UUID) -> Task:
    """撤销删除。恢复父任务时，和它一起删除的子任务也恢复（之前单独删除的不恢复）。

    父任务已被删除的子任务不能单独恢复（返回 404），要先恢复父任务。
    """
    task = await get_task(db, user_id, task_id, deleted=True)
    if task.parent_id is not None:
        parent = await _lock_parent(db, task)
        if parent.deleted_at is not None:
            raise _task_not_found()
        if task.status != TaskStatus.DONE:
            await _reopen_parent(db, task)
    else:
        await db.execute(
            update(Task)
            .where(Task.parent_id == task.id, Task.deleted_at == task.deleted_at)
            .values(deleted_at=None)
        )
    task.deleted_at = None
    await db.flush()
    return task
