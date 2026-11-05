import pytest
from httpx import AsyncClient
from pydantic import ValidationError

from app.core.config import Settings, get_settings
from app.main import app
from tests.conftest import DEFAULT_PASSWORD, ClientFactory, RegisterFn
from tests.helpers import execute, latest_token, outbox_for

AUTH = "/api/v1/auth"


# ---------- 注册 ----------


async def test_register_logs_in_and_queues_verification_email(
    client: AsyncClient, register: RegisterFn
) -> None:
    user = await register(email="Alice@Example.com", display_name="Alice", timezone="Asia/Shanghai")

    assert user["email"] == "alice@example.com"  # 邮箱统一转小写
    assert user["email_verified"] is False
    assert user["timezone"] == "Asia/Shanghai"

    cookie = client.cookies.get("pa_session")
    assert cookie and len(cookie) >= 40
    me = await client.get(f"{AUTH}/me")
    assert me.status_code == 200
    assert me.json()["id"] == user["id"]

    emails = await outbox_for("alice@example.com", "verify_email")
    assert len(emails) == 1
    assert "/verify-email#token=" in emails[0].payload["url"]


async def test_session_cookie_flags(make_client: ClientFactory) -> None:
    async with make_client() as c:
        resp = await c.post(
            f"{AUTH}/register", json={"email": "a@example.com", "password": DEFAULT_PASSWORD}
        )
    set_cookie = resp.headers["set-cookie"].lower()
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie
    assert "path=/" in set_cookie


async def test_register_duplicate_email_is_case_insensitive(
    make_client: ClientFactory, register: RegisterFn
) -> None:
    await register(email="bob@example.com")
    async with make_client() as other:
        resp = await other.post(
            f"{AUTH}/register", json={"email": "BOB@example.com", "password": DEFAULT_PASSWORD}
        )
    assert resp.status_code == 409
    assert resp.json()["code"] == "email_taken"


async def test_register_validates_input(client: AsyncClient) -> None:
    short = await client.post(
        f"{AUTH}/register", json={"email": "c@example.com", "password": "123"}
    )
    assert short.status_code == 422
    bad_email = await client.post(
        f"{AUTH}/register", json={"email": "not-an-email", "password": DEFAULT_PASSWORD}
    )
    assert bad_email.status_code == 422
    bad_tz = await client.post(
        f"{AUTH}/register",
        json={"email": "c@example.com", "password": DEFAULT_PASSWORD, "timezone": "Mars/Base"},
    )
    assert bad_tz.status_code == 422


# ---------- 登录 / 退出 ----------


async def test_login_and_logout(make_client: ClientFactory, register: RegisterFn) -> None:
    await register(email="dan@example.com")
    async with make_client() as c:
        login = await c.post(
            f"{AUTH}/login", json={"email": "DAN@example.com", "password": DEFAULT_PASSWORD}
        )
        assert login.status_code == 200
        token = c.cookies.get("pa_session")
        assert (await c.get(f"{AUTH}/me")).status_code == 200

        logout = await c.post(f"{AUTH}/logout")
        assert logout.status_code == 204
        assert (await c.get(f"{AUTH}/me")).status_code == 401

    # 退出后旧 token 在服务端也已失效（不只是删了 Cookie）
    async with make_client() as replay:
        replay.cookies.set("pa_session", token or "")
        assert (await replay.get(f"{AUTH}/me")).status_code == 401


async def test_login_failure_does_not_reveal_whether_email_exists(
    client: AsyncClient, register: RegisterFn
) -> None:
    await register(email="erin@example.com")
    wrong_pw = await client.post(
        f"{AUTH}/login", json={"email": "erin@example.com", "password": "wrong password"}
    )
    no_user = await client.post(
        f"{AUTH}/login", json={"email": "nobody@example.com", "password": "wrong password"}
    )
    assert wrong_pw.status_code == no_user.status_code == 401
    assert wrong_pw.json() == no_user.json()


async def test_register_is_rate_limited_per_ip(make_client: ClientFactory) -> None:
    # 看字段本身的默认值：get_settings() 会读本地的 .env 和环境变量
    assert Settings.model_fields["register_per_ip_per_hour"].default == 10
    with pytest.raises(ValidationError):
        Settings(register_per_ip_per_hour=0)
    # 次数可以配置（端到端测试会调大）；这里调小，免得注册 10 个账号
    limited = get_settings().model_copy(update={"register_per_ip_per_hour": 2})
    app.dependency_overrides[get_settings] = lambda: limited
    try:
        async with make_client() as c:
            for i in range(2):
                resp = await c.post(
                    f"{AUTH}/register",
                    json={"email": f"user{i}@example.com", "password": DEFAULT_PASSWORD},
                )
                assert resp.status_code == 201
            blocked = await c.post(
                f"{AUTH}/register",
                json={"email": "user2@example.com", "password": DEFAULT_PASSWORD},
            )
        assert blocked.status_code == 429
        assert blocked.json()["code"] == "rate_limited"
    finally:
        del app.dependency_overrides[get_settings]


