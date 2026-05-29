# 추천판 수집 — 스킬 파일 08

## 개요

무신사 추천판(`/main/musinsa/recommend`)의 큐레이션 모듈과 노출 상품을 매일 스냅샷으로 수집한다.
매일 내용이 교체되므로 당일 수집하지 않으면 데이터가 사라진다.

---

## API

| 항목 | 값 |
|---|---|
| 초기 로드 | `api.musinsa.com/api2/hm/web/v9/pans/recommend?storeCode=musinsa&gf={A\|M\|F}` |
| 상품 lazy-load | 동일 URL + `&size=10&index={N}&scenarioIndex={S}&page=1` |
| 버전 | **v9** (세일판 v3, 랭킹 v5와 다름) |
| 인증 | 불필요 |
| 렌더링 | JavaScript SPA — httpx 불가, **Playwright 인터셉트 필수** |

### 왜 Playwright인가

CAROUSEL 모듈은 스크롤에 의한 lazy-load로 삽입된다. httpx로 `scenarioIndex` 파라미터를 직접 호출하면 로그인 세션 없이는 모든 scenarioIndex에서 동일한 기본 모듈만 반환된다. Playwright로 실제 브라우저를 구동하고 응답을 인터셉트해야 전체 모듈을 얻을 수 있다.

---

## 응답 구조

### 초기 응답 모듈 (수집 제외)
| 타입 | 내용 |
|---|---|
| `BANNER_MAIN` | 메인 배너 슬라이드 (캠페인 이미지) |
| `QUICKMENU_HIGHLIGHT` | 카테고리 빠른 메뉴 (고정값) |

### lazy-load 모듈 (수집 대상)
| 타입 | 내용 |
|---|---|
| `CAROUSEL_TWOROW` | 일반 카테고리 트렌드 큐레이션 |
| `CAROUSEL_TWOROW_DYNAMIC_TAB` | 브랜드 탭 필터 포함 큐레이션 |

### 상품 아이템 필드
```
item.id                                        → musinsa_no
item.info.brandName                            → brand_name
item.info.productName                          → product_name
item.info.finalPrice                           → final_price
item.info.discountRatio                        → discount_rate
item.info.isSoldOut                            → is_sold_out
item.onClick.eventLog.ga4.payload.original_price  → list_price (원가)
item.onClick.eventLog.amplitude.payload.reviewCount → review_count
item.onClick.eventLog.amplitude.payload.reviewScore → review_score
```

---

## 테이블 구조

### `recommend_modules`
| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | UUID PK | |
| `snapshot_date` | DATE | 수집 날짜 |
| `gender_filter` | TEXT | A / M / F |
| `module_key` | TEXT | API id 원본 (uuid는 매일 바뀜) |
| `module_type` | TEXT | CAROUSEL_TWOROW / CAROUSEL_TWOROW_DYNAMIC_TAB |
| `title` | TEXT | 에디토리얼 테마 제목 (트렌드 분석 핵심) |
| `position` | SMALLINT | 페이지 내 등장 순서 (0-based) |
| `brand_tabs` | TEXT[] | DYNAMIC_TAB 모듈의 브랜드 탭 목록 |
| `items_count` | SMALLINT | 수집된 상품 수 |

UNIQUE: `(snapshot_date, gender_filter, module_key)`

> **날짜 간 동일 모듈 추적**: `module_key`의 UUID는 매일 갱신되므로 `title` 컬럼으로 연속성을 추적한다.

### `recommend_items`
| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | UUID PK | |
| `module_id` | UUID FK | → recommend_modules ON DELETE CASCADE |
| `snapshot_date` | DATE | 비정규화 (JOIN 없이 필터링용) |
| `gender_filter` | TEXT | 비정규화 |
| `musinsa_no` | TEXT | 상품번호 |
| `product_id` | UUID nullable FK | → products (stub 매칭 후 채워짐) |
| `brand_name` | TEXT | |
| `product_name` | TEXT | |
| `list_price` | INTEGER | 정가 (원가) |
| `final_price` | INTEGER | 실제 판매가 |
| `discount_rate` | SMALLINT | 할인율 % |
| `review_count` | INTEGER | |
| `review_score` | SMALLINT | 100점 만점 |
| `is_sold_out` | BOOLEAN | |
| `position` | SMALLINT | 모듈 내 노출 순서 (0-based) |

UNIQUE: `(module_id, musinsa_no)`

---

## 스크래퍼

**파일**: `worker/scrapers/musinsa_recommend.py`

