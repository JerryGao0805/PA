"""优先级、截止日期，以及「今天」「即将到来」这类跨项目的列表。"""

from typing import Any

from httpx import AsyncClient

from tests.conftest import ClientFactory, RegisterFn
from tests.test_projects import create_project
from tests.test_tasks import add_task

# 测试里的「今天」由调用方指定（前端按用户时区算出来再传给后端）
TODAY = "2026-11-01"


async def query(client: AsyncClient, **params: str) -> list[str]:
    resp = await client.get("/api/v1/tasks", params=params)
    assert resp.status_code == 200, resp.text
    return [t["title"] for t in resp.json()]


async def patch(client: AsyncClient, task: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    resp = await client.patch(f"/api/v1/tasks/{task['id']}", json=body)
    assert resp.status_code == 200, resp.text
    data: dict[str, Any] = resp.json()
    return data


async def test_defaults(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    task = await add_task(client, "普通任务")
    assert task["priority"] == 4
    assert task["due_date"] is None
    assert task["due_time"] is None
    assert task["label_ids"] == []


async def test_priority(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    task = await add_task(client, "急事", priority=1)
    assert task["priority"] == 1
    assert (await patch(client, task, {"priority": 3}))["priority"] == 3
    assert (await patch(client, task, {"title": "不急了"}))["priority"] == 3  # 不传时不改
    for priority in (0, 5):
        resp = await client.patch(f"/api/v1/tasks/{task['id']}", json={"priority": priority})
        assert resp.status_code == 422


async def test_due_date_and_time(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    task = await add_task(client, "交报告", due_date="2026-11-03", due_time="15:00:42")
    assert task["due_date"] == "2026-11-03"
    assert task["due_time"] == "15:00:00"  # 精确到分钟

    # 改日期时没传时间 = 全天
    task = await patch(client, task, {"due_date": "2026-11-04"})
    assert (task["due_date"], task["due_time"]) == ("2026-11-04", None)
    task = await patch(client, task, {"due_date": "2026-11-04", "due_time": "09:30"})
    assert task["due_time"] == "09:30:00"
    # 不传 due_date 时不改
    task = await patch(client, task, {"priority": 2})
    assert (task["due_date"], task["due_time"]) == ("2026-11-04", "09:30:00")
    # 传 null 清除，时间也一起清掉
    task = await patch(client, task, {"due_date": None})
    assert (task["due_date"], task["due_time"]) == (None, None)


async def test_due_validation(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    task = await add_task(client, "x", due_date="2026-11-03")
    url = f"/api/v1/tasks/{task['id']}"
    for body in (
        {"title": "x", "due_time": "10:00"},  # 有时间没日期
        {"title": "x", "due_date": "2026-02-30"},
        {"title": "x", "due_date": "2026-11-03", "due_time": "10:00+08:00"},  # 不带时区
    ):
        assert (await client.post("/api/v1/tasks", json=body)).status_code == 422, body
    bodies: list[dict[str, str | None]] = [
        {"due_time": "10:00"},  # 只改时间时也要带上日期
        {"due_date": None, "due_time": "10:00"},
    ]
    for patch_body in bodies:
        assert (await client.patch(url, json=patch_body)).status_code == 422, patch_body


async def test_today_includes_overdue_and_sorts_by_time_then_priority(
    client: AsyncClient, register: RegisterFn
) -> None:
    await register()
    work = await create_project(client, "工作")
    await add_task(client, "全天 P4", due_date=TODAY)
    await add_task(client, "全天 P1", due_date=TODAY, priority=1, project_id=work["id"])
    await add_task(client, "下午三点", due_date=TODAY, due_time="15:00")
    await add_task(client, "上午九点", due_date=TODAY, due_time="09:00")
    await add_task(client, "上周逾期", due_date="2026-10-25")
    await add_task(client, "明天", due_date="2026-11-02")
    await add_task(client, "没有日期")
    done = await add_task(client, "今天已完成", due_date=TODAY)
    await patch(client, done, {"status": "done"})
    deleted = await add_task(client, "今天已删除", due_date=TODAY)
    await client.delete(f"/api/v1/tasks/{deleted['id']}")

    assert await query(client, due_to=TODAY) == [
        "上周逾期",
        "上午九点",
        "下午三点",
        "全天 P1",
        "全天 P4",
    ]


async def test_upcoming_range(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    for title, due in (
        ("昨天", "2026-10-31"),
        ("今天", TODAY),
        ("第七天", "2026-11-07"),
        ("第八天", "2026-11-08"),
        ("周三", "2026-11-04"),
    ):
        await add_task(client, title, due_date=due)

    assert await query(client, due_from=TODAY, due_to="2026-11-07") == ["今天", "周三", "第七天"]


async def test_cross_project_lists_skip_archived_projects(
    client: AsyncClient, register: RegisterFn
) -> None:
    await register()
    shelved = await create_project(client, "搁置")
    await add_task(client, "搁置项目里的", due_date=TODAY, project_id=shelved["id"])
    await add_task(client, "收件箱里的", due_date=TODAY)
    await client.patch(f"/api/v1/projects/{shelved['id']}", json={"archived": True})

    assert await query(client, due_to=TODAY) == ["收件箱里的"]
    # 进项目页还是能看到
    assert await query(client, project_id=shelved["id"]) == ["搁置项目里的"]


async def test_filters_combine(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    work = await create_project(client, "工作")
    await add_task(client, "工作 今天", due_date=TODAY, project_id=work["id"])
    await add_task(client, "工作 下周", due_date="2026-11-09", project_id=work["id"])
    await add_task(client, "收件箱 今天", due_date=TODAY)

    assert await query(client, project_id=work["id"], due_to=TODAY) == ["工作 今天"]


async def test_get_single_task(
    client: AsyncClient, make_client: ClientFactory, register: RegisterFn
) -> None:
    await register(email="alice@example.com")
    task = await add_task(client, "详情", description="说明", priority=2, due_date=TODAY)
    url = f"/api/v1/tasks/{task['id']}"

    resp = await client.get(url)
    assert resp.status_code == 200
    assert resp.json() == task

    async with make_client() as bob:
        await register(email="bob@example.com", c=bob)
        resp = await bob.get(url)
        assert resp.status_code == 404
        assert resp.json()["code"] == "task_not_found"

    await client.delete(url)
    assert (await client.get(url)).status_code == 404
