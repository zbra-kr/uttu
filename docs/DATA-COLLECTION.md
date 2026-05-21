# UTTU 데이터 수집 전체 구조

## 개요

3개 외부 소스 → 17개 테이블 → Supabase (ogtrvberttzupxrffpoh, ap-northeast-2)

| 소스 | 구현 상태 | 테이블 수 |
|---|---|---|
| 무신사 API (httpx) — 경쟁사 데이터 | ✅ 완료 | 11개 |
| 무신사 API (httpx) — 자사 브랜드 상품 전수 | ✅ 완료 | products (is_own=true) |
| 자사 ERP (Snowflake) | ❌ 미구현 | 2개 |
| DART OpenAPI | ✅ 완료 (이름 매칭 실패 912개는 수동 등록 필요) | 2개 |
| 무신사 리뷰 (httpx) | ✅ 수집 완료 (LLM 분석 미구현) | 2개 |

### 자사 브랜드 슬러그 & 상품 수 (2026-05-20 기준)

| 브랜드명 | slug | ERP코드 | 상품 수 |
|---|---|---|---|
| 커버낫 | covernat | CO | 2,627개 |
| 커버낫 우먼 | covernatwoman | CO | 1,369개 |
| 커버낫 키즈 | covernatkids | CO | 620개 |
| 커버낫 뷰티 | covernatbeauty | CO | 6개 |
| 와키윌리 | wackywilly | WA | 1,839개 |
| 리 | lee | LE | 2,008개 |
| 리 키즈 | leekids | LE | 802개 |
| **합계** | | | **9,271개** |

---

## 수집 파이프라인 전체 흐름

```
[자사 브랜드 PLP API] →  products (is_own=True, ~9,271개)  ← run_own_products.sh
[무신사 랭킹 API]     →  ranking_snapshots
[무신사 랭킹 API]     →  brands (slug/name/logo 자동 등록)
[무신사 브랜드 API] →  brand_ranking_snapshots
[무신사 세일 API]   →  promotions → promotion_items
[무신사 스냅 API]   →  snaps → snap_products
[무신사 매거진 API] →  magazine_articles → magazine_article_products
        ↓ (위 4개 스크래퍼가 신규 musinsa_no 발견 시)
    products (stub: name="(stub)", detail_fetched_at=NULL)
        ↓ (run_product.sh — 매일 03:00)
[무신사 상품 페이지] →  products (상세 채움) + companies (법인 정보)
        ↓ (companies.business_number 생성 후)
[DART API]          →  dart_disclosures + dart_financials  ← 미구현
        ↓
[Snowflake ERP]     →  own_sales_daily + own_inventory     ← 미구현
[무신사 리뷰]       →  reviews → review_analysis (Ollama)  ← 미구현
```

---

## 테이블별 수집 상세

### 1. companies — 법인 마스터

| 항목 | 내용 |
|---|---|
| 스크래퍼 | `worker/scrapers/musinsa_product.py` |
| API | `www.musinsa.com/products/{musinsa_no}` (HTML) |
| 파싱 | `window.__MSS__.product.state.company` |
| 수집 필드 | corp_name, business_number, ceo_name, address, phone, email, mail_order_no |
| 수집 조건 | 상품 상세 수집 시 company 블록이 있으면 자동 upsert |
| upsert 기준 | business_number (있으면) / corp_name (없으면) |
| 미수집 필드 | corp_code, stock_code, is_listed — DART API로 채움 (미구현) |
| 스크립트 | `scripts/run_product.sh` |
| 권장 주기 | 매일 03:00 |

---

### 2. brands — 브랜드 마스터

