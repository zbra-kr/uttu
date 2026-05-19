# MUSINSA API 시스템 분석 — UTTU 데이터 수집 설계

> 2026-05-19 실측 확인. 작업 전 반드시 읽어라.
> 관련 스킬: docs/skills/01-scraping.md, docs/skills/04-ranking.md

---

## 1. storeCode 목록

무신사 전체 서비스는 단일 `client.musinsa.com` API에 storeCode 파라미터로 구분됨.

| storeCode | 서비스명 | 수집 상태 |
|---|---|---|
| `musinsa` | 무신사 본관 (패션) | **현재 수집 중** |
| `beauty` | 무신사 뷰티 | 향후 확장 예정 |
| `player` | 무신사 플레이어 (스포츠) | 향후 확장 예정 |
| `kids` | 무신사 키즈 | 향후 확장 예정 |
| `boutique` | 무신사 부티크 | 향후 확장 예정 |
| `outlet` | 무신사 아울렛 | 향후 확장 예정 |
| `sneaker` | 무신사 스니커즈 | 향후 확장 예정 |
| `used` | 유스드 (중고) | 향후 확장 예정 |

---

## 2. 상품 랭킹 API (확인됨)

### 2-1. 무신사 본관 — sectionId 방식

```
GET https://client.musinsa.com/api/home/web/v5/pans/ranking/sections/{sectionId}

sectionId = 199   (전체 스타일 통합 랭킹, 고정)
파라미터:
  storeCode    musinsa
  categoryCode 000~020 (9개)
  contentsId   ""      (빈 문자열 필수)
  period       DAILY
  gf           A / M / F
  ageBand      AGE_BAND_ALL / AGE_BAND_MINOR / AGE_BAND_20 / AGE_BAND_25 /
               AGE_BAND_30 / AGE_BAND_35 / AGE_BAND_40

조합: 13 × 3 × 7 = 273개  /  ~102건/조합  /  예상 18분
```

### 2-2. 뷰티·키즈·플레이어 — sectionId 없는 방식

```
GET https://client.musinsa.com/api/home/web/v5/pans/ranking
파라미터: storeCode={beauty|kids|player|...} + gf + ageBand + period + categoryCode

beauty 실측: MULTICOLUMN 모듈 × 6건 형태, 총 ~102건
kids   실측: 102건 확인 (2026-05-19)
player 실측: 102건 확인 (2026-05-19)
```

### 응답 파싱 (공통)

```
data.modules[type=="MULTICOLUMN"].items[]
  .id                                          → 무신사 상품번호
  .image.rank                                  → 순위 (1~N)
  .info.brandName                              → 브랜드명
  .info.productName                            → 상품명
  .info.finalPrice                             → 최종가
  .info.discountRatio                          → 할인율 (%)
  .image.onClickLike.eventLog.ga4.payload
    .original_price                            → 정상가
    .gender_filter                             → A/M/F (확인용)
    .applied_filter_group_1                    → "성별:XX|연령별:XX|주기별:XX"
```

### 카테고리 코드

> 2026-05-19 ranking API TAB_OUTLINED 모듈 실측. 구 코드(004=신발, 005=가방 등) 전부 오류.

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

## 3. 브랜드 랭킹 API (확인됨)

### 3-1. 브랜드 목록 (200개)

```
GET https://client.musinsa.com/api/home/web/v5/pans/ranking/sections/1054
파라미터: storeCode=musinsa + categoryCode + contentsId="" + period + gf + ageBand

응답: 200개 RANKING_BRAND 모듈 (브랜드 1개당 1 모듈)
각 모듈:
  .title.rank                → 브랜드 순위 ("1"~"200")
  .title.title.text          → 브랜드 한글명
  .title.imageUrl            → 브랜드 로고 이미지 URL
  .title.fluctuation.type    → UP / DOWN / NONE
  .title.fluctuation.amount  → 순위 변동폭 (UP/DOWN일 때)
  .title.labels[]            → 레이블 (단독, 한정 등)
  .title.onClick.url         → https://www.musinsa.com/brand/{brand_slug}
  .title.onClick.apiUrl      → 브랜드 상품 목록 API (아래 참고)
  .title.onClick.eventLog.ga4.payload.brand_id → brand_slug

조합: 상품 랭킹과 동일 — 13 × 3 × 7 = 273조합 (모두 다른 결과 반환)
```

