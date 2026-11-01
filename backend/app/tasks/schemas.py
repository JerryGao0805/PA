import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

from app.tasks.models import TaskStatus

TaskTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
TaskDescription = Annotated[str, StringConstraints(max_length=10_000)]


class TaskCreate(BaseModel):
    title: TaskTitle
    description: TaskDescription = ""
    # 不传时放进收件箱
    project_id: uuid.UUID | None = None


class TaskUpdate(BaseModel):
    """只修改传了的字段。改 project_id 会把任务移到目标项目的末尾。"""

    title: TaskTitle | None = None
    description: TaskDescription | None = None
    status: TaskStatus | None = None
    project_id: uuid.UUID | None = None


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    title: str
    description: str
    status: TaskStatus
    # 未完成任务按它升序排列（字节序）；前端做乐观更新时用它把任务插回正确的位置
    sort_key: str
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime
