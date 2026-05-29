"""BaseScraper — 모든 스크래퍼의 공통 기반.

규칙:
  - semaphore = 1 (동시 요청 절대 금지)
  - MIN_DELAY_SEC >= 3.0 (절대 낮추지 마)
  - BotBlockedError 발생 시 즉시 raise, retry 금지
"""
import asyncio
import random

from loguru import logger

SCRAPE_MIN_DELAY_SEC = 3.0
DELAY_JITTER = 2.0
MAX_RETRIES = 3


class BotBlockedError(Exception):
    """무신사 봇 차단 감지 시 raise. 호출자가 즉시 중단 처리."""


class BaseScraper:
    MIN_DELAY_SEC = SCRAPE_MIN_DELAY_SEC
    DELAY_JITTER = DELAY_JITTER
    MAX_RETRIES = MAX_RETRIES

    # 동시 요청 금지 — 항상 1
    _semaphore = asyncio.Semaphore(1)

    # 무신사 봇 차단 감지 신호
    # "robot"/"cloudflare" 단독 제외 — 정상 페이지에도 포함됨 (meta robots, CDN 참조)
    # 실제 차단: captcha 직접 노출, 비정상 접근 메시지, cf challenge 페이지
    _BLOCK_SIGNALS = ["captcha", "비정상적", "접근이 제한", "just a moment", "enable javascript and cookies"]

    # JSON API 호출용 (XHR/fetch 요청처럼 보이게)
    DEFAULT_HEADERS = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Referer": "https://www.musinsa.com/",
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
    }

    # HTML 페이지 직접 탐색용 (navigate 요청처럼 보이게)
    PAGE_HEADERS = {
        **DEFAULT_HEADERS,
        "Accept": (
            "text/html,application/xhtml+xml,application/xml;"
            "q=0.9,image/avif,image/webp,image/apng,*/*;"
            "q=0.8,application/signed-exchange;v=b3;q=0.7"
        ),
        "Cache-Control": "max-age=0",
        "Upgrade-Insecure-Requests": "1",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "same-origin",
        "sec-fetch-user": "?1",
    }

    async def _sleep(self) -> None:
        """요청 사이 랜덤 딜레이 (MIN_DELAY_SEC ~ MIN_DELAY_SEC + DELAY_JITTER)."""
        delay = random.uniform(self.MIN_DELAY_SEC, self.MIN_DELAY_SEC + self.DELAY_JITTER)
        logger.debug("rate_limit_sleep", delay_sec=round(delay, 2))
        await asyncio.sleep(delay)

    def _check_bot_blocked(self, response_text: str) -> None:
        """응답 텍스트에서 봇 차단 신호 감지 → BotBlockedError raise."""
        lower = response_text.lower()
        for signal in self._BLOCK_SIGNALS:
            if signal in lower:
                raise BotBlockedError(f"Bot blocked detected: signal='{signal}'")

    async def _with_retry(self, coro_factory, *, label: str = "request"):
        """
        최대 MAX_RETRIES 회 재시도 (지수 백오프).
        BotBlockedError는 즉시 재raise — retry 금지.
        """
        last_exc: Exception | None = None
        for attempt in range(1, self.MAX_RETRIES + 1):
            try:
                async with self._semaphore:
                    return await coro_factory()
            except BotBlockedError:
                raise  # 즉시 중단, retry 금지
            except Exception as exc:
                last_exc = exc
                wait = max(self.MIN_DELAY_SEC, 2 ** attempt)
                logger.warning(
                    "retry",
                    label=label,
                    attempt=attempt,
                    max=self.MAX_RETRIES,
                    wait_sec=wait,
                    error=str(exc),
                )
                if attempt < self.MAX_RETRIES:
                    await asyncio.sleep(wait)

        raise RuntimeError(f"{label} failed after {self.MAX_RETRIES} retries") from last_exc
