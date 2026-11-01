import uuid
from datetime import date, datetime, time
from enum import StrEnum

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.projects.models import SORT_KEY_COLLATION


class TaskStatus(StrEnum):
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    DONE = "done"


# 优先级 1 最高，4 是默认（不标优先级）
DEFAULT_PRIORITY = 4


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        # 复合外键：任务只能属于同一用户的项目；删除项目时一并删除其中的任务
        ForeignKeyConstraint(
            ["project_id", "user_id"],
            ["projects.id", "projects.user_id"],
            ondelete="CASCADE",
        ),
        CheckConstraint("status IN ('todo', 'in_progress', 'done')", name="status_valid"),
        CheckConstraint(
            "(status = 'done') = (completed_at IS NOT NULL)", name="completed_at_matches_status"
        ),
        CheckConstraint("priority BETWEEN 1 AND 4", name="priority_valid"),
        CheckConstraint("due_time IS NULL OR due_date IS NOT NULL", name="due_time_requires_date"),
        # 供 task_labels 的复合外键引用，道理同 projects
        UniqueConstraint("id", "user_id"),
        Index("ix_tasks_project_id_sort_key", "project_id", "sort_key"),
        # 「今天」「即将到来」按截止日期查未完成的任务
        Index(
            "ix_tasks_user_id_due_date",
            "user_id",
            "due_date",
            postgresql_where=text(
                "due_date IS NOT NULL AND deleted_at IS NULL AND status <> 'done'"
            ),
        ),
    )

    # 写入后用 RETURNING 取回 updated_at 等服务端生成的值，避免 async 下访问过期属性触发懒加载
    __mapper_args__ = {"eager_defaults": True}  # noqa: RUF012  SQLAlchemy 约定写法

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, server_default=func.gen_random_uuid())
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    project_id: Mapped[uuid.UUID]
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str] = mapped_column(Text, server_default="")
    status: Mapped[str] = mapped_column(String(16), server_default=TaskStatus.TODO.value)
    priority: Mapped[int] = mapped_column(SmallInteger, server_default=str(DEFAULT_PRIORITY))
    # 截止日期按用户时区解释的日历日期，不做时区换算；due_time 为空表示全天
    due_date: Mapped[date | None]
    due_time: Mapped[time | None]
    sort_key: Mapped[str] = mapped_column(String(255, collation=SORT_KEY_COLLATION))
    completed_at: Mapped[datetime | None]
    # 软删除：删除后可以撤销；worker 会清理删除超过 30 天的任务
    deleted_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