| 항목 | 내용 |
|---|---|
| 스크래퍼 | `worker/scrapers/musinsa_brand_ranking.py` |
| API | `client.musinsa.com/api/home/web/v5/pans/ranking/sections/1054` |
| 파싱 | RANKING_BRAND 모듈 → `title.onClick.eventLog.ga4.payload.brand_id` (slug) |
| 수집 필드 | slug, name, logo_url |
| 수집 조건 | 브랜드 랭킹 수집 시 신규 slug 자동 upsert (`ignore_duplicates=True`) |
| upsert 기준 | slug |
| 미수집 필드 | name_eng, nation_code, since_year, introduction 등 — 브랜드 상세 페이지 별도 수집 필요 (미구현) |
| 스크립트 | `scripts/run_brand_ranking.sh` |
| 권장 주기 | 매일 01:30 |

---

### 3. products — 상품 마스터

2단계로 수집됩니다.

**1단계: stub 삽입** (아래 4개 스크래퍼가 신규 musinsa_no 발견 시 자동 생성)

| 스크래퍼 | 신규 상품 발견 경로 |
|---|---|
| musinsa_ranking.py | 랭킹에 등장한 상품 |
| musinsa_brand_ranking.py | — (상품 아닌 브랜드 수집) |
| musinsa_event.py | 프로모션 세일 탭 상품 |
| musinsa_snap.py | 스냅에 태그된 상품 |
| musinsa_magazine.py | 매거진 기사 연관 상품 |

stub 형태: `{musinsa_no, name:"(stub)", is_own:false, detail_fetched_at:NULL}`

**2단계: 상세 채움** (`detail_fetched_at IS NULL` 인 stub 순차 처리)

| 항목 | 내용 |
|---|---|
| 스크래퍼 | `worker/scrapers/musinsa_product.py` |
| API | `www.musinsa.com/products/{musinsa_no}` (HTML 페이지) |
| 파싱 | `window.__MSS__.product.state` JSON |
| 수집 필드 | name, category, gender, season, fit/texture/elasticity/transparency/thickness, 각종 플래그(monopoly/outlet/drop 등), review_count, satisfaction_score, ranking_best_records |
| 1회 처리 수 | 50개 (기본값, `--limit` 파라미터로 변경 가능) |
| 소요 시간 | ~1~2초/상품 |
| 스크립트 | `scripts/run_product.sh` |
| 권장 주기 | 매일 04:00 (랭킹 수집 후) |

**일간 루틴 모드 (`--today-ranking`)** (2026-05-22 결정)

111,119개 보류 상품 전체 수집 대신, 오늘 랭킹 TOP50 이내 미수집 상품만 수집하는 방식으로 운영.

```bash
worker/.venv/bin/python3 -m worker.scrapers.musinsa_product --today-ranking --ranking-top-n 50
```

- `ranking_snapshots`에서 오늘 날짜 + `rank_position ≤ 50` 상품 목록 추출
- 그 중 `detail_fetched_at IS NULL`인 상품만 처리
- 보류 111k개는 건드리지 않음

---

### 4. ranking_snapshots — 상품 랭킹 스냅샷

| 항목 | 내용 |
|---|---|
| 스크래퍼 | `worker/scrapers/musinsa_ranking.py` |
| API | `client.musinsa.com/api/home/web/v5/pans/ranking/sections/199` |
| 파라미터 | storeCode=musinsa, categoryCode, gf, ageBand, period=DAILY |
| 수집 조합 | 13 카테고리 × 3 성별(A/M/F) × 7 연령대 = **273 조합** |
| 카테고리 | 000(전체)/001(상의)/002(하의)/003(아우터)/004(신발)/017(모자)/026(양말·속옷)/100(가방)/101(지갑)/102(벨트)/103(주얼리)/104(시계)/106(안경) |
| 연령대 | AGE_BAND_ALL/MINOR/20/25/30/35/40 |
| 수집 필드 | rank_position, musinsa_no, product_name, brand_slug, brand_name, list_price, final_price, discount_rate, is_sold_out, review_count, review_score |
| upsert 기준 | product_id + snapshot_date + store_code + category_code + gender_filter + age_filter |
| 예상 행수 | ~27,300행/일 (273조합 × 100개) |
| 소요 시간 | ~20분 |
| 스크립트 | `scripts/run_ranking.sh` |
| 권장 주기 | 매일 01:00 |

