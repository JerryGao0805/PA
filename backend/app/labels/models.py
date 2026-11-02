import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, ForeignKeyConstraint, Index, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Label(Base):
    """标签。名字在同一用户内唯一，不区分大小写。"""

    __tablename__ = "labels"
    __table_args__ = (
        UniqueConstraint("user_id", "name"),
        # 供 task_labels 的复合外键引用
        UniqueConstraint("id", "user_id"),
    )

    # 写入后用 RETURNING 取回 updated_at 等服务端生成的值，避免 async 下访问过期属性触发懒加载
    __mapper_args__ = {"eager_defaults": True}  # noqa: RUF012  SQLAlchemy 约定写法

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, server_default=func.gen_random_uuid())
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # citext：唯一约束不区分大小写
    name: Mapped[str] = mapped_column(CITEXT)
    color: Mapped[str] = mapped_column(String(16), server_default="gray")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class TaskLabel(Base):
    """任务和标签的多对多关系。

    两个复合外键都带上 user_id：任务和标签必须属于同一个用户，数据库层面就挂不上别人的标签。
    删除任务或标签时，关联行随之删除。
    """

    __tablename__ = "task_labels"
    __table_args__ = (
        ForeignKeyConstraint(
            ["task_id", "user_id"], ["tasks.id", "tasks.user_id"], ondelete="CASCADE"
        ),
        ForeignKeyConstraint(
            ["label_id", "user_id"], ["labels.id", "labels.user_id"], ondelete="CASCADE"
        ),
        Index("ix_task_labels_label_id", "label_id"),
    )

    task_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    label_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID]
