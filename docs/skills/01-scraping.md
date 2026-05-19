# Skill 01 — 스크래핑 (BaseScraper · 무신사 API)

> 모든 스크래퍼 작업 전 이 파일을 읽어라.

---

## BaseScraper 패턴

```python
# worker/scrapers/base.py

SCRAPE_MIN_DELAY_SEC = 3.0   # 절대 낮추지 마
DELAY_JITTER        = 2.0
MAX_RETRIES         = 3

class BotBlockedError(Exception):
    """무신사 봇 차단 감지 시 raise. 호출자가 즉시 중단 처리."""
    pass

class BaseScraper:
    MIN_DELAY_SEC = SCRAPE_MIN_DELAY_SEC
    DELAY_JITTER  = DELAY_JITTER
    MAX_RETRIES   = MAX_RETRIES

    async def _sleep(self):
        """요청 사이 랜덤 딜레이"""
        import random, asyncio
        await asyncio.sleep(random.uniform(self.MIN_DELAY_SEC,
                                           self.MIN_DELAY_SEC + self.DELAY_JITTER))

    def _check_bot_blocked(self, response_text: str):
        """봇 차단 감지 — 감지 시 BotBlockedError raise"""
        blocked_signals = ["captcha", "robot", "비정상적", "접근이 제한"]
        if any(s in response_text.lower() for s in blocked_signals):
            raise BotBlockedError(f"Bot blocked detected")
```

**원칙**:
- 동시성 1 (`semaphore = 1`) — 절대 병렬 요청 금지
- retry 3회, 지수 백오프
- BotBlockedError 발생 시 상위에서 즉시 중단 (retry 금지)

---

## 무신사 API — 확인된 URL 목록

### 랭킹 API (2026-05-19 API 변경 확인)

```
⚠️ 구 API (api.musinsa.com/api2/dp/v1/plp/ranking) 완전 폐기 — HTTP 400

신 API:
GET https://client.musinsa.com/api/home/web/v5/pans/ranking/sections/{sectionId}

파라미터:
  sectionId=199           전체 스타일 통합 랭킹 (고정)
  storeCode=musinsa       필수
  categoryCode={code}     카테고리 코드
  contentsId=             빈 문자열 필수
  period=DAILY            일별 집계 → "최근 1일" 필터 적용됨
  gf={gender}             성별 (A=전체, M=남성, F=여성) — 동작 확인
  ❌ age 파라미터 제거됨 — 2026-05-19 기준 어떤 값도 효과 없음

응답에서 상품 파싱:
  data.modules[type=="MULTICOLUMN"].items[]
    .id          → 무신사 상품번호
    .image.rank  → 순위
    .info.finalPrice          → 최종가
    .info.discountRatio       → 할인율
    .image.onClickLike.eventLog.ga4.payload.original_price → 정상가

※ Playwright 불필요 — httpx 직접 호출
※ 결과 수: ~102 고정 (limit 파라미터 없음)
```

### 프로모션 API

```
GET https://api.musinsa.com/api2/hm/web/v3/pans/sale/modules

※ httpx 직접 호출 (Playwright 불필요)
※ 약 214건/회 반환
```

### 상품 상세

```
Playwright + 응답 인터셉트 방식
URL: https://www.musinsa.com/products/{musinsa_no}
평균 소요: 18초/상품

capture 패턴:
  - goods-detail.musinsa.com/api2/goods/{no}/detail
  - goods-detail.musinsa.com/api2/goods/{no}/options

색상 파싱:
  options API → data.basic[displayType=="COLOR_CHIP"].optionValues[].name
  색상 없는 상품(가방 등) → 빈 리스트 [] (에러 아님)
```

### 리뷰

```
※ 자사 브랜드 상품만 수집
URL: https://www.musinsa.com/products/{musinsa_no}/reviews (또는 API)

수집 대상:
  rating (1~5)
  review_text (본문)
  review_date
  helpful_count
  musinsa_review_id (UNIQUE KEY — 중복 방지)

수집 금지:
  닉네임 (개인정보)
  사용자 ID (개인정보)
```

---

## 카테고리 코드

| 코드 | 카테고리 |
|---|---|
| 000 | 전체 |
| 001 | 상의 |
| 002 | 아우터 |
| 003 | 바지 |
| 004 | 신발 |
| 005 | 가방 |
| 006 | 액세서리 |
| 010 | 뷰티 |
| 020 | 원피스/스커트 |

※ 실제 코드는 첫 수집 시 API 응답으로 검증할 것

---

## 수집 조합 (ranking_snapshots)

```python
CATEGORY_CODES = ["000","001","002","003","004","005","006","010","020"]
GENDER_FILTERS = ["A", "M", "F"]
AGE_FILTERS    = ["A", "10", "20", "25", "30", "35", "40"]

COMBINATIONS = [
    (cat, gf, "A")      # age는 항상 "A" (API에서 age 필터 제거됨)
    for cat in CATEGORY_CODES
    for gf  in GENDER_FILTERS
]
# 9 × 3 = 27 조합 (이전: 9 × 3 × 7 = 189)
# 27 × ~102건 = 2,754건/일
# 예상 소요: 27 × 4초 ≈ 2분 (이전 13분)
```

---

## 스크래퍼별 실행 스크립트 패턴

```bash
#!/bin/bash
# scripts/run_ranking.sh
set -euo pipefail
LOG_DIR="/Users/macmini/projects/uttu/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/ranking_$(date +%Y%m%d).log"

echo "=== start: $(date '+%Y-%m-%d %H:%M:%S KST') ===" >> "$LOG"
cd /Users/macmini/projects/uttu
worker/.venv/bin/python3 -m worker.main --mode ranking >> "$LOG" 2>&1
echo "=== done: $(date '+%Y-%m-%d %H:%M:%S KST') ===" >> "$LOG"
```

---

## 주의사항

- 봇 차단 감지 신호: HTTP 403, "captcha", "비정상적 접근"
- 차단 시 즉시 중단 — 같은 IP로 retry 하면 차단 심화
- User-Agent 명시 필수 (브라우저 UA 사용)
- 세션 쿠키 관리 (Playwright 컨텍스트 재사용 권장)
