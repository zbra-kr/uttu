"""5분마다 unsent 알림을 polling하여 채널별 발송."""
from __future__ import annotations

import os
from datetime import datetime

import pytz
from dotenv import load_dotenv
from loguru import logger

from supabase import create_client
from worker.notifications.channels.teams import send_teams
from worker.notifications.channels.telegram import send_telegram

load_dotenv()

KST = pytz.timezone("Asia/Seoul")
BATCH_SIZE = 200


def _client():
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], key)


def dispatch_pending() -> dict:
    """unsent 알림을 채널별로 발송. 발송 시각 마킹."""
    c = _client()
    now_iso = datetime.now(KST).isoformat()

    # ── Teams ──────────────────────────────────────────────────────────────
    teams_rows = (
        c.table("user_notifications")
        .select("id, user_id, event_type, title, body, link")
        .is_("sent_to_teams_at", "null")
        .order("created_at", desc=False)
        .limit(BATCH_SIZE)
        .execute()
        .data or []
    )

    # 사용자별 webhook URL 일괄 조회
    webhooks: dict[str, str] = {}
    user_ids = list({r["user_id"] for r in teams_rows})
    if user_ids:
        for i in range(0, len(user_ids), 200):
            profs = (
                c.table("profiles")
                .select("id, teams_webhook_url")
                .in_("id", user_ids[i:i + 200])
                .execute()
                .data or []
            )
            for p in profs:
                if p["teams_webhook_url"]:
                    webhooks[p["id"]] = p["teams_webhook_url"]

    # 구독 enabled 일괄 확인
    enabled_subs: dict[tuple[str, str], bool] = {}
    keys = list({(r["user_id"], r["event_type"]) for r in teams_rows})
    for uid, ev in keys:
        resp = (
            c.table("user_notification_subscriptions")
            .select("enabled")
            .eq("user_id", uid)
            .eq("event_type", ev)
            .eq("channel", "teams")
            .maybe_single()
            .execute()
        )
        enabled_subs[(uid, ev)] = bool(resp.data and resp.data.get("enabled"))

    teams_sent = 0
    for r in teams_rows:
        webhook = webhooks.get(r["user_id"])
        is_enabled = enabled_subs.get((r["user_id"], r["event_type"]), False)
        ok = False
        if webhook and is_enabled:
            ok = send_teams(webhook, r["title"], r["body"], r["link"])
        # 성공·실패·스킵 모두 마킹 — 무한 재시도 방지
        (c.table("user_notifications")
         .update({"sent_to_teams_at": now_iso})
         .eq("id", r["id"]).execute())
        if ok:
            teams_sent += 1

    # ── Telegram ───────────────────────────────────────────────────────────
    tg_rows = (
        c.table("user_notifications")
        .select("id, user_id, event_type, title, body, link")
        .is_("sent_to_telegram_at", "null")
        .order("created_at", desc=False)
        .limit(BATCH_SIZE)
        .execute()
        .data or []
    )

    # admin + telegram_chat_id 있는 사용자만
    tg_targets: dict[str, str] = {}
    tg_user_ids = list({r["user_id"] for r in tg_rows})
    if tg_user_ids:
        for i in range(0, len(tg_user_ids), 200):
            profs = (
                c.table("profiles")
                .select("id, role, telegram_chat_id")
                .in_("id", tg_user_ids[i:i + 200])
                .execute()
                .data or []
            )
            for p in profs:
                if p["role"] == "admin" and p["telegram_chat_id"]:
                    tg_targets[p["id"]] = p["telegram_chat_id"]

    tg_sent = 0
    for r in tg_rows:
        chat_id = tg_targets.get(r["user_id"])
        ok = False
        if chat_id:
            resp = (
                c.table("user_notification_subscriptions")
                .select("enabled")
                .eq("user_id", r["user_id"])
                .eq("event_type", r["event_type"])
                .eq("channel", "telegram")
                .maybe_single()
                .execute()
            )
            if resp.data and resp.data.get("enabled"):
                ok = send_telegram(chat_id, r["title"], r["body"], r["link"])
        (c.table("user_notifications")
         .update({"sent_to_telegram_at": now_iso})
         .eq("id", r["id"]).execute())
        if ok:
            tg_sent += 1

    logger.info(
        "dispatch_done",
        teams_sent=teams_sent, teams_total=len(teams_rows),
        tg_sent=tg_sent, tg_total=len(tg_rows),
    )
    return {
        "teams_sent": teams_sent, "teams_total": len(teams_rows),
        "telegram_sent": tg_sent, "telegram_total": len(tg_rows),
    }


def main() -> None:
    dispatch_pending()


if __name__ == "__main__":
    main()
