# UTTU 이상탐지 명세서

**버전:** 2.0  
**기준일:** 2026-05-24  
**총 탐지 항목:** 22종

---

## 개요

무신사에서 수집된 데이터(랭킹·브랜드랭킹·프로모션·리뷰)를 매일 1회 분석해 이상 신호를 `anomalies` 테이블에 저장하고 텔레그램으로 알림을 발송한다.

### 탐지 주기

- 매일 전체 데이터 수집 완료 후 1회 실행
- 실행 방법: `python -m worker.detectors.runner [--date YYYY-MM-DD]`

### 심각도(severity)

| 등급 | 의미 | 조치 |
|------|------|------|
| `high` | 즉각 확인 필요 — 자사 지표 악화, 자사 상품 이탈 등 | 당일 대응 |
| `medium` | 모니터링 필요 — 경쟁사 동향, 중간 수준 이상 | 3일 내 검토 |
| `low` | 참고용 — 경쟁사 미세 변동, 긍정적 신호 포함 | 주간 리뷰 |

### 탐지 모듈 구조

| 모듈명 | 파일 | 데이터 소스 | 부서 |
|--------|------|------------|------|
| `product_planning` | `ranking_detector.py` | `ranking_snapshots`, `promotion_items` | 상품기획 |
| `brand_planning` | `brand_ranking_detector.py` | `brand_ranking_snapshots` | 상품기획 |
| `cs` | `review_detector.py` | `reviews` | CS |

---

## 탐지 항목 전체 목록

### 1. 상품 랭킹 이상 (module: `product_planning`)

#### 1-1. `rank_spike` — 경쟁 상품 순위 급등

- **조건:** `is_own = False`, 전일 대비 순위 +20위 이상 상승, 오늘 TOP50 이내
- **심각도:** `medium`
- **임계값:** `RANK_SPIKE_DELTA = 20`
- **기준 조합:** category=000 (전체), gender=A, age=AGE_BAND_ALL
- **활용:** 경쟁 상품의 갑작스러운 상승을 포착해 원인(마케팅/할인/미디어 노출) 분석

#### 1-2. `rank_drop_own` — 자사 상품 순위 하락

- **조건:** `is_own = True`, 전일 대비 순위 -10위 이상 하락
- **심각도:** `high` (하락 폭 ≥30위), `medium` (10~29위)
- **임계값:** `RANK_DROP_OWN_DELTA = 10`
- **활용:** 자사 상품 경쟁력 저하 조기 감지

#### 1-3. `new_entrant_top10` — 경쟁 상품 TOP10 신규 진입

- **조건:** `is_own = False`, 오늘 TOP10 이내, 어제 TOP20 밖 (또는 신규 진입)
- **심각도:** `medium`
- **임계값:** `NEW_ENTRANT_TOP = 10`, `NEW_ENTRANT_PREV_OUT = 20`
- **활용:** 신규 강자 진입 포착 — 해당 상품의 특성(소재/가격/디자인) 벤치마킹

#### 1-4. `sold_out` — TOP50 내 품절 전환

- **조건:** 오늘 TOP50, 오늘 `is_sold_out = True`, 어제 `is_sold_out = False`
- **심각도:** `high` (자사), `low` (경쟁)
- **임계값:** `SOLD_OUT_MIN_RANK = 50`
- **활용:** 자사는 재입고 필요 감지; 경쟁사는 공급 부족으로 인한 반사이익 가능성 평가

#### 1-5. `price_drop` — 전일 대비 가격 인하

- **조건:** 전일 대비 final_price -10% 이상 하락
- **심각도:** `high` (자사 또는 인하율 ≥20%), `low` (경쟁사 10~19%)
- **임계값:** `PRICE_DROP_RATE = 0.10`
- **활용:** 자사 가격 실수 또는 의도적 인하 확인; 경쟁사 공격적 가격 전략 감지

#### 1-6. `price_rise` — 전일 대비 가격 인상 *(신규)*

