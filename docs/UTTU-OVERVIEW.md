# UTTU — 프로젝트 전체 개요

> 수메르 직조의 여신 UTTU — 데이터의 실을 엮어 패션 인텔리전스를 만든다
> 오너: 정호철 (IT팀장, B.CAVE)
> 시작: 2026-05-19

---

## 시스템 목적

무신사에서 경쟁 브랜드 데이터를 자동 수집·분석하여 B.CAVE 3개 부서에 인텔리전스를 제공.

---

## 3개 부서 요구사항

### 🛍️ 상품기획 / 영업기획

> 어느 성별의 어느 연령대는 어떤 상품이 인기이고, 이 상품들은 어떤 가격 조닝과 어떤 프로모션을 하고,
> 우리 상품에는 어떤 비슷한 것들이 있다. 그리고 이 상품들은 얼마고 재고량이 많다. 그래서 어떤 전략을 취해야 한다.

### 📊 재무 / 회계

> 인기있는 상품은 어떤 브랜드이고, 이 브랜드는 어떤 회사이고, 이 회사는 어떤 재무성격을 가지고 있는지.
> 이 브랜드/회사의 인기 상품·브랜드는 무엇인지, 최근 이상탐지 내역은 무엇이 있는지.

### 💬 CS

> 우리 브랜드의 상품은 모두 수집해야 함.
> 우리 브랜드 상품의 리뷰 역시 모두 수집해야 함.
> 별점이 낮은 리뷰에서 문제점이 무엇이었는지 리포팅.
> 별점이 높은 리뷰에서 어떤 것들이 강점이었는지 소비자의 심리 분석.

---

## 기술 스택

| 영역 | 기술 |
|---|---|
| 스크래퍼 | Python 3.12 + Playwright (stealth) + httpx |
| DB | Supabase (Postgres + pgvector + RLS) |
| ERP | Snowflake read-only (BI 계정, Key-pair 인증) |
| Viewer | Next.js 15 App Router + Tailwind v3 → Vercel |
| LLM | Ollama (gemma4:e4b) 로컬 — $0 |
| 임베딩 | embeddinggemma:300m 768차원 |
| 스케줄러 | macOS crontab |

---

## 핵심 설계 결정

| 결정 | 이유 |
|---|---|
| 랭킹 DAILY 1회/일 | 실시간은 노이즈. 일별 집계가 실무에 맞음 |
| 189 조합 (성별×나이대×카테고리) | 차원 없으면 실무 활용 불가 |
| 자사 리뷰 텍스트 전체 수집 | CS 분석에 집계값만으론 불가 |
| docs/skills 먼저 | MDA 교훈: 기반 없이 시작하면 나중에 전부 뜯어고침 |

---

## DB 테이블 구조

```
companies       98개사 마스터
brands          770개 브랜드 (company_id FK)
products        무신사 상품 + 자사 전체 상품 (brand_id FK)

ranking_snapshots   ← 핵심 수집 테이블
  (product_id, snapshot_date, category_code, gender_filter, age_filter, rank_position)
  189 조합 × 100건 = 18,900건/일

promotions      타임딜·세일탭 (product_id FK)

reviews         자사 브랜드 리뷰 텍스트 전체 (product_id FK)
  최초: 전체 수집
  이후: 증분 (musinsa_review_id UNIQUE)

review_analysis LLM 저점/고점 분석 결과 (product_id FK)

own_sales_daily Snowflake ERP 일별 매출 집계
own_inventory   Snowflake ERP 재고 스냅샷

dart_companies  DART 기업 코드 매핑
dart_disclosures 공시 목록
dart_financials  재무제표 (상장: finstate API / 비상장: XML 파싱)
```

---

## 크론 스케줄 (목표)

| 시각 | 작업 |
|---|---|
| 01:00 | 무신사 랭킹 수집 (189 조합, DAILY) |
| 02:00 | 자사 리뷰 수집 (증분) |
| 03:00 | 상품 상세 수집 (색상·가격 등) |
| 04:00 | 프로모션·타임딜 수집 |
| 05:00 | 이상탐지 |
| 06:00 | ERP 매출 (Snowflake) |
| 07:00 | ERP 재고 (Snowflake) |
| 매주 일요일 06:00 | DART 주간 공시 |
| 분기 1일 07:00 | DART 분기 재무 |
| 4월 1일 08:00 | DART 감사보고서 |
| 매주 월요일 03:00 | LLM 리뷰 분석 |

---

## Viewer 화면 구조 (목표)

```
/                     홈 대시보드
/market               시장 허브
/market/segment       성별×나이대 세그먼트 분석 (상품기획 핵심)
/market/companies     98사 재무 목록 (재무 핵심)
/market/[slug]        회사 상세 (브랜드·재무·이상탐지)
/own                  자사 허브
/own/sales            ERP 매출 분석
/own/reviews          CS 리뷰 분석 (CS 핵심)
/signal               이상탐지 목록
/ops                  운영 도구
```

---

## 로드맵

| Week | 목표 |
|---|---|
| 1 | 수집 기반 — ranking_snapshots 189조합, promotions |
| 2 | 자사 데이터 — 전체 상품 수집, 리뷰 텍스트, ERP 연동 |
| 3 | 분석 — 이상탐지, LLM 리뷰 분석 |
| 4 | Viewer — 3개 부서 화면 |

---

## 환경변수 목록

```bash
# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=          # worker 전용
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=               # 실제 도메인 (localhost 아님)
NEXT_PUBLIC_USE_MOCK=false          # 반드시 false

# Snowflake
SNOWFLAKE_ACCOUNT=A7267140136571-BCAVE_ADMIN
SNOWFLAKE_USER=BI
SNOWFLAKE_PRIVATE_KEY_PATH=/Users/macmini/projects/uttu/.secret/pbi_it_svc_pkcs8.pem
SNOWFLAKE_PRIVATE_KEY_PASSPHRASE=
SNOWFLAKE_WAREHOUSE=BCAVE_WH
SNOWFLAKE_DATABASE=BCAVE
SNOWFLAKE_SCHEMA=SEWON
SNOWFLAKE_ROLE=BI

# DART
DART_API_KEY=

# 알림
SLACK_BOT_TOKEN=
NOTION_TOKEN=
```
