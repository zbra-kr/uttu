"""
DART 공시·재무 스크래퍼
대상: companies 테이블 (corp_code 없는 항목 → corp_code 조회 → 공시/재무 수집)

실행:
  python -m worker.scrapers.dart_scraper --target bcave   # B.CAVE만
  python -m worker.scrapers.dart_scraper --target all     # 전체

흐름:
  1. corp_code 조회   (DART corpCode.xml → business_number 매핑)
  2. 공시 목록 수집   → dart_disclosures
  3. 재무제표 수집    → dart_financials
     - 외감법인 API (fnlttSinglAcnt)가 있으면 사용
     - 없으면 감사보고서 ZIP 파싱
"""

import asyncio
import os
from datetime import datetime, timedelta

import pytz
from dotenv import load_dotenv
from loguru import logger
from supabase import Client, create_client

from worker.dart.fetcher import (
    fetch_company,
    fetch_corp_code_zip,
    fetch_disclosures,
)
from worker.dart.parser import parse_corp_codes
from worker.dart.fss_client import fetch_audit_financials

load_dotenv()

KST = pytz.timezone("Asia/Seoul")
BCAVE_BUSINESS_NO = "2618117293"


def _supabase_client() -> Client:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], key)


# ── Step 1: corp_code 조회 ────────────────────────────────────────────────────

async def resolve_corp_codes(client: Client, api_key: str, company_ids: list[str]) -> int:
    """
    dart_fetched_at IS NULL인 companies에 corp_code 채워넣기.
    corpCode.xml 1회 다운로드 → 이름 후보 → company.json bizr_no 검증.
    """
    rows: list[dict] = []
    for i in range(0, len(company_ids), 200):
        chunk = company_ids[i:i + 200]
        rows += (
            client.table("companies")
            .select("id, corp_name, business_number, corp_code")
            .in_("id", chunk)
            .is_("corp_code", "null")
            .execute()
            .data or []
        )
    if not rows:
        logger.info("corp_code_all_resolved")
        return 0

    logger.info("corp_code_downloading_list")
    zip_bytes = await fetch_corp_code_zip(api_key)
    all_corps = parse_corp_codes(zip_bytes)
    logger.info("corp_code_list_size", count=len(all_corps))

    # corp_name → corp_code 딕셔너리 (소문자 정규화)
    name_index: dict[str, str] = {
        c["corp_name"].strip().lower(): c["corp_code"]
        for c in all_corps
        if c["corp_code"]
    }

    updated = 0
    for row in rows:
        raw_name: str = row["corp_name"] or ""
        biz_no: str = (row["business_number"] or "").replace("-", "")

        # ① 정확한 이름 매칭
        candidates: list[str] = []
        key = raw_name.strip().lower()
        if key in name_index:
            candidates.append(name_index[key])

        # ② 괄호 변형 (주)비케이브 ↔ 비케이브 등
        stripped = raw_name.replace("(주)", "").replace("주식회사", "").strip().lower()
        if stripped in name_index and name_index[stripped] not in candidates:
            candidates.append(name_index[stripped])

        if not candidates:
            logger.warning("corp_code_name_not_found", corp_name=raw_name)
            # 찾지 못해도 dart_fetched_at 기록하여 재조회 방지
            client.table("companies").update(
                {"dart_fetched_at": datetime.now(KST).isoformat()}
            ).eq("id", row["id"]).execute()
            continue

        # ③ bizr_no 검증
        resolved_code: str | None = None
        for corp_code in candidates:
            detail = await fetch_company(api_key, corp_code)
            dart_biz = (detail.get("bizr_no") or "").replace("-", "")
            if biz_no and dart_biz == biz_no:
                resolved_code = corp_code
                break
            if not biz_no:
                # business_number가 없으면 이름 매칭만으로 결정
                resolved_code = corp_code
                break

        if resolved_code:
            is_listed = bool(detail.get("stock_code", "").strip())
            payload: dict = {
                "corp_code":       resolved_code,
                "is_listed":       is_listed,
                "dart_fetched_at": datetime.now(KST).isoformat(),
            }
            # DART company.json에서 가져올 수 있는 기본정보 저장
            if detail.get("ceo_nm"):
                payload["ceo_name"] = detail["ceo_nm"]
            if detail.get("adres"):
                payload["address"] = detail["adres"]
            if detail.get("phn_no"):
                payload["phone"] = detail["phn_no"]
            if detail.get("stock_code", "").strip():
                payload["stock_code"] = detail["stock_code"].strip()
            if detail.get("hm_url"):
                payload["website"] = detail["hm_url"]
            client.table("companies").update(payload).eq("id", row["id"]).execute()
            logger.info("corp_code_resolved",
                        corp_name=raw_name, corp_code=resolved_code, listed=is_listed)
            updated += 1
        else:
            logger.warning("corp_code_bizr_mismatch", corp_name=raw_name, candidates=candidates)
            client.table("companies").update(
                {"dart_fetched_at": datetime.now(KST).isoformat()}
            ).eq("id", row["id"]).execute()

    logger.info("corp_code_done", updated=updated, total=len(rows))
    return updated


