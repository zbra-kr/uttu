"""
Teams + Telegram 알림 유틸리티.
환경변수: TEAMS_WEBHOOK_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
"""

import os

import httpx
from dotenv import load_dotenv
from loguru import logger

load_dotenv()


def _send_teams(text: str) -> None:
    url = os.environ.get("TEAMS_WEBHOOK_URL")
    if not url:
        return
    try:
        payload = {"text": text}
        httpx.post(url, json=payload, timeout=10)
    except Exception as e:
        logger.warning("teams_notify_failed", error=str(e))


def _send_telegram(text: str) -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        return
    try:
        httpx.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
            timeout=10,
        )
    except Exception as e:
        logger.warning("telegram_notify_failed", error=str(e))


def send(text: str) -> None:
    """Teams + Telegram 동시 전송."""
    logger.info("notify_send", text=text[:80])
    _send_teams(text)
    _send_telegram(text)


if __name__ == "__main__":
    import sys
    msg = " ".join(sys.argv[1:]) or "UTTU 알림 테스트"
    send(msg)
