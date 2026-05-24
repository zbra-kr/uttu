"""
상품기획/영업기획 이상탐지 — ranking_snapshots + promotion_items 기반.

탐지 항목:
  rank_spike             — 경쟁 상품 순위 급등 (전일 대비 +20위↑ & TOP50 진입)
  rank_drop_own          — 자사 상품 순위 이탈 (전일 대비 -10위↓)
  new_entrant_top10      — TOP10 신규 진입 (어제 TOP20 밖)
  sold_out               — TOP50 내 품절 전환
  price_drop             — 전일 대비 final_price -10% 이상
  price_rise             — 전일 대비 final_price +10% 이상
  rank_exit_own          — 자사 상품 TOP100 이탈
  rank_return_own        — 자사 상품 TOP50 재진입
  rank_multi_drop_own    — 자사 상품 3개 이상 동시 하락
  promo_heavy_discount   — 프로모션 할인율 ≥ 50%
  promo_item_count_drop  — 프로모션 전체 상품 수 전일 대비 -30% 이상
  promo_own_exit         — 자사 상품 프로모션 이탈

기준 조합: category_code='000' (전체), gender_filter='A', age_filter='AGE_BAND_ALL'
"""

from __future__ import annotations

from datetime import date, timedelta

from loguru import logger
from supabase import Client

from worker.detectors.base import Anomaly

MODULE = "product_planning"

# 임계값
RANK_SPIKE_DELTA        = 20   # 순위 상승 폭
RANK_DROP_OWN_DELTA     = 10   # 자사 순위 하락 폭
NEW_ENTRANT_TOP         = 10   # 오늘 TOP N
NEW_ENTRANT_PREV_OUT    = 20   # 어제 이 순위 밖이면 신규 진입
SOLD_OUT_MIN_RANK       = 50   # 이 순위 이내 품절만 탐지
HEAVY_DISCOUNT_RATE     = 50.0 # 할인율 %
PRICE_DROP_RATE         = 0.10 # 가격 하락 비율
PRICE_RISE_RATE         = 0.10 # 가격 상승 비율
RANK_EXIT_TOP           = 100  # 자사 상품 이탈 기준 순위
RANK_RETURN_TOP         = 50   # 자사 상품 재진입 기준 순위
MULTI_DROP_MIN          = 3    # 동시 하락 최소 상품 수
PROMO_COUNT_DROP_RATE   = 0.30 # 프로모션 상품 수 급감 임계


def _load_ranking(client: Client, target_date: date) -> dict[str, dict]:
    """
    (category='000', gender='A', age='AGE_BAND_ALL') 기준
    product_id → {rank, is_sold_out, final_price, product_name, brand_name, is_own}
    """
    rows: list[dict] = []
    offset = 0
    while True:
        batch = (
            client.table("ranking_snapshots")
            .select("product_id, rank_position, is_sold_out, final_price, product_name, brand_name")
            .eq("snapshot_date", target_date.isoformat())
            .eq("category_code", "000")
            .eq("gender_filter", "A")
            .eq("age_filter", "AGE_BAND_ALL")
            .range(offset, offset + 999)
            .execute()
            .data or []
        )
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    if not rows:
        return {}

    # products 테이블에서 is_own 가져오기
    product_ids = list({r["product_id"] for r in rows})
    own_set: set[str] = set()
    for i in range(0, len(product_ids), 200):
        chunk = product_ids[i:i + 200]
        own_rows = (
            client.table("products")
            .select("id")
            .in_("id", chunk)
            .eq("is_own", True)
            .execute()
            .data or []
        )
        own_set.update(r["id"] for r in own_rows)

    return {
        r["product_id"]: {
            "rank":         r["rank_position"],
            "is_sold_out":  r["is_sold_out"],
            "final_price":  r["final_price"],
            "product_name": r["product_name"],
            "brand_name":   r["brand_name"],
            "is_own":       r["product_id"] in own_set,
        }
        for r in rows
    }