**클래스**: `RecommendScraper`

**수집 흐름**:
```
성별 A → M → F 순으로 반복:
  1. Playwright 브라우저 실행 (headless)
  2. /main/musinsa/recommend?gf={gender} 로드
  3. on_response 핸들러로 recommend API 응답 인터셉트
  4. SCROLL_STEPS(15)회 × SCROLL_PX(700px) 스크롤 → lazy-load 전부 트리거
  5. 수집된 CAROUSEL 모듈 index 순으로 정렬
  6. products 테이블에 stub 삽입 (없는 상품번호)
  7. recommend_modules upsert (on_conflict: snapshot_date,gender_filter,module_key)
  8. recommend_items upsert (on_conflict: module_id,musinsa_no)
  9. _sleep() 후 다음 성별
```

**스크롤 설정**:
```python
SCROLL_STEPS   = 15    # 페이지 하단까지 커버
SCROLL_PX      = 700   # 회당 픽셀
SCROLL_WAIT_MS = 1_400 # lazy-load 대기
```

---

## 실행

```bash
# 직접 실행
cd ~/projects/uttu
worker/.venv/bin/python3 -m worker.scrapers.musinsa_recommend

# 스크립트
bash scripts/run_recommend.sh
```

**cron 등록** (정호철 직접 등록):
```
0 3 * * * /Users/macmini/projects/uttu/scripts/run_recommend.sh
```

---

## 주요 쿼리 예시

### 오늘 추천 모듈 목록 (전체 성별)
```sql
SELECT position, title, module_type, array_length(brand_tabs, 1) AS tab_count, items_count
FROM recommend_modules
WHERE snapshot_date = CURRENT_DATE AND gender_filter = 'A'
ORDER BY position;
```

### 특정 브랜드가 며칠째 추천판에 노출됐는지
```sql
SELECT snapshot_date, count(*) AS modules
FROM recommend_items
WHERE brand_name = '커버낫' AND gender_filter = 'A'
GROUP BY snapshot_date
ORDER BY snapshot_date DESC;
```

### 추천판 채널 전환율 (랭킹 브랜드와 교집합)
```sql
WITH rec_brands AS (
  SELECT DISTINCT brand_name
  FROM recommend_items
  WHERE snapshot_date = CURRENT_DATE AND gender_filter = 'A'
),
rank_brands AS (
  SELECT DISTINCT brand_name
  FROM ranking_snapshots
  WHERE snapshot_date = CURRENT_DATE
    AND category_code = '000' AND gender_filter = 'A'
)
SELECT
  COUNT(*) FILTER (WHERE rb.brand_name IS NOT NULL) AS matched,
  COUNT(*) AS total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE rb.brand_name IS NOT NULL) / NULLIF(COUNT(*), 0)) AS rate_pct
FROM rec_brands r
LEFT JOIN rank_brands rb USING (brand_name);
```

### 오늘 추천판 × 자사 브랜드 노출 확인
```sql
SELECT rm.title, ri.brand_name, ri.product_name, ri.final_price, ri.discount_rate, ri.position
FROM recommend_items ri
JOIN recommend_modules rm ON rm.id = ri.module_id
JOIN products p ON p.id = ri.product_id
WHERE ri.snapshot_date = CURRENT_DATE
  AND ri.gender_filter = 'A'
  AND p.is_own = true
ORDER BY rm.position, ri.position;
```

---

## 주의사항

```
❌ scenarioIndex를 파라미터로 순회하지 마라
   → 로그인 세션 없이는 모든 값에서 동일 기본 모듈 반환
   → Playwright 인터셉트 방식만 신뢰할 수 있음

❌ httpx로 직접 API 호출 금지 (이 스크래퍼 한정)
   → lazy-load SPA 특성상 초기 응답에 CAROUSEL 없음

✅ 스크롤 횟수(SCROLL_STEPS) 줄이지 마라
   → 15회 미만이면 하단 모듈 누락 가능

✅ 성별 간 _sleep() 필수
   → Playwright 세션을 성별마다 새로 열어도 봇 감지 가능
```

---

## 관련 파일

| 파일 | 설명 |
|---|---|
| `supabase/migrations/01200_recommend.sql` | 테이블 DDL |
| `worker/scrapers/musinsa_recommend.py` | 스크래퍼 본체 |
| `scripts/run_recommend.sh` | 실행 스크립트 |
| `docs/skills/05-reviews.md` | 유사 패턴 참고 |
| `docs/skills/02-supabase.md` | DB 패턴 참고 |
