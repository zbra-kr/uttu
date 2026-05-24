"""user_notifications에 알림 INSERT — detector·메모 멘션 등에서 호출."""
from __future__ import annotations

import os
from typing import Literal

from supabase import Client, create_client

EventType = Literal[
    "daily_summary", "anomaly_high", "anomaly_med",
    "mention", "dart_new_disclosure",
    "review_low_rating", "rank_change_bookmarked",
]


def _client() -> Client:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], key)


def enqueue_notification(
    user_id: str,
    event_type: EventType,
    title: str,
    body: str | None = None,
    link: str | None = None,
    payload: dict | None = None,
    client: Client | None = None,
) -> None:
    """단일 사용자에게 알림 INSERT. 발송은 dispatcher가 처리."""
    c = client or _client()
    c.table("user_notifications").insert({
        "user_id": user_id,
        "event_type": event_type,
        "title": title,
        "body": body,
        "link": link,
        "payload": payload or {},
    }).execute()


def enqueue_for_subscribers(
    event_type: EventType,
    title: str,
    body: str | None = None,
    link: str | None = None,
    payload: dict | None = None,
    client: Client | None = None,
) -> int:
    """이 이벤트를 구독한 모든 사용자에게 알림 INSERT.
    enabled=true인 구독자만 대상. 사용자별 1건만 INSERT."""
    c = client or _client()
    subs = (
        c.table("user_notification_subscriptions")
        .select("user_id")
        .eq("event_type", event_type)
        .eq("enabled", True)
        .execute()
        .data or []
    )
    user_ids = list({s["user_id"] for s in subs})
    if not user_ids:
        return 0

    rows = [
        {
            "user_id": uid,
            "event_type": event_type,
            "title": title,
            "body": body,
            "link": link,
            "payload": payload or {},
        }
        for uid in user_ids
    ]
    for i in range(0, len(rows), 1000):
        c.table("user_notifications").insert(rows[i:i + 1000]).execute()
    return len(rows)
