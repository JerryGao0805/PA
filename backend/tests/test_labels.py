from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.exc import IntegrityError

from tests.conftest import ClientFactory, RegisterFn
from tests.helpers import execute
from tests.test_tasks import add_task


async def labels(client: AsyncClient) -> list[dict[str, Any]]:
    resp = await client.get("/api/v1/labels")
    assert resp.status_code == 200, resp.text
    data: list[dict[str, Any]] = resp.json()
    return data


async def create_label(client: AsyncClient, name: str, **extra: object) -> dict[str, Any]:
    resp = await client.post("/api/v1/labels", json={"name": name, **extra})
    assert resp.status_code == 201, resp.text
    data: dict[str, Any] = resp.json()
    return data


async def tagged(client: AsyncClient, label_id: str) -> list[str]:
    resp = await client.get("/api/v1/tasks", params={"label_id": label_id})
    assert resp.status_code == 200, resp.text
    return [t["title"] for t in resp.json()]


async def test_label_crud(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    assert await labels(client) == []
    work = await create_label(client, "  工作  ", color="blue")
    assert work["name"] == "工作"
    assert work["color"] == "blue"
    await create_label(client, "alpha")

    assert [lb["name"] for lb in await labels(client)] == ["alpha", "工作"]  # 按名字排序

    resp = await client.patch(f"/api/v1/labels/{work['id']}", json={"name": "上班", "color": "red"})
    assert resp.status_code == 200
    assert (resp.json()["name"], resp.json()["color"]) == ("上班", "red")

    assert (await client.delete(f"/api/v1/labels/{work['id']}")).status_code == 204
    assert [lb["name"] for lb in await labels(client)] == ["alpha"]
    resp = await client.delete(f"/api/v1/labels/{work['id']}")
    assert resp.status_code == 404
    assert resp.json()["code"] == "label_not_found"


async def test_label_validation(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    for body in (
        {"name": ""},
        {"name": "   "},
        {"name": "两个 词"},  # 快速添加里用 @标签 引用，不能有空格
        {"name": "x" * 51},
        {"name": "ok", "color": "black"},
    ):
        resp = await client.post("/api/v1/labels", json=body)
        assert resp.status_code == 422, body


async def test_label_names_are_unique_ignoring_case(
    client: AsyncClient, make_client: ClientFactory, register: RegisterFn
) -> None:
    await register(email="alice@example.com")
    await create_label(client, "Urgent")
    other = await create_label(client, "later")

    resp = await client.post("/api/v1/labels", json={"name": "urgent"})
    assert resp.status_code == 409
    assert resp.json()["code"] == "label_name_taken"
    resp = await client.patch(f"/api/v1/labels/{other['id']}", json={"name": "URGENT"})
    assert resp.status_code == 409
    # 只改大小写是允许的
    resp = await client.patch(f"/api/v1/labels/{other['id']}", json={"name": "Later"})
    assert resp.status_code == 200

    # 不同用户之间互不影响
    async with make_client() as bob:
        await register(email="bob@example.com", c=bob)
        await create_label(bob, "urgent")


async def test_tag_tasks_and_filter_by_label(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    home = await create_label(client, "家")
    work = await create_label(client, "工作")
    a = await add_task(client, "修水管", label_ids=[home["id"], home["id"]])  # 重复的去掉
    assert a["label_ids"] == [home["id"]]
    b = await add_task(client, "写周报", label_ids=[work["id"]])
    await add_task(client, "没有标签")

    assert await tagged(client, home["id"]) == ["修水管"]

    # label_ids 整体替换
    resp = await client.patch(
        f"/api/v1/tasks/{b['id']}", json={"label_ids": [work["id"], home["id"]]}
    )
    assert sorted(resp.json()["label_ids"]) == sorted([work["id"], home["id"]])
    assert await tagged(client, home["id"]) == ["修水管", "写周报"]
    resp = await client.patch(f"/api/v1/tasks/{b['id']}", json={"label_ids": []})
    assert resp.json()["label_ids"] == []
    # 不传 label_ids 时不改
    resp = await client.patch(f"/api/v1/tasks/{a['id']}", json={"title": "修厨房水管"})
    assert resp.json()["label_ids"] == [home["id"]]

    # 列表和单个任务都带 label_ids
    [listed] = (await client.get("/api/v1/tasks", params={"label_id": home["id"]})).json()
    assert listed["label_ids"] == [home["id"]]
    assert (await client.get(f"/api/v1/tasks/{a['id']}")).json()["label_ids"] == [home["id"]]


async def test_deleting_label_keeps_tasks(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    home = await create_label(client, "家")
    task = await add_task(client, "修水管", label_ids=[home["id"]])
    await client.delete(f"/api/v1/labels/{home['id']}")

    resp = await client.get(f"/api/v1/tasks/{task['id']}")
    assert resp.status_code == 200
    assert resp.json()["label_ids"] == []
    resp = await client.get("/api/v1/tasks", params={"label_id": home["id"]})
    assert resp.status_code == 404


async def test_too_many_labels(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    ids = [(await create_label(client, f"l{i}"))["id"] for i in range(21)]
    resp = await client.post("/api/v1/tasks", json={"title": "x", "label_ids": ids})
    assert resp.status_code == 422


async def test_other_users_labels_are_invisible(
    client: AsyncClient, make_client: ClientFactory, register: RegisterFn
) -> None:
    await register(email="alice@example.com")
    label = await create_label(client, "私人")
    url = f"/api/v1/labels/{label['id']}"

    async with make_client() as bob:
        await register(email="bob@example.com", c=bob)
        assert await labels(bob) == []
        for resp in (
            await bob.patch(url, json={"name": "改掉"}),
            await bob.delete(url),
            await bob.get("/api/v1/tasks", params={"label_id": label["id"]}),
            # 也不能给自己的任务打上别人的标签
            await bob.post("/api/v1/tasks", json={"title": "x", "label_ids": [label["id"]]}),
        ):
            assert resp.status_code == 404
            assert resp.json()["code"] == "label_not_found"
        bob_task = await add_task(bob, "Bob 的任务")
        resp = await bob.patch(f"/api/v1/tasks/{bob_task['id']}", json={"label_ids": [label["id"]]})
        assert resp.status_code == 404

    assert [lb["name"] for lb in await labels(client)] == ["私人"]


async def test_database_rejects_label_of_another_user(
    client: AsyncClient, make_client: ClientFactory, register: RegisterFn
) -> None:
    """即使应用代码漏了检查，复合外键也不允许任务挂上别人的标签。"""
    alice = await register(email="alice@example.com")
    task = await add_task(client, "Alice 的任务")
    async with make_client() as bob:
        await register(email="bob@example.com", c=bob)
        bob_label = await create_label(bob, "Bob的标签")

    with pytest.raises(IntegrityError, match="fk_task_labels_label_id_labels"):
        await execute(
            "INSERT INTO task_labels (task_id, label_id, user_id) "
            "VALUES (:task_id, :label_id, :user_id)",
            task_id=task["id"],
            label_id=bob_label["id"],
            user_id=alice["id"],
        )
