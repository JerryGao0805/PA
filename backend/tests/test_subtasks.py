"""子任务：只有一层，跟随父任务移动、完成、删除。"""

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.exc import IntegrityError

from tests.conftest import ClientFactory, RegisterFn
from tests.helpers import execute
from tests.test_projects import create_project, projects
from tests.test_scheduling import patch, query
from tests.test_tasks import add_task, inbox_id, list_tasks


async def subtasks(client: AsyncClient, parent: dict[str, Any], *, done: bool = False) -> list[str]:
    return await query(client, parent_id=parent["id"], done=str(done).lower())


async def get(client: AsyncClient, task: dict[str, Any]) -> dict[str, Any]:
    resp = await client.get(f"/api/v1/tasks/{task['id']}")
    assert resp.status_code == 200, resp.text
    data: dict[str, Any] = resp.json()
    return data


async def test_create_subtasks(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    work = await create_project(client, "工作")
    parent = await add_task(client, "发布新版本", project_id=work["id"])
    assert (parent["parent_id"], parent["subtask_count"], parent["done_subtask_count"]) == (
        None,
        0,
        0,
    )

    # 不传 project_id 时放在父任务的项目里，而不是收件箱
    a = await add_task(client, "写更新日志", parent_id=parent["id"])
    assert (a["parent_id"], a["project_id"]) == (parent["id"], work["id"])
    await add_task(client, "打 tag", parent_id=parent["id"], project_id=work["id"])
    await add_task(client, "发公告", parent_id=parent["id"])

    assert await subtasks(client, parent) == ["写更新日志", "打 tag", "发公告"]
    # 项目列表和计数只算顶层任务
    assert await list_tasks(client, work["id"]) == ["发布新版本"]
    [_, counted] = await projects(client)
    assert counted["open_task_count"] == 1

    await patch(client, a, {"status": "done"})
    parent = await get(client, parent)
    assert (parent["subtask_count"], parent["done_subtask_count"]) == (3, 1)
    assert await subtasks(client, parent) == ["打 tag", "发公告"]
    assert await subtasks(client, parent, done=True) == ["写更新日志"]

    # 列表接口返回的父任务也带着计数
    resp = await client.get("/api/v1/tasks", params={"project_id": work["id"]})
    assert resp.json()[0]["subtask_count"] == 3


async def test_subtasks_are_one_level_in_the_same_project(
    client: AsyncClient, register: RegisterFn
) -> None:
    await register()
    other = await create_project(client, "别的项目")
    parent = await add_task(client, "父任务")
    child = await add_task(client, "子任务", parent_id=parent["id"])
    done = await add_task(client, "已完成")
    await patch(client, done, {"status": "done"})

    for body in (
        {"title": "孙任务", "parent_id": child["id"]},  # 只有一层
        {"title": "x", "parent_id": parent["id"], "project_id": other["id"]},  # 项目不一致
        {"title": "x", "parent_id": done["id"]},  # 父任务已完成
    ):
        resp = await client.post("/api/v1/tasks", json=body)
        assert resp.status_code == 400, body
        assert resp.json()["code"] == "invalid_parent"

    await client.delete(f"/api/v1/tasks/{parent['id']}")
    resp = await client.post("/api/v1/tasks", json={"title": "x", "parent_id": parent["id"]})
    assert resp.status_code == 404
    assert resp.json()["code"] == "task_not_found"


async def test_cross_project_lists_include_subtasks(
    client: AsyncClient, register: RegisterFn
) -> None:
    await register()
    parent = await add_task(client, "搬家")
    await add_task(client, "订搬家公司", parent_id=parent["id"], due_date="2026-11-01")
    assert await query(client, due_to="2026-11-01") == ["订搬家公司"]


async def test_moving_parent_moves_subtasks(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    work = await create_project(client, "工作")
    parent = await add_task(client, "父任务")
    a = await add_task(client, "a", parent_id=parent["id"])
    b = await add_task(client, "b", parent_id=parent["id"])

    await patch(client, parent, {"project_id": work["id"]})
    for child in (a, b):
        assert (await get(client, child))["project_id"] == work["id"]
    assert await subtasks(client, parent) == ["a", "b"]  # 顺序不变

    # 子任务单独移走后变成那个项目里的普通任务
    moved = await patch(client, b, {"project_id": await inbox_id(client)})
    assert moved["parent_id"] is None
    assert await list_tasks(client, await inbox_id(client)) == ["b"]
    assert await subtasks(client, parent) == ["a"]


async def test_completing_parent_completes_subtasks(
    client: AsyncClient, register: RegisterFn
) -> None:
    await register()
    parent = await add_task(client, "父任务")
    early = await add_task(client, "早就完成了", parent_id=parent["id"])
    await add_task(client, "a", parent_id=parent["id"])
    await add_task(client, "b", parent_id=parent["id"])
    await patch(client, early, {"status": "done"})

    await patch(client, parent, {"status": "done"})
    assert await subtasks(client, parent) == []
    assert (await get(client, parent))["done_subtask_count"] == 3

    # 重新打开父任务：只有和它一起完成的子任务重新打开
    await patch(client, parent, {"status": "todo"})
    assert await subtasks(client, parent) == ["a", "b"]
    assert await subtasks(client, parent, done=True) == ["早就完成了"]


async def test_reopening_subtask_reopens_parent(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    parent = await add_task(client, "父任务")
    a = await add_task(client, "a", parent_id=parent["id"])
    await add_task(client, "b", parent_id=parent["id"])
    await patch(client, parent, {"status": "done"})

    await patch(client, a, {"status": "todo"})
    assert (await get(client, parent))["status"] == "todo"
    # 只打开父任务本身，别的子任务还是已完成
    assert await subtasks(client, parent) == ["a"]
    assert await subtasks(client, parent, done=True) == ["b"]


async def test_deleting_parent_deletes_subtasks(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    parent = await add_task(client, "父任务")
    early = await add_task(client, "早就删了", parent_id=parent["id"], due_date="2026-11-01")
    a = await add_task(client, "a", parent_id=parent["id"], due_date="2026-11-01")
    await client.delete(f"/api/v1/tasks/{early['id']}")

    assert (await client.delete(f"/api/v1/tasks/{parent['id']}")).status_code == 204
    assert await query(client, due_to="2026-11-01") == []
    assert (await client.get(f"/api/v1/tasks/{a['id']}")).status_code == 404
    resp = await client.get("/api/v1/tasks", params={"parent_id": parent["id"]})
    assert resp.status_code == 404
    # 父任务被删除时，子任务不能单独恢复
    assert (await client.post(f"/api/v1/tasks/{a['id']}/restore")).status_code == 404

    # 恢复父任务：只有和它一起删除的子任务恢复
    assert (await client.post(f"/api/v1/tasks/{parent['id']}/restore")).status_code == 200
    assert await subtasks(client, parent) == ["a"]
    assert (await get(client, parent))["subtask_count"] == 1


async def test_restoring_open_subtask_reopens_parent(
    client: AsyncClient, register: RegisterFn
) -> None:
    await register()
    parent = await add_task(client, "父任务")
    a = await add_task(client, "a", parent_id=parent["id"])
    await client.delete(f"/api/v1/tasks/{a['id']}")
    await patch(client, parent, {"status": "done"})

    await client.post(f"/api/v1/tasks/{a['id']}/restore")
    assert (await get(client, parent))["status"] == "todo"


async def test_other_users_task_cannot_be_parent(
    client: AsyncClient, make_client: ClientFactory, register: RegisterFn
) -> None:
    await register(email="alice@example.com")
    alice_task = await add_task(client, "Alice 的任务")

    async with make_client() as bob:
        await register(email="bob@example.com", c=bob)
        resp = await bob.post("/api/v1/tasks", json={"title": "x", "parent_id": alice_task["id"]})
        assert resp.status_code == 404
        assert resp.json()["code"] == "task_not_found"
        resp = await bob.get("/api/v1/tasks", params={"parent_id": alice_task["id"]})
        assert resp.status_code == 404


async def test_database_keeps_subtask_in_parent_project(
    client: AsyncClient, register: RegisterFn
) -> None:
    """即使应用代码漏了检查，复合外键也不允许子任务和父任务不在同一个项目里。"""
    user = await register()
    other = await create_project(client, "别的项目")
    parent = await add_task(client, "父任务")

    with pytest.raises(IntegrityError, match="fk_tasks_parent_id_tasks"):
        await execute(
            "INSERT INTO tasks (user_id, project_id, parent_id, title, sort_key) "
            "VALUES (:user_id, :project_id, :parent_id, 'x', 'a0')",
            user_id=user["id"],
            project_id=other["id"],
            parent_id=parent["id"],
        )
    with pytest.raises(IntegrityError, match="ck_tasks_parent_not_self"):
        await execute("UPDATE tasks SET parent_id = id WHERE id = :id", id=parent["id"])