---

### 5. brand_ranking_snapshots — 브랜드 랭킹 스냅샷

| 항목 | 내용 |
|---|---|
| 스크래퍼 | `worker/scrapers/musinsa_brand_ranking.py` |
| API | `client.musinsa.com/api/home/web/v5/pans/ranking/sections/1054` |
| 파라미터 | 상품 랭킹과 동일 (273 조합) |
| 수집 필드 | musinsa_brand_slug, brand_name, brand_image_url, rank_position |
| upsert 기준 | musinsa_brand_slug + snapshot_date + category_code + gender_filter + age_filter |
| 예상 행수 | ~54,600행/일 (273조합 × 200브랜드) |
| 소요 시간 | ~20분 |
| 스크립트 | `scripts/run_brand_ranking.sh` |
| 권장 주기 | 매일 01:30 |

---

### 6. promotions — 프로모션 모듈

| 항목 | 내용 |
|---|---|
| 스크래퍼 | `worker/scrapers/musinsa_event.py` |
| API | `api.musinsa.com/api2/hm/web/v3/pans/sale/modules?storeCode=musinsa` |
| 수집 필드 | musinsa_event_id, title, promotion_type, items_count, end_at |
| promotion_type 분류 | ONEROW→limited_offer(선착순특가) / TWOROW→daily_sale(하루특가) / BRAND→brand_week |
| upsert 기준 | musinsa_event_id |
| 스크립트 | `scripts/run_event.sh` |
| 권장 주기 | 매일 02:00 |

---

### 7. promotion_items — 프로모션 개별 상품

| 항목 | 내용 |
|---|---|
| 스크래퍼 | `worker/scrapers/musinsa_event.py` (promotions와 동시 수집) |
| API | promotions와 동일 API의 `modules[].items[]` |
| 수집 필드 | promotion_id, musinsa_no, brand_slug, brand_name, product_name, rank_in_module, final_price, list_price, discount_rate, is_sold_out, review_count, review_score |
| 선착순 전용 필드 | limited_total, limited_remaining, limited_status (ONEROW 모듈만) |
| upsert 기준 | promotion_id + musinsa_no + snapshot_date |
| 스크립트 | `scripts/run_event.sh` |
| 권장 주기 | 매일 02:00 |

**상품 목록 변경 처리 방식**: upsert 키에 `snapshot_date` 포함 → 상품 목록이 바뀌어도 이전 상품은 삭제되지 않고 과거 `snapshot_date`로 누적 보존 (이력 추적 가능).

Viewer 조회 시에는 각 프로모션의 `promotions.snapshot_date`와 일치하는 items만 필터링해 최신 상품 목록만 표시:
```typescript
// Viewer — promotion_items 조회 시
.or(selPromos.map(p => `and(promotion_id.eq.${p.id},snapshot_date.eq.${p.snapshot_date})`).join(','))
```

---

### 8. snaps — 무신사 스냅

| 항목 | 내용 |
|---|---|
| 스크래퍼 | `worker/scrapers/musinsa_snap.py` |
| API | `content.musinsa.com/api2/content/snap/v1/snaps` |
| 수집 대상 | CODISHOP_SNAP(코디샵 공식) + MUSINSA_SNAP(무신사 공식) — USER_SNAP 제외 |
| 수집 필드 | snap_id, content_type, format_type, published_at, like_count, view_count, comment_count, goods_click_count, model_gender, model_height, model_weight |
| 증분 방식 | 기존 snap_id 등장 시 해당 페이지에서 중단 (이후는 이미 수집된 것으로 판단) |
| upsert 기준 | snap_id |
| 스크립트 | `scripts/run_snap.sh` |
| 권장 주기 | 매일 02:00 |

---

### 9. snap_products — 스냅 × 상품 연결

