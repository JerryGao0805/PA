import uuid

from fastapi import APIRouter, status

from app.auth.deps import CurrentUser, DbSession
from app.core.errors import error_responses
from app.tasks import service
from app.tasks.schemas import TaskCreate, TaskOut, TaskUpdate

router = APIRouter(prefix="/tasks", tags=["tasks"], responses=error_responses(401))


@router.get("", response_model=list[TaskOut], responses=error_responses(404))
async def list_tasks(
    project_id: uuid.UUID, user: CurrentUser, db: DbSession, done: bool = False
) -> list[TaskOut]:
    """项目里的任务。done=false：未完成的，按排序；done=true：最近完成的 100 条，新的在前。"""
    tasks = await service.list_tasks(db, user.id, project_id, done=done)
    return [TaskOut.model_validate(t) for t in tasks]


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=TaskOut,
    responses=error_responses(404),
)
async def create_task(body: TaskCreate, user: CurrentUser, db: DbSession) -> TaskOut:
    task = await service.create_task(db, user.id, body)
    await db.commit()
    return TaskOut.model_validate(task)


@router.patch("/{task_id}", response_model=TaskOut, responses=error_responses(404))
async def update_task(
    task_id: uuid.UUID, body: TaskUpdate, user: CurrentUser, db: DbSession
) -> TaskOut:
    task = await service.update_task(db, user.id, task_id, body)
    await db.commit()
    return TaskOut.model_validate(task)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT, responses=error_responses(404))
async def delete_task(task_id: uuid.UUID, user: CurrentUser, db: DbSession) -> None:
    await service.delete_task(db, user.id, task_id)
    await db.commit()


@router.post("/{task_id}/restore", response_model=TaskOut, responses=error_responses(404))
async def restore_task(task_id: uuid.UUID, user: CurrentUser, db: DbSession) -> TaskOut:
    """撤销删除。"""
    task = await service.restore_task(db, user.id, task_id)
    await db.commit()
    return TaskOut.model_validate(task)
