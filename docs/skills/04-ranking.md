# Skill 04 — 무신사 랭킹 수집

> 랭킹 관련 모든 작업 전 이 파일을 읽어라.
> 2026-05-19 API 엔드포인트 변경 확인 — 구 api.musinsa.com 폐기, 신 client.musinsa.com 사용

---

## ⚠️ API 변경 이력 (2026-05-19 확인)

| 항목 | 구 API (폐기) | 신 API |
|---|---|---|
| 엔드포인트 | `api.musinsa.com/api2/dp/v1/plp/ranking` | `client.musinsa.com/api/home/web/v5/pans/ranking/sections/{sectionId}` |
| HTTP 상태 | **400 (완전 폐기)** | 200 OK |
| gender 파라미터명 | `gf=A/M/F` | `gf=A/M/F` (동일) |
| age 파라미터명 | `age=10/20/25/30/35/40/A` | `ageBand=AGE_BAND_MINOR/AGE_BAND_20/.../AGE_BAND_ALL` |
| 추가 필수 파라미터 | 없음 | `storeCode=musinsa`, `contentsId=` (빈 문자열) |
| 결과 수 | `limit=100` 파라미터 | 102 고정 (limit 파라미터 없음) |
| 상품 ID 필드 | `goodsNo` | `item.id` |
| 정상가 필드 | `normalPrice` | `ga4.payload.original_price` |
| 최종가 필드 | `salePrice` | `item.info.finalPrice` |
| rank 필드 위치 | `list[].rank` | `item.image.rank` |

**조합 수 유지: 189개** (9 카테고리 × 3 성별 × 7 ageBand)
- gf × ageBand 모든 조합 서버에서 실제로 다른 결과 반환 확인 (2026-05-19)

---

## 핵심 설계 결정

```
sectionId  = 199     전체 스타일 통합 랭킹 (고정)
storeCode  = musinsa (필수)
contentsId = ""      (빈 문자열 필수)
period     = DAILY   → "최근 1일" 필터 (확인)
```

---

## ageBand 파라미터 매핑

| ageBand 값 | 의미 | 구 API age 값 |
|---|---|---|
| `AGE_BAND_ALL` | 전체 연령대 | `A` |
| `AGE_BAND_MINOR` | 19세 이하 | `10` |
| `AGE_BAND_20` | 20~24세 | `20` |
| `AGE_BAND_25` | 25~29세 | `25` |
| `AGE_BAND_30` | 30~34세 | `30` |
| `AGE_BAND_35` | 35~39세 | `35` |
| `AGE_BAND_40` | 40세 이상 | `40` |

---

## 수집 조합 — 189개

```python
# worker/scrapers/_ranking_config.py

SECTION_ID = 199
STORE_CODE = "musinsa"

CATEGORY_CODES = {
    "전체":          "000",
    "상의":          "001",
    "아우터":        "002",
    "바지":          "003",
    "가방":          "004",
    "스포츠/레저":   "017",
    "속옷/홈웨어":   "026",
    "원피스/스커트": "100",
    "소품":          "101",
    "디지털/라이프": "102",
    "신발":          "103",
    "뷰티":          "104",
    "키즈":          "106",
}
# 2026-05-19 ranking API TAB_OUTLINED 실측. 구 코드(004=신발, 005=가방 등) 전부 오류였음.

GENDER_FILTERS = ["A", "M", "F"]

AGE_BANDS = [
    "AGE_BAND_ALL",
    "AGE_BAND_MINOR",
    "AGE_BAND_20",
    "AGE_BAND_25",
    "AGE_BAND_30",
    "AGE_BAND_35",
    "AGE_BAND_40",
]

def build_combinations() -> list[tuple]:
    return [
        (cat_code, gf, age_band)
        for cat_code in CATEGORY_CODES.values()
        for gf       in GENDER_FILTERS
        for age_band in AGE_BANDS
    ]

RANKING_COMBINATIONS = build_combinations()
assert len(RANKING_COMBINATIONS) == 273  # 13 × 3 × 7
```

---

## API 호출 패턴 (신 API)