def detect_ranking(client: Client, target_date: date) -> list[Anomaly]:
    yesterday = target_date - timedelta(days=1)
    today_map = _load_ranking(client, target_date)
    prev_map  = _load_ranking(client, yesterday)

    if not today_map:
        logger.warning("ranking_detector_no_data", date=target_date.isoformat())
        return []

    anomalies: list[Anomaly] = []

    for pid, today in today_map.items():
        prev = prev_map.get(pid)
        rank_today = today["rank"]
        rank_prev  = prev["rank"] if prev else None
        name       = today["product_name"] or "—"
        brand      = today["brand_name"] or "—"

        # rank_spike — 경쟁 상품 순위 급등 (자사 제외)
        if (
            not today["is_own"]
            and rank_prev is not None
            and rank_today <= 50
            and (rank_prev - rank_today) >= RANK_SPIKE_DELTA
        ):
            delta = rank_prev - rank_today
            anomalies.append(Anomaly(
                module=MODULE, severity="medium", anomaly_type="rank_spike",
                entity_type="product", entity_id=pid, entity_name=name,
                description=f"[{brand}] {name} — 순위 {rank_prev}위 → {rank_today}위 ({delta}계단 급등)",
                meta={"rank_today": rank_today, "rank_prev": rank_prev, "delta": delta, "brand": brand},
            ))

        # rank_drop_own — 자사 상품 순위 하락
        if (
            today["is_own"]
            and rank_prev is not None
            and (rank_today - rank_prev) >= RANK_DROP_OWN_DELTA
        ):
            delta = rank_today - rank_prev
            severity = "high" if delta >= 30 else "medium"
            anomalies.append(Anomaly(
                module=MODULE, severity=severity, anomaly_type="rank_drop_own",
                entity_type="product", entity_id=pid, entity_name=name,
                description=f"[자사] {name} — 순위 {rank_prev}위 → {rank_today}위 ({delta}계단 하락)",
                meta={"rank_today": rank_today, "rank_prev": rank_prev, "delta": delta},
            ))

        # new_entrant_top10 — 오늘 TOP10, 어제 TOP20 밖
        if (
            not today["is_own"]
            and rank_today <= NEW_ENTRANT_TOP
            and (rank_prev is None or rank_prev > NEW_ENTRANT_PREV_OUT)
        ):
            prev_str = f"{rank_prev}위" if rank_prev else "미진입"
            anomalies.append(Anomaly(
                module=MODULE, severity="medium", anomaly_type="new_entrant_top10",
                entity_type="product", entity_id=pid, entity_name=name,
                description=f"[{brand}] {name} — TOP10 신규 진입 (어제: {prev_str} → 오늘: {rank_today}위)",
                meta={"rank_today": rank_today, "rank_prev": rank_prev, "brand": brand},
            ))

        # sold_out — TOP50 내 품절 전환
        if (
            rank_today <= SOLD_OUT_MIN_RANK
            and today["is_sold_out"]
            and prev is not None
            and not prev["is_sold_out"]
        ):
            severity = "high" if today["is_own"] else "low"
            label = "[자사] " if today["is_own"] else f"[{brand}] "
            anomalies.append(Anomaly(
                module=MODULE, severity=severity, anomaly_type="sold_out",
                entity_type="product", entity_id=pid, entity_name=name,
                description=f"{label}{name} — {rank_today}위 진입 상태에서 품절 전환",
                meta={"rank_today": rank_today, "is_own": today["is_own"], "brand": brand},
            ))

        # price_drop — 전일 대비 가격 -10% 이상
        if (
            prev is not None
            and prev["final_price"] and today["final_price"]
            and prev["final_price"] > 0
        ):
            drop_rate = (prev["final_price"] - today["final_price"]) / prev["final_price"]
            if drop_rate >= PRICE_DROP_RATE:
                label = "[자사] " if today["is_own"] else f"[{brand}] "
                severity = "high" if (today["is_own"] or drop_rate >= 0.2) else "low"
                anomalies.append(Anomaly(
                    module=MODULE, severity=severity, anomaly_type="price_drop",
                    entity_type="product", entity_id=pid, entity_name=name,
                    description=f"{label}{name} — 가격 {prev['final_price']:,}원 → {today['final_price']:,}원 ({drop_rate*100:.0f}% 인하)",
                    meta={"price_prev": prev["final_price"], "price_today": today["final_price"],
                          "drop_rate": round(drop_rate, 3), "is_own": today["is_own"]},
                ))

        # price_rise — 전일 대비 가격 +10% 이상
        if (
            prev is not None
            and prev["final_price"] and today["final_price"]
            and prev["final_price"] > 0
        ):
            rise_rate = (today["final_price"] - prev["final_price"]) / prev["final_price"]
            if rise_rate >= PRICE_RISE_RATE:
                label = "[자사] " if today["is_own"] else f"[{brand}] "
                severity = "medium" if today["is_own"] else "low"
                anomalies.append(Anomaly(
                    module=MODULE, severity=severity, anomaly_type="price_rise",
                    entity_type="product", entity_id=pid, entity_name=name,
                    description=f"{label}{name} — 가격 {prev['final_price']:,}원 → {today['final_price']:,}원 ({rise_rate*100:.0f}% 인상)",
                    meta={"price_prev": prev["final_price"], "price_today": today["final_price"],
                          "rise_rate": round(rise_rate, 3), "is_own": today["is_own"]},
                ))

        # rank_return_own — 자사 상품 TOP50 재진입
        if (
            today["is_own"]
            and rank_today <= RANK_RETURN_TOP
            and (rank_prev is None or rank_prev > RANK_RETURN_TOP)
        ):
            prev_str = f"{rank_prev}위" if rank_prev else "미진입"
            anomalies.append(Anomaly(
                module=MODULE, severity="low", anomaly_type="rank_return_own",
                entity_type="product", entity_id=pid, entity_name=name,
                description=f"[자사] {name} — TOP50 재진입 ({prev_str} → {rank_today}위)",
                meta={"rank_today": rank_today, "rank_prev": rank_prev},
            ))

    # rank_exit_own — 어제 TOP100 이내였지만 오늘 랭킹에 없는 자사 상품
    for pid, prev in prev_map.items():
        if pid not in today_map and prev["is_own"] and prev["rank"] <= RANK_EXIT_TOP:
            name = prev["product_name"] or "—"
            anomalies.append(Anomaly(
                module=MODULE, severity="high", anomaly_type="rank_exit_own",
                entity_type="product", entity_id=pid, entity_name=name,
                description=f"[자사] {name} — 전체 랭킹 TOP{RANK_EXIT_TOP} 이탈 (어제 {prev['rank']}위)",
                meta={"rank_prev": prev["rank"]},
            ))

    # rank_multi_drop_own — 자사 상품 N개 이상 동시 하락 (rank_drop_own 해당 항목 집계)
    drop_own_items = [a for a in anomalies if a.anomaly_type == "rank_drop_own"]
    if len(drop_own_items) >= MULTI_DROP_MIN:
        names = ", ".join(a.entity_name or "—" for a in drop_own_items[:5])
        suffix = f" 외 {len(drop_own_items) - 5}개" if len(drop_own_items) > 5 else ""
        anomalies.append(Anomaly(
            module=MODULE, severity="high", anomaly_type="rank_multi_drop_own",
            entity_type=None, entity_id=None, entity_name=None,
            description=f"[자사] 자사 상품 {len(drop_own_items)}개 동시 순위 하락: {names}{suffix}",
            meta={"count": len(drop_own_items), "products": [a.entity_id for a in drop_own_items]},
        ))

    logger.info(f"ranking_detector_done date={target_date} anomalies={len(anomalies)}")
    return anomalies


