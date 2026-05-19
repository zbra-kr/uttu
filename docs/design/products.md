# 상품(products) 테이블 설계

> 2026-05-19 실측 기반. 수집 가능 항목 전수 조사 후 선택 항목만 반영.

---

## 수집 방법

| 단계 | 방법 | 속도 | 수집 항목 |
|---|---|---|---|
| **1단계** | httpx 직접 GET | ~1초/상품 | 기본 정보~랭킹이력 전부 |
| **2단계** | Playwright intercept | ~18초/상품 | colors, sizes 만 |

**1단계 URL**: `https://www.musinsa.com/products/{musinsa_no}`
**파싱 대상**: HTML 내 `window.__MSS__.product.state` JSON (클라이언트 렌더링 없이 서버에서 내려줌)

**2단계 intercept**: `goods-detail.musinsa.com/api2/goods/{id}/options`

---

## 수집 가능 전체 항목

### A. 기본 식별

| 필드 (API) | 타입 | 예시 |
|---|---|---|
| `goodsNo` | int | 991339 |
| `goodsNm` | string | "라이트웨이트 크루 삭스 7팩 [화이트]" |
| `goodsNmEng` | string | "LIGHTWEIGHT CREW SOCKS 7PACK [WHITE]" |
| `styleNo` | string | "ME0SC0Z01-WH" (브랜드 자체 코드) |
| `thumbnailImageUrl` | string | "/images/goods_img/..." |
| `goodsImages[]` | array | 상품 이미지 목록 (최대 9장) |
| `headDesc` | string | 한줄 설명 (거의 비어있음) |
| `mdOpinion` | string | MD 코멘트 (거의 비어있음) |
| `specDesc` | string | 스펙 설명 (거의 비어있음) |
| `goodsContents` | HTML string | 상품 상세 HTML (이미지 다수 포함, 수십KB) |
| `seo.metaDescription` | string | SEO 설명 |

### B. 카테고리

| 필드 (API) | 타입 | 예시 |
|---|---|---|
| `baseCategoryFullPath` | string | "Clothing > 바지 > 코튼 팬츠" |
| `category.categoryDepth1Code` | string | "003" |
| `category.categoryDepth1Name` | string | "바지" |
| `category.categoryDepth2Code` | string | "003007" |
| `category.categoryDepth2Name` | string | "코튼 팬츠" |
| `category.categoryDepth3Code` | string | "" (없는 경우 많음) |
| `category.categoryDepth3Name` | string | "" |

### C. 성별 / 시즌

| 필드 (API) | 타입 | 예시 |
|---|---|---|
| `sex[]` | array | ["남성", "여성"] |
| `sexCode` | int | 2=남성, 4=여성, 6=공용 |
| `genders[]` | array | ["M", "W"] |
| `seasonYear` | string | "2024", "" = 시즌리스 |
| `season` | int/string | 1=SS, 2=FW, ""=없음 |

### D. 가격 (goodsPrice)

| 필드 (API) | 타입 | 예시 |
|---|---|---|
| `normalPrice` | int | 19900 (정상가) |
| `salePrice` | int | 15900 (할인가) |
| `discountRate` | int | 22 (%) |
| `finalPrice` | int | 15900 |
| `couponPrice` | int | 최대 쿠폰 적용가 |
| `isLowestPrice` | bool | false |
| `memberDiscountRate` | float | 회원 추가 할인율 |

> ⚠️ **가격은 products 테이블에 저장하지 않음** — `ranking_snapshots` LATERAL 조회 패턴 유지

### E. 상품 특성 (goodsMaterial.materials[])

의류 전용. 각 속성에서 `isSelected: true` 항목 하나만 추출.

| 속성명 | 선택지 |
|---|---|
| 핏 | 스키니 / 슬림 / 레귤러 / 루즈 / 오버\|사이즈 |
| 촉감 | 부드러움 / 약간\|부드러움 / 보통 / 약간\|뻣뻣함 / 뻣뻣함 |
| 신축성 | 없음 / 거의 없음 / 보통 / 약간 있음 / 있음 |
| 비침 | 있음 / 약간 있음 / 보통 / 거의 없음 / 없음 |
| 두께 | 얇음 / 약간 얇음 / 보통 / 약간\|두꺼움 / 두꺼움 |
| 계절 | 봄 / 여름 / 가을 / 겨울 (복수 선택 가능) |

비의류(가방, 신발 등): materials 배열 비어있음 → 모두 NULL

### F. 특수 플래그 (Boolean)

