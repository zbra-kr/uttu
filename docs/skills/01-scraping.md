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
        # ⚠️ "robot"·"cloudflare" 제외 — 정상 HTML에 포함됨
        blocked_signals = ["captcha", "비정상적", "접근이 제한",
                           "just a moment", "enable javascript and cookies"]
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

### 브랜드 상세

```
httpx 직접 호출 (Playwright 불필요)
URL: https://www.musinsa.com/brand/{slug}
평균 소요: ~1초/브랜드

파싱 대상: HTML 내 __NEXT_DATA__.props.pageProps.meta

수집 필드:
  brandName, brandNameEng
  brandNation, brandNationName
  since (설립 연도)
  introduction (소개글)
  logoImageUrl, whiteLogoImageUrl
  serviceType (FLAGSHIP / BRAND_SHOP)
  flagshipType (TYPE_A / TYPE_B / TYPE_C)
  isUsed (중고거래 가능 여부)

수집 불가 (클라이언트 렌더링):
  팔로워 수, 상품 수, 누적 판매량
```

```python
import re, json, httpx
from loguru import logger

BRAND_PAGE_URL = "https://www.musinsa.com/brand/{slug}"
_NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
    re.DOTALL,
)

async def fetch_brand_detail(slug: str) -> dict | None:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            BRAND_PAGE_URL.format(slug=slug),
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                "Accept": "text/html",
            },
        )
        resp.raise_for_status()

    m = _NEXT_DATA_RE.search(resp.text)
    if not m:
        logger.warning("brand_next_data_not_found", slug=slug)
        return None

    page_props = json.loads(m.group(1)).get("props", {}).get("pageProps", {})
    if page_props.get("isBrandNotFound"):
        logger.warning("brand_not_found", slug=slug)
        return None

    meta = page_props.get("meta", {})
    return {
        "name":          meta.get("brandName", ""),
        "name_eng":      meta.get("brandNameEng"),
        "logo_url":      meta.get("logoImageUrl"),
        "white_logo_url": meta.get("whiteLogoImageUrl"),
        "nation_code":   meta.get("brandNation"),
        "nation_name":   meta.get("brandNationName"),
        "since_year":    meta.get("since"),
        "introduction":  meta.get("introduction"),
        "service_type":  meta.get("serviceType"),
        "flagship_type": meta.get("flagshipType"),
        "is_used":       meta.get("isUsed", False),
    }
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

### 스냅 랭킹 API (2026-05-21 확인)

```
GET https://content.musinsa.com/api2/content/snap/v1/snap-rankings

파라미터:
  filter={style}    ← 핵심. 스타일 필터 — ALL | CASUAL | STREET | MINIMAL | GIRLISH | ROMANTIC | CHIC
                      ⚠️ style= / styleType= / labelId= 등 다른 파라미터명 전부 무시됨. filter= 만 동작.
  gender={gender}   성별 — ALL | MEN | WOMEN
  period={period}   집계 기간 — DAILY | WEEKLY | MONTHLY
  page={n}          0-based 페이지 (서버가 pageSize=20 이상 무시 → 50개 수집 시 3 페이지 필요)
  pageSize=20       20 고정 (더 크게 줘도 20개만 반환)

응답 구조:
  data.content[]              ← 스냅 목록
    .snapId                   → snap_id (TEXT PK)
    .contentType              → USER_SNAP | BRAND_SNAP | CODISHOP_SNAP
    .medias[0].path           → thumbnail_url (없으면 .thumbnailUrl 폴백)
    .contentText              → content_text
    .likeCount / .viewCount / .scrapCount / .goodsClickCount / .commentCount / .clickCount
    .createdBy.gender         → model_gender (WOMEN | MEN | null)
    .createdBy.profilePhysical.height / .weight / .skinTone → model_height / model_weight / model_skin_tone
    .publishedAt              → published_at
    .hashTags[]               → hashtags (문자열 배열)
    .styleLabelIds[]          → style_label_ids (정수 배열)
    .rankingInfo.rank         → rank_position
    .rankingInfo.previousRank → prev_rank_position (null = NEW)
    .rankingInfo.highlight    → highlight (NEW | MOST_LIKED 등)

  data.totalElements          → 전체 수 (페이지 계산용)

