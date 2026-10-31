"""邮件发送抽象层。业务代码不直接调用这里，而是写入 outbox，由 worker 调用 sender 发送。"""

import asyncio
import logging
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage as MimeMessage
from typing import TYPE_CHECKING, Protocol

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
    """普通 SMTP（无 TLS、无认证），开发环境配合 Mailpit 使用。生产环境请用 SES。"""

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


def build_email_sender(settings: Settings) -> EmailSender:
    match settings.email_backend:
        case "console":
            return ConsoleEmailSender()
        case "smtp":
            return SmtpEmailSender(settings.smtp_host, settings.smtp_port, settings.email_from)
        case "ses":
            return SesEmailSender(settings.ses_region, settings.email_from)
