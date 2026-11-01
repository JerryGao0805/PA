import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints

# 固定调色板：前端把这些名字映射成具体颜色，以后换主题时不用迁移数据
ProjectColor = Literal[
    "gray", "red", "orange", "amber", "green", "teal", "blue", "indigo", "violet", "pink"
]
ProjectName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class ProjectCreate(BaseModel):
    name: ProjectName
    color: ProjectColor = "gray"


class ProjectUpdate(BaseModel):
    """只修改传了的字段。"""

    name: ProjectName | None = None
    color: ProjectColor | None = None
    archived: bool | None = None


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    color: ProjectColor
    is_inbox: bool
    archived: bool
    open_task_count: int
    done_task_count: int
    created_at: datetime
