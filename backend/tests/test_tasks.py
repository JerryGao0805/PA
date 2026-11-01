from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.core.db import SessionLocal
from app.tasks.models import Task
from app.worker import cleanup_expired
from tests.conftest import ClientFactory, RegisterFn
from tests.helpers import execute
from tests.test_projects import create_project, projects


async def add_task(client: AsyncClient, title: str, **extra: object) -> dict[str, Any]:
    resp = await client.post("/api/v1/tasks", json={"title": title, **extra})
    assert resp.status_code == 201, resp.text
    data: dict[str, Any] = resp.json()
    return data


async def list_tasks(client: AsyncClient, project_id: str, *, done: bool = False) -> list[str]:
    resp = await client.get(
        "/api/v1/tasks", params={"project_id": project_id, "done": str(done).lower()}
    )
    assert resp.status_code == 200, resp.text
    return [t["title"] for t in resp.json()]


async def inbox_id(client: AsyncClient) -> str:
    [inbox] = [p for p in await projects(client) if p["is_inbox"]]
    return str(inbox["id"])


async def test_new_tasks_go_to_inbox_in_order(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    first = await add_task(client, "  买牛奶  ")
    assert first["title"] == "买牛奶"
    assert first["status"] == "todo"
    assert first["completed_at"] is None
    assert first["project_id"] == await inbox_id(client)
    await add_task(client, "写周报")
    await add_task(client, "交电费")

    assert await list_tasks(client, await inbox_id(client)) == ["买牛奶", "写周报", "交电费"]


async def test_task_validation(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    for body in (
        {"title": "   "},
        {"title": "x" * 501},
        {"title": "ok", "description": "x" * 10_001},
    ):
        resp = await client.post("/api/v1/tasks", json=body)
        assert resp.status_code == 422, body
    resp = await client.patch(
        f"/api/v1/tasks/{(await add_task(client, 'ok'))['id']}", json={"status": "archived"}
    )
    assert resp.status_code == 422


async def test_complete_and_reopen(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    inbox = await inbox_id(client)
    a, b, c = [await add_task(client, t) for t in ("a", "b", "c")]

    resp = await client.patch(f"/api/v1/tasks/{b['id']}", json={"status": "done"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "done"
    assert resp.json()["completed_at"] is not None
    await client.patch(f"/api/v1/tasks/{c['id']}", json={"status": "done"})

    assert await list_tasks(client, inbox) == ["a"]
    assert await list_tasks(client, inbox, done=True) == ["c", "b"]  # 最近完成的在前

    # 重新打开后回到原来的位置
    resp = await client.patch(f"/api/v1/tasks/{b['id']}", json={"status": "todo"})
    assert resp.json()["completed_at"] is None
    assert await list_tasks(client, inbox) == ["a", "b"]

    resp = await client.patch(f"/api/v1/tasks/{a['id']}", json={"status": "in_progress"})
    assert resp.json()["status"] == "in_progress"
    assert resp.json()["completed_at"] is None
    assert await list_tasks(client, inbox) == ["a", "b"]  # 进行中也算未完成


async def test_edit_title_and_description(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    task = await add_task(client, "草稿")
    resp = await client.patch(
        f"/api/v1/tasks/{task['id']}", json={"title": "定稿", "description": "**加粗**"}
    )
    assert resp.status_code == 200
    assert resp.json()["title"] == "定稿"
    assert resp.json()["description"] == "**加粗**"
    assert resp.json()["updated_at"] >= task["updated_at"]


async def test_move_task_to_end_of_other_project(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    work = await create_project(client, "工作")
    await add_task(client, "已有任务", project_id=work["id"])
    task = await add_task(client, "从收件箱移过来")

    resp = await client.patch(f"/api/v1/tasks/{task['id']}", json={"project_id": work["id"]})
    assert resp.status_code == 200
    assert resp.json()["project_id"] == work["id"]
    assert await list_tasks(client, work["id"]) == ["已有任务", "从收件箱移过来"]
    assert await list_tasks(client, await inbox_id(client)) == []


async def test_delete_and_restore(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    inbox = await inbox_id(client)
    a = await add_task(client, "a")
    await add_task(client, "b")
    url = f"/api/v1/tasks/{a['id']}"

    assert (await client.delete(url)).status_code == 204
    assert await list_tasks(client, inbox) == ["b"]
    assert (await client.patch(url, json={"title": "x"})).status_code == 404
    assert (await client.delete(url)).status_code == 404

    resp = await client.post(f"{url}/restore")
    assert resp.status_code == 200
    assert await list_tasks(client, inbox) == ["a", "b"]  # 回到原来的位置

    # 没被删除的任务不能「恢复」
    resp = await client.post(f"{url}/restore")
    assert resp.status_code == 404
    assert resp.json()["code"] == "task_not_found"


async def test_worker_purges_tasks_deleted_long_ago(
    client: AsyncClient, register: RegisterFn
) -> None:
    await register()
    old = await add_task(client, "很久以前删的")
    recent = await add_task(client, "刚删的")
    await client.delete(f"/api/v1/tasks/{old['id']}")
    await client.delete(f"/api/v1/tasks/{recent['id']}")
    await execute(
        "UPDATE tasks SET deleted_at = now() - interval '31 days' WHERE id = :id", id=old["id"]
    )

    await cleanup_expired()

    async with SessionLocal() as db:
        assert await db.scalar(select(func.count()).select_from(Task)) == 1
    assert (await client.post(f"/api/v1/tasks/{recent['id']}/restore")).status_code == 200


async def test_other_users_tasks_are_invisible(
    client: AsyncClient, make_client: ClientFactory, register: RegisterFn
) -> None:
    await register(email="alice@example.com")
    alice_task = await add_task(client, "Alice 的任务")
    url = f"/api/v1/tasks/{alice_task['id']}"
    await client.delete(url)  # 已删除的任务也不能被别人恢复

    async with make_client() as bob:
        await register(email="bob@example.com", c=bob)
        for resp in (
            await bob.patch(url, json={"title": "改掉"}),
            await bob.delete(url),
            await bob.post(f"{url}/restore"),
        ):
            assert resp.status_code == 404
            assert resp.json()["code"] == "task_not_found"

        # 也不能把自己的任务移进别人的项目
        bob_task = await add_task(bob, "Bob 的任务")
        resp = await bob.patch(
            f"/api/v1/tasks/{bob_task['id']}", json={"project_id": alice_task["project_id"]}
        )
        assert resp.status_code == 404
        assert resp.json()["code"] == "project_not_found"

    resp = await client.post(f"{url}/restore")
    assert resp.json()["title"] == "Alice 的任务"


async def test_database_rejects_task_in_another_users_project(
    client: AsyncClient, make_client: ClientFactory, register: RegisterFn
) -> None:
    """即使应用代码漏了检查，复合外键也不允许任务挂到别人的项目下。"""
    alice = await register(email="alice@example.com")
    async with make_client() as bob:
        await register(email="bob@example.com", c=bob)
        bob_inbox = await inbox_id(bob)

    with pytest.raises(IntegrityError, match="fk_tasks_project_id_projects"):
        await execute(
            "INSERT INTO tasks (user_id, project_id, title, sort_key) "
            "VALUES (:user_id, :project_id, 'x', 'a0')",
            user_id=alice["id"],
            project_id=bob_inbox,
        )