- **조건:** 전일 대비 final_price +10% 이상 상승
- **심각도:** `medium` (자사), `low` (경쟁)
- **임계값:** `PRICE_RISE_RATE = 0.10`
- **활용:** 자사 가격 실수 감지; 경쟁사 재고 소진 후 가격 회복 패턴 모니터링

#### 1-7. `rank_exit_own` — 자사 상품 TOP100 이탈 *(신규)*

- **조건:** `is_own = True`, 어제 랭킹 진입 (TOP100), 오늘 랭킹 없음
- **심각도:** `high`
- **활용:** 자사 상품이 전체 랭킹에서 완전 이탈 — 트렌드 이탈 또는 노출 문제 감지

#### 1-8. `rank_return_own` — 자사 상품 TOP50 재진입 *(신규)*

- **조건:** `is_own = True`, 어제 TOP50 밖 또는 미진입, 오늘 TOP50 이내
- **심각도:** `low`
- **활용:** 긍정적 신호 — 마케팅 효과 또는 계절성 수요 회복 확인

#### 1-9. `rank_multi_drop_own` — 자사 상품 3개 이상 동시 하락 *(신규)*

- **조건:** 동일 날짜에 `rank_drop_own` 해당 상품이 3개 이상
- **심각도:** `high`
- **활용:** 개별 상품 문제가 아닌 자사 브랜드 전반적 경쟁력 하락 감지 — 플랫폼 노출 알고리즘 변화 또는 브랜드 이슈 의심

---

### 2. 프로모션 이상 (module: `product_planning`)

#### 2-1. `promo_heavy_discount` — 고할인율 프로모션 노출

- **조건:** `promotion_items.discount_rate ≥ 50%`
- **심각도:** `medium`
- **임계값:** `HEAVY_DISCOUNT_RATE = 50.0`
- **활용:** 경쟁사의 공격적 할인 프로모션 포착 — 자사 프로모션 기획 참고

#### 2-2. `promo_item_count_drop` — 프로모션 상품 수 급감 *(신규)*

- **조건:** 동일 날짜 전체 `promotion_items` 수가 전일 대비 -30% 이상 감소
- **심각도:** `medium`
- **임계값:** `PROMO_COUNT_DROP_RATE = 0.30`
- **활용:** 무신사 프로모션 개편 또는 스크래퍼 이상 조기 감지

#### 2-3. `promo_own_exit` — 자사 상품 프로모션 이탈 *(신규)*

- **조건:** 어제 `promotion_items`에 있던 자사 상품(`musinsa_brand_slug`이 자사 브랜드)이 오늘 없음
- **심각도:** `medium`
- **활용:** 자사 상품의 프로모션 퇴출 — 담당자 확인 및 재진입 전략 수립

---

### 3. 브랜드 랭킹 이상 (module: `brand_planning`)

기준 조합: `category=000` (전체), `gender=A` (전체), `age=AGE_BAND_ALL`

#### 3-1. `brand_rank_drop_own` — 자사 브랜드 순위 하락 *(신규)*

- **조건:** `brands.is_own = True`, 전일 대비 순위 -5위 이상 하락
- **심각도:** `high` (하락 폭 ≥15위), `medium` (5~14위)
- **임계값:** `BRAND_DROP_DELTA = 5`
- **활용:** 자사 브랜드 전체 경쟁력 저하의 가장 이른 신호 — 개별 상품 하락보다 선행

#### 3-2. `brand_rank_spike_competitor` — 경쟁 브랜드 순위 급등 *(신규)*

- **조건:** `brands.is_own = False`, 전일 대비 순위 +10위 이상 상승, 오늘 TOP30 이내
- **심각도:** `medium`
- **임계값:** `BRAND_SPIKE_DELTA = 10`, `BRAND_SPIKE_TOP = 30`
- **활용:** 경쟁 브랜드의 급부상 — 마케팅/컬렉션 출시/미디어 노출 원인 분석

#### 3-3. `brand_new_entrant_top10` — 경쟁 브랜드 TOP10 신규 진입 *(신규)*

