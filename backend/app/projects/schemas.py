import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

from app.core.colors import Color

ProjectName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class ProjectCreate(BaseModel):
    name: ProjectName
    color: Color = "gray"


class ProjectUpdate(BaseModel):
    """只修改传了的字段。"""

    name: ProjectName | None = None
    color: Color | None = None
    archived: bool | None = None


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    color: Color
    is_inbox: bool
    archived: bool
    open_task_count: int
    done_task_count: int
    created_at: datetime


class ProjectMove(BaseModel):
    """拖拽排序：放到 after_id 这个项目后面，after_id 为 null 表示放到最前（收件箱始终在最前）。"""

    after_id: uuid.UUID | None
