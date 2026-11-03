"""拖拽排序：任务（项目里的顶层任务、父任务下的子任务）和项目。"""

from typing import Any

from httpx import AsyncClient, Response

from tests.conftest import ClientFactory, RegisterFn
from tests.test_projects import create_project, projects
from tests.test_subtasks import subtasks
from tests.test_tasks import add_task, inbox_id, list_tasks


async def move(client: AsyncClient, item: dict[str, Any], after: dict[str, Any] | None) -> Response:
    kind = "tasks" if "title" in item else "projects"
    return await client.post(
        f"/api/v1/{kind}/{item['id']}/move", json={"after_id": after and after["id"]}
    )


async def test_reorder_tasks(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    inbox = await inbox_id(client)
    a, b, c, d = [await add_task(client, t) for t in "abcd"]

    resp = await move(client, d, None)  # 放到最前
    assert resp.status_code == 200, resp.text
    assert resp.json()["sort_key"] < a["sort_key"]
    assert await list_tasks(client, inbox) == ["d", "a", "b", "c"]

    await move(client, a, c)  # 放到最后
    assert await list_tasks(client, inbox) == ["d", "b", "c", "a"]
    await move(client, d, b)  # 放到中间
    assert await list_tasks(client, inbox) == ["b", "d", "c", "a"]
    await move(client, d, b)  # 原地不动也可以
    assert await list_tasks(client, inbox) == ["b", "d", "c", "a"]

    # 新任务仍然加在末尾
    await add_task(client, "e")
    assert await list_tasks(client, inbox) == ["b", "d", "c", "a", "e"]


async def test_reorder_skips_hidden_tasks(client: AsyncClient, register: RegisterFn) -> None:
    """已完成和已删除的任务看不到，但它们的 key 还在：新 key 不能和它们重复。"""
    await register()
    inbox = await inbox_id(client)
    a, hidden, b, c = [await add_task(client, t) for t in ("a", "hidden", "b", "c")]
    await client.patch(f"/api/v1/tasks/{hidden['id']}", json={"status": "done"})

    # 前端看到的是 [a, b, c]：b 已经在 a 后面，原地放下不改顺序
    resp = await move(client, b, a)
    assert resp.json()["sort_key"] == b["sort_key"]
    # c 放到 a 后面：新 key 在 a 和 hidden 之间
    await move(client, c, a)
    assert await list_tasks(client, inbox) == ["a", "c", "b"]
    await client.patch(f"/api/v1/tasks/{hidden['id']}", json={"status": "todo"})
    assert await list_tasks(client, inbox) == ["a", "c", "hidden", "b"]


async def test_reorder_subtasks(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    parent = await add_task(client, "父任务")
    a, b, c = [await add_task(client, t, parent_id=parent["id"]) for t in "abc"]

    await move(client, c, None)
    await move(client, a, b)
    assert await subtasks(client, parent) == ["c", "b", "a"]


async def test_move_only_within_the_same_list(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    work = await create_project(client, "工作")
    task = await add_task(client, "收件箱里的任务")
    elsewhere = await add_task(client, "别的项目里的任务", project_id=work["id"])
    parent = await add_task(client, "父任务")
    child = await add_task(client, "子任务", parent_id=parent["id"])

    for item, after in (
        (task, elsewhere),  # 不同项目
        (task, child),  # 顶层任务不能放到子任务之间
        (child, task),  # 反过来也不行
        (task, task),
    ):
        resp = await move(client, item, after)
        assert resp.status_code == 400, (item["title"], after["title"])
        assert resp.json()["code"] == "invalid_move"

    await client.delete(f"/api/v1/tasks/{parent['id']}")
    resp = await move(client, task, parent)
    assert resp.status_code == 404
    assert resp.json()["code"] == "task_not_found"


async def test_reorder_projects(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    a, b, c = [await create_project(client, name) for name in "abc"]

    async def names() -> list[str]:
        return [p["name"] for p in await projects(client) if not p["is_inbox"]]

    resp = await move(client, c, None)
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "c"
    assert await names() == ["c", "a", "b"]
    await move(client, c, b)
    assert await names() == ["a", "b", "c"]

    # 归档的项目也在同一个顺序里，取消归档后回到原来的位置
    await client.patch(f"/api/v1/projects/{b['id']}", json={"archived": True})
    await move(client, c, a)  # 前端看到的是 [a, c]
    await client.patch(f"/api/v1/projects/{b['id']}", json={"archived": False})
    assert await names() == ["a", "c", "b"]

    # 收件箱始终在最前，不能移动，也不能作为位置参照
    [inbox] = [p for p in await projects(client) if p["is_inbox"]]
    assert (await projects(client))[0]["is_inbox"]
    resp = await move(client, inbox, a)
    assert (resp.status_code, resp.json()["code"]) == (400, "inbox_immutable")
    resp = await move(client, a, inbox)
    assert (resp.status_code, resp.json()["code"]) == (400, "invalid_move")
    resp = await move(client, a, a)
    assert (resp.status_code, resp.json()["code"]) == (400, "invalid_move")


async def test_cannot_move_other_users_items(
    client: AsyncClient, make_client: ClientFactory, register: RegisterFn
) -> None:
    await register(email="alice@example.com")
    alice_task = await add_task(client, "Alice 的任务")
    alice_project = await create_project(client, "Alice 的项目")

    async with make_client() as bob:
        await register(email="bob@example.com", c=bob)
        bob_task = await add_task(bob, "Bob 的任务")
        bob_project = await create_project(bob, "Bob 的项目")
        for resp in (await move(bob, alice_task, None), await move(bob, bob_task, alice_task)):
            assert (resp.status_code, resp.json()["code"]) == (404, "task_not_found")
        for resp in (
            await move(bob, alice_project, None),
            await move(bob, bob_project, alice_project),
        ):
            assert (resp.status_code, resp.json()["code"]) == (404, "project_not_found")
