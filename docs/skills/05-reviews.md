# Skill 05 — 리뷰 수집 (자사 브랜드 전용)

> 리뷰 관련 모든 작업 전 이 파일을 읽어라.

---

## 수집 대상

```
자사 브랜드만: CO(커버낫) · LE(리) · WA(와키윌리)
경쟁사 리뷰 수집 금지
```

---

## 수집 규칙 (개인정보보호법)

```
✅ 수집 가능:
  - rating (별점 1~5) — 전체 별점 수집 (저점·고점 필터 없음)
  - review_text (본문 내용)
  - review_date (날짜)
  - helpful_count (도움됐어요 수)
  - musinsa_review_id (고유 ID — 중복 방지 키)
  - has_image (이미지 첨부 여부)
  - image_urls (Musinsa CDN URL 배열 — 하자/불량 증거 사진)

❌ 수집 금지:
  - 닉네임 (개인정보)
  - 사용자 ID (개인정보)
  - 프로필 이미지 (개인정보)
```

## API 수집 방법

```
⚠️ goods-detail.musinsa.com/api2/goods/{id}/reviews — 세션 쿠키 없이 400 반환
→ Playwright 필수 (옵션 수집과 동일 패턴, XHR intercept)
```

---

## 증분 수집 패턴 (핵심)

```
최초 실행: 상품별 전체 리뷰 수집 (페이지 순회)
이후 실행: 마지막 수집 날짜 이후 신규 리뷰만 수집

중복 방지: musinsa_review_id UNIQUE 제약으로 자동 처리
```

```python
async def scrape_reviews_for_product(
    musinsa_no: str,
    since_date: str | None = None,  # None이면 전체 수집
    max_pages: int = 100,
) -> list[dict]:
    """
    자사 상품 리뷰 수집.
    since_date: "2026-05-01" 형식. None이면 최초 전체 수집.
    """
    results = []

    for page in range(1, max_pages + 1):
        items = await _fetch_review_page(musinsa_no, page)
        if not items:
            break  # 마지막 페이지

        for item in items:
            review_date = item.get("review_date")

            # 증분: 수집 기준일보다 오래된 리뷰면 중단
            if since_date and review_date and review_date < since_date:
                return results  # 정렬 가정: 최신순

            image_urls = item.get("image_urls", []) or []
            results.append({
                "musinsa_review_id": str(item["review_id"]),
                "rating":            item["rating"],
                "review_text":       item.get("content", ""),
                "review_date":       review_date,
                "helpful_count":     item.get("helpful_count", 0),
                "has_image":         len(image_urls) > 0,
                "image_urls":        image_urls,
                # 닉네임·사용자ID 절대 포함 금지
            })

        await asyncio.sleep(random.uniform(2.0, 4.0))

    return results
```

---

## 증분 관리 패턴

```python
def get_last_review_date(client, product_id: str) -> str | None:
    """해당 상품의 마지막 수집 리뷰 날짜 조회"""
    result = client.table("reviews") \
        .select("review_date") \
        .eq("product_id", product_id) \
        .order("review_date", desc=True) \
        .limit(1) \
        .execute()

    if result.data:
        return result.data[0]["review_date"]
    return None  # 수집 이력 없음 → 전체 수집


def upsert_reviews(client, reviews: list[dict], product_id: str) -> int:
    """
    reviews upsert.
    musinsa_review_id UNIQUE → 중복 자동 처리 (INSERT OR IGNORE).
    """
    if not reviews:
        return 0

    rows = [{"product_id": product_id, **r} for r in reviews]

    result = client.table("reviews").upsert(
        rows,
        on_conflict="musinsa_review_id",
        ignore_duplicates=True  # 중복이면 UPDATE 안 하고 skip
    ).execute()

    return len(result.data or [])
```

---

## 전체 자사 상품 수집 흐름

```python
async def run_review_collection():
    """자사 브랜드 전체 상품 리뷰 수집"""
    client = get_supabase_client()

    # 자사 상품 전체 조회
    result = client.table("products") \
        .select("id, musinsa_no") \
        .eq("is_own", True) \
        .execute()

    own_products = result.data or []
    logger.info("review_collection_start", total=len(own_products))

    for prod in own_products:
        product_id  = prod["id"]
        musinsa_no  = prod["musinsa_no"]
        since_date  = get_last_review_date(client, product_id)

        reviews = await scrape_reviews_for_product(
            musinsa_no, since_date=since_date
        )

        if reviews:
            count = upsert_reviews(client, reviews, product_id)
            logger.info("reviews_saved",
                        musinsa_no=musinsa_no,
                        new=count,
                        since=since_date or "all")

        await asyncio.sleep(random.uniform(3.0, 5.0))
```

---

## LLM 분석 연계 (review_analysis)

```python
async def analyze_reviews(client, product_id: str, model: str = "gemma4:e4b"):
    """
    상품별 전체 리뷰 LLM 분석.
    - 저점(1~2점) → 문제점 추출
    - 고점(4~5점) → 강점 추출
    - 전체 → 한줄 요약
    결과 → review_analysis 테이블 upsert (매일 갱신)
    """
    low = client.table("reviews") \
        .select("review_text, rating") \
        .eq("product_id", product_id) \
        .lte("rating", 2) \
        .order("review_date", desc=True) \
        .limit(200) \
        .execute()

    high = client.table("reviews") \
        .select("review_text, rating") \
        .eq("product_id", product_id) \
        .gte("rating", 4) \
        .order("review_date", desc=True) \
        .limit(200) \
        .execute()

    low_texts  = [r["review_text"] for r in (low.data  or []) if r["review_text"]]
    high_texts = [r["review_text"] for r in (high.data or []) if r["review_text"]]

    if not low_texts and not high_texts:
        return

    issues    = await _llm_extract_issues(low_texts, model)
    strengths = await _llm_extract_strengths(high_texts, model)
    summary   = await _llm_summarize(low_texts + high_texts, model)

    from datetime import date
    client.table("review_analysis").upsert({
        "product_id":             product_id,
        "analysis_date":          date.today().isoformat(),
        "summary_text":           summary,
        "low_rating_issues":      issues,
        "high_rating_strengths":  strengths,
        "total_reviewed":         len(low_texts) + len(high_texts),
        "low_count":              len(low_texts),
        "high_count":             len(high_texts),
        "model_used":             model,
    }, on_conflict="product_id,analysis_date").execute()
```

---

## Cron 등록 (정호철 직접 등록)

```bash
# 리뷰 수집 — 매일 02시 (증분, 기존 musinsa_review_id 중복 자동 스킵)
0 2 * * * /Users/macmini/projects/uttu/scripts/run_review.sh

# LLM 분석 — 매일 04시 (리뷰 수집 완료 후)
0 4 * * * /Users/macmini/projects/uttu/scripts/run_review_analysis.sh
```
