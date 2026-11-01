import uuid
from datetime import date

from fastapi import APIRouter, status

from app.auth.deps import CurrentUser, DbSession
from app.core.errors import error_responses
from app.tasks import service
from app.tasks.schemas import TaskCreate, TaskOut, TaskUpdate

router = APIRouter(prefix="/tasks", tags=["tasks"], responses=error_responses(401))


@router.get("", response_model=list[TaskOut], responses=error_responses(404))
async def list_tasks(
    user: CurrentUser,
    db: DbSession,
    project_id: uuid.UUID | None = None,
    label_id: uuid.UUID | None = None,
    due_from: date | None = None,
    due_to: date | None = None,
    done: bool = False,
) -> list[TaskOut]:
    """筛选条件可以组合。

    - project_id：项目里的任务，按手动顺序
    - 不传 project_id：跨项目（不含已归档的项目），按截止日期、时间、优先级排序。
      「今天」= due_to=今天（含逾期）；「即将到来」= due_from=今天&due_to=6 天后
    - label_id：带这个标签的任务
    - done=true：最近完成的 100 条，新的在前
    """
    tasks = await service.list_tasks(
        db,
        user.id,
        service.TaskFilter(
            project_id=project_id,
            label_id=label_id,
            due_from=due_from,
            due_to=due_to,
            done=done,
        ),
    )
    return await service.tasks_out(db, tasks)


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=TaskOut,
    responses=error_responses(404),
)
async def create_task(body: TaskCreate, user: CurrentUser, db: DbSession) -> TaskOut:
    task = await service.create_task(db, user.id, body)
    out = await service.task_out(db, task)
    await db.commit()
    return out


@router.get("/{task_id}", response_model=TaskOut, responses=error_responses(404))
async def get_task(task_id: uuid.UUID, user: CurrentUser, db: DbSession) -> TaskOut:
    return await service.task_out(db, await service.get_task(db, user.id, task_id))


@router.patch("/{task_id}", response_model=TaskOut, responses=error_responses(404))
async def update_task(
    task_id: uuid.UUID, body: TaskUpdate, user: CurrentUser, db: DbSession
) -> TaskOut:
    task = await service.update_task(db, user.id, task_id, body)
    out = await service.task_out(db, task)
    await db.commit()
    return out


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT, responses=error_responses(404))
async def delete_task(task_id: uuid.UUID, user: CurrentUser, db: DbSession) -> None:
    await service.delete_task(db, user.id, task_id)
    await db.commit()


@router.post("/{task_id}/restore", response_model=TaskOut, responses=error_responses(404))
async def restore_task(task_id: uuid.UUID, user: CurrentUser, db: DbSession) -> TaskOut:
    """撤销删除。"""
    task = await service.restore_task(db, user.id, task_id)
    out = await service.task_out(db, task)
    await db.commit()
    return out
