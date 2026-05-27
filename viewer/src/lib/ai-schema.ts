export const DB_SCHEMA = `
## 데이터베이스 스키마 (PostgreSQL)

### companies — 법인 마스터
- id(uuid), corp_name(text), business_number(text, 사업자번호)
- ceo_name, address, phone, website, remark(메모)
- corp_code(DART 고유번호), stock_code(KRX 종목코드), is_listed(boolean)

### brands — 브랜드 마스터
- id(uuid), company_id→companies.id
- slug(text, 영문 ID), name(text, 한글명), name_eng(영문명)
- is_own(boolean, 자사=B.CAVE CO/LE/WA), erp_brand_code
- nation_code, since_year, remark(메모)

### products — 상품
- id(uuid), brand_id→brands.id
- musinsa_no(text, 무신사 번호), name(한글명), name_eng, style_no
- is_own(boolean), erp_style_code
- category_code(000=전체,001~020=카테고리), gender(M/F/U)
- list_price(원), final_price(원), discount_rate, review_count, review_score
- is_active(boolean), detail_fetched_at

### ranking_snapshots — 상품 랭킹 일별 스냅샷
- product_id→products.id, snapshot_date(date)
- category_code, gender_filter(A/M/F)
- age_filter(AGE_BAND_ALL/MINOR/20/25/30/35/40)
- rank_position(정수 1~102)
- musinsa_no, product_name, brand_slug, brand_name (비정규화)
- list_price(원), final_price(원), discount_rate
- is_sold_out(boolean), review_count, review_score

### brand_ranking_snapshots — 브랜드 랭킹 일별 스냅샷
- brand_id→brands.id, musinsa_brand_slug, brand_name, snapshot_date
- category_code, gender_filter, age_filter, rank_position(1~200)

### dart_financials — DART 재무제표 (금액 단위: 원)
- company_id→companies.id, fiscal_year(연도 e.g. 2024)
- revenue(매출액), operating_income(영업이익), net_income(당기순이익)
- total_assets(자산총계), total_liabilities(부채총계)
- data_source('finstate_api'|'audit_report_html')
- UNIQUE: (company_id, fiscal_year, data_source)

### dart_disclosures — DART 공시 목록
- company_id→companies.id
- rcept_no(접수번호,UNIQUE), report_nm(공시명), rcept_dt(date), flr_nm(제출인)

### anomalies — 이상탐지 결과
- detection_date(date), severity('high'|'medium'|'low')
- anomaly_type(text), module(text)
- entity_type('product'|'brand'), entity_id(uuid), entity_name(text)
- description(text), meta(jsonb, 상세 수치), is_read(boolean)

### promotions — 무신사 프로모션
- musinsa_event_id(UNIQUE), title
- promotion_type(limited_offer/daily_sale/brand_week/general)
- items_count, end_at(timestamptz), snapshot_date(date)

### promotion_items — 프로모션 상품
- promotion_id→promotions.id, product_id→products.id
- musinsa_no, discount_rate, final_price, snapshot_date

### reviews — 자사 리뷰 (⚠️ 닉네임/사용자ID 없음, 절대 조회 금지)
- product_id→products.id, rating(1~5), review_text
- review_date, helpful_count, has_image(boolean)

### magazine_articles — 무신사 매거진 기사
- article_id(UNIQUE), title, category
- brand_names(text[], 등장 브랜드), view_count, published_at(timestamptz)

### snaps — 무신사 스냅
- snap_id(UNIQUE), content_type(CODISHOP_SNAP|MUSINSA_SNAP)
- published_at, like_count, view_count
- model_gender(WOMEN|MEN), model_height(cm), model_weight(kg)

### snap_products — 스냅 등장 상품
- snap_id→snaps.snap_id, product_id→products.id

### collection_jobs — 수집 작업 이력
- script, label, status('running'|'done'|'error')
- rows_done, started_at, finished_at, error_msg

## 조인 관계
brands.company_id → companies.id
products.brand_id → brands.id
ranking_snapshots.product_id → products.id
brand_ranking_snapshots.brand_id → brands.id
dart_financials.company_id → companies.id
dart_disclosures.company_id → companies.id
reviews.product_id → products.id
promotion_items.product_id → products.id
snap_products.product_id → products.id

## 수집 범위 한계 — 이 목록에 없는 것은 존재하지 않는다
UTTU가 수집하는 플랫폼: **무신사(musinsa.com)만** — 다른 플랫폼 데이터 없음
존재하는 랭킹: ranking_snapshots (무신사 국내 랭킹), brand_ranking_snapshots — **글로벌/해외 랭킹 없음**
존재하는 재무: dart_financials (상장사 DART 공시 기준) — **비상장사 재무, 분기 데이터 없음**
존재하지 않는 것: 재고, SNS 지표, 해외 판매, 실시간 가격, 타 플랫폼 순위, 사용자 개인 데이터
`;
