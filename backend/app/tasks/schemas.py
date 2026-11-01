import uuid
from datetime import date, datetime, time
from typing import Annotated, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from app.tasks.models import DEFAULT_PRIORITY, TaskStatus

TaskTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
TaskDescription = Annotated[str, StringConstraints(max_length=10_000)]
# 1 最高，4 是默认（不标优先级）
Priority = Annotated[int, Field(ge=1, le=4)]
MAX_LABELS_PER_TASK = 20
LabelIds = Annotated[list[uuid.UUID], Field(max_length=MAX_LABELS_PER_TASK)]


def _wall_clock_minutes(value: time) -> time:
    """截止时间是用户时区里的「几点几分」：不带时区，精确到分钟。"""
    if value.tzinfo is not None:
        raise ValueError("due_time must not include a timezone")
    return value.replace(second=0, microsecond=0)


DueTime = Annotated[time, AfterValidator(_wall_clock_minutes)]


class TaskCreate(BaseModel):
    title: TaskTitle
    description: TaskDescription = ""
    # 不传时放进收件箱
    project_id: uuid.UUID | None = None
    priority: Priority = DEFAULT_PRIORITY
    due_date: date | None = None
    # 为空表示全天
    due_time: DueTime | None = None
    label_ids: LabelIds = Field(default_factory=list)

    @model_validator(mode="after")
    def _time_needs_date(self) -> Self:
        if self.due_time is not None and self.due_date is None:
            raise ValueError("due_time requires due_date")
        return self


class TaskUpdate(BaseModel):
    """只修改传了的字段。

    - 改 project_id 会把任务移到目标项目的末尾
    - due_date 和 due_time 一起修改：传 due_date 时没传 due_time 就当作全天；due_date 传 null
      清除截止日期。不能只传 due_time
    - label_ids 整体替换任务的标签
    """

    title: TaskTitle | None = None
    description: TaskDescription | None = None
    status: TaskStatus | None = None
    project_id: uuid.UUID | None = None
    priority: Priority | None = None
    due_date: date | None = None
    due_time: DueTime | None = None
    label_ids: LabelIds | None = None

    @model_validator(mode="after")
    def _time_needs_date(self) -> Self:
        if "due_time" in self.model_fields_set and "due_date" not in self.model_fields_set:
            raise ValueError("due_time must be sent together with due_date")
        if self.due_time is not None and self.due_date is None:
            raise ValueError("due_time requires due_date")
        return self

    @property
    def due_changed(self) -> bool:
        return "due_date" in self.model_fields_set


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    title: str
    description: str
    status: TaskStatus
    priority: int
    due_date: date | None
    due_time: time | None
    label_ids: list[uuid.UUID]
    # 项目里的未完成任务按它升序排列（字节序）；前端做乐观更新时用它把任务插回正确的位置
    sort_key: str
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime
