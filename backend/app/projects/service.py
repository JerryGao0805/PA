"""项目业务逻辑。所有查询都带 user_id 条件：访问别人的项目和访问不存在的项目一样返回 404。

函数只改动会话里的数据，由调用方（路由）决定何时提交。
"""

import uuid
from collections.abc import Sequence

from sqlalchemy import and_, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import utcnow
from app.core.errors import ApiError
from app.core.ordering import FIRST_KEY, key_after, key_between
from app.projects.models import Project
from app.projects.schemas import ProjectCreate, ProjectOut, ProjectUpdate
from app.tasks.models import Task, TaskStatus

INBOX_NAME = "Inbox"  # 界面上显示的名字由前端按语言决定，这里只是占位


def project_not_found() -> ApiError:
    return ApiError(404, "project_not_found", "Project not found")


def _inbox_immutable() -> ApiError:
    return ApiError(
        400, "inbox_immutable", "The inbox cannot be renamed, moved, archived or deleted"
    )


def _invalid_move() -> ApiError:
    return ApiError(400, "invalid_move", "Projects can only be placed after another project")


# ---------- 查询 ----------


async def get_project(
    db: AsyncSession, user_id: uuid.UUID, project_id: uuid.UUID, *, for_update: bool = False
) -> Project:
    stmt = select(Project).where(Project.id == project_id, Project.user_id == user_id)
    if for_update:
        stmt = stmt.with_for_update()
    project = await db.scalar(stmt)
    if project is None:
        raise project_not_found()
    return project


async def get_inbox(db: AsyncSession, user_id: uuid.UUID, *, for_update: bool = False) -> Project:
    stmt = select(Project).where(Project.user_id == user_id, Project.is_inbox)
    if for_update:
        stmt = stmt.with_for_update()
    inbox = await db.scalar(stmt)
    if inbox is None:
        # 正常情况下注册时就已创建；这里兜底，保证任何账号都有收件箱
        inbox = create_inbox(db, user_id)
        await db.flush()
    return inbox


async def task_counts(
    db: AsyncSession, user_id: uuid.UUID, project_ids: Sequence[uuid.UUID] | None = None
) -> dict[uuid.UUID, tuple[int, int]]:
    """每个项目的（未完成数，已完成数），只算顶层任务（和项目列表一致），不含已删除的。"""
    done = Task.status == TaskStatus.DONE
    stmt = (
        select(
            Task.project_id,
            func.count().filter(~done),
            func.count().filter(done),
        )
        .where(Task.user_id == user_id, Task.deleted_at.is_(None), Task.parent_id.is_(None))
        .group_by(Task.project_id)
    )
    if project_ids is not None:
        stmt = stmt.where(Task.project_id.in_(project_ids))
    rows = await db.execute(stmt)
    return {project_id: (open_count, done_count) for project_id, open_count, done_count in rows}


def to_out(project: Project, counts: tuple[int, int] = (0, 0)) -> ProjectOut:
    return ProjectOut.model_validate(
        {
            "id": project.id,
            "name": project.name,
            "color": project.color,
            "is_inbox": project.is_inbox,
            "archived": project.archived_at is not None,
            "layout": project.layout,
            "open_task_count": counts[0],
            "done_task_count": counts[1],
            "created_at": project.created_at,
        }
    )


async def project_out(db: AsyncSession, project: Project) -> ProjectOut:
    counts = await task_counts(db, project.user_id, [project.id])
    return to_out(project, counts.get(project.id, (0, 0)))


async def list_projects(db: AsyncSession, user_id: uuid.UUID) -> list[ProjectOut]:
    """收件箱排在最前，其余按 sort_key 排列（包括已归档的，由前端分组显示）。"""
    projects = await db.scalars(
        select(Project)
        .where(Project.user_id == user_id)
        .order_by(Project.is_inbox.desc(), Project.sort_key, Project.id)
    )
    counts = await task_counts(db, user_id)
    return [to_out(p, counts.get(p.id, (0, 0))) for p in projects]


# ---------- 修改 ----------


def create_inbox(db: AsyncSession, user_id: uuid.UUID) -> Project:
    inbox = Project(user_id=user_id, name=INBOX_NAME, is_inbox=True, sort_key=FIRST_KEY)
    db.add(inbox)
    return inbox


async def _lock_user_projects(db: AsyncSession, user_id: uuid.UUID) -> None:
    """同一用户并发新建项目时串行执行，避免两个项目拿到相同的 sort_key。事务结束时自动释放。"""
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"projects:{user_id}"},
    )


async def create_project(db: AsyncSession, user_id: uuid.UUID, data: ProjectCreate) -> Project:
    await _lock_user_projects(db, user_id)
    last_key = await db.scalar(select(func.max(Project.sort_key)).where(Project.user_id == user_id))
    project = Project(
        user_id=user_id, name=data.name, color=data.color, sort_key=key_after(last_key)
    )
    db.add(project)
    await db.flush()
    return project


async def update_project(
    db: AsyncSession, user_id: uuid.UUID, project_id: uuid.UUID, data: ProjectUpdate
) -> Project:
    project = await get_project(db, user_id, project_id)
    # 收件箱只能改 layout
    if project.is_inbox and any(
        getattr(data, field) is not None for field in data.model_fields_set - {"layout"}
    ):
        raise _inbox_immutable()
    if data.name is not None:
        project.name = data.name
    if data.color is not None:
        project.color = data.color
    if data.archived is not None:
        if not data.archived:
            project.archived_at = None
        elif project.archived_at is None:
            project.archived_at = utcnow()
    if data.layout is not None:
        project.layout = data.layout
    await db.flush()
    return project


async def move_project(
    db: AsyncSession, user_id: uuid.UUID, project_id: uuid.UUID, after_id: uuid.UUID | None
) -> Project:
    """拖拽排序：只给这个项目生成新 key。收件箱不参与排序（始终在最前）。

    后一个项目从数据库里找，包括已归档的：它们和未归档的在同一个 key 空间里。
    """
    project = await get_project(db, user_id, project_id)
    if project.is_inbox:
        raise _inbox_immutable()
    await _lock_user_projects(db, user_id)
    others = and_(Project.user_id == user_id, Project.is_inbox.is_(False), Project.id != project.id)
    prev_key: str | None = None
    if after_id is not None:
        anchor = await get_project(db, user_id, after_id)
        if anchor.is_inbox or anchor.id == project.id:
            raise _invalid_move()
        prev_key = anchor.sort_key
    next_stmt = select(func.min(Project.sort_key)).where(others)
    if prev_key is not None:
        next_stmt = next_stmt.where(Project.sort_key > prev_key)
    project.sort_key = key_between(prev_key, await db.scalar(next_stmt))
    await db.flush()
    return project


async def delete_project(db: AsyncSession, user_id: uuid.UUID, project_id: uuid.UUID) -> None:
    """永久删除项目，其中的任务由外键级联删除。"""
    project = await get_project(db, user_id, project_id)
    if project.is_inbox:
        raise _inbox_immutable()
    await db.delete(project)
