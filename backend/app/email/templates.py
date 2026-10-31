"""邮件模板。MVP 只有中文；第二阶段按用户 locale 选择语言。"""

from collections.abc import Callable
from dataclasses import dataclass
from html import escape
from typing import Any

APP_NAME = "个人助手"


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    text: str
    html: str


def _layout(heading: str, paragraphs: list[str], button_label: str, url: str, footer: str) -> str:
    """简单的单栏 HTML 布局。所有动态内容都在调用方 escape 过。"""
    body = "".join(f'<p style="margin:0 0 16px">{p}</p>' for p in paragraphs)
    return f"""<!doctype html>
<html lang="zh-CN"><body style="margin:0;padding:32px 16px;background:#f6f6f7;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Noto Sans SC',sans-serif;color:#18181b">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
<h1 style="margin:0 0 24px;font-size:20px;font-weight:600">{heading}</h1>
{body}
<p style="margin:24px 0"><a href="{url}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px">{button_label}</a></p>
<p style="margin:0 0 8px;font-size:12px;color:#71717a">如果按钮无法点击，请复制下面的链接到浏览器打开：</p>
<p style="margin:0 0 24px;font-size:12px;color:#71717a;word-break:break-all">{url}</p>
<p style="margin:0;font-size:12px;color:#a1a1aa">{footer}</p>
</div></body></html>"""


def _greeting(payload: dict[str, Any]) -> str:
    name = str(payload.get("display_name") or "").strip()
    return f"{name}，你好：" if name else "你好："


def _verify_email(payload: dict[str, Any]) -> RenderedEmail:
    url = str(payload["url"])
    greeting = _greeting(payload)
    intro = f"感谢注册{APP_NAME}。请点击下面的按钮验证你的邮箱地址，链接 24 小时内有效。"
    footer = "如果你没有注册过这个账号，忽略这封邮件即可。"
    return RenderedEmail(
        subject=f"验证你的邮箱 · {APP_NAME}",
        text=f"{greeting}\n\n{intro}\n\n{url}\n\n{footer}\n",
        html=_layout(
            "验证你的邮箱",
            [escape(greeting), escape(intro)],
            "验证邮箱",
            escape(url, quote=True),
            escape(footer),
        ),
    )


def _reset_password(payload: dict[str, Any]) -> RenderedEmail:
    url = str(payload["url"])
    greeting = _greeting(payload)
    intro = (
        "我们收到了重置密码的请求。请点击下面的按钮设置新密码，链接 1 小时内有效，且只能使用一次。"
    )
    footer = "如果这不是你本人的操作，忽略这封邮件即可，你的密码不会改变。"
    return RenderedEmail(
        subject=f"重置密码 · {APP_NAME}",
        text=f"{greeting}\n\n{intro}\n\n{url}\n\n{footer}\n",
        html=_layout(
            "重置密码",
            [escape(greeting), escape(intro)],
            "设置新密码",
            escape(url, quote=True),
            escape(footer),
        ),
    )


TEMPLATES: dict[str, Callable[[dict[str, Any]], RenderedEmail]] = {
    "verify_email": _verify_email,
    "reset_password": _reset_password,
}


def render_email(template: str, payload: dict[str, Any]) -> RenderedEmail:
    try:
        renderer = TEMPLATES[template]
    except KeyError:
        raise ValueError(f"unknown email template: {template}") from None
    return renderer(payload)
