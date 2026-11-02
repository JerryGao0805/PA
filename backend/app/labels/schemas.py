import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

from app.core.colors import Color

# 不允许空白：快速添加里用「@标签」引用，遇到空格就结束
LabelName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50, pattern=r"^\S+$")
]


class LabelCreate(BaseModel):
    name: LabelName
    color: Color = "gray"


class LabelUpdate(BaseModel):
    """只修改传了的字段。"""

    name: LabelName | None = None
    color: Color | None = None


class LabelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    color: Color
    created_at: datetime
