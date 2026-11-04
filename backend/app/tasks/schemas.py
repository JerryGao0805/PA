import uuid
from datetime import date, datetime, time
from typing import Annotated, Literal, Self

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
# 待办和进行中。直接创建、拖动到某一列时只能是这两种；完成任务走 PATCH（可以撤销）
OpenStatus = Literal[TaskStatus.TODO, TaskStatus.IN_PROGRESS]
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
    """新任务加在列表末尾。

    传 parent_id 时创建子任务：放在父任务的项目里（传了 project_id 就必须和父任务的一致）。
    子任务只有一层，父任务不能是子任务，也不能已经完成
    """

    title: TaskTitle
    description: TaskDescription = ""
    # 不传时放进收件箱
    project_id: uuid.UUID | None = None
    parent_id: uuid.UUID | None = None
    # 看板的「进行中」一列里添加的任务直接是进行中
    status: OpenStatus = TaskStatus.TODO
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

    - 改 project_id 会把任务移到目标项目的末尾，子任务跟着一起移动；
      子任务单独移到别的项目时变成那个项目里的普通任务
    - 完成父任务时，它未完成的子任务一起完成；重新打开时，和它一起完成的子任务也重新打开。
      重新打开子任务时，如果父任务已完成，父任务也重新打开
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
    parent_id: uuid.UUID | None
    title: str
    description: str
    status: TaskStatus
    priority: int
    due_date: date | None
    due_time: time | None
    label_ids: list[uuid.UUID]
    # 子任务的数量（不含已删除的）和其中已完成的数量
    subtask_count: int
    done_subtask_count: int
    # 列表里的未完成任务按它升序排列（字节序）：顶层任务在项目里排，子任务在父任务下排。
    # 前端做乐观更新时用它把任务插回正确的位置
    sort_key: str
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class TaskMove(BaseModel):
    """拖拽：放到同一个列表里的 after_id 后面，after_id 为 null 表示放到最前。

    同一个列表 = 同一项目里的顶层任务，或同一父任务的子任务。看板的几列共用这一个顺序，
    每一列显示其中对应状态的任务：看板上要传 status（目标列，没换列也传），after_id 是
    目标列里放下位置的上一个任务；不传 status 时目标列就是所有未完成的任务（列表视图）。
    任务已经在这个位置上时不改顺序，所以在看板上换列不会打乱列表视图里的顺序。

    status 和当前状态不同时同时修改状态（从「已完成」拖回来就是重新打开，规则和 PATCH 一样）。
    拖到「已完成」等于完成任务，用 PATCH：已完成的按完成时间排列，位置不变，
    以后重新打开会回到原来的位置
    """

    after_id: uuid.UUID | None
    status: OpenStatus | None = None
