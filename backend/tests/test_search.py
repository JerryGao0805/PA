"""搜索任务（Cmd/Ctrl+K 用）。"""

from httpx import AsyncClient

from tests.conftest import ClientFactory, RegisterFn
from tests.test_projects import create_project
from tests.test_tasks import add_task


async def search(client: AsyncClient, q: str) -> list[str]:
    resp = await client.get("/api/v1/tasks/search", params={"q": q})
    assert resp.status_code == 200, resp.text
    return [t["title"] for t in resp.json()]


async def test_matches_title_or_description_ignoring_case(
    client: AsyncClient, register: RegisterFn
) -> None:
    await register()
    await add_task(client, "Write Weekly Report")
    await add_task(client, "整理笔记", description="下周的 weekly 会议要用")
    await add_task(client, "买牛奶")

    assert await search(client, "WEEKLY") == ["Write Weekly Report", "整理笔记"]
    assert await search(client, "牛奶") == ["买牛奶"]
    assert await search(client, "咖啡") == []


async def test_includes_done_subtasks_and_archived_projects_but_not_deleted(
    client: AsyncClient, register: RegisterFn
) -> None:
    await register()
    parent = await add_task(client, "搬家")
    await add_task(client, "搬家前打包", parent_id=parent["id"])
    done = await add_task(client, "搬家公司报价")
    await client.patch(f"/api/v1/tasks/{done['id']}", json={"status": "done"})
    shelved = await create_project(client, "旧项目")
    await add_task(client, "搬家清单", project_id=shelved["id"])
    await client.patch(f"/api/v1/projects/{shelved['id']}", json={"archived": True})
    deleted = await add_task(client, "搬家日期")
    await client.delete(f"/api/v1/tasks/{deleted['id']}")

    found = await search(client, "搬家")
    assert sorted(found) == sorted(["搬家", "搬家前打包", "搬家清单", "搬家公司报价"])


async def test_order_open_first_then_title_hits_then_recently_updated(
    client: AsyncClient, register: RegisterFn
) -> None:
    await register()
    done = await add_task(client, "预约体检")
    await client.patch(f"/api/v1/tasks/{done['id']}", json={"status": "done"})
    await add_task(client, "准备材料", description="体检前空腹")
    older = await add_task(client, "体检报告")
    await add_task(client, "体检复查")
    # 改过的算最近的
    await client.patch(f"/api/v1/tasks/{older['id']}", json={"priority": 2})

    assert await search(client, "体检") == ["体检报告", "体检复查", "准备材料", "预约体检"]


async def test_wildcards_match_literally(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    await add_task(client, "完成度 100%")
    await add_task(client, "完成度 1000")
    await add_task(client, "snake_case 命名")
    await add_task(client, "snakeXcase")
    await add_task(client, r"C:\temp 清理")

    assert await search(client, "100%") == ["完成度 100%"]
    assert await search(client, "e_c") == ["snake_case 命名"]
    assert await search(client, "\\") == [r"C:\temp 清理"]


async def test_query_validation(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    await add_task(client, "  空格  ")
    # 只有空白：不搜索
    assert await search(client, "   ") == []
    for params in ({}, {"q": ""}, {"q": "x" * 201}):
        resp = await client.get("/api/v1/tasks/search", params=params)
        assert resp.status_code == 422


async def test_at_most_20_results(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    for i in range(22):
        await add_task(client, f"任务 {i}")
    assert len(await search(client, "任务")) == 20


async def test_only_own_tasks(
    client: AsyncClient, register: RegisterFn, make_client: ClientFactory
) -> None:
    await register()
    await add_task(client, "Alice 的秘密计划")
    async with make_client() as bob:
        await register(email="bob@example.com", c=bob)
        assert await search(bob, "秘密") == []
    resp = await client.get("/api/v1/tasks/search", params={"q": "秘密"})
    assert [t["title"] for t in resp.json()] == ["Alice 的秘密计划"]


async def test_requires_login(make_client: ClientFactory) -> None:
    async with make_client() as anonymous:
        resp = await anonymous.get("/api/v1/tasks/search", params={"q": "x"})
    assert resp.status_code == 401