# ── Step 1-B: 기본정보 백필 (corp_code 있지만 ceo_name 비어있는 기존 레코드) ──────

async def refresh_company_details(client: Client, api_key: str, company_ids: list[str]) -> int:
    """
    corp_code가 있지만 ceo_name이 NULL인 companies에 DART company.json으로 기본정보 채우기.
    resolve_corp_codes() 이전에 매핑된 레코드 백필용.
    """
    rows: list[dict] = []
    for i in range(0, len(company_ids), 200):
        chunk = company_ids[i:i + 200]
        rows += (
            client.table("companies")
            .select("id, corp_name, corp_code")
            .in_("id", chunk)
            .not_.is_("corp_code", "null")
            .filter("ceo_name", "is", "null")
            .execute()
            .data or []
        )
    if not rows:
        return 0

    logger.info("refresh_company_details_start", count=len(rows))
    updated = 0
    for row in rows:
        detail = await fetch_company(api_key, row["corp_code"])
        if not detail:
            continue
        payload: dict = {}
        if detail.get("ceo_nm"):
            payload["ceo_name"] = detail["ceo_nm"]
        if detail.get("adres"):
            payload["address"] = detail["adres"]
        if detail.get("phn_no"):
            payload["phone"] = detail["phn_no"]
        if detail.get("stock_code", "").strip():
            payload["stock_code"] = detail["stock_code"].strip()
        if detail.get("hm_url"):
            payload["website"] = detail["hm_url"]
        if payload:
            client.table("companies").update(payload).eq("id", row["id"]).execute()
            logger.info("company_detail_refreshed", corp_name=row["corp_name"])
            updated += 1

    logger.info("refresh_company_details_done", updated=updated)
    return updated


# ── Step 2: 공시 목록 수집 ────────────────────────────────────────────────────

async def collect_disclosures(
    client: Client, api_key: str, company_ids: list[str], years: int = 3
) -> int:
    rows: list[dict] = []
    for i in range(0, len(company_ids), 200):
        chunk = company_ids[i:i + 200]
        rows += (
            client.table("companies")
            .select("id, corp_name, corp_code")
            .in_("id", chunk)
            .not_.is_("corp_code", "null")
            .execute()
            .data or []
        )
    if not rows:
        return 0

    end_de = datetime.now(KST).strftime("%Y%m%d")
    bgn_de = (datetime.now(KST) - timedelta(days=365 * years)).strftime("%Y%m%d")

    inserted = 0
    for row in rows:
        corp_code = row["corp_code"]
        company_id = row["id"]
        items = await fetch_disclosures(api_key, corp_code, bgn_de, end_de)
        if not items:
            logger.info("disclosures_none", corp_name=row["corp_name"])
            continue

        payloads = [
            {
                "company_id": company_id,
                "rcept_no":   item["rcept_no"],
                "report_nm":  item["report_nm"],
                "rcept_dt":   item["rcept_dt"][:4] + "-" + item["rcept_dt"][4:6] + "-" + item["rcept_dt"][6:],
                "flr_nm":     item.get("flr_nm"),
                "rm":         item.get("rm"),
            }
            for item in items
        ]
        for i in range(0, len(payloads), 500):
            client.table("dart_disclosures").upsert(
                payloads[i:i+500], on_conflict="rcept_no"
            ).execute()
        inserted += len(payloads)
        logger.info("disclosures_done", corp_name=row["corp_name"], count=len(payloads))

    return inserted


