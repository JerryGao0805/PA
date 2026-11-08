import json

import httpx
import pytest

from app.core.config import Settings
from app.email.sender import (
    EmailSendError,
    OutgoingEmail,
    ResendEmailSender,
    build_email_sender,
)

API_KEY = "re_test_secret"
EMAIL = OutgoingEmail(
    to="amy@example.com",
    subject="验证你的邮箱",
    text="纯文本",
    html="<p>HTML</p>",
    idempotency_key="outbox-1-1762588800.5",
)


def _sender(handler: httpx.MockTransport) -> ResendEmailSender:
    return ResendEmailSender(API_KEY, "个人助手 <no-reply@example.com>", transport=handler)


async def test_resend_posts_email() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"id": "49a3999c"})

    await _sender(httpx.MockTransport(handler)).send(EMAIL)

    [req] = requests
    assert req.method == "POST"
    assert str(req.url) == "https://api.resend.com/emails"
    assert req.headers["Authorization"] == f"Bearer {API_KEY}"
    assert req.headers["Idempotency-Key"] == "outbox-1-1762588800.5"
    assert req.headers["User-Agent"] == "personal-assistant"
    assert json.loads(req.content) == {
        "from": "个人助手 <no-reply@example.com>",
        "to": ["amy@example.com"],
        "subject": "验证你的邮箱",
        "text": "纯文本",
        "html": "<p>HTML</p>",
    }


@pytest.mark.parametrize(
    ("response", "expected"),
    [
        (
            httpx.Response(
                422,
                json={
                    "statusCode": 422,
                    "name": "validation_error",
                    "message": "Invalid `to` field.",
                },
            ),
            "resend 422 validation_error: Invalid `to` field.",
        ),
        # 网关之类返回的错误页不是 JSON
        (httpx.Response(502, text="<html>Bad Gateway</html>"), "resend 502 <html>Bad Gateway"),
    ],
)
async def test_resend_raises_on_error(response: httpx.Response, expected: str) -> None:
    sender = _sender(httpx.MockTransport(lambda _: response))
    with pytest.raises(EmailSendError) as exc_info:
        await sender.send(EMAIL)
    message = str(exc_info.value)
    assert message.startswith(expected)
    # 错误信息会写进 outbox.last_error 和日志，不能带 API key
    assert API_KEY not in message


def test_build_resend_sender_requires_api_key() -> None:
    with pytest.raises(ValueError, match="PA_RESEND_API_KEY"):
        build_email_sender(Settings(email_backend="resend", resend_api_key=""))

    sender = build_email_sender(Settings(email_backend="resend", resend_api_key=API_KEY))
    assert isinstance(sender, ResendEmailSender)