실측 Top 10 (2026-05-19, category=000, gf=A, AGE_BAND_ALL, DAILY):
1. 무신사 스탠다드 (NONE)  2. 아디다스 (UP+1)  3. 무신사 스탠다드 우먼 (DOWN-1)
4. 크록스 (UP+14)  5. 디미트리블랙 (UP+1)  6. 나이키 (DOWN-1)
7. 뉴발란스 (UP+1)  8. 키뮤어 (DOWN-1)  9. 언탭트 스튜디오 (UP+4)  10. 트릴리온 (DOWN-1)

### 3-2. 브랜드별 상품 목록 (개별 조회)

```
GET https://client.musinsa.com/api/home/v5/pans/ranking/brands/{brand_slug}
파라미터:
  storeCode  musinsa
  gf         A/M/F
  categoryCode "" (빈 문자열)
  sectionId  1054
  ageBand    AGE_BAND_ALL 등
  period     DAILY / REALTIME

응답: MULTICOLUMN 모듈의 items (브랜드 인기 상품)
  ※ 오늘 실측: 순위 1위(무신사 스탠다드) → 33개 items
  ※ 2위(아디다스) → 0개 (별도 호출 필요하거나 현재 미지원)
  ※ 수집 대상 여부 미확정 — 브랜드 랭킹 수집 시 우선 목록만
```

---

## 4. 프로모션 API (확인됨)

```
GET https://api.musinsa.com/api2/hm/web/v3/pans/sale/modules?storeCode=musinsa
```

### 모듈 타입 분류

| module.id prefix | 프로모션 종류 | promotion_type |
|---|---|---|
| `CAROUSEL_ONEROW_DYNAMIC_TAB-` | 선착순 특가 (한정수량) | `limited_offer` |
| `CAROUSEL_TWOROW_DYNAMIC_TAB-` | 하루특가/패션페스타/뷰티/기획 | `daily_sale` |
| `CAROUSEL_MODULAR_SNAPPING_DYNAMIC_TAB_BRAND-` | 브랜드위크 | `brand_week` |

### 실측 모듈 목록 (2026-05-19)

| module.id | 제목 | items | 마감일 |
|---|---|---|---|
| CAROUSEL_ONEROW_DYNAMIC_TAB-1304 | 한정수량 선착순 특가 | 11 | 2026-05-19 |
| CAROUSEL_TWOROW_DYNAMIC_TAB-1954 | 하루특가 | 100 | 2026-05-19 |
| CAROUSEL_MODULAR_SNAPPING_DYNAMIC_TAB_BRAND-2017 | 브랜드위크 | 0 | null |
| CAROUSEL_TWOROW_DYNAMIC_TAB-2018 | 무신사 패션 페스타 | 22 | null |
| CAROUSEL_TWOROW_DYNAMIC_TAB-2019 | 오직 무신사 뷰티 | 14 | null |
| CAROUSEL_TWOROW_DYNAMIC_TAB-1301 | 쿠폰으로 만나는 인기 추천템 | 30 | null |
| CAROUSEL_TWOROW_DYNAMIC_TAB-1831 | 최저가 보상제 | 30 | null |

### 응답 파싱

```
data.modules[]
  .id                          → musinsa_event_id
  .type                        → 모듈 타입 (promotion_type 분류 기준)
  .title.title.text            → 프로모션 제목
  .title.targetDate            → 마감 timestamp (ms, null 가능) → end_at
  .items[]
    .id                        → 무신사 상품번호 (product musinsa_no)
    .info.brandName            → 브랜드명
    .info.finalPrice           → 최종가
    .info.discountRatio        → 할인율 (%)
    .info.limitedOffer         → 선착순만 존재
      .totalCount              → 총 수량
      .remainingCount          → 잔여 수량
      .status.type             → PROGRESS / SOLD_OUT
    .image.onClickLike.eventLog.ga4.payload.original_price → 정상가
    .onClick.url               → https://www.musinsa.com/products/{id}
```

---

## 5. 상품 상세 API

```
※ httpx 직접 호출 불가 — Playwright 필요 (세션 쿠키)

intercept URL:
  goods-detail.musinsa.com/api2/goods/{musinsa_no}/detail
  goods-detail.musinsa.com/api2/goods/{musinsa_no}/options

Playwright 패턴:
  page.goto(https://www.musinsa.com/products/{musinsa_no})
  page.on('response', ...) → goods-detail API 응답 캡처

파싱 대상:
  detail: 상품명, 브랜드, 카테고리, 성별, 상품 설명
  options: color chips → data.basic[displayType=="COLOR_CHIP"].optionValues[].name
  ※ 색상 없는 상품 → 빈 배열 [] (에러 아님)

평균 소요: 18초/상품
```

