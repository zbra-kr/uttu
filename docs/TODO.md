# UTTU — 개발 TODO

> 우선순위: 🔴 긴급 / 🟡 중요 / 🟢 나중에

---

## 📅 일간 수집 루틴 (매일 수동 실행)

> 결정일: 2026-05-22. 상품 상세 111k 보류분은 수집 제외, 오늘 랭킹 TOP50만 수집.

### 실행 순서

```bash
# 1. 랭킹 (가장 먼저 — 이후 상품 상세의 기준이 됨)
scripts/run_ranking.sh

# 2. 프로모션 · 스냅 · 매거진 (랭킹과 독립, 동시 실행 가능)
scripts/run_event.sh
scripts/run_snap.sh
scripts/run_magazine.sh

# 3. 리뷰
scripts/run_reviews.sh

# 4. 상품 상세 — 오늘 랭킹 TOP50 이내 상품 중 미수집분만
worker/.venv/bin/python3 -m worker.scrapers.musinsa_product --today-ranking --ranking-top-n 50

# 5. DART (주 1회, 매주 일요일 권장)
worker/.venv/bin/python3 -m worker.scrapers.dart_scraper --target all --years 1
```

### 예상 소요 시간

| 항목 | 예상 |
|---|---|
| 랭킹 | ~2분 |
| 프로모션 | ~1분 |
| 스냅 | ~3분 |
| 매거진 | ~5분 |
| 리뷰 | ~10분 |
| 상품 상세 (TOP50) | ~5분 (조합당 ~50개 × 27조합 = 최대 1,350개) |
| **합계** | **~26분** |

### cron 등록 예시 (정호철 직접 등록)

```bash
# 매일 02:00 — 랭킹·프로모션·스냅·매거진
0 2 * * * cd /Users/macmini/projects/uttu && scripts/run_ranking.sh && scripts/run_event.sh && scripts/run_snap.sh && scripts/run_magazine.sh

# 매일 03:00 — 리뷰
0 3 * * * cd /Users/macmini/projects/uttu && scripts/run_reviews.sh

# 매일 04:00 — 상품 상세 (오늘 랭킹 TOP50)
0 4 * * * cd /Users/macmini/projects/uttu && worker/.venv/bin/python3 -m worker.scrapers.musinsa_product --today-ranking --ranking-top-n 50

# 매주 일요일 06:00 — DART
0 6 * * 0 cd /Users/macmini/projects/uttu && worker/.venv/bin/python3 -m worker.scrapers.dart_scraper --target all --years 1
```

---

## 🟡 DART 관련

### corp_code 수동 등록 기능
- **배경**: DART 이름 매칭 실패 케이스 (사업자번호 불일치, DART 미등록명)
  - 에프앤에프: DB bizr_no(1538102451) ≠ DART bizr_no(5408602835) — 판매처 vs 법인 불일치
  - 영원아웃도어: DART corp list에 해당 이름 없음 (영원무역 자회사 추정)
- **필요 기능**:
  - Viewer 관리 화면 또는 스크립트로 `companies.corp_code` 직접 수정
  - DART 사이트(dart.fss.or.kr)에서 corp_code 확인 후 UPDATE
  - 예시 SQL:
    ```sql
    -- 에프앤에프: DART에서 corp_code 확인 후
    UPDATE companies SET corp_code = '00000000', is_listed = true
    WHERE business_number = '1538102451';
    ```
- **확인 필요 회사**: 에프앤에프, 영원아웃도어, (무신사는 corp_code 있으나 DART 공시 없음)

### DART 수집 정기화
- corp_code 확보된 회사의 공시·재무 주기적 수집 cron 등록 (정호철 직접)
  ```
  # 공시 — 매주 일요일 06시
  0 6 * * 0 .venv/bin/python3 -m worker.scrapers.dart_scraper --target all --years 1
  ```

---

## 🟡 이상탐지 모듈

> 테이블: `anomalies` / 스크래퍼: `worker/detectors/` / 스크립트: `scripts/run_detect.sh`

### 상품기획 / 영업기획 (`module = 'product_planning'`)

