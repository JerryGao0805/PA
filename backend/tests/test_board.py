"""看板：按状态分列，拖到另一列时同时改状态；项目记住用列表还是看板显示。"""

from typing import Any

from httpx import AsyncClient, Response

from tests.conftest import RegisterFn
from tests.test_projects import create_project, projects
from tests.test_scheduling import patch
from tests.test_subtasks import get, subtasks
from tests.test_tasks import add_task, inbox_id, list_tasks


async def board(client: AsyncClient, project_id: str) -> dict[str, list[str]]:
    """看板的三列：未完成的按手动顺序分成两列，已完成的按完成时间（新的在前）。"""
    open_tasks = await client.get("/api/v1/tasks", params={"project_id": project_id})
    done = await client.get("/api/v1/tasks", params={"project_id": project_id, "done": "true"})
    return {
        "todo": [t["title"] for t in open_tasks.json() if t["status"] == "todo"],
        "in_progress": [t["title"] for t in open_tasks.json() if t["status"] == "in_progress"],
        "done": [t["title"] for t in done.json()],
    }


async def move(
    client: AsyncClient,
    task: dict[str, Any],
    after: dict[str, Any] | None,
    status: str | None = None,
) -> Response:
    body: dict[str, Any] = {"after_id": after and after["id"]}
    if status is not None:
        body["status"] = status
    return await client.post(f"/api/v1/tasks/{task['id']}/move", json=body)


async def test_project_remembers_layout(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    work = await create_project(client, "工作")
    assert work["layout"] == "list"

    resp = await client.patch(f"/api/v1/projects/{work['id']}", json={"layout": "board"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["layout"] == "board"
    [inbox, saved] = await projects(client)
    assert saved["layout"] == "board"

    # 收件箱不能改名、归档，但可以换成看板
    url = f"/api/v1/projects/{inbox['id']}"
    assert (await client.patch(url, json={"layout": "board"})).json()["layout"] == "board"
    resp = await client.patch(url, json={"layout": "board", "name": "x"})
    assert (resp.status_code, resp.json()["code"]) == (400, "inbox_immutable")

    resp = await client.patch(f"/api/v1/projects/{work['id']}", json={"layout": "calendar"})
    assert resp.status_code == 422


async def test_create_task_in_progress(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    inbox = await inbox_id(client)
    await add_task(client, "a")
    started = await add_task(client, "b", status="in_progress")
    assert started["status"] == "in_progress"
    assert await board(client, inbox) == {"todo": ["a"], "in_progress": ["b"], "done": []}
    # 未完成 = 待办 + 进行中
    assert (await projects(client))[0]["open_task_count"] == 2

    resp = await client.post("/api/v1/tasks", json={"title": "c", "status": "done"})
    assert resp.status_code == 422


async def test_drag_between_columns(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    inbox = await inbox_id(client)
    a, b, c, d = [await add_task(client, t) for t in "abcd"]

    # 拖到空的一列：位置没有限制，key 不变，列表视图里的顺序也不变
    resp = await move(client, b, None, "in_progress")
    assert resp.status_code == 200, resp.text
    assert (resp.json()["status"], resp.json()["sort_key"]) == ("in_progress", b["sort_key"])
    # 放到 b 后面：d 本来就在 b 后面，也不用改
    resp = await move(client, d, b, "in_progress")
    assert resp.json()["sort_key"] == d["sort_key"]
    assert await board(client, inbox) == {"todo": ["a", "c"], "in_progress": ["b", "d"], "done": []}
    assert await list_tasks(client, inbox) == ["a", "b", "c", "d"]

    # 要改的时候，紧挨着目标列里的第一个任务（放到最前时）或上一个任务放
    await move(client, c, None, "in_progress")
    assert await board(client, inbox) == {"todo": ["a"], "in_progress": ["c", "b", "d"], "done": []}
    assert await list_tasks(client, inbox) == ["a", "c", "b", "d"]
    await move(client, a, d, "in_progress")
    assert await list_tasks(client, inbox) == ["c", "b", "d", "a"]

    # 列内排序也传 status（目标列）
    await move(client, a, c, "in_progress")
    assert await board(client, inbox) == {
        "todo": [],
        "in_progress": ["c", "a", "b", "d"],
        "done": [],
    }
    await move(client, b, None, "todo")
    assert await board(client, inbox) == {"todo": ["b"], "in_progress": ["c", "a", "d"], "done": []}


async def test_drag_to_done_keeps_position(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    inbox = await inbox_id(client)
    x = await add_task(client, "x")
    parent = await add_task(client, "父任务", status="in_progress")
    y = await add_task(client, "y")
    child = await add_task(client, "子任务", parent_id=parent["id"])

    resp = await move(client, parent, None, "done")
    assert resp.status_code == 200, resp.text
    assert resp.json()["sort_key"] == parent["sort_key"]
    assert await board(client, inbox) == {"todo": ["x", "y"], "in_progress": [], "done": ["父任务"]}
    # 和勾选完成一样，子任务一起完成
    assert (await get(client, child))["status"] == "done"

    # 拖到「已完成」时不能指定位置
    resp = await move(client, x, y, "done")
    assert resp.status_code == 422

    # 重新打开后回到原来的位置，子任务也一起重新打开
    await patch(client, parent, {"status": "todo"})
    assert await list_tasks(client, inbox) == ["x", "父任务", "y"]
    assert await subtasks(client, parent) == ["子任务"]

    # 也可以从「已完成」直接拖到别的列：拖到空的一列，同样回到原来的位置
    await move(client, parent, None, "done")
    resp = await move(client, parent, None, "in_progress")
    assert resp.json()["completed_at"] is None
    assert await board(client, inbox) == {"todo": ["x", "y"], "in_progress": ["父任务"], "done": []}
    assert await list_tasks(client, inbox) == ["x", "父任务", "y"]
    assert await subtasks(client, parent) == ["子任务"]


async def test_invalid_drag_changes_nothing(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    work = await create_project(client, "工作")
    task = await add_task(client, "收件箱里的任务")
    elsewhere = await add_task(client, "别的项目里的任务", project_id=work["id"])

    resp = await move(client, task, elsewhere, "in_progress")
    assert (resp.status_code, resp.json()["code"]) == (400, "invalid_move")
    assert (await get(client, task))["status"] == "todo"

    resp = await move(client, task, None, "started")
    assert resp.status_code == 422
