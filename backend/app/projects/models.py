import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, String, UniqueConstraint, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

# 排序 key 按字节比较，见 app/core/ordering.py
SORT_KEY_COLLATION = "C"


class Project(Base):
    """项目（清单）。每个用户有且只有一个收件箱（is_inbox），它不能改名、归档或删除。"""

    __tablename__ = "projects"
    __table_args__ = (
        Index(
            "uq_projects_user_id_inbox",
            "user_id",
            unique=True,
            postgresql_where=text("is_inbox"),
        ),
        # 供 tasks 的复合外键引用：在数据库层面保证任务和它所属的项目是同一个用户的
        UniqueConstraint("id", "user_id"),
        Index("ix_projects_user_id_sort_key", "user_id", "sort_key"),
    )

    # 写入后用 RETURNING 取回 updated_at 等服务端生成的值，避免 async 下访问过期属性触发懒加载
    __mapper_args__ = {"eager_defaults": True}  # noqa: RUF012  SQLAlchemy 约定写法

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, server_default=func.gen_random_uuid())
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    color: Mapped[str] = mapped_column(String(16), server_default="gray")
    is_inbox: Mapped[bool] = mapped_column(server_default="false")
    sort_key: Mapped[str] = mapped_column(String(255, collation=SORT_KEY_COLLATION))
    archived_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