---

## 6. 브랜드 상세

```
※ 직접 API 없음 — 클라이언트 렌더링 (14KB HTML)
※ 현재 브랜드 정보는 랭킹 API 응답에서 추출:
    title.title.text   → 브랜드 한글명
    title.imageUrl     → 로고 이미지
    title.onClick.url  → https://www.musinsa.com/brand/{slug}
    brand_id (ga4)     → slug (영문 ID)

※ 브랜드 상세 스크래핑 필요 시: Playwright로 브랜드 페이지 방문
```

---

## 7. 리뷰 API

```
※ 자사 브랜드(CO/LE/WA) 상품만 수집

URL: https://www.musinsa.com/products/{musinsa_no}/reviews

수집:
  rating (1~5)
  review_text
  review_date
  helpful_count
  musinsa_review_id (UNIQUE)

수집 금지:
  닉네임 (개인정보)
  사용자 ID (개인정보)
```

---

## 8. 테이블 연결 구조

```
companies (법인 — DART 연결)
  └── brands (브랜드 마스터)
        ├── brand_ranking_snapshots
        │     (브랜드 순위 × 189조합/일 × 200브랜드)
        └── products (상품 마스터)
              ├── ranking_snapshots
              │     (상품 순위 × 189조합/일 × ~102건)
              ├── promotion_items
              │     └── promotions (프로모션 모듈 — 7개/일)
              ├── reviews (자사만)
              ├── review_analysis (LLM 분석 — 자사만)
              └── own_inventory (재고 — erp_style_code 연결)

own_sales_daily (자사 매출 — brands.erp_brand_code 연결)
dart_disclosures → companies
dart_financials  → companies
```

### 데이터 볼륨 추정

| 테이블 | 행/일 | 누적 1년 |
|---|---|---|
| ranking_snapshots | ~27,846 (273×102) | ~10M |
| brand_ranking_snapshots | ~54,600 (273×200) | ~20M |
| promotion_items | ~207 (7모듈×30) | ~75K |
| promotions | 7 | ~2,500 |

---

## 9. 수집 주기 및 cron 계획

| 데이터 | 주기 | 스크립트 |
|---|---|---|
| 상품 랭킹 | 매일 01:00 | scripts/run_ranking.sh |
| 브랜드 랭킹 | 매일 01:30 | scripts/run_brand_ranking.sh |
| 프로모션 | 매일 02:00 | scripts/run_promotions.sh |
| 상품 상세 | 매일 03:00 (신규 상품만) | scripts/run_product.sh |
| 리뷰 (자사) | 매일 04:00 | scripts/run_review.sh |
| Snowflake 매출/재고 | 매일 05:00 | scripts/run_erp.sh |
| DART 공시 | 매주 일요일 06:00 | scripts/run_dart.sh |

※ cron 등록은 정호철이 직접 — AI 자동 등록 금지

---

## 10. 향후 확장 메모

- **뷰티/키즈/플레이어 랭킹**: `storeCode=beauty|kids|player` + 동일 파라미터 체계 → ranking_snapshots.store_code로 구분 가능
- **브랜드위크 브랜드 연결**: CAROUSEL_MODULAR_SNAPPING_DYNAMIC_TAB_BRAND 모듈 items의 brand_id → brands.slug 조인
- **선착순특가 모니터링**: limitedOffer.remainingCount 실시간 추적 시 promotion_items 수집 빈도 높여야 (현재: 1회/일)
- **DART 비상장사**: `audit_report_xml` 파싱 → 감사보고서 XBRL 구조 별도 확인 필요

### 스냅·매거진·라이브 조사 결과 (2026-05-20 실측)

---

#### 무신사 스냅 ✅ API 확인