```python
import httpx
from loguru import logger

BASE_URL = "https://client.musinsa.com/api/home/web/v5/pans/ranking/sections/{section_id}"

async def fetch_ranking(
    category_code: str,
    gender_filter: str,
    age_band: str,
    section_id: int = 199,
    period: str = "DAILY",
) -> list[dict]:
    """단일 조합 랭킹 수집. 실패 시 빈 리스트 반환."""
    url = BASE_URL.format(section_id=section_id)
    params = {
        "storeCode":    "musinsa",
        "categoryCode": category_code,
        "contentsId":   "",
        "period":       period,
        "gf":           gender_filter,
        "ageBand":      age_band,
    }
    headers = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Referer": "https://www.musinsa.com/main/musinsa/ranking",
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, params=params, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        modules = data.get("data", {}).get("modules", [])
        items = []
        for module in modules:
            if module.get("type") == "MULTICOLUMN":
                items.extend(module.get("items", []))

        result = []
        for item in items:
            product_id = item.get("id")
            rank = item.get("image", {}).get("rank")
            if not product_id or not rank:
                continue

            info = item.get("info", {})
            ga4_payload = (
                item.get("image", {})
                    .get("onClickLike", {})
                    .get("eventLog", {})
                    .get("ga4", {})
                    .get("payload", {})
            )

            amp_payload = (
                item.get("image", {})
                    .get("onClickLike", {})
                    .get("eventLog", {})
                    .get("amplitude", {})
                    .get("payload", {})
            )

            result.append({
                "musinsa_no":    str(product_id),
                "rank_position": int(rank),
                "category_code": category_code,
                "gender_filter": gender_filter,
                "age_filter":    age_band,
                "product_name":  amp_payload.get("product_name"),
                "brand_slug":    amp_payload.get("brand_id"),
                "brand_name":    info.get("brandName"),
                "list_price":    _to_int(ga4_payload.get("original_price")),
                "final_price":   _to_int(info.get("finalPrice")),
                "discount_rate": _to_decimal(info.get("discountRatio")),
                "is_sold_out":   info.get("isSoldOut", False),
                "review_count":  _to_int(amp_payload.get("reviewCount")),
                "review_score":  _to_int(amp_payload.get("reviewScore")),
            })

        return result

    except httpx.HTTPStatusError as e:
        if e.response.status_code in (403, 429):
            from worker.scrapers.base import BotBlockedError
            raise BotBlockedError(f"Blocked: {e.response.status_code}")
        logger.warning("ranking_fetch_failed",
                       category=category_code, gender=gender_filter,
                       age_band=age_band, error=str(e))
        return []

    except Exception as e:
        logger.warning("ranking_fetch_error", category=category_code, error=str(e))
        return []


def _to_int(value) -> int | None:
    try:
        return int(value) if value is not None else None
    except (ValueError, TypeError):
        return None


def _to_decimal(value) -> float | None:
    try:
        return float(value) if value is not None else None
    except (ValueError, TypeError):
        return None
```

---

## 전체 조합 순차 수집

```python
async def scrape_all_combinations(
    combinations: list[tuple],
    period: str = "DAILY",
) -> list[dict]:
    """
    273개 조합 순차 수집.
    예상 소요: 189 × 4초 ≈ 13분
    """
    import random, asyncio
    results = []

    for i, (cat, gf, age_band) in enumerate(combinations):
        try:
            items = await fetch_ranking(cat, gf, age_band, period=period)
            results.extend(items)
            logger.debug("combo_done",
                         idx=i+1, total=len(combinations),
                         category=cat, gender=gf, age_band=age_band,
                         count=len(items))

        except BotBlockedError:
            logger.error("bot_blocked_abort",
                         category=cat, gender=gf, age_band=age_band)
            raise  # 즉시 중단

        except Exception as e:
            logger.warning("combo_failed", category=cat, error=str(e))
            continue

        await asyncio.sleep(random.uniform(3.0, 5.0))

    logger.info("all_combos_done", total=len(results), combos=len(combinations))
    return results
```

---

## DB 적재 패턴

```python
def upsert_ranking_snapshots(client, rows: list[dict], snapshot_date: str) -> int:
    """age_filter = ageBand 값 그대로 저장 (AGE_BAND_20 등)"""
    musinsa_nos = list({r["musinsa_no"] for r in rows})
    id_map = get_product_id_map(client, musinsa_nos)

    new_nos = [no for no in musinsa_nos if no not in id_map]
    if new_nos:
        _insert_new_products(client, new_nos)
        id_map.update(get_product_id_map(client, new_nos))

    mapped = []
    for row in rows:
        pid = id_map.get(row["musinsa_no"])
        if not pid:
            continue
        mapped.append({
            "product_id":    pid,
            "snapshot_date": snapshot_date,
            "store_code":    row.get("store_code", "musinsa"),
            "category_code": row["category_code"],
            "gender_filter": row["gender_filter"],
            "age_filter":    row["age_filter"],
            "rank_position": row["rank_position"],
            "musinsa_no":    row["musinsa_no"],
            "product_name":  row.get("product_name"),
            "brand_slug":    row.get("brand_slug"),
            "brand_name":    row.get("brand_name"),
            "list_price":    row.get("list_price"),
            "final_price":   row.get("final_price"),
            "discount_rate": row.get("discount_rate"),
            "is_sold_out":   row.get("is_sold_out", False),
            "review_count":  row.get("review_count"),
            "review_score":  row.get("review_score"),
        })

    total = 0
    for i in range(0, len(mapped), 500):
        batch = mapped[i:i+500]
        client.table("ranking_snapshots").upsert(
            batch,
            on_conflict="product_id,snapshot_date,category_code,gender_filter,age_filter"
        ).execute()
        total += len(batch)

    return total
```

