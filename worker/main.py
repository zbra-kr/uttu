"""
UTTU Worker 진입점 (main.py)

사용법:
  python -m worker.main --mode funding --company-id <uuid> [--dry-run]
  python -m worker.main --mode funding-poll [--limit N]
"""
from __future__ import annotations

import argparse
import asyncio
import sys

from dotenv import load_dotenv
from loguru import logger

load_dotenv()


def _configure_logger() -> None:
    logger.remove()
    logger.add(sys.stderr, level="DEBUG", format="{time:HH:mm:ss} | {level:<7} | {message}")


# ── 모드별 실행 ──────────────────────────────────────────────────────────────────

async def _run_funding(company_id: str, dry_run: bool) -> int:
    from worker.funding.orchestrator import run_job
    result = await run_job(company_id=company_id, dry_run=dry_run)
    logger.info("funding_result", **result)
    return 0 if "error" not in result else 1


async def _run_funding_poll(limit: int) -> int:
    from worker.funding.orchestrator import poll_pending
    processed = await poll_pending(limit=limit)
    logger.info("funding_poll_done", processed=processed)
    return 0


# ── CLI ──────────────────────────────────────────────────────────────────────────

def main() -> None:
    _configure_logger()

    parser = argparse.ArgumentParser(description="UTTU Worker")
    parser.add_argument(
        "--mode",
        required=True,
        choices=["funding", "funding-poll"],
        help="실행 모드",
    )
    parser.add_argument(
        "--company-id",
        default=None,
        help="[funding 모드] 수집 대상 companies.id (UUID)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="[funding 모드] DB 적재 없이 결과만 출력",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=1,
        help="[funding-poll 모드] 한 번에 처리할 최대 잡 수 (기본 1)",
    )
    args = parser.parse_args()

    if args.mode == "funding":
        if not args.company_id:
            parser.error("--mode funding 은 --company-id 가 필요합니다.")
        rc = asyncio.run(_run_funding(args.company_id, args.dry_run))
    elif args.mode == "funding-poll":
        rc = asyncio.run(_run_funding_poll(args.limit))
    else:
        parser.error(f"알 수 없는 모드: {args.mode}")
        rc = 1

    sys.exit(rc)


if __name__ == "__main__":
    main()
