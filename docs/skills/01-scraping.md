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
  ageBand={band}          연령대 — 파라미터명 변경됨 (구: age=10/20/25/30/35/40/A)
                          AGE_BAND_ALL / AGE_BAND_MINOR / AGE_BAND_20 /
                          AGE_BAND_25 / AGE_BAND_30 / AGE_BAND_35 / AGE_BAND_40

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
2단계 수집:

1단계 — httpx (기본 정보, ~1초/상품, Playwright 불필요)
  URL: https://www.musinsa.com/products/{musinsa_no}
  HTML 내 window.__MSS__.product.state JSON 파싱

  수집 필드:
    goodsNm, goodsNmEng, styleNo, thumbnailImageUrl
    category (depth1~depth3, baseCategoryFullPath)
    sex[], sexCode → gender (2→M, 4→F, 6→U)
    seasonYear, season
    goodsMaterial.materials[] → fit/texture/elasticity/transparency/thickness/seasons
    isMusinsaMonopoly, isOnlineMonopoly, isFirst, isClearance, isOutlet,
    isLimitedQuantity, isDrop, isAdult, isParallelImport, isFreeReturn
    labels[].code
    goodsReview.totalCount, goodsReview.satisfactionScore
    rankingRecord.rankingRecordsTop[]

2단계 — Playwright (색상·사이즈, ~18초/상품, 자사 상품 위주 실행)
  intercept: goods-detail.musinsa.com/api2/goods/{no}/options
  colors: data.basic[displayType=="COLOR_CHIP"].optionValues[].name
  sizes:  data.basic[displayType=="SIZE"].optionValues[].name
  ※ 색상/사이즈 없는 상품(가방 등) → 빈 배열 [] (에러 아님)
```

#### httpx 파싱 패턴

```python
import re, json, httpx
from loguru import logger

PRODUCT_PAGE_URL = "https://www.musinsa.com/products/{musinsa_no}"
_STATE_RE = re.compile(
    r'window\.__MSS__\.product\.state\s*=\s*(\{.*?\});\s*\n', re.DOTALL
)

async def fetch_product_detail(musinsa_no: str) -> dict | None:
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "text/html",
        "Referer": "https://www.musinsa.com/",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            PRODUCT_PAGE_URL.format(musinsa_no=musinsa_no), headers=headers
        )
        resp.raise_for_status()

    m = _STATE_RE.search(resp.text)
    if not m:
        logger.warning("product_state_not_found", musinsa_no=musinsa_no)
        return None

    state = json.loads(m.group(1))
    return _parse_state(state)


def _parse_state(s: dict) -> dict:
    cat = s.get("category", {})
    price = s.get("goodsPrice", {})
    review = s.get("goodsReview", {})

    sex_code = s.get("sexCode", 0)
    gender = {2: "M", 4: "F", 6: "U"}.get(sex_code, "U")

    materials = {
        m["name"]: next((i["name"] for i in m["items"] if i["isSelected"]), None)
        for m in s.get("goodsMaterial", {}).get("materials", [])
    }
    season_material = materials.pop("계절", None)
    # 계절은 복수 선택 → 선택된 것만 배열로
    seasons_list = [
        i["name"]
        for m in s.get("goodsMaterial", {}).get("materials", [])
        if m["name"] == "계절"
        for i in m["items"] if i["isSelected"]
    ]

    return {
        "name":          s.get("goodsNm", ""),
        "name_eng":      s.get("goodsNmEng"),
        "style_no":      s.get("styleNo"),
        "thumbnail_url": s.get("thumbnailImageUrl"),

        "category_code":    cat.get("categoryDepth1Code", "000"),
        "category_d2_code": cat.get("categoryDepth2Code") or None,
        "category_d2_name": cat.get("categoryDepth2Name") or None,
        "category_d3_code": cat.get("categoryDepth3Code") or None,
        "category_d3_name": cat.get("categoryDepth3Name") or None,
        "category_path":    s.get("baseCategoryFullPath"),

        "gender":       gender,
        "season_year":  s.get("seasonYear") or None,
        "season_code":  str(s.get("season")) if s.get("season") else None,

        "fit":          materials.get("핏"),
        "texture":      materials.get("촉감"),
        "elasticity":   materials.get("신축성"),
        "transparency": materials.get("비침"),
        "thickness":    materials.get("두께"),
        "item_seasons": seasons_list,

        "is_musinsa_monopoly": s.get("isMusinsaMonopoly", False),
        "is_online_monopoly":  s.get("isOnlineMonopoly", False),
        "is_first":            s.get("isFirst", False),
        "is_clearance":        s.get("isClearance", False),
        "is_outlet":           s.get("isOutlet", False),
        "is_limited_quantity": s.get("isLimitedQuantity", False),
        "is_drop":             s.get("isDrop", False),
        "is_adult":            s.get("isAdult", False),
        "is_parallel_import":  s.get("isParallelImport", False),
        "is_free_return":      s.get("isFreeReturn", False),

        "labels":        [lb["code"] for lb in s.get("labels", [])],
        "review_count":  review.get("totalCount", 0),
        "satisfaction_score": review.get("satisfactionScore") or None,

        "ranking_best_records": s.get("rankingRecord", {}).get("rankingRecordsTop", []),
    }
```

#### Playwright 옵션 파싱 패턴 (색상·사이즈)

```python
async def fetch_product_options(musinsa_no: str, page) -> dict:
    """
    Playwright page 객체 전달. BaseScraper._with_retry 래핑 권장.
    colors, sizes 반환.
    """
    captured = {}

    async def handle_response(response):
        url = response.url
        if f"/api2/goods/{musinsa_no}/options" in url:
            try:
                captured["options"] = await response.json()
            except Exception:
                pass

    page.on("response", handle_response)
    await page.goto(f"https://www.musinsa.com/products/{musinsa_no}")
    await page.wait_for_load_state("networkidle", timeout=30000)

    colors, sizes = [], []
    opts_data = captured.get("options", {}).get("data", {})
    for group in opts_data.get("basic", []):
        if group.get("displayType") == "COLOR_CHIP":
            colors = [v["name"] for v in group.get("optionValues", [])]
        elif group.get("displayType") == "SIZE":
            sizes = [v["name"] for v in group.get("optionValues", [])]

    return {"colors": colors, "sizes": sizes}
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
AGE_BANDS = [
    "AGE_BAND_ALL", "AGE_BAND_MINOR", "AGE_BAND_20",
    "AGE_BAND_25",  "AGE_BAND_30",    "AGE_BAND_35", "AGE_BAND_40",
]
# 구 파라미터 age=A/10/20/25/30/35/40 → 신 파라미터 ageBand=AGE_BAND_ALL/MINOR/20/...

COMBINATIONS = [
    (cat, gf, age_band)
    for cat      in CATEGORY_CODES
    for gf       in GENDER_FILTERS
    for age_band in AGE_BANDS
]
# 9 × 3 × 7 = 189 조합 (gf × ageBand 모두 서버에서 실제 다른 결과 반환 확인)
# 189 × ~102건 = 19,278건/일
# 예상 소요: 189 × 4초 ≈ 13분
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
