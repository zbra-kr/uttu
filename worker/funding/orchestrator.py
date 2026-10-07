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
from datetime import datetime

import pytz
from dotenv import load_dotenv
from loguru import logger

from supabase import Client, create_client
from worker.funding.audit_source import fetch_audit_rounds
from worker.funding.brief_writer import generate_brief
from worker.funding.dart_source import fetch_dart_rounds
from worker.funding.datago_source import fetch_datago_rounds
from worker.funding.merge import merge_rounds
from worker.funding.news_source import fetch_news_rounds
from worker.funding.persistence import PersistenceFailure, persist_rounds, publish_company
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
) -> bool:
    now = datetime.now(KST).isoformat()
    update: dict = {"status": status}
    if status == "running":
        update.update(started_at=now, finished_at=None, rounds_found=0, error=None)
    elif status in ("done", "failed"):
        update["finished_at"] = now
        update["rounds_found"] = rounds_found
        update["error"] = error[:500] if error else None
    try:
        data = db.table("funding_collection_jobs").update(update).eq("id", job_id).execute().data
        if not isinstance(data, list) or len(data) != 1 or data[0].get("id") != job_id or data[0].get("status") != status:
            return False
        if any(data[0].get(key) != value for key, value in update.items()
               if key not in {'started_at', 'finished_at'}):
            return False
        for key in ('started_at', 'finished_at'):
            if key not in update:
                continue
            actual, expected = data[0].get(key), update[key]
            if expected is None:
                if actual is not None:
                    return False
            elif datetime.fromisoformat(actual) != datetime.fromisoformat(expected):
                return False
        logger.debug("job_status_updated", job_id=job_id, status=status)
        return True
    except Exception as e:
        logger.warning("job_status_update_failed", job_id=job_id, error=str(e))
        return False


# ── DB 쓰기 ──────────────────────────────────────────────────────────────────────

def _publication_failure(db, job_id, code, stage):
    result = {"rounds_found": 0, "by_source": {}, "dry_run": False,
              "error": code, "publication_stage": stage, "brief_preview": None,
              "round_writes_may_have_committed": stage != "source_identity"}
    if job_id and not _set_job_status(db, job_id, "failed", error=code):
        result["job_error"] = "failed_status_ack_unverified"
    return result


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
        if not isinstance(company, dict) or company.get('id') != company_id:
            raise RuntimeError('company_lookup_ack_unverified')
    except Exception as e:
        msg = f"company_not_found: {e}"
        logger.error("company_not_found", company_id=company_id, error=str(e))
        result = {"rounds_found": 0, "by_source": {}, "dry_run": dry_run, "error": msg}
        if job_id and not dry_run and not _set_job_status(db, job_id, "failed", error=msg):
            result["job_error"] = "failed_status_ack_unverified"
        return result

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
    if job_id and not dry_run and not _set_job_status(db, job_id, "running"):
        return {"rounds_found": 0, "by_source": {}, "dry_run": False,
                "error": "funding_job_start_ack_unverified", "brief_preview": None}

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

    # Source failures stop before additive storage or company publication.
    if errors:
        code = "funding_source_discovery_failed"
        result = {"rounds_found": 0, "by_source": {}, "dry_run": dry_run,
                  "error": code, "errors": errors, "brief_preview": None}
        if job_id and not dry_run and not _set_job_status(db, job_id, "failed", error=code):
            result["job_error"] = "failed_status_ack_unverified"
        return result

    # 6. merge
    merged = merge_rounds(all_rounds, company_id)

    by_source: dict[str, int] = {}
    for r in merged:
        st = r.get("source_type", "unknown")
        by_source[st] = by_source.get(st, 0) + 1

    # 7. Add new stable identities; never delete or overwrite historical rows.
    stored = None
    if not dry_run:
        stage = "rounds"
        try:
            stored = persist_rounds(db, company_id, merged)
            stage = "brief_generation"
            brief_md = await generate_brief(company_name, stored.history)
            stage = "company_publication"
            publish_company(db, company_id, brief_md)
        except Exception as error:
            code = error.code if isinstance(error, PersistenceFailure) else "funding_publication_failed"
            if code in {"funding_source_identity_invalid", "funding_source_identity_duplicate"}:
                stage = "source_identity"
            logger.error("funding_publication_failed", stage=stage, code=code)
            return _publication_failure(db, job_id, code, stage)
        if job_id:
            if not _set_job_status(db, job_id, "done", rounds_found=stored.confirmed):
                # Publication is confirmed, terminal acknowledgment is not. Do not
                # overwrite an ambiguously committed done state or enqueue success.
                return {"rounds_found": stored.confirmed, "by_source": by_source,
                        "dry_run": False, "error": "funding_done_ack_unverified",
                        "publication_stage": "job_done", "publication_confirmed": True,
                        "brief_preview": None}
            try:
                job_row = db.table("funding_collection_jobs").select("requested_by").eq("id", job_id).single().execute()
                requested_by = (job_row.data or {}).get("requested_by")
                if requested_by:
                    enqueue_notification(
                        user_id=requested_by,
                        event_type="funding_collection_done",
                        title=f"투자정보 수집 완료 — {company_name}",
                        body=f"{stored.confirmed}건 확인됨" if stored.confirmed else "신규 데이터 없음 — 기존 이력 유지",
                        link=f"/company?id={company_id}",
                        client=db,
                    )
                    logger.info("funding_notify_sent", user_id=requested_by, company=company_name)
            except Exception as error:
                # Notification acknowledgment/outbox idempotency is a separate
                # concern; never turn confirmed data publication into a retry.
                logger.warning("funding_notify_failed", job_id=job_id, error=str(error))
    else:
        brief_md = await generate_brief(company_name, merged)
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

    brief_preview = brief_md[:200] if brief_md else None

    result = {
        "rounds_found":   len(merged),
        "by_source":      by_source,
        "dry_run":        dry_run,
        "brief_preview":  brief_preview,
    }
    if stored is not None:
        result.update(rounds_inserted=stored.inserted, history_rounds=len(stored.history))

    logger.info("funding_job_done", **result)
    return result


# ── 폴링 ────────────────────────────────────────────────────────────────────────

async def poll_pending(limit: int = 1) -> dict:
    """
    funding_collection_jobs 에서 pending 잡을 가져와 순서대로 실행.

    Parameters
    ----------
    limit : 한 번에 처리할 최대 잡 수 (기본 1)

    Returns
    -------
    처리/실패 수와 성공 여부 (빈 정상 큐와 큐 읽기 실패 구분)
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
        jobs = result.data
        if not isinstance(jobs, list):
            raise RuntimeError("funding_queue_receipt_invalid")
    except Exception as e:
        logger.error("poll_pending_fetch_failed", error=str(e))
        return {"ok": False, "processed": 0, "failed": 0, "error": "funding_queue_read_failed"}

    if not jobs:
        logger.debug("poll_pending_no_jobs")
        return {"ok": True, "processed": 0, "failed": 0}

    logger.info("poll_pending_found", count=len(jobs))
    processed = 0
    failed = 0

    for job in jobs:
        job_id = job["id"]
        company_id = job["company_id"]
        try:
            outcome = await run_job(company_id=company_id, dry_run=False, job_id=job_id)
            processed += 1
            if outcome.get("error") or outcome.get("errors"):
                failed += 1
        except Exception as e:
            processed += 1
            failed += 1
            logger.error("poll_job_failed", job_id=job_id, company_id=company_id, error=str(e))
            _set_job_status(db, job_id, "failed", error="funding_job_exception")

    return {"ok": failed == 0, "processed": processed, "failed": failed}
