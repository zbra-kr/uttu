"""Telegram 개인 chat_id 발송. admin만."""
from __future__ import annotations

import os

import httpx
from loguru import logger


def send_telegram(chat_id: str, title: str, body: str | None, link: str | None) -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        return False
    text = f"<b>{title}</b>"
    if body:
        text += f"\n\n{body}"
    if link:
        site = "https://uttu.bcave.co.kr"
        text += f'\n\n<a href="{site}{link}">열기</a>'
    try:
        resp = httpx.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "HTML",
                "disable_web_page_preview": True,
            },
            timeout=10,
        )
        return resp.status_code < 400
    except Exception as e:
        logger.warning("telegram_send_exception", error=str(e))
        return False
