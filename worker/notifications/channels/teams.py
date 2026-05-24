"""Teams 개인 webhook 발송. profiles.teams_webhook_url 사용."""
from __future__ import annotations

import httpx
from loguru import logger

SITE = "https://uttu.bcave.co.kr"


def _adaptive_card(title: str, body: str | None, link: str | None) -> dict:
    """Adaptive Card 페이로드 생성."""
    blocks: list[dict] = [
        {
            "type": "TextBlock",
            "text": title,
            "weight": "Bolder",
            "size": "Medium",
            "wrap": True,
        }
    ]
    if body:
        blocks.append({"type": "TextBlock", "text": body, "wrap": True, "spacing": "Small"})
    if link:
        blocks.append({
            "type": "ActionSet",
            "actions": [{"type": "Action.OpenUrl", "title": "열기", "url": f"{SITE}{link}"}],
            "spacing": "Small",
        })
    return {
        "type": "AdaptiveCard",
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "version": "1.4",
        "body": blocks,
    }


def send_teams(webhook_url: str, title: str, body: str | None, link: str | None) -> bool:
    """단일 webhook으로 Teams Adaptive Card 전송. 성공 시 True."""
    card = _adaptive_card(title, body, link)
    try:
        resp = httpx.post(webhook_url, json=card, timeout=10)
        if resp.status_code >= 400:
            logger.warning("teams_send_failed", status=resp.status_code, body=resp.text[:200])
            return False
        return True
    except Exception as e:
        logger.warning("teams_send_exception", error=str(e))
        return False
