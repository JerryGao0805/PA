"""邮件发送抽象层。业务代码不直接调用这里，而是写入 outbox，由 worker 调用 sender 发送。"""

import asyncio
import logging
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage as MimeMessage
from typing import TYPE_CHECKING, Protocol

import httpx

from app.core.config import Settings

if TYPE_CHECKING:
    from mypy_boto3_sesv2 import SESV2Client

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class OutgoingEmail:
    to: str
    subject: str
    text: str
    html: str
    # 同一封邮件每次重试都相同。支持幂等的服务商（Resend）据此避免重复发送，其他实现忽略它
    idempotency_key: str


class EmailSendError(Exception):
    """服务商拒绝了这封邮件（HTTP 状态码不是 2xx）。worker 会按退避重试。"""


class EmailSender(Protocol):
    async def send(self, email: OutgoingEmail) -> None: ...


class ConsoleEmailSender:
    """只打印到日志，不真正发送。用于测试，或者没有邮件服务时的本地调试。"""

    def __init__(self) -> None:
        self.sent: list[OutgoingEmail] = []

    async def send(self, email: OutgoingEmail) -> None:
        self.sent.append(email)
        logger.info("email to=%s subject=%s\n%s", email.to, email.subject, email.text)


def _to_mime(email: OutgoingEmail, sender: str) -> MimeMessage:
    msg = MimeMessage()
    msg["From"] = sender
    msg["To"] = email.to
    msg["Subject"] = email.subject
    msg.set_content(email.text)
    msg.add_alternative(email.html, subtype="html")
    return msg


class SmtpEmailSender:
    """普通 SMTP（无 TLS、无认证），开发环境配合 Mailpit 使用。生产环境请用 Resend 或 SES。"""

    def __init__(self, host: str, port: int, sender: str) -> None:
        self._host, self._port, self._sender = host, port, sender

    def _send_sync(self, email: OutgoingEmail) -> None:
        with smtplib.SMTP(self._host, self._port, timeout=10) as smtp:
            smtp.send_message(_to_mime(email, self._sender))

    async def send(self, email: OutgoingEmail) -> None:
        await asyncio.to_thread(self._send_sync, email)


class SesEmailSender:
    """AWS SES v2。凭证走 boto3 的标准链（环境变量 / 实例角色 / ~/.aws）。"""

    def __init__(self, region: str, sender: str) -> None:
        import boto3

        self._client: SESV2Client = boto3.client("sesv2", region_name=region)
        self._sender = sender

    def _send_sync(self, email: OutgoingEmail) -> None:
        self._client.send_email(
            FromEmailAddress=self._sender,
            Destination={"ToAddresses": [email.to]},
            Content={
                "Simple": {
                    "Subject": {"Data": email.subject, "Charset": "UTF-8"},
                    "Body": {
                        "Text": {"Data": email.text, "Charset": "UTF-8"},
                        "Html": {"Data": email.html, "Charset": "UTF-8"},
                    },
                }
            },
        )

    async def send(self, email: OutgoingEmail) -> None:
        await asyncio.to_thread(self._send_sync, email)


class ResendEmailSender:
    """Resend 的 HTTP API（https://resend.com/docs/api-reference/emails/send-email）。

    走 HTTPS，不受服务器封出站 SMTP 端口的影响。每封邮件都带 Idempotency-Key：
    请求其实成功了、但响应在路上丢了时，worker 的重试不会让用户收到两封（key 保留 24 小时）。
    """

    BASE_URL = "https://api.resend.com"

    def __init__(
        self, api_key: str, sender: str, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self._api_key, self._sender = api_key, sender
        self._transport = transport  # 只在测试里传，用来拦截请求

    async def send(self, email: OutgoingEmail) -> None:
        # 每封邮件新建一个连接：量很小，省得管理长连接的关闭
        async with httpx.AsyncClient(
            base_url=self.BASE_URL, timeout=10, transport=self._transport
        ) as client:
            resp = await client.post(
                "/emails",
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Idempotency-Key": email.idempotency_key,
                    # Resend 拒绝没有 User-Agent 的请求
                    "User-Agent": "personal-assistant",
                },
                json={
                    "from": self._sender,
                    "to": [email.to],
                    "subject": email.subject,
                    "text": email.text,
                    "html": email.html,
                },
            )
        if not resp.is_success:
            raise EmailSendError(f"resend {resp.status_code} {_resend_error(resp)}")
        logger.info("resend accepted email id=%s", resp.json().get("id"))


def _resend_error(resp: httpx.Response) -> str:
    """Resend 的错误响应是 {"name": ..., "message": ...}；网关之类返回的可能不是 JSON。"""
    try:
        body = resp.json()
        return f"{body['name']}: {body['message']}"
    except (ValueError, KeyError, TypeError):
        return resp.text[:200]


def build_email_sender(settings: Settings) -> EmailSender:
    match settings.email_backend:
        case "console":
            return ConsoleEmailSender()
        case "smtp":
            return SmtpEmailSender(settings.smtp_host, settings.smtp_port, settings.email_from)
        case "ses":
            return SesEmailSender(settings.ses_region, settings.email_from)
        case "resend":
            api_key = settings.resend_api_key.get_secret_value()
            if not api_key:
                raise ValueError("PA_EMAIL_BACKEND=resend 时必须设置 PA_RESEND_API_KEY")
            return ResendEmailSender(api_key, settings.email_from)
