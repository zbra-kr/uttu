# Skill 04 — 무신사 랭킹 수집

> 랭킹 관련 모든 작업 전 이 파일을 읽어라.

---

## 핵심 설계 결정

```
period = DAILY (실시간 now 사용 금지 — 노이즈만 많고 실무 활용 불가)
sectionId = 199 (전체 랭킹 — 고정)
수집 횟수 = 1회/일 (01시)
```

---

## 수집 조합 — 189개

```python
# worker/scrapers/_ranking_config.py

SECTION_ID = 199  # 전체 랭킹 — 변경 금지

CATEGORY_CODES = {
    "전체":          "000",
    "상의":          "001",
    "아우터":        "002",
    "바지":          "003",
    "신발":          "004",
    "가방":          "005",
    "액세서리":      "006",
    "뷰티":          "010",
    "원피스/스커트": "020",
}

GENDER_FILTERS = ["A", "M", "F"]        # 전체/남성/여성
AGE_FILTERS    = ["A", "10", "20", "25", "30", "35", "40"]  # 7개

def build_combinations() -> list[tuple]:
    return [
        (cat_code, gf, age)
        for cat_code in CATEGORY_CODES.values()
        for gf      in GENDER_FILTERS
        for age     in AGE_FILTERS
    ]

RANKING_COMBINATIONS = build_combinations()
assert len(RANKING_COMBINATIONS) == 189  # 9 × 3 × 7
```

---

## API 호출 패턴

```python
import httpx
from loguru import logger

BASE_URL = "https://api.musinsa.com/api2/dp/v1/plp/ranking"

async def fetch_ranking(
    category_code: str,
    gender_filter: str,
    age_filter: str,
    section_id: int = 199,
    period: str = "DAILY",
    limit: int = 100,
) -> list[dict]:
    """단일 조합 랭킹 수집. 실패 시 빈 리스트 반환."""
    params = {
        "sectionId":      section_id,
        "period":         period,
        "categoryCode":   category_code,
        "gf":             gender_filter,
        "age":            age_filter,
        "includeSoldOut": "true",
        "page":           1,
        "limit":          limit,
    }
    headers = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(BASE_URL, params=params, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        # 응답 파싱 — 실제 JSON 구조 확인 후 수정
        items = data.get("data", {}).get("list", [])
        return [
            {
                "musinsa_no":    str(item["goodsNo"]),
                "rank_position": item["rank"],
                "list_price":    item.get("normalPrice"),
                "discount_rate": item.get("discountRate"),
                "category_code": category_code,
                "gender_filter": gender_filter,
                "age_filter":    age_filter,
            }
            for item in items
        ]

    except httpx.HTTPStatusError as e:
        if e.response.status_code in (403, 429):
            from worker.scrapers.base import BotBlockedError
            raise BotBlockedError(f"Blocked: {e.response.status_code}")
        logger.warning("ranking_fetch_failed",
                       category=category_code, gender=gender_filter,
                       age=age_filter, error=str(e))
        return []

    except Exception as e:
        logger.warning("ranking_fetch_error",
                       category=category_code, error=str(e))
        return []
```

---

## 전체 조합 순차 수집

```python
async def scrape_all_combinations(
    combinations: list[tuple],
    period: str = "DAILY",
    limit: int = 100,
) -> list[dict]:
    """
    189개 조합 순차 수집.
    예상 소요: 189 × 4초 ≈ 13분
    """
    import random, asyncio
    results = []

    for i, (cat, gf, age) in enumerate(combinations):
        try:
            items = await fetch_ranking(cat, gf, age, period=period, limit=limit)
            results.extend(items)
            logger.debug("combo_done",
                         idx=i+1, total=len(combinations),
                         category=cat, gender=gf, age=age,
                         count=len(items))

        except BotBlockedError:
            logger.error("bot_blocked_abort", category=cat, gender=gf, age=age)
            raise  # 즉시 중단

        except Exception as e:
            logger.warning("combo_failed", category=cat, error=str(e))
            continue  # 한 조합 실패해도 계속

        # rate limit sleep
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
    """
    # step1: musinsa_no → product_id
    musinsa_nos = list({r["musinsa_no"] for r in rows})
    id_map = get_product_id_map(client, musinsa_nos)

    # step2: 신규 상품 INSERT
    new_nos = [no for no in musinsa_nos if no not in id_map]
    if new_nos:
        _insert_new_products(client, new_nos)
        id_map.update(get_product_id_map(client, new_nos))

    # step3: ranking_snapshots upsert
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
            "age_filter":    row["age_filter"],
            "rank_position": row["rank_position"],
            "list_price":    row.get("list_price"),
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

## 나이대 파라미터 의미

| 값 | 의미 |
|---|---|
| A | 전체 |
| 10 | 19세 이하 |
| 20 | 20~24세 |
| 25 | 25~29세 |
| 30 | 30~34세 |
| 35 | 35~39세 |
| 40 | 40세 이상 |
