# Skill 04 — 무신사 랭킹 수집

> 랭킹 관련 모든 작업 전 이 파일을 읽어라.
> 2026-05-19 API 완전 변경 확인 — 구 api.musinsa.com 폐기, 신 client.musinsa.com 사용

---

## ⚠️ API 변경 이력 (2026-05-19 확인)

| 항목 | 구 API (폐기) | 신 API |
|---|---|---|
| 엔드포인트 | `api.musinsa.com/api2/dp/v1/plp/ranking` | `client.musinsa.com/api/home/web/v5/pans/ranking/sections/{sectionId}` |
| HTTP 상태 | **400 (완전 폐기)** | 200 OK |
| age 필터 | `age=10/20/25/30/35/40/A` | **완전 제거** — 어떤 값을 넣어도 "전체 연령대", 결과 동일 |
| 결과 수 | `limit=100` 파라미터 | ~102 고정 (limit 파라미터 없음) |
| 상품 ID 필드 | `goodsNo` | `item.id` |
| 정상가 필드 | `normalPrice` | `ga4.payload.original_price` (이벤트 로그 내) |
| rank 필드 | `list[].rank` | `item.image.rank` |

**조합 변경: 189개 → 27개** (9 카테고리 × 3 성별 × age 필터 없음)
- 예상 소요: 27 × 4초 ≈ **2분** (구 API: 13분)

---

## 핵심 설계 결정

```
sectionId  = 199     전체 스타일 통합 랭킹 (고정)
storeCode  = musinsa (필수)
contentsId = ""      (빈 문자열 필수)
period     = DAILY   → API 응답에 "최근 1일" 필터로 표시됨 (확인)
```

---

## 수집 조합 — 27개

```python
# worker/scrapers/_ranking_config.py

SECTION_ID = 199      # 전체 스타일 통합 — 변경 금지
STORE_CODE = "musinsa"

CATEGORY_CODES = {
    "전체":          "000",
    "상의":          "001",
    "아우터":        "002",
    "바지":          "003",
    "신발":          "004",  # 실제 코드 첫 수집 시 검증 필요
    "가방":          "005",
    "액세서리":      "006",
    "뷰티":          "010",
    "원피스/스커트": "020",
}

GENDER_FILTERS = ["A", "M", "F"]   # 전체/남성/여성

# age 필터 2026-05-19 기준 API에서 완전 제거됨 — "A"만 사용
# DB 스키마의 age_filter 컬럼은 항상 "A"로 적재
AGE_FILTERS = ["A"]

def build_combinations() -> list[tuple]:
    return [
        (cat_code, gf, "A")   # age는 항상 "A"
        for cat_code in CATEGORY_CODES.values()
        for gf      in GENDER_FILTERS
    ]

RANKING_COMBINATIONS = build_combinations()
assert len(RANKING_COMBINATIONS) == 27  # 9 × 3 (이전: 9 × 3 × 7 = 189)
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
    section_id: int = 199,
    period: str = "DAILY",
) -> list[dict]:
    """
    단일 조합 랭킹 수집.
    age 필터는 API에서 제거됨 — 파라미터 불필요.
    실패 시 빈 리스트 반환.
    """
    url = BASE_URL.format(section_id=section_id)
    params = {
        "storeCode":    "musinsa",
        "categoryCode": category_code,
        "contentsId":   "",          # 빈 문자열 필수
        "period":       period,
        "gf":           gender_filter,
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

        # 응답 파싱 — MULTICOLUMN 모듈에서 상품 수집
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

            result.append({
                "musinsa_no":    str(product_id),
                "rank_position": int(rank),
                "list_price":    _to_int(ga4_payload.get("original_price")),
                "final_price":   _to_int(info.get("finalPrice")),
                "discount_rate": _to_decimal(info.get("discountRatio")),
                "category_code": category_code,
                "gender_filter": gender_filter,
                "age_filter":    "A",   # API에서 제거됨 — 항상 "A"
                "brand_name":    info.get("brandName"),
            })

        return result

    except httpx.HTTPStatusError as e:
        if e.response.status_code in (403, 429):
            from worker.scrapers.base import BotBlockedError
            raise BotBlockedError(f"Blocked: {e.response.status_code}")
        logger.warning("ranking_fetch_failed",
                       category=category_code, gender=gender_filter,
                       error=str(e))
        return []

    except Exception as e:
        logger.warning("ranking_fetch_error",
                       category=category_code, error=str(e))
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
    27개 조합 순차 수집.
    예상 소요: 27 × 4초 ≈ 2분 (이전 189조합 × 4초 ≈ 13분)
    """
    import random, asyncio
    results = []

    for i, (cat, gf, age) in enumerate(combinations):
        try:
            items = await fetch_ranking(cat, gf, period=period)
            results.extend(items)
            logger.debug("combo_done",
                         idx=i+1, total=len(combinations),
                         category=cat, gender=gf,
                         count=len(items))

        except BotBlockedError:
            logger.error("bot_blocked_abort", category=cat, gender=gf)
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
    """
    1. musinsa_no → product_id 변환 (없으면 products에 신규 INSERT)
    2. ranking_snapshots upsert
    age_filter 는 항상 "A" (API에서 제거됨)
    """
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
            "category_code": row["category_code"],
            "gender_filter": row["gender_filter"],
            "age_filter":    "A",   # 항상 "A"
            "rank_position": row["rank_position"],
            "list_price":    row.get("list_price"),
            "final_price":   row.get("final_price"),
            "discount_rate": row.get("discount_rate"),
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
# 랭킹 수집 — 매일 01시 (전일 DAILY 집계 완료 후)
0 1 * * * /Users/macmini/projects/uttu/scripts/run_ranking.sh
```

---

## 나이대 파라미터 상태 (2026-05-19 기준)

```
❌ age 파라미터 완전 제거됨
   - age=10/20/25/30/35/40 어떤 값을 넣어도 동일한 결과 반환
   - applied_filter_group_1 에 항상 "연령별:전체 연령대" 표시
   - DB 스키마의 age_filter 컬럼은 유지 (API 복구 시 확장 가능)
   
✅ gender 필터 (gf=A/M/F) 정상 동작 확인
✅ period=DAILY 정상 동작 확인 ("최근 1일" 표시)
```

---

## 응답 구조 요약

```
GET client.musinsa.com/api/home/web/v5/pans/ranking/sections/199
  ?storeCode=musinsa&categoryCode=001&contentsId=&period=DAILY&gf=M

Response:
  data.modules[]                 # 모듈 배열
    .type == "MULTICOLUMN"       # 랭킹 상품 모듈
    .items[]                     # 상품 목록 (~102개)
      .id                        # 무신사 상품번호 (string)
      .image.rank                # 순위 (1~N)
      .info.brandName            # 브랜드명
      .info.productName          # 상품명
      .info.finalPrice           # 최종가 (할인 적용)
      .info.discountRatio        # 할인율 (%)
      .image.onClickLike
        .eventLog.ga4.payload
          .original_price        # 정상가
          .gender_filter         # A/M/F (확인용)
```