| 항목 | 내용 |
|---|---|
| 스크래퍼 | `worker/scrapers/musinsa_snap.py` (snaps와 동시 수집) |
| 파싱 | 스냅 응답의 `goods[].goodsNo` |
| 수집 필드 | snap_id, product_id, musinsa_no, goods_platform |
| stub 삽입 | 신규 musinsa_no → products 테이블에 stub 자동 삽입 |
| upsert 기준 | snap_id + musinsa_no |

---

### 10. magazine_articles — 매거진 기사

| 항목 | 내용 |
|---|---|
| 스크래퍼 | `worker/scrapers/musinsa_magazine.py` |
| API | `content.musinsa.com/api2/content/musinsa-content/v1/contents` |
| 수집 필드 | article_id, cms_index, title, category, brand_names, view_count, comment_count, published_at |
| 증분 방식 | DB의 최신 published_at - 2일 버퍼부터 신규 수집 |
| 누적 기사 수 | ~120,754건 (2026-05-20 기준), 신규 ~20건/일 |
| upsert 기준 | article_id |
| 스크립트 | `scripts/run_magazine.sh` |
| 권장 주기 | 매일 02:30 |

---

### 11. magazine_article_products — 매거진 × 상품 연결

| 항목 | 내용 |
|---|---|
| 스크래퍼 | `worker/scrapers/musinsa_magazine.py` (articles와 동시 수집) |
| 파싱 | 기사 응답의 `relatedGoodsList[].goodsNo` |
| stub 삽입 | 신규 musinsa_no → products 테이블에 stub 자동 삽입 |
| upsert 기준 | article_id + musinsa_no |

---

### 3-B. products (자사 브랜드 전수) — is_own=True

| 항목 | 내용 |
|---|---|
| 스크래퍼 | `worker/scrapers/musinsa_own_products.py` |
| API | `api.musinsa.com/api2/dp/v1/plp/goods?brand={slug}&caller=FLAGSHIP&page={n}&pageSize=100` |
| 대상 슬러그 | covernat / covernatwoman / covernatkids / covernatbeauty / wackywilly / lee / leekids |
| 수집 필드 | musinsa_no, name, thumbnail_url, brand_id, is_own=True |
| 수집 방식 | pagination.hasNext 가 False 될 때까지 전체 페이지 순회 |
| 광고 상품 제외 | `isAd=True` 아이템 스킵 |
| upsert 기준 | musinsa_no |
| 이후 단계 | `run_product.sh` 가 detail_fetched_at IS NULL 인 자사 상품 상세 채움 |
| 스크립트 | `scripts/run_own_products.sh` |
| 권장 주기 | 매일 00:30 (하루 1회, 신상품 추가 즉시 반영) |
| 예상 소요 | ~9,300번 upsert, API 호출 ~98회, ~7분 |

---

### 12–13. own_sales_daily / own_inventory — 자사 ERP (미구현)

| 항목 | 내용 |
|---|---|
| 소스 | Snowflake SW_SALEINFO / SW_WHINV |
| 대상 브랜드 | CO(커버낫) / LE(리) / WA(와키윌리) |
| 구현 조건 | Snowflake 연결 정보 (account, user, password, warehouse) |
| 비고 | 원본 3,072만행 직접 적재 금지 — Snowflake에서 집계 후 소량만 저장 |

---

### 14–15. dart_disclosures / dart_financials — DART ✅

| 항목 | 내용 |
|---|---|
| 스크래퍼 | `worker/scrapers/dart_scraper.py` |
| 소스 | DART OpenAPI (opendart.fss.or.kr) |
| 수집 현황 | corp_code 확보 254개 / 1,195개, 공시 5,464건, 재무 523건 (2026-05-22 기준) |
| 스크립트 | `worker/.venv/bin/python3 -m worker.scrapers.dart_scraper --target all --years 3` |
| 권장 주기 | 매주 일요일 06:00 |

**3단계 수집 흐름**