async def test_login_is_rate_limited_per_email(
    make_client: ClientFactory, register: RegisterFn
) -> None:
    await register(email="frank@example.com")
    async with make_client() as c:
        for _ in range(5):
            resp = await c.post(
                f"{AUTH}/login", json={"email": "frank@example.com", "password": "nope nope"}
            )
            assert resp.status_code == 401
        # 超限后即使密码正确也被拒绝
        blocked = await c.post(
            f"{AUTH}/login", json={"email": "frank@example.com", "password": DEFAULT_PASSWORD}
        )
        assert blocked.status_code == 429
        assert blocked.json()["code"] == "rate_limited"


async def test_unauthenticated_me(client: AsyncClient) -> None:
    resp = await client.get(f"{AUTH}/me")
    assert resp.status_code == 401
    assert resp.json()["code"] == "not_authenticated"


# ---------- 会话有效期 ----------


async def test_expired_session_is_rejected(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    await execute("UPDATE sessions SET expires_at = now() - interval '1 minute'")
    assert (await client.get(f"{AUTH}/me")).status_code == 401


async def test_active_session_is_renewed(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    await execute("UPDATE sessions SET expires_at = now() + interval '10 days'")
    resp = await client.get(f"{AUTH}/me")
    assert resp.status_code == 200
    assert "pa_session=" in resp.headers.get("set-cookie", "")  # Cookie 也一起续期


async def test_fresh_session_is_not_rewritten_on_every_request(
    client: AsyncClient, register: RegisterFn
) -> None:
    await register()
    resp = await client.get(f"{AUTH}/me")
    assert "set-cookie" not in resp.headers


# ---------- 邮箱验证 ----------


async def test_verify_email(client: AsyncClient, register: RegisterFn) -> None:
    await register(email="gina@example.com")
    token = await latest_token("gina@example.com", "verify_email")

    resp = await client.post(f"{AUTH}/verify-email", json={"token": token})
    assert resp.status_code == 200
    assert resp.json()["email_verified"] is True
    assert (await client.get(f"{AUTH}/me")).json()["email_verified"] is True

    # token 只能用一次
    again = await client.post(f"{AUTH}/verify-email", json={"token": token})
    assert again.status_code == 400
    assert again.json()["code"] == "invalid_token"


async def test_verify_email_rejects_unknown_and_expired_tokens(
    client: AsyncClient, register: RegisterFn
) -> None:
    await register(email="hank@example.com")
    bogus = await client.post(f"{AUTH}/verify-email", json={"token": "x" * 43})
    assert bogus.status_code == 400

    token = await latest_token("hank@example.com", "verify_email")
    await execute("UPDATE email_tokens SET expires_at = now() - interval '1 second'")
    expired = await client.post(f"{AUTH}/verify-email", json={"token": token})
    assert expired.status_code == 400


async def test_resend_verification_invalidates_previous_link(
    client: AsyncClient, register: RegisterFn
) -> None:
    await register(email="ivy@example.com")
    old = await latest_token("ivy@example.com", "verify_email")

    resp = await client.post(f"{AUTH}/resend-verification")
    assert resp.status_code == 204
    new = await latest_token("ivy@example.com", "verify_email")
    assert new != old

    assert (await client.post(f"{AUTH}/verify-email", json={"token": old})).status_code == 400
    assert (await client.post(f"{AUTH}/verify-email", json={"token": new})).status_code == 200


async def test_resend_verification_requires_login(client: AsyncClient) -> None:
    assert (await client.post(f"{AUTH}/resend-verification")).status_code == 401


# ---------- 找回密码 ----------


async def test_forgot_password_for_unknown_email_looks_identical(client: AsyncClient) -> None:
    resp = await client.post(f"{AUTH}/forgot-password", json={"email": "ghost@example.com"})
    assert resp.status_code == 202
    assert await outbox_for("ghost@example.com") == []


async def test_reset_password_flow(make_client: ClientFactory, register: RegisterFn) -> None:
    async with make_client() as laptop, make_client() as phone:
        await register(email="jay@example.com", c=laptop)
        await phone.post(
            f"{AUTH}/login", json={"email": "jay@example.com", "password": DEFAULT_PASSWORD}
        )

        resp = await phone.post(f"{AUTH}/forgot-password", json={"email": "jay@example.com"})
        assert resp.status_code == 202
        token = await latest_token("jay@example.com", "reset_password")

        new_password = "a brand new passphrase"
        reset = await phone.post(
            f"{AUTH}/reset-password", json={"token": token, "password": new_password}
        )
        assert reset.status_code == 204

        # 所有设备都被下线
        assert (await laptop.get(f"{AUTH}/me")).status_code == 401
        assert (await phone.get(f"{AUTH}/me")).status_code == 401

        old_login = await phone.post(
            f"{AUTH}/login", json={"email": "jay@example.com", "password": DEFAULT_PASSWORD}
        )
        assert old_login.status_code == 401
        new_login = await phone.post(
            f"{AUTH}/login", json={"email": "jay@example.com", "password": new_password}
        )
        assert new_login.status_code == 200
        # 通过邮件重置密码也证明了邮箱归属
        assert new_login.json()["email_verified"] is True

        reuse = await phone.post(
            f"{AUTH}/reset-password", json={"token": token, "password": "another passphrase"}
        )
        assert reuse.status_code == 400


async def test_forgot_password_is_rate_limited_per_email_silently(
    client: AsyncClient, register: RegisterFn
) -> None:
    await register(email="kim@example.com")
    for _ in range(5):
        resp = await client.post(f"{AUTH}/forgot-password", json={"email": "kim@example.com"})
        assert resp.status_code == 202
    # 每个邮箱每小时最多 3 封，超出部分静默丢弃
    assert len(await outbox_for("kim@example.com", "reset_password")) == 3


# ---------- 修改密码 ----------


async def test_change_password_keeps_current_session_only(
    make_client: ClientFactory, register: RegisterFn
) -> None:
    async with make_client() as laptop, make_client() as phone:
        await register(email="lee@example.com", c=laptop)
        await phone.post(
            f"{AUTH}/login", json={"email": "lee@example.com", "password": DEFAULT_PASSWORD}
        )

        wrong = await laptop.post(
            f"{AUTH}/change-password",
            json={"current_password": "wrong one", "new_password": "fresh passphrase"},
        )
        assert wrong.status_code == 400
        assert wrong.json()["code"] == "invalid_current_password"

        ok = await laptop.post(
            f"{AUTH}/change-password",
            json={"current_password": DEFAULT_PASSWORD, "new_password": "fresh passphrase"},
        )
        assert ok.status_code == 204
        assert (await laptop.get(f"{AUTH}/me")).status_code == 200
        assert (await phone.get(f"{AUTH}/me")).status_code == 401


async def test_change_password_voids_pending_reset_links(
    client: AsyncClient, register: RegisterFn
) -> None:
    """改了密码，之前发出的重置链接就作废：否则拿到那封邮件的人在有效期内还能把密码改掉"""
    await register(email="mia@example.com")
    await client.post(f"{AUTH}/forgot-password", json={"email": "mia@example.com"})
    reset_token = await latest_token("mia@example.com", "reset_password")

    ok = await client.post(
        f"{AUTH}/change-password",
        json={"current_password": DEFAULT_PASSWORD, "new_password": "fresh passphrase"},
    )
    assert ok.status_code == 204

    reset = await client.post(
        f"{AUTH}/reset-password", json={"token": reset_token, "password": "someone else's"}
    )
    assert reset.status_code == 400
    assert reset.json()["code"] == "invalid_token"
    login = await client.post(
        f"{AUTH}/login", json={"email": "mia@example.com", "password": "fresh passphrase"}
    )
    assert login.status_code == 200
    # 验证邮箱的链接和密码无关，照样能用
    verify_token = await latest_token("mia@example.com", "verify_email")
    verify = await client.post(f"{AUTH}/verify-email", json={"token": verify_token})
    assert verify.status_code == 200


# ---------- CSRF ----------


async def test_cross_origin_writes_are_blocked(client: AsyncClient, register: RegisterFn) -> None:
    await register()
    evil = await client.post(f"{AUTH}/logout", headers={"Origin": "https://evil.example"})
    assert evil.status_code == 403
    assert evil.json()["code"] == "csrf_origin_mismatch"
    assert (await client.get(f"{AUTH}/me")).status_code == 200  # 没有被登出

    same = await client.post(f"{AUTH}/logout", headers={"Origin": "http://localhost:5173"})
    assert same.status_code == 204


async def test_cross_origin_reads_are_allowed(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/health", headers={"Origin": "https://evil.example"})
    assert resp.status_code == 200
