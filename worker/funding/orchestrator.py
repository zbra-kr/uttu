"""
UTTU 투자유치 수집 오케스트레이터

08-funding.md §2 아키텍처:
  1. funding_collection_jobs 에서 pending 잡 픽업
  2. status pending → running
  3. Tier 1: 뉴스 NLP (news_source)
  4. Tier 2: DART (dart_source) + datago (datago_source)
  5. merge → funding_rounds upsert
  6. companies.funding_last_collected_at 업데이트
  7. status → done / failed
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import pytz
from dotenv import load_dotenv
from loguru import logger
from supabase import create_client, Client

from worker.funding.dart_source import fetch_dart_rounds
from worker.funding.audit_source import fetch_audit_rounds
from worker.funding.news_source import fetch_news_rounds
from worker.funding.datago_source import fetch_datago_rounds
from worker.funding.merge import merge_rounds
from worker.funding.brief_writer import generate_brief
from worker.notifications.enqueue import enqueue_notification

load_dotenv()

KST = pytz.timezone("Asia/Seoul")


# ── Supabase 클라이언트 ──────────────────────────────────────────────────────────

def _supabase() -> Client:
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], service_key)


# ── 잡 상태 전이 ─────────────────────────────────────────────────────────────────

def _set_job_status(
    db: Client,
    job_id: str,
    status: str,
    rounds_found: int = 0,
    error: str | None = None,
) -> None:
    now = datetime.now(KST).isoformat()
    update: dict = {"status": status}
    if status == "running":
        update["started_at"] = now
    elif status in ("done", "failed"):
        update["finished_at"] = now
        update["rounds_found"] = rounds_found
        if error:
            update["error"] = error[:500]
    try:
        db.table("funding_collection_jobs").update(update).eq("id", job_id).execute()
        logger.debug("job_status_updated", job_id=job_id, status=status)
    except Exception as e:
        logger.warning("job_status_update_failed", job_id=job_id, error=str(e))


# ── DB 쓰기 ──────────────────────────────────────────────────────────────────────

def _delete_existing_rounds(db: Client, company_id: str) -> None:
    """기존 수집 결과 전체 삭제 — 재수집 전 호출."""
    try:
        db.table("funding_rounds").delete().eq("company_id", company_id).execute()
        logger.info("funding_rounds_deleted", company_id=company_id)
    except Exception as e:
        logger.warning("funding_rounds_delete_failed", company_id=company_id, error=str(e))


def _upsert_rounds(db: Client, rounds: list[dict]) -> int:
    """
    funding_rounds 테이블에 insert.
    _delete_existing_rounds 호출 후 사용 (삭제 후 신규 적재 패턴).
    PostgREST 1000행 상한 대응: 청크 처리.
    """
    if not rounds:
        return 0

    inserted = 0
    chunk_size = 100  # PostgREST 안전 청크
    for i in range(0, len(rounds), chunk_size):
        chunk = rounds[i : i + chunk_size]
        try:
            result = (
                db.table("funding_rounds")
                .upsert(chunk, on_conflict="company_id,source_type,source_ref")
                .execute()
            )
            inserted += len(result.data or chunk)
        except Exception as e:
            logger.error("funding_upsert_failed", chunk_start=i, error=str(e))

    logger.info("funding_rounds_upserted", count=inserted)
    return inserted


def _update_company_collected_at(db: Client, company_id: str) -> None:
    now = datetime.now(KST).isoformat()
    try:
        db.table("companies").update(
            {"funding_last_collected_at": now}
        ).eq("id", company_id).execute()
    except Exception as e:
        logger.warning("company_collected_at_update_failed", company_id=company_id, error=str(e))


# ── 핵심 잡 실행 ────────────────────────────────────────────────────────────────

async def run_job(
    company_id: str,
    dry_run: bool = False,
    job_id: str | None = None,
) -> dict:
    """
    단일 회사 투자정보 수집 실행.

    Parameters
    ----------
    company_id : companies.id (UUID)
    dry_run    : True면 DB 삽입 없이 결과만 반환
    job_id     : funding_collection_jobs.id (있으면 상태 업데이트)

    Returns
    -------
    dict:
      rounds_found : int
      by_source    : dict[source_type → count]
      dry_run      : bool
    """
    db = _supabase()

    # 1. 회사 정보 조회
    try:
        r = db.table("companies").select("id, corp_name, corp_code").eq("id", company_id).single().execute()
        company = r.data
    except Exception as e:
        msg = f"company_not_found: {e}"
        logger.error("company_not_found", company_id=company_id, error=str(e))
        if job_id:
            _set_job_status(db, job_id, "failed", error=msg)
        return {"rounds_found": 0, "by_source": {}, "dry_run": dry_run, "error": msg}

    corp_code = company.get("corp_code") or ""
    corp_name = company.get("corp_name") or ""
    company_name = corp_name  # companies 테이블에는 corp_name 컬럼만 있음

    logger.info(
        "funding_job_start",
        company_id=company_id,
        company_name=company_name,
        corp_code=corp_code,
        dry_run=dry_run,
    )

    # 2. 잡 상태 running으로 전환
    if job_id:
        _set_job_status(db, job_id, "running")

    all_rounds: list[dict] = []
    errors: list[str] = []

    # 3. Tier 2: DART 공시 + 감사보고서 SCE
    if corp_code:
        try:
            dart_rounds = await fetch_dart_rounds(corp_code)
            all_rounds.extend(dart_rounds)
            logger.info("dart_done", count=len(dart_rounds), company=company_name)
        except Exception as e:
            err = f"dart_error: {e}"
            errors.append(err)
            logger.warning(err, company=company_name)

        try:
            audit_rounds = fetch_audit_rounds(corp_code)
            all_rounds.extend(audit_rounds)
            logger.info("audit_done", count=len(audit_rounds), company=company_name)
        except Exception as e:
            err = f"audit_error: {e}"
            errors.append(err)
            logger.warning(err, company=company_name)
    else:
        logger.info("dart_skip_no_corp_code", company=company_name)

    # 4. Tier 1: 뉴스 NLP
    try:
        news_rounds = await fetch_news_rounds(
            company_name=company_name,
            corp_name=corp_name,
            company_id=company_id,
        )
        all_rounds.extend(news_rounds)
        logger.info("news_done", count=len(news_rounds), company=company_name)
    except Exception as e:
        err = f"news_error: {e}"
        errors.append(err)
        logger.warning(err, company=company_name)

    # 5. Tier 2: datago (stub)
    try:
        datago_rounds = await fetch_datago_rounds(company_name)
        all_rounds.extend(datago_rounds)
    except Exception as e:
        errors.append(f"datago_error: {e}")

    # 6. merge
    merged = merge_rounds(all_rounds, company_id)

    by_source: dict[str, int] = {}
    for r in merged:
        st = r.get("source_type", "unknown")
        by_source[st] = by_source.get(st, 0) + 1

    # 7. 브리핑 생성
    brief_md = await generate_brief(company_name, merged)

    # 8. DB 쓰기 (dry_run 아닐 때만)
    if not dry_run:
        _delete_existing_rounds(db, company_id)
        upserted = _upsert_rounds(db, merged)
        _update_company_collected_at(db, company_id)
        # funding_brief_md, funding_brief_at 업데이트
        try:
            db.table("companies").update({
                "funding_brief_md": brief_md,
                "funding_brief_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", company_id).execute()
            logger.info("funding_brief_saved", company=company_name, chars=len(brief_md))
        except Exception as e:
            logger.warning("funding_brief_save_failed", company=company_name, error=str(e))
        if job_id:
            _set_job_status(db, job_id, "done", rounds_found=upserted)
            # 요청자에게 완료 알림
            try:
                job_row = db.table("funding_collection_jobs").select("requested_by").eq("id", job_id).single().execute()
                requested_by = (job_row.data or {}).get("requested_by")
                if requested_by:
                    enqueue_notification(
                        user_id=requested_by,
                        event_type="funding_collection_done",
                        title=f"투자정보 수집 완료 — {company_name}",
                        body=f"{upserted}건 수집됨" if upserted else "신규 데이터 없음",
                        link=f"/company?id={company_id}",
                        client=db,
                    )
                    logger.info("funding_notify_sent", user_id=requested_by, company=company_name)
            except Exception as e:
                logger.warning("funding_notify_failed", job_id=job_id, error=str(e))
    else:
        logger.info(
            "dry_run_result",
            company=company_name,
            total=len(merged),
            by_source=by_source,
        )
        for idx, r in enumerate(merged):
            logger.info(
                "dry_run_round",
                idx=idx,
                round_type=r.get("round_type"),
                amount_krw=r.get("amount_krw"),
                announced_date=r.get("announced_date"),
                source_type=r.get("source_type"),
                confidence=r.get("confidence"),
                investors=r.get("investors"),
            )
        if job_id:
            _set_job_status(db, job_id, "done", rounds_found=len(merged))

    brief_preview = brief_md[:200] if brief_md else None

    result = {
        "rounds_found":   len(merged),
        "by_source":      by_source,
        "dry_run":        dry_run,
        "brief_preview":  brief_preview,
    }
    if errors:
        result["errors"] = errors

    logger.info("funding_job_done", **result)
    return result


# ── 폴링 ────────────────────────────────────────────────────────────────────────

async def poll_pending(limit: int = 1) -> int:
    """
    funding_collection_jobs 에서 pending 잡을 가져와 순서대로 실행.

    Parameters
    ----------
    limit : 한 번에 처리할 최대 잡 수 (기본 1)

    Returns
    -------
    처리한 잡 수
    """
    db = _supabase()

    try:
        result = (
            db.table("funding_collection_jobs")
            .select("id, company_id")
            .eq("status", "pending")
            .order("created_at")
            .limit(limit)
            .execute()
        )
        jobs = result.data or []
    except Exception as e:
        logger.error("poll_pending_fetch_failed", error=str(e))
        return 0

    if not jobs:
        logger.debug("poll_pending_no_jobs")
        return 0

    logger.info("poll_pending_found", count=len(jobs))
    processed = 0

    for job in jobs:
        job_id = job["id"]
        company_id = job["company_id"]
        try:
            await run_job(company_id=company_id, dry_run=False, job_id=job_id)
            processed += 1
        except Exception as e:
            logger.error("poll_job_failed", job_id=job_id, company_id=company_id, error=str(e))
            db.table("funding_collection_jobs").update({
                "status": "failed",
                "error": str(e)[:500],
                "finished_at": datetime.now(KST).isoformat(),
            }).eq("id", job_id).execute()

    return processed