def detect_promo_discount(client: Client, target_date: date) -> list[Anomaly]:
    """promotion_items 중 할인율 ≥ 50% 탐지."""
    rows = (
        client.table("promotion_items")
        .select("id, promotion_id, musinsa_brand_name, product_name, discount_rate, final_price")
        .eq("snapshot_date", target_date.isoformat())
        .gte("discount_rate", HEAVY_DISCOUNT_RATE)
        .limit(500)
        .execute()
        .data or []
    )

    anomalies: list[Anomaly] = []
    for r in rows:
        brand = r.get("musinsa_brand_name") or "—"
        name  = r.get("product_name") or "—"
        dr    = float(r.get("discount_rate") or 0)
        anomalies.append(Anomaly(
            module=MODULE, severity="medium", anomaly_type="promo_heavy_discount",
            entity_type="product", entity_id=r["id"], entity_name=name,
            description=f"[{brand}] {name} — 프로모션 할인율 {dr:.0f}%",
            meta={"discount_rate": dr, "brand": brand, "final_price": r.get("final_price")},
        ))

    logger.info(f"promo_detector_done date={target_date} anomalies={len(anomalies)}")
    return anomalies


def _count_promo_items(client: Client, target_date: date) -> int:
    result = (
        client.table("promotion_items")
        .select("id", count="exact")
        .eq("snapshot_date", target_date.isoformat())
        .execute()
    )
    return result.count or 0