수집 전략:
  SNAP_STYLE_FILTERS = ["ALL", "CASUAL", "STREET", "MINIMAL", "GIRLISH", "ROMANTIC", "CHIC"]
  GENDER_FILTERS = ["ALL", "MEN", "WOMEN"]  ← ALL만 수집, 성별 조합 현재 미사용
  PERIOD = "DAILY"
  목표: 스타일별 50개 → 7 styles × ceil(50/20) = 21 페이지
  하루 총: 7 × 50 = 350건 → snap_rankings 에 style_filter 컬럼으로 구분

upsert 키: snapshot_date, snap_id, style_filter, gender_filter, ranking_period
```

```python
SNAP_RANKING_BASE = "https://content.musinsa.com/api2/content/snap/v1/snap-rankings"
PAGE_SIZE = 20

async def _fetch_rankings_page(self, page: int, style: str = "ALL", gender: str = "ALL") -> dict:
    resp = await self._client.get(
        SNAP_RANKING_BASE,
        params={"filter": style, "gender": gender, "period": "DAILY",
                "page": page, "pageSize": PAGE_SIZE},
    )
    resp.raise_for_status()
    return resp.json()
```

---

### 스냅 프로필 랭킹 API (2026-05-21 확인)

```
GET https://content.musinsa.com/api2/content/snap/v1/profile-rankings/{profileType}/{period}

  profileType: USER | BRAND
               ⚠️ MEMBER → HTTP 404 "존재하지 않는 프로필 타입". 반드시 USER 사용.
  period:      DAILY

파라미터:
  page={n}        0-based
  pageSize=20     20 고정 (더 크게 줘도 무시)

응답 구조:
  data.content[]                  ← 프로필 목록
    .id                           → profile_id
    .profileType                  → USER | BRAND
    .nickname
    .bio
    .profileImageUrl
    .followerCount                → follower_count
    .rankingInfo.rank             → rank_position
    .rankingInfo.previousRank     → prev_rank_position (null = NEW)
    .rankingInfo.highlight        → highlight

    .snaps[]                      ← 각 프로필에 내장된 최근 스냅 (최대 10개)
      .snapId / .contentType / .medias / .publishedAt / 등
      .goods[].brand.brandId      → BRAND 프로필의 brand_code 추출 경로

  data.totalElements

수집 전략:
  PROFILE_TYPES = ["USER", "BRAND"]
  PROFILE_RANKING_MAX = 30 → 2 페이지 (20+10)
  embedded snaps: 프로필당 최대 10개 → snap_profile_snaps 에 저장 (추가 API 호출 없음)
  brand_code: snaps[0].goods[0].brand.brandId (BRAND 타입만)
  키/몸무게/팔로잉수/게시물수: /profiles/{id} 상세 API 필요 → 현재 미수집, DB 기본값 0/null

upsert 키:
  snap_profiles: id (TEXT PK, ON CONFLICT DO UPDATE)
  snap_profile_rankings: snapshot_date, profile_id, ranking_period
  snap_profile_snaps: snapshot_date, profile_id, snap_id
```

```python
PROFILE_RANKING_BASE = "https://content.musinsa.com/api2/content/snap/v1/profile-rankings"

async def _fetch_profile_rankings_page(self, profile_type: str, page: int, period: str = "DAILY") -> dict:
    resp = await self._client.get(
        f"{PROFILE_RANKING_BASE}/{profile_type}/{period}",
        params={"page": page, "pageSize": PAGE_SIZE},
    )
    resp.raise_for_status()
    return resp.json()
```

---

## 카테고리 코드

> 2026-05-19 ranking API TAB_OUTLINED 모듈에서 실측 확인. 구 코드(005/006/010/020 등) 오류.

| 코드 | 카테고리 |
|---|---|
| 000 | 전체 |
| 001 | 상의 |
| 002 | 아우터 |
| 003 | 바지 |
| 004 | 가방 |
| 017 | 스포츠/레저 |
| 026 | 속옷/홈웨어 |
| 100 | 원피스/스커트 |
| 101 | 소품 |
| 102 | 디지털/라이프 |
| 103 | 신발 |
| 104 | 뷰티 |
| 106 | 키즈 |

---

## 수집 조합 (ranking_snapshots)

```python
CATEGORY_CODES = ["000","001","002","003","004","017","026","100","101","102","103","104","106"]
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
# 13 × 3 × 7 = 273 조합 (gf × ageBand 모두 서버에서 실제 다른 결과 반환 확인)
# 273 × ~102건 = 27,846건/일
# 예상 소요: 273 × 4초 ≈ 18분
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