- **조건:** `brands.is_own = False`, 오늘 TOP10, 어제 TOP20 밖
- **심각도:** `medium`
- **임계값:** `BRAND_NEW_ENTRANT_TOP = 10`, `BRAND_NEW_ENTRANT_PREV_OUT = 20`
- **활용:** 브랜드 랭킹 상위권 지형 변화 포착

#### 3-4. `brand_exit_top50_own` — 자사 브랜드 TOP50 이탈 *(신규)*

- **조건:** `brands.is_own = True`, 어제 TOP50 이내, 오늘 TOP50 밖 또는 랭킹 없음
- **심각도:** `high`
- **활용:** 자사 브랜드가 상위권에서 완전히 밀려나는 심각한 신호

#### 3-5. `brand_rank_gender_diverge` — 자사 브랜드 성별 순위 편차 *(신규)*

- **조건:** `brands.is_own = True`, 남성(`gender=M`) 순위와 여성(`gender=F`) 순위 차이 ≥20위, 두 순위 모두 TOP50 이내
- **심각도:** `low`
- **임계값:** `BRAND_GENDER_DIVERGE = 20`
- **활용:** 특정 성별에서만 약세를 보이는 경우 카테고리별 전략 재검토

---

### 4. 리뷰 이상 (module: `cs`)

#### 4-1. `review_rating_drop` — 자사 상품 별점 급락

- **조건:** `is_own = True`, 최근 7일 평균별점 < 30일 전체 평균 - 0.3점
- **심각도:** `high`
- **임계값:** `RATING_DROP_THRESHOLD = 0.3`
- **활용:** 제품 불량 배치 또는 특정 사이즈/색상 이슈 조기 포착

#### 4-2. `review_negative_surge` — 부정 리뷰 비율 급증

- **조건:** `is_own = True`, 최근 7일 1~2점 리뷰 비율 ≥ 30%
- **심각도:** `high`
- **임계값:** `NEGATIVE_RATE_THRESHOLD = 0.30`
- **활용:** CS 이슈 대응 — 공통 불만 사항 파악 후 상품 개선 또는 고객 대응

#### 4-3. `review_count_surge` — 일일 리뷰 수 급증

- **조건:** `is_own = True`, 오늘 리뷰 수 > 30일 일평균 × 3배
- **심각도:** `high` (5배 이상), `medium` (3~5배)
- **임계값:** `SURGE_MULTIPLIER = 3.0`
- **활용:** 긍정이든 부정이든 바이럴 신호 — 내용 확인 필요

#### 4-4. `review_no_activity` — 활발하던 자사 상품 리뷰 중단 *(신규)*

- **조건:** `is_own = True`, 30일 일평균 리뷰 ≥ 1건이었는데 최근 7일 리뷰 0건
- **심각도:** `medium`
- **임계값:** `MIN_DAILY_AVG_FOR_ACTIVE = 1.0`
- **활용:** 노출 감소, 판매 중단, 고객 관심 이탈 신호 — 상품 상태 및 광고 집행 확인

#### 4-5. `review_helpful_surge` — 부정 리뷰 helpful_count 급증 *(신규)*

- **조건:** `is_own = True`, rating ≤ 2점인 리뷰의 helpful_count ≥ 10
- **심각도:** `high`
- **임계값:** `NEGATIVE_HELPFUL_MIN = 10`
- **활용:** 부정 리뷰가 바이럴됨 — "공감" 많은 부정 리뷰는 구매 전환율에 직접 영향

---

## 임계값 요약