| anomaly_type | 설명 | 임계값 | 구현 |
|---|---|---|---|
| `rank_spike` | 경쟁 상품 순위 급등 | 전일 대비 +20위 이상 상승 & TOP50 진입 | ✅ `ranking_detector.py` |
| `rank_drop_own` | 자사 상품 순위 이탈 | 전일 대비 -10위 이상 하락 | ✅ `ranking_detector.py` |
| `new_entrant_top10` | 경쟁 상품 TOP10 신규 진입 | 오늘 TOP10, 어제 TOP20 밖 | ✅ `ranking_detector.py` |
| `sold_out` | 랭킹 상품 품절 전환 | TOP50 내 is_sold_out 변경 | ✅ `ranking_detector.py` |
| `promo_heavy_discount` | 비정상 고할인율 | promotion_items discount_rate ≥ 50% | ✅ `ranking_detector.py` |
| `price_drop` | 가격 급락 | 전일 대비 final_price -10% 이상 | ✅ `ranking_detector.py` |

### CS (`module = 'cs'`)

| anomaly_type | 설명 | 임계값 | 구현 |
|---|---|---|---|
| `review_rating_drop` | 자사 상품 별점 급락 | 최근 7일 평균 < 전체 평균 - 0.3 | ✅ `review_detector.py` |
| `review_negative_surge` | 부정 리뷰 급증 | 최근 7일 1~2점 비율 ≥ 30% | ✅ `review_detector.py` |
| `review_count_surge` | 리뷰 폭증 (바이럴/이슈) | 오늘 리뷰 수 > 30일 일평균 × 3 | ✅ `review_detector.py` |

### 재무팀 (`module = 'finance'`) — 추후 개발

| anomaly_type | 설명 | 구현 |
|---|---|---|
| `dart_new_disclosure` | 경쟁사 신규 공시 | ❌ |
| `financial_revenue_drop` | 매출 전년 대비 -30% | ❌ |
| `financial_debt_ratio` | 부채비율 임계값 초과 | ❌ |

---

## 🟡 수집 관련

### 브랜드 상세 수집 완료 확인
- 현재 3,291 / 4,467개 완료 (수집 중)
- 완료 후 나머지 재시도 필요한지 확인

### 리뷰 분석 (LLM)
- `review_analysis` 테이블 비어있음
- Ollama (gemma4:e4b) 로컬 모델로 리뷰 요약·감성분석 개발 필요

### Snowflake 연동
- `own_sales_daily`, `own_inventory` 수집 미개발
- Snowflake read-only Key-pair 인증 연동 필요

---

## 🟢 Viewer 관련

### 프로모션 페이지 — AI 노트 전환 (TO-BE)
- **현재**: "요약" 섹션 — 이미 로드된 데이터로 문장 조합 (AI 호출 없음), live 뱃지 숨김
- **전환 시**: 섹션명 "AI 노트"로 복원, `<span className="capsule"><span className="ico" /> live</span>` 뱃지 복원
- **구현 방법 (선택)**
  - Ollama (로컬, $0): `POST http://localhost:11434/api/generate` — `gemma4:e4b` 모델 이미 세팅됨
  - Claude API (유료, 품질 높음): `claude-haiku-4-5-20251001` 권장 (비용 최소)
- **연결 위치**: `viewer/src/app/(app)/promo/page.tsx` PromoHub 컴포넌트 내 요약 섹션
- **API 라우트 필요**: `viewer/src/app/api/ai-promo-note/route.ts` (서버사이드 — API 키 보호)

### 재무 데이터 뷰 추가
- `dart_financials` 수집됐으나 Viewer에 표시 안 됨
- 재무팀용 경쟁사 재무 비교 화면 필요

---

## 완료된 항목 ✅

- [x] 무신사 랭킹 스크래퍼 (27조합, 매일)
- [x] 브랜드 랭킹 스크래퍼
- [x] 상품 상세 스크래퍼 (자사 + 경쟁사 TOP50)
- [x] 브랜드 상세 스크래퍼
- [x] 프로모션 스크래퍼
- [x] 자사 리뷰 스크래퍼
- [x] 스냅 스크래퍼
- [x] 매거진 스크래퍼
- [x] skip-detail 정책 적용 (111,081개 제외)
- [x] Teams + Telegram 알림 시스템
- [x] DART 스크래퍼 초기 버전 (B.CAVE 5개년, 더네이쳐홀딩스 3개년)
- [x] 이상탐지 모듈 — product_planning (rank_spike/rank_drop_own/new_entrant_top10/sold_out/promo_heavy_discount/price_drop)
- [x] 이상탐지 모듈 — CS (review_rating_drop/review_negative_surge/review_count_surge)
- [x] anomalies 테이블 마이그레이션 (`00300_anomalies.sql`) + runner + run_detect.sh