---

## Cron 등록 (정호철 직접 등록)

```bash
# 상품 랭킹 수집 — 매일 01시
0 1 * * * /Users/macmini/projects/uttu/scripts/run_ranking.sh

# 브랜드 랭킹 수집 — 매일 01시 30분
30 1 * * * /Users/macmini/projects/uttu/scripts/run_brand_ranking.sh
```

---

## 응답 구조 요약 — 상품 랭킹

```
GET client.musinsa.com/api/home/web/v5/pans/ranking/sections/199
  ?storeCode=musinsa&categoryCode=001&contentsId=&period=DAILY&gf=M&ageBand=AGE_BAND_20

Response:
  data.modules[]                 # 모듈 배열
    .type == "MULTICOLUMN"       # 랭킹 상품 모듈
    .items[]                     # ~102건
      .id                        # 무신사 상품번호 (string)
      .image.rank                # 순위 (1~N)
      .info.brandName
      .info.productName
      .info.finalPrice           # 최종가 (할인 적용)
      .info.discountRatio        # 할인율 (%)
      .image.onClickLike
        .eventLog.ga4.payload
          .original_price        # 정상가
          .gender_filter         # A/M/F (확인용)
          .applied_filter_group_1 # 성별:XX|연령별:XX|주기별:XX (확인용)
```

---

## 브랜드 랭킹 API (2026-05-19 확인)

### 엔드포인트

```
GET https://client.musinsa.com/api/home/web/v5/pans/ranking/sections/1054
파라미터: storeCode=musinsa, categoryCode, contentsId="", period=DAILY, gf, ageBand
조합: 상품 랭킹과 동일 — 189조합 (9×3×7)
```

### 응답 구조

```
data.modules[]                         # 200개 RANKING_BRAND 모듈 (브랜드 1개 = 1 모듈)
  .type == "RANKING_BRAND"
  .title
    .rank                              # 브랜드 순위 ("1"~"200", string)
    .title.text                        # 브랜드 한글명
    .imageUrl                          # 브랜드 로고 URL
    .fluctuation.type                  # UP / DOWN / NONE
    .fluctuation.amount                # 순위 변동폭 (NONE이면 없음)
    .labels[]                          # 레이블 (단독, 한정 등)
    .onClick.url                       # https://www.musinsa.com/brand/{slug}
    .onClick.apiUrl                    # 브랜드 상품 목록 API
    .onClick.eventLog.ga4.payload
      .brand_id                        # slug (영문 brand_id) → brands.slug
  .items[]                             # 해당 브랜드 상품 (1위 브랜드만 반환, 나머지 빈 배열)
```

### DB 적재 패턴

```python
def upsert_brand_ranking_snapshots(client, modules: list[dict], snapshot_date: str,
                                    category_code: str, gender_filter: str,
                                    age_filter: str) -> int:
    rows = []
    for module in modules:
        if module.get('type') != 'RANKING_BRAND':
            continue
        title = module.get('title', {})
        rank = title.get('rank')
        if not rank:
            continue
        ga4 = title.get('onClick', {}).get('eventLog', {}).get('ga4', {}).get('payload', {})
        brand_slug = ga4.get('brand_id', '')
        rows.append({
            'musinsa_brand_slug': brand_slug,
            'brand_name':        title.get('title', {}).get('text', ''),
            'brand_image_url':   title.get('imageUrl'),
            'snapshot_date':     snapshot_date,
            'category_code':     category_code,
            'gender_filter':     gender_filter,
            'age_filter':        age_filter,
            'rank_position':     int(rank),
        })

    for i in range(0, len(rows), 500):
        client.table('brand_ranking_snapshots').upsert(
            rows[i:i+500],
            on_conflict='musinsa_brand_slug,snapshot_date,category_code,gender_filter,age_filter'
        ).execute()
    return len(rows)
```