# ── Step 3: 재무제표 수집 ─────────────────────────────────────────────────────

async def collect_financials(
    client: Client, api_key: str, company_ids: list[str], years: int = 3
) -> int:
    """
    재무 수치 수집 → dart_financials upsert.
    ① 모든 회사: fnlttSinglAcnt API 먼저 시도 (상장사 + 외감 비상장사 모두 가능)
    ② API 데이터 없으면: dart-fss 감사보고서 HTML 파싱 (유한회사 등)
    """
    from worker.dart.fetcher import fetch_financials as _fetch_fin
    from worker.dart.parser import parse_financial_api as _parse_fin

    cutoff = (datetime.now(KST) - timedelta(days=7)).isoformat()
    rows: list[dict] = []
    for i in range(0, len(company_ids), 200):
        chunk = company_ids[i:i + 200]
        rows += (
            client.table("companies")
            .select("id, corp_name, corp_code")
            .in_("id", chunk)
            .not_.is_("corp_code", "null")
            .or_(f"dart_fin_checked_at.is.null,dart_fin_checked_at.lt.{cutoff}")
            .execute()
            .data or []
        )
    if not rows:
        logger.info("financials_all_recent_skip", total_with_corp_code=len(company_ids))
        return 0

    logger.info("financials_checking", count=len(rows))
    inserted = 0
    current_year = datetime.now(KST).year

    for row in rows:
        corp_code = row["corp_code"]
        company_id = row["id"]

        financials_list: list[dict] = []

        # ① fnlttSinglAcnt API (상장사 + 외감 비상장사 모두 지원)
        for year in range(current_year - years, current_year):  # 당해년도 제외 (연간보고서 미공시)
            api_rows = await _fetch_fin(api_key, corp_code, year, fs_div="CFS")
            if not api_rows:
                api_rows = await _fetch_fin(api_key, corp_code, year, fs_div="OFS")
            if api_rows:
                fin = _parse_fin(api_rows)
                if fin:
                    fin["fiscal_year"] = year
                    fin["data_source"] = "finstate_api"
                    financials_list.append(fin)
                    logger.info("financials_api_ok",
                                corp_name=row["corp_name"], year=year)

        # ② API 결과 없으면 dart-fss 감사보고서 HTML 시도
        if not financials_list:
            financials_list = fetch_audit_financials(api_key, corp_code, years=years)

        # dart_fin_checked_at 갱신 (성공·실패 무관)
        client.table("companies").update(
            {"dart_fin_checked_at": datetime.now(KST).isoformat()}
        ).eq("id", company_id).execute()

        if not financials_list:
            logger.info("financials_no_data", corp_name=row["corp_name"])
            continue

        for fin in financials_list:
            client.table("dart_financials").upsert(
                {
                    "company_id":        company_id,
                    "fiscal_year":       fin["fiscal_year"],
                    "revenue":           fin.get("revenue"),
                    "operating_income":  fin.get("operating_income"),
                    "net_income":        fin.get("net_income"),
                    "total_assets":      fin.get("total_assets"),
                    "total_liabilities": fin.get("total_liabilities"),
                    "data_source":       fin.get("data_source", "audit_report_html"),
                },
                on_conflict="company_id,fiscal_year,data_source",
            ).execute()
            inserted += 1
            logger.info("financials_upserted",
                        corp_name=row["corp_name"],
                        year=fin["fiscal_year"],
                        keys=[k for k in fin if fin[k] is not None])

    logger.info("financials_done", inserted=inserted)
    return inserted


