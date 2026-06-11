"""
이상탐지 공통 기반 클래스 및 저장 헬퍼.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import pytz
from loguru import logger

from supabase import Client, create_client

KST = pytz.timezone("Asia/Seoul")


@dataclass
class Anomaly:
    module:       str
    severity:     str          # 'high' | 'medium' | 'low'
    anomaly_type: str
    entity_type:  str | None   = None
    entity_id:    str | None   = None
    entity_name:  str | None   = None
    description:  str | None   = None
    meta:         dict[str, Any] = field(default_factory=dict)


def supabase_client() -> Client:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], key)


def save_anomalies(client: Client, anomalies: list[Anomaly], detection_date: date) -> int:
    if not anomalies:
        return 0

    payloads = [
        {
            "detection_date": detection_date.isoformat(),
            "module":         a.module,
            "severity":       a.severity,
            "anomaly_type":   a.anomaly_type,
            "entity_type":    a.entity_type,
            "entity_id":      a.entity_id,
            "entity_name":    a.entity_name,
            "description":    a.description,
            "meta":           a.meta,
        }
        for a in anomalies
    ]

    # entity_id가 None인 경우 (entity 없는 이상) UNIQUE 키 충돌 안 나므로 별도 처리
    saved = 0
    for chunk in (payloads[i:i+100] for i in range(0, len(payloads), 100)):
        try:
            client.table("anomalies").upsert(
                chunk,
                on_conflict="detection_date,anomaly_type,entity_id",
                ignore_duplicates=True,
            ).execute()
            saved += len(chunk)
        except Exception as e:
            logger.warning("anomaly_save_error", error=str(e), count=len(chunk))

    logger.info(f"anomalies_saved count={saved} date={detection_date}")
    return saved