| 파라미터 | 값 | 설명 |
|---------|-----|------|
| `RANK_SPIKE_DELTA` | 20 | 경쟁 상품 순위 상승 임계 |
| `RANK_DROP_OWN_DELTA` | 10 | 자사 상품 순위 하락 임계 |
| `NEW_ENTRANT_TOP` | 10 | 신규 진입 기준 순위 |
| `NEW_ENTRANT_PREV_OUT` | 20 | 신규 진입 전일 기준 순위 밖 |
| `SOLD_OUT_MIN_RANK` | 50 | 품절 탐지 최소 순위 |
| `PRICE_DROP_RATE` | 10% | 가격 인하 임계 |
| `PRICE_RISE_RATE` | 10% | 가격 인상 임계 |
| `HEAVY_DISCOUNT_RATE` | 50% | 프로모션 고할인 임계 |
| `PROMO_COUNT_DROP_RATE` | 30% | 프로모션 상품 수 급감 임계 |
| `BRAND_DROP_DELTA` | 5 | 브랜드 순위 하락 임계 |
| `BRAND_SPIKE_DELTA` | 10 | 경쟁 브랜드 순위 상승 임계 |
| `BRAND_SPIKE_TOP` | 30 | 경쟁 브랜드 급등 감지 TOP N |
| `BRAND_NEW_ENTRANT_TOP` | 10 | 브랜드 신규 진입 기준 |
| `BRAND_NEW_ENTRANT_PREV_OUT` | 20 | 브랜드 신규 진입 전일 기준 |
| `BRAND_GENDER_DIVERGE` | 20 | 성별 순위 편차 임계 |
| `RATING_DROP_THRESHOLD` | 0.3점 | 별점 급락 임계 |
| `NEGATIVE_RATE_THRESHOLD` | 30% | 부정 리뷰 비율 임계 |
| `SURGE_MULTIPLIER` | 3× | 리뷰 급증 임계 |
| `MIN_DAILY_AVG_FOR_ACTIVE` | 1.0건 | 활발 상품 일평균 기준 |
| `NEGATIVE_HELPFUL_MIN` | 10 | 부정 리뷰 helpful 임계 |

---

## 데이터 흐름

```
ranking_snapshots          → detect_ranking()         → product_planning anomalies
brand_ranking_snapshots    → detect_brand_ranking()   → brand_planning anomalies
promotion_items            → detect_promo_*()         → product_planning anomalies
reviews                    → detect_review()          → cs anomalies
                                                              ↓
                                               anomalies 테이블 upsert
                                                              ↓
                                               텔레그램 / MS Teams 알림
```

---

## 탐지 항목 × 심각도 매트릭스

| # | anomaly_type | module | severity | 자사/경쟁 |
|---|-------------|--------|----------|----------|
| 1 | `rank_spike` | product_planning | medium | 경쟁 |
| 2 | `rank_drop_own` | product_planning | high/medium | 자사 |
| 3 | `new_entrant_top10` | product_planning | medium | 경쟁 |
| 4 | `sold_out` | product_planning | high(자사)/low(경쟁) | 양쪽 |
| 5 | `price_drop` | product_planning | high/low | 양쪽 |
| 6 | `price_rise` | product_planning | medium(자사)/low(경쟁) | 양쪽 |
| 7 | `rank_exit_own` | product_planning | high | 자사 |
| 8 | `rank_return_own` | product_planning | low | 자사 |
| 9 | `rank_multi_drop_own` | product_planning | high | 자사 |
| 10 | `promo_heavy_discount` | product_planning | medium | 경쟁 |
| 11 | `promo_item_count_drop` | product_planning | medium | 전체 |
| 12 | `promo_own_exit` | product_planning | medium | 자사 |
| 13 | `brand_rank_drop_own` | brand_planning | high/medium | 자사 |
| 14 | `brand_rank_spike_competitor` | brand_planning | medium | 경쟁 |
| 15 | `brand_new_entrant_top10` | brand_planning | medium | 경쟁 |
| 16 | `brand_exit_top50_own` | brand_planning | high | 자사 |
| 17 | `brand_rank_gender_diverge` | brand_planning | low | 자사 |
| 18 | `review_rating_drop` | cs | high | 자사 |
| 19 | `review_negative_surge` | cs | high | 자사 |
| 20 | `review_count_surge` | cs | high/medium | 자사 |
| 21 | `review_no_activity` | cs | medium | 자사 |
| 22 | `review_helpful_surge` | cs | high | 자사 |