| 단계 | 내용 |
|---|---|
| Step 1: corp_code 조회 | `corpCode.xml` ZIP 다운로드 → 회사명 매칭 → `company.json` API로 사업자번호 검증 → `companies.corp_code` 업데이트 |
| Step 2: 공시 수집 | `list.json` API → `dart_disclosures` upsert (rcept_no 기준) |
| Step 3: 재무 수집 | 상장사: `fnlttSinglAcnt.json` API / 비상장사: `dart-fss` 라이브러리로 감사보고서 HTML 파싱 |

**이름 매칭 실패 처리**

- 1,195개 중 912개 자동 매칭 실패 (개인사업자, 해외 브랜드, DART 미등록명, 사업자번호 불일치)
- Viewer `/mapping` 페이지에서 담당자가 수동으로 corp_code 입력 (개발 예정)
- 미매핑 회사 확인 쿼리:
  ```sql
  SELECT corp_name, business_number FROM companies
  WHERE corp_code IS NULL AND dart_fetched_at IS NOT NULL ORDER BY corp_name;
  ```

---

### 16. reviews — 자사 리뷰 ✅

| 항목 | 내용 |
|---|---|
| 스크래퍼 | `worker/scrapers/musinsa_review.py` |
| 소스 | `goods-detail.musinsa.com` (httpx, 세션 쿠키 불필요) |
| 대상 | 자사 브랜드(CO/LE/WA) 상품만 |
| 수집 필드 | product_id, musinsa_no, rating, review_text, size_fit, color_comment, collected_at |
| 수집 현황 | 31,494건 (2026-05-22 기준) |
| 금지 | 닉네임, 사용자 ID 절대 수집·저장 금지 |
| upsert 기준 | product_id + (리뷰 고유 식별자) |
| 스크립트 | `scripts/run_reviews.sh` |
| 권장 주기 | 매일 03:00 |

### 17. review_analysis — LLM 분석 ❌ (미구현)

| 항목 | 내용 |
|---|---|
| 소스 | reviews 테이블 |
| 분석 대상 | 저점(별점 1~2) 리뷰 문제점, 고점(별점 4~5) 리뷰 강점 |
| 구현 예정 | Ollama gemma4:e4b 로컬 LLM으로 요약·감성분석 (비용 $0) |
| 구현 조건 | Ollama 실행 환경 + gemma4:e4b 모델 로드 |

---

## 일별 수집 스케줄 (권장, 2026-05-22 확정)

```
00:30  run_own_products.sh          # 자사 브랜드 상품 전수 (~7분, 신상품 즉시 반영)
01:00  run_ranking.sh               # 상품 랭킹 273조합 (~20분)
01:30  run_brand_ranking.sh         # 브랜드 랭킹 273조합 (~20분)
02:00  run_event.sh                 # 프로모션 (~1분)
02:00  run_snap.sh                  # 스냅 (~3분)
02:30  run_magazine.sh              # 매거진 (~5분)
03:00  run_reviews.sh               # 자사 리뷰 (~10분)
04:00  musinsa_product --today-ranking --ranking-top-n 50   # 오늘 랭킹 TOP50 상세 (~5분)
```

**주간**
```
일요일 06:00  dart_scraper --target all --years 1   # DART 공시·재무 (~30분)
```

> cron 등록은 직접 수동으로. `scripts/` 하위 쉘 스크립트를 crontab에 등록.
> 상품 상세 111,119개 보류분 전체 수집은 별도 판단 후 결정.

---

## 주요 설계 원칙

- **stub → 상세 분리**: 신규 상품은 먼저 stub으로 등록, 이후 상세 수집. products 테이블이 참조 키 역할.
- **비정규화**: ranking_snapshots에 product_name/brand_slug 중복 저장 — JOIN 없이 바로 조회 가능.
- **LATERAL JOIN**: 상품의 최신 가격/순위는 current_price 컬럼 없이 ranking_snapshots LATERAL JOIN으로 조회.
- **증분 수집**: snaps(snap_id 중복 감지), magazine(published_at 기준), products(detail_fetched_at IS NULL).
- **upsert 전략**: 모든 스크래퍼가 INSERT 대신 upsert — 재실행해도 중복 없음.