def detect_promo_anomalies(client: Client, target_date: date) -> list[Anomaly]:
    """
    promo_item_count_drop — 전일 대비 프로모션 상품 수 -30% 이상 급감
    promo_own_exit        — 어제 있던 자사 상품이 오늘 프로모션에서 빠짐
    """
    from worker.detectors.brand_ranking_detector import _load_own_brand_slugs

    yesterday = target_date - timedelta(days=1)
    anomalies: list[Anomaly] = []

    # promo_item_count_drop
    count_today = _count_promo_items(client, target_date)
    count_prev  = _count_promo_items(client, yesterday)

    if count_prev > 0 and count_today < count_prev * (1 - PROMO_COUNT_DROP_RATE):
        drop_rate = (count_prev - count_today) / count_prev
        anomalies.append(Anomaly(
            module=MODULE, severity="medium", anomaly_type="promo_item_count_drop",
            entity_type=None, entity_id=None, entity_name=None,
            description=(
                f"프로모션 상품 수 급감: {count_prev}건 → {count_today}건 "
                f"({drop_rate*100:.0f}% 감소)"
            ),
            meta={"count_today": count_today, "count_prev": count_prev,
                  "drop_rate": round(drop_rate, 3)},
        ))

    # promo_own_exit — 자사 브랜드 슬러그로 어제/오늘 비교
    own_slugs = _load_own_brand_slugs(client)
    if not own_slugs:
        logger.info(f"promo_anomalies_done date={target_date} anomalies={len(anomalies)}")
        return anomalies

    def _load_own_promo_items(d: date) -> dict[str, str]:
        """musinsa_no → product_name, 자사 브랜드만."""
        result: dict[str, str] = {}
        offset = 0
        while True:
            batch = (
                client.table("promotion_items")
                .select("musinsa_no, product_name, musinsa_brand_slug")
                .eq("snapshot_date", d.isoformat())
                .in_("musinsa_brand_slug", list(own_slugs))
                .range(offset, offset + 999)
                .execute()
                .data or []
            )
            for r in batch:
                result[r["musinsa_no"]] = r.get("product_name") or r["musinsa_no"]
            if len(batch) < 1000:
                break
            offset += 1000
        return result

    prev_own = _load_own_promo_items(yesterday)
    today_own = _load_own_promo_items(target_date)

    exited = {no: name for no, name in prev_own.items() if no not in today_own}
    for musinsa_no, product_name in exited.items():
        anomalies.append(Anomaly(
            module=MODULE, severity="medium", anomaly_type="promo_own_exit",
            entity_type="product", entity_id=musinsa_no, entity_name=product_name,
            description=f"[자사] {product_name} — 어제 프로모션 노출 → 오늘 이탈",
            meta={"musinsa_no": musinsa_no},
        ))

    logger.info(f"promo_anomalies_done date={target_date} anomalies={len(anomalies)}")
    return anomalies
