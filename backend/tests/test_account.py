"""账户设置：改名字、时区；删除账户。"""

from httpx import AsyncClient
from sqlalchemy import text

from app.core.db import SessionLocal
from tests.conftest import DEFAULT_PASSWORD, ClientFactory, RegisterFn
from tests.helpers import outbox_for
from tests.test_labels import create_label
from tests.test_projects import create_project
from tests.test_tasks import add_task

ACCOUNT = "/api/v1/account"
ME = "/api/v1/auth/me"
# 带 user_id 的表：删除账户后这个用户在里面一行都不能剩
USER_TABLES = ("sessions", "email_tokens", "projects", "tasks", "labels", "task_labels")


async def rows_of(user_id: str) -> dict[str, int]:
    async with SessionLocal() as db:
        counts = {
            table: await db.scalar(
                text(f"SELECT count(*) FROM {table} WHERE user_id = :id"), {"id": user_id}
            )
            for table in USER_TABLES
        }
        counts["users"] = await db.scalar(
            text("SELECT count(*) FROM users WHERE id = :id"), {"id": user_id}
        )
    return {table: n or 0 for table, n in counts.items()}


# ---------- 改名字、时区 ----------


async def test_update_name_and_timezone(client: AsyncClient, register: RegisterFn) -> None:
    await register(display_name="Alice")

    resp = await client.patch(ACCOUNT, json={"display_name": "  Alice Li  "})
    assert resp.status_code == 200, resp.text
    assert resp.json()["display_name"] == "Alice Li"  # 去掉首尾空格
    assert resp.json()["timezone"] == "UTC"  # 没传的不改

    resp = await client.patch(ACCOUNT, json={"timezone": "Asia/Shanghai"})
    assert resp.json()["timezone"] == "Asia/Shanghai"
    me = (await client.get(ME)).json()
    assert (me["display_name"], me["timezone"]) == ("Alice Li", "Asia/Shanghai")

    # 名字可以清空（界面上就显示邮箱前缀）
    resp = await client.patch(ACCOUNT, json={"display_name": ""})
    assert resp.json()["display_name"] == ""


async def test_update_validation(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    for body in ({"timezone": "Mars/Olympus"}, {"timezone": ""}, {"display_name": "x" * 101}):
        resp = await client.patch(ACCOUNT, json=body)
        assert resp.status_code == 422, body
    assert (await client.get(ME)).json()["timezone"] == "UTC"


async def test_requires_login(make_client: ClientFactory) -> None:
    async with make_client() as anonymous:
        assert (await anonymous.patch(ACCOUNT, json={"display_name": "x"})).status_code == 401
        resp = await anonymous.post(f"{ACCOUNT}/delete", json={"password": DEFAULT_PASSWORD})
        assert resp.status_code == 401


# ---------- 删除账户 ----------


async def test_delete_requires_the_password(client: AsyncClient, register: RegisterFn) -> None:
    user = await register()
    await add_task(client, "买牛奶")

    resp = await client.post(f"{ACCOUNT}/delete", json={"password": "wrong one"})
    assert resp.status_code == 400
    assert resp.json()["code"] == "invalid_current_password"
    assert (await client.get(ME)).status_code == 200
    assert (await rows_of(str(user["id"])))["tasks"] == 1


async def test_delete_removes_the_account_and_all_its_data(
    client: AsyncClient, register: RegisterFn, make_client: ClientFactory
) -> None:
    alice = await register()  # 注册时发了验证邮件（email_tokens、email_outbox 里各有一行）
    work = await create_project(client, "工作")
    parent = await add_task(client, "搬家", project_id=work["id"])
    await add_task(client, "打包", parent_id=parent["id"])
    label = await create_label(client, "重要")
    await add_task(client, "交报告", label_ids=[label["id"]])
    gone = await add_task(client, "已删除的")
    await client.delete(f"/api/v1/tasks/{gone['id']}")
    before = await rows_of(str(alice["id"]))
    assert all(before.values()), before

    async with make_client() as phone, make_client() as bob_client:
        login = {"email": "alice@example.com", "password": DEFAULT_PASSWORD}
        await phone.post("/api/v1/auth/login", json=login)
        await register(email="bob@example.com", c=bob_client)
        await add_task(bob_client, "Bob 的任务")

        resp = await client.post(f"{ACCOUNT}/delete", json={"password": DEFAULT_PASSWORD})
        assert resp.status_code == 204
        assert 'pa_session=""' in resp.headers["set-cookie"]  # 清掉 Cookie

        # 所有设备都下线，数据一行不剩，邮件也不再留着
        assert (await client.get(ME)).status_code == 401
        assert (await phone.get(ME)).status_code == 401
        assert await rows_of(str(alice["id"])) == dict.fromkeys(before, 0)
        assert await outbox_for("alice@example.com") == []
        assert (await phone.post("/api/v1/auth/login", json=login)).status_code == 401

        # 别人的数据不受影响
        resp = await bob_client.get("/api/v1/tasks/search", params={"q": "任务"})
        assert [t["title"] for t in resp.json()] == ["Bob 的任务"]
        assert len(await outbox_for("bob@example.com")) == 1

    # 同一个邮箱可以重新注册，是一个全新的账户
    again = await register()
    assert again["id"] != alice["id"]
    projects = (await client.get("/api/v1/projects")).json()
    assert [p["is_inbox"] for p in projects] == [True]


async def test_wrong_passwords_are_rate_limited_per_user(
    client: AsyncClient, register: RegisterFn
) -> None:
    """改密码和删除账户共用一个计数：15 分钟内错 5 次，之后密码对了也先拒绝"""
    await register()

    async def change(current: str) -> int:
        body = {"current_password": current, "new_password": "fresh passphrase"}
        return (await client.post("/api/v1/auth/change-password", json=body)).status_code

    async def delete(password: str) -> int:
        resp = await client.post(f"{ACCOUNT}/delete", json={"password": password})
        return resp.status_code

    # 输对一次就重新计数
    assert [await change("wrong one") for _ in range(4)] == [400] * 4
    assert await change(DEFAULT_PASSWORD) == 204
    password = "fresh passphrase"

    assert [await change("wrong one"), await delete("wrong one")] == [400, 400]
    assert [await delete("wrong one") for _ in range(3)] == [400] * 3
    assert await delete(password) == 429
    assert await change(password) == 429
    assert (await client.get(ME)).status_code == 200
