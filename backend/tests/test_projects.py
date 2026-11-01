from typing import Any

from httpx import AsyncClient

from tests.conftest import ClientFactory, RegisterFn


async def projects(client: AsyncClient) -> list[dict[str, Any]]:
    resp = await client.get("/api/v1/projects")
    assert resp.status_code == 200, resp.text
    data: list[dict[str, Any]] = resp.json()
    return data


async def create_project(client: AsyncClient, name: str, **extra: object) -> dict[str, Any]:
    resp = await client.post("/api/v1/projects", json={"name": name, **extra})
    assert resp.status_code == 201, resp.text
    data: dict[str, Any] = resp.json()
    return data


async def test_register_creates_inbox(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    [inbox] = await projects(client)
    assert inbox["is_inbox"] is True
    assert inbox["archived"] is False
    assert inbox["open_task_count"] == 0


async def test_projects_require_login(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/projects")
    assert resp.status_code == 401
    assert resp.json()["code"] == "not_authenticated"


async def test_create_projects_keeps_creation_order(
    client: AsyncClient, register: RegisterFn
) -> None:
    await register()
    work = await create_project(client, "  工作  ")
    assert work["name"] == "工作"
    assert work["color"] == "gray"
    assert work["is_inbox"] is False
    await create_project(client, "生活", color="green")
    await create_project(client, "学习", color="blue")

    names = [p["name"] for p in await projects(client)]
    assert names[1:] == ["工作", "生活", "学习"]  # 收件箱永远在最前


async def test_create_project_validation(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    for body in ({"name": "   "}, {"name": "x" * 101}, {"name": "ok", "color": "neon"}):
        resp = await client.post("/api/v1/projects", json=body)
        assert resp.status_code == 422, body


async def test_update_and_archive_project(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    project = await create_project(client, "旧名字")
    url = f"/api/v1/projects/{project['id']}"

    resp = await client.patch(url, json={"name": "新名字", "color": "red"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "新名字"
    assert resp.json()["color"] == "red"

    resp = await client.patch(url, json={"archived": True})
    assert resp.json()["archived"] is True
    # 已归档的项目仍在列表里，由前端分组显示
    assert [p["archived"] for p in await projects(client)] == [False, True]

    resp = await client.patch(url, json={"archived": False})
    assert resp.json()["archived"] is False


async def test_inbox_cannot_be_changed_or_deleted(
    client: AsyncClient, register: RegisterFn
) -> None:
    await register()
    [inbox] = await projects(client)
    url = f"/api/v1/projects/{inbox['id']}"

    for resp in (
        await client.patch(url, json={"name": "别的名字"}),
        await client.patch(url, json={"archived": True}),
        await client.delete(url),
    ):
        assert resp.status_code == 400
        assert resp.json()["code"] == "inbox_immutable"
    assert len(await projects(client)) == 1


async def test_delete_project_deletes_its_tasks(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    project = await create_project(client, "临时")
    task = (
        await client.post("/api/v1/tasks", json={"title": "任务", "project_id": project["id"]})
    ).json()

    resp = await client.delete(f"/api/v1/projects/{project['id']}")
    assert resp.status_code == 204

    assert len(await projects(client)) == 1
    resp = await client.get("/api/v1/tasks", params={"project_id": project["id"]})
    assert resp.status_code == 404
    resp = await client.patch(f"/api/v1/tasks/{task['id']}", json={"title": "x"})
    assert resp.status_code == 404


async def test_task_counts(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    project = await create_project(client, "计数")
    ids = []
    for title in ("a", "b", "c", "d"):
        resp = await client.post(
            "/api/v1/tasks", json={"title": title, "project_id": project["id"]}
        )
        ids.append(resp.json()["id"])
    await client.patch(f"/api/v1/tasks/{ids[0]}", json={"status": "done"})
    await client.patch(f"/api/v1/tasks/{ids[1]}", json={"status": "in_progress"})
    await client.delete(f"/api/v1/tasks/{ids[2]}")  # 已删除的不计入

    [_, counted] = await projects(client)
    assert counted["open_task_count"] == 2
    assert counted["done_task_count"] == 1

    resp = await client.patch(f"/api/v1/projects/{project['id']}", json={"color": "pink"})
    assert resp.json()["open_task_count"] == 2


async def test_other_users_projects_are_invisible(
    client: AsyncClient, make_client: ClientFactory, register: RegisterFn
) -> None:
    await register(email="alice@example.com")
    alice_project = await create_project(client, "Alice 的项目")
    url = f"/api/v1/projects/{alice_project['id']}"

    async with make_client() as bob:
        await register(email="bob@example.com", c=bob)
        assert [p["name"] for p in await projects(bob) if not p["is_inbox"]] == []

        # 访问别人的项目和访问不存在的项目一样：404
        for resp in (
            await bob.patch(url, json={"name": "改掉"}),
            await bob.delete(url),
            await bob.get("/api/v1/tasks", params={"project_id": alice_project["id"]}),
            await bob.post(
                "/api/v1/tasks", json={"title": "塞进去", "project_id": alice_project["id"]}
            ),
        ):
            assert resp.status_code == 404
            assert resp.json()["code"] == "project_not_found"

    [_, still_there] = await projects(client)
    assert still_there["name"] == "Alice 的项目"
    assert still_there["open_task_count"] == 0
