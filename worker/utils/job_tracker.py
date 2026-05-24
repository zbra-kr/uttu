"""
JobTracker: collection_jobs 테이블에 작업 상태를 기록하는 유틸리티.

사용 예:
    tracker = JobTracker(client, script="musinsa_ranking", label="상품 랭킹", target=273)
    await tracker.start()
    try:
        total = await scraper.run()
        await tracker.finish(rows_done=total or 0)
    except Exception as e:
        await tracker.error(str(e))
        raise
"""

from __future__ import annotations

import os
from datetime import datetime
from typing import Optional

import pytz
from loguru import logger
from supabase import Client, create_client

KST = pytz.timezone("Asia/Seoul")


def _supabase_client() -> Client:
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], service_key)


class JobTracker:
    """
    수집 작업의 시작·진행·완료·오류 상태를 collection_jobs 테이블에 기록.
    메서드는 async로 선언되어 있으나 내부적으로 동기 .execute() 호출을 사용한다
    (Supabase Python 클라이언트가 동기 방식이므로).
    """

    def __init__(
        self,
        client: Client,
        script: str,
        label: str,
        target: Optional[int] = None,
    ) -> None:
        self.client = client
        self.script = script
        self.label = label
        self.target = target
        self.job_id: Optional[int] = None

    async def start(self) -> None:
        """collection_jobs에 새 행 삽입 후 job_id 저장."""
        try:
            result = (
                self.client.table("collection_jobs")
                .insert({
                    "script": self.script,
                    "label": self.label,
                    "status": "running",
                    "rows_done": 0,
                    "target": self.target,
                    "started_at": datetime.now(KST).isoformat(),
                })
                .execute()
            )
            if result.data:
                self.job_id = result.data[0]["id"]
                logger.debug("job_tracker_start", script=self.script, job_id=self.job_id)
        except Exception as e:
            logger.warning("job_tracker_start_failed", script=self.script, error=str(e))

    async def progress(self, rows_done: int) -> None:
        """진행 행 수 업데이트. job_id가 없으면 무시."""
        if self.job_id is None:
            return
        try:
            self.client.table("collection_jobs").update({
                "rows_done": rows_done,
            }).eq("id", self.job_id).execute()
        except Exception as e:
            logger.debug("job_tracker_progress_failed", job_id=self.job_id, error=str(e))

    async def finish(self, rows_done: int) -> None:
        """작업 완료 표시."""
        if self.job_id is None:
            return
        try:
            self.client.table("collection_jobs").update({
                "status": "done",
                "rows_done": rows_done,
                "finished_at": datetime.now(KST).isoformat(),
            }).eq("id", self.job_id).execute()
            logger.debug("job_tracker_finish", script=self.script, job_id=self.job_id, rows_done=rows_done)
        except Exception as e:
            logger.warning("job_tracker_finish_failed", job_id=self.job_id, error=str(e))

    async def error(self, msg: str) -> None:
        """오류 발생 표시."""
        if self.job_id is None:
            return
        try:
            self.client.table("collection_jobs").update({
                "status": "error",
                "error_msg": msg[:500],
                "finished_at": datetime.now(KST).isoformat(),
            }).eq("id", self.job_id).execute()
            logger.warning("job_tracker_error", script=self.script, job_id=self.job_id, msg=msg[:200])
        except Exception as e:
            logger.warning("job_tracker_error_failed", job_id=self.job_id, error=str(e))