| 필드 (API) | 의미 |
|---|---|
| `isMusinsaMonopoly` | 무신사 단독 (전 채널) |
| `isOnlineMonopoly` | 온라인 단독 |
| `isFirst` | 신규 출시 (첫 등록) |
| `isClearance` | 클리어런스 (재고 처리) |
| `isOutlet` | 아울렛 상품 |
| `isLimitedQuantity` | 한정수량 |
| `isDrop` | 드롭 상품 |
| `isAdult` | 성인 상품 |
| `isParallelImport` | 병행수입 |
| `isFreeReturn` | 무료반품 |
| `isRestock` | 재입고 예정 가능 |
| `isSoonOutOfStock` | 곧 품절 예상 |
| `isRaffle` | 래플 상품 |
| `isTimeSale` | 타임세일 상품 |

> ℹ️ `isRestock`, `isSoonOutOfStock`, `isTimeSale` 은 실시간 변동값 — products에 저장 불필요 판단 → **미수집**

### G. 레이블 (labels[])

| code 예시 | 표시명 |
|---|---|
| `exclusive-musinsa` | 무신사단독 |
| `big-campaign-sale` | 패션 페스타 |
| `outlet` | 아울렛 |
| `limited-quantity` | 한정수량 |

labels[].code 배열로 저장.

### H. 리뷰 요약 (goodsReview)

| 필드 (API) | 타입 | 예시 |
|---|---|---|
| `totalCount` | int | 105871 |
| `satisfactionScore` | float | 4.9 |
| `hasSummary` | bool | true (AI 요약 있음) |

### I. 랭킹 이력 (rankingRecord.rankingRecordsTop[])

월별 카테고리별 최고 달성 순위 기록. 단순 `rank_position` 이 아닌, "어느 카테고리·성별에서 몇위였는가" 이력.

```json
{
  "rank": 1,
  "gender": "A",
  "depth1CategoryCode": "101",
  "depth1CategoryName": "소품",
  "depth2CategoryCode": "101002",
  "depth2CategoryName": "양말/레그웨어",
  "year": "2026",
  "month": "04",
  "depth": 2
}
```

최대 5~10개 레코드. JSONB 배열로 저장.

### J. 브랜드 정보 (brandInfo)

상품 페이지에서도 브랜드 상세 정보를 얻을 수 있음. 단, brands 테이블 별도 수집 예정이므로 **미수집**.

### K. 판매자 회사 (company)

| 필드 | 예시 |
|---|---|
| name | (주)제이씨패밀리 |
| ceoName | 김예철 |
| businessNumber | 2118658580 |
| mailOrderReportNumber | 2017-서울성동-1359 |
| phoneNumber | 0220156000 |
| email | pyoyopyo@jcfamily.co.kr |
| address | 서울특별시 성동구 ... |

> ℹ️ companies 테이블과 중복. brands → company_id 연결로 처리. **미수집** (단, 자사 상품에서 브랜드 매칭 보조 용도로 검토 가능)

### L. 배송 정보 (goodsLogisticsInfoV2[])

| 필드 | 예시 |
|---|---|
| courierName | 한진택배 |
| returnShippingCourierName | CJ대한통운 |
| returnShippingAddress | 경기 용인시 처인구... |
| roundShippingFee | 6000 (원) |
| isPlusDelivery | true (무신사 플러스 배송) |

> ℹ️ UTTU 분석 목적과 관련성 낮음. **미수집**

### M. 색상 / 사이즈 옵션 (Playwright 필요)

| 데이터 | 출처 API | 예시 |
|---|---|---|
| colors | options → `displayType == "COLOR_CHIP"` | ["블랙", "화이트", "네이비"] |
| sizes | options → `displayType == "SIZE"` | ["S", "M", "L", "XL"] |

---

## 선택 항목 → products 테이블 반영

| 그룹 | 선택 항목 | 제외 항목 (사유) |
|---|---|---|
| 기본 식별 | name, name_eng, style_no, thumbnail_url | goodsImages (대용량), goodsContents (HTML), headDesc/mdOpinion/specDesc (거의 공란) |
| 카테고리 | category_code, d2/d3 코드+명, category_path | — |
| 성별/시즌 | gender (M/F/U), season_year, season_code | genders[] (sexCode로 충분) |
| 가격 | **없음** | ranking_snapshots LATERAL 패턴 유지 |
| 상품 특성 | fit, texture, elasticity, transparency, thickness, item_seasons[] | — |
| 특수 플래그 | 10종 (monopoly/first/clearance/outlet/drop/adult/limited/parallel/free_return) | isRestock/isSoonOutOfStock/isTimeSale (실시간 변동) |
| 레이블 | labels[] (code 배열) | — |
| 리뷰 요약 | review_count, satisfaction_score | hasSummary (내부 기능 플래그) |
| 랭킹 이력 | ranking_best_records JSONB | — |
| 옵션 | colors[], sizes[] | — |
| 브랜드/회사/배송 | **없음** | brands 테이블 분리, 배송은 분석 불필요 |

---

## 마이그레이션 파일

[supabase/migrations/00003_products.sql](../../supabase/migrations/00003_products.sql)

---

## 스크래핑 코드

[docs/skills/01-scraping.md](../skills/01-scraping.md) — "상품 상세" 섹션 참고