# ── 메인 ─────────────────────────────────────────────────────────────────────

async def run(target: str = "bcave", disc_years: int = 10, fin_years: int = 3, ids: list[str] | None = None) -> int:
    client = _supabase_client()
    api_key = os.environ["DART_API_KEY"]

    if ids:
        company_ids = ids
        logger.info("dart_target_ids", count=len(ids))
    elif target == "bcave":
        rows = (
            client.table("companies")
            .select("id")
            .eq("business_number", BCAVE_BUSINESS_NO)
            .execute()
            .data or []
        )
        if not rows:
            logger.error("bcave_not_found")
            return
        company_ids = [r["id"] for r in rows]
        logger.info("dart_target_bcave", ids=company_ids)
    else:
        rows = (
            client.table("companies")
            .select("id")
            .execute()
            .data or []
        )
        company_ids = [r["id"] for r in rows]
        logger.info("dart_target_all", count=len(company_ids))

    # 1. corp_code 조회
    await resolve_corp_codes(client, api_key, company_ids)

    # corp_code가 채워진 회사만 이후 단계
    resolved: list[dict] = []
    for i in range(0, len(company_ids), 200):
        chunk = company_ids[i:i + 200]
        resolved += (
            client.table("companies")
            .select("id")
            .in_("id", chunk)
            .not_.is_("corp_code", "null")
            .execute()
            .data or []
        )
    resolved_ids = [r["id"] for r in resolved]
    if not resolved_ids:
        logger.warning("no_corp_code_resolved")
        return

    # 1-B. 기존 매핑 회사 기본정보 백필 (ceo_name NULL인 레코드)
    await refresh_company_details(client, api_key, resolved_ids)

    # 2. 공시 수집
    disc_count = await collect_disclosures(client, api_key, resolved_ids, years=disc_years)
    logger.info("disclosures_total", count=disc_count)

    # 3. 재무 수집
    fin_count = await collect_financials(client, api_key, resolved_ids, years=fin_years)
    logger.info("financials_total", count=fin_count)

    return disc_count + fin_count


async def main(
    target: str = "bcave",
    disc_years: int = 10,
    fin_years: int = 3,
    ids: list[str] | None = None,
) -> None:
    from worker.utils.job_tracker import JobTracker
    client = _supabase_client()
    label = "DART 공시·재무 (B.CAVE)" if target == "bcave" else "DART 공시·재무 (전체)"
    tracker = JobTracker(client, script="dart_scraper", label=label)
    await tracker.start()
    try:
        rows_done = await run(target=target, disc_years=disc_years, fin_years=fin_years, ids=ids)
        await tracker.finish(rows_done=rows_done or 0)
    except Exception as e:
        await tracker.error(str(e))
        raise


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["bcave", "all"], default="bcave",
                        help="bcave=B.CAVE만, all=전체 companies")
    parser.add_argument("--disc-years", type=int, default=10, help="공시 수집 연도 수 (기본 10)")
    parser.add_argument("--fin-years",  type=int, default=3,  help="재무제표 수집 연도 수 (기본 3)")
    parser.add_argument("--ids", type=str, default="",
                        help="company UUID 콤마 구분 (예: uuid1,uuid2)")
    args = parser.parse_args()

    id_list = [i.strip() for i in args.ids.split(",") if i.strip()] if args.ids else None
    asyncio.run(main(target=args.target, disc_years=args.disc_years, fin_years=args.fin_years, ids=id_list))
