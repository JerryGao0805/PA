"""模型注册表：在这里导入所有 ORM 模型模块，供 Alembic autogenerate 使用。"""

from app.auth.models import EmailToken, RateLimitEvent, User, UserSession
from app.email.models import EmailOutbox
from app.projects.models import Project
from app.tasks.models import Task

__all__ = [
    "EmailOutbox",
    "EmailToken",
    "Project",
    "RateLimitEvent",
    "Task",
    "User",
    "UserSession",
]