```
Base: https://content.musinsa.com
인증: 불필요 (쿠키 없이 200 반환)

# 스냅 목록
GET /api2/content/snap/v1/snaps
  ?page=1&pageSize=20&sort=LATEST|POPULAR
  &contentType=USER_SNAP|CODISHOP_SNAP|MUSINSA_SNAP  (선택)

응답:
  data.list[]
    .id                  → snap ID (snowflake)
    .contentType         → USER_SNAP (일반유저) / CODISHOP_SNAP (코디샵) / MUSINSA_SNAP (공식)
    .formatType          → POST (이미지) / SHORTS (숏폼 영상)
    .createdAt           → 업로드 시각 ISO8601
    .goods[]
      .goodsNo           → 무신사 상품번호 ← products 테이블 연결 키
      .goodsPlatform     → MUSINSA / SOLDOUT
      .isMatched         → 상품 매칭 여부
    .aggregations
      .likeCount         → 좋아요 수
      .viewCount         → 조회수
      .commentCount      → 댓글 수
      .goodsClickCount   → 상품 클릭 수
    .model
      .gender            → WOMEN / MEN
      .height            → 키 (cm)
      .weight            → 몸무게 (kg)
    .tags[].name         → 해시태그
    .labels[].id         → 스타일 라벨 ID

# 스냅 상세
GET /api2/content/snap/v1/snaps/{snapId}
→ 동일 구조 (goods[] 포함)

# 스냅에 태그된 상품 전체 + 상품 상세
GET /api2/content/snap/v1/snap-goods?snapId={snapId}

응답 data.list[]:
  .goodsNo             → 무신사 상품번호
  .goodsName           → 상품명
  .brand.brandId       → 브랜드 slug
  .brand.brandName     → 브랜드명
  .price.normalPrice   → 정상가
  .price.finalPrice    → 최종가
  .price.discountRate  → 할인율 (%)
  .saleState           → SALE / SOLD_OUT
  .categories[]        → 카테고리 계층
  .aggregations.snapCount → 이 상품이 등장한 총 스냅 수 ← 트렌드 선행 신호

# 특정 상품이 등장한 스냅 목록
GET /api2/content/snap/v1/snap-goods?goodsNo={goodsNo}
```

**수집 가치**: `snapCount` = 랭킹 진입 전 트렌드 선행 신호.
상품이 스냅에 많이 등장할수록 조만간 랭킹 상승 가능성.

---

#### 무신사 매거진 ⚠️ 목록 API만 (상품 목록은 Playwright 필요)

```
Base: https://api.musinsa.com
인증: 불필요

# 매거진 모듈 (탭 목록)
GET /api2/hm/web/v2/pans/contents/modules?storeCode=musinsa

응답: data.modules[] (5개 섹션)
  - 최근 매거진 (CAROUSEL_ONEROW_SNAPPING_DYNAMIC_TAB)
  - 최근 쇼케이스
  - BEST 매거진
  - 스타일/코디
  각 섹션 → tabs[].onClick.apiUrl 으로 탭별 아이템 조회

# 탭별 기사 목록
GET /api2/hm/web/v2/pans/contents/sections/{sectionId}/tab-items
  ?storeCode=musinsa&gf=A&tabKey=0

응답 data.items[]:
  .id                   → 기사 ID (정수)
  .info.title.text      → 기사 제목
  .info.subTitle.text   → 요약
  .info.category.text   → 카테고리 (트렌드/쇼핑, 브랜드 쇼케이스, 스타일/코디)
  .info.brandInfo.brandName.text → 피처드 브랜드명
  .info.releaseDateTime.dateTime → 발행일 ISO8601
  .info.viewCount.text  → 조회수 (텍스트: "1.5만" 형태)
  .info.commentCount.text → 댓글 수
  .onClick.url          → https://www.musinsa.com/content/{id}

제약:
  기사 본문 + 태그된 상품 목록: SPA 렌더링 → Playwright 필요
  현재 공개 API로는 기사 목록·메타데이터만 수집 가능
```

---

#### 무신사 라이브 ❌ 독립 API 없음

```
조사 결과:
  - www.musinsa.com/live      → 404
  - live.musinsa.com          → 연결 거부 (서비스 없음)
  - 메인 네비게이션에 Live 탭  → 없음 (추천/랭킹/세일/발매/콘텐츠만 존재)
  - snap API formatType="SHORTS" 존재 → 숏폼 영상 기능은 스냅에 통합됨

결론: 무신사 라이브 커머스(실시간 방송)는 현재 웹 공개 API 없음.
      숏폼 영상(SHORTS)은 스냅 API의 formatType=SHORTS로 수집 가능.
```

---

**세 가지 공통 분석 패턴** (스냅·매거진 모두):
```
콘텐츠 ID + 상품 목록 → products.musinsa_no 연결
→ ranking_snapshots JOIN → "콘텐츠 노출 이후 랭킹 변화" 분석
```
