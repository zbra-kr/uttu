# UTTU 데일리 브리핑 — 설계 확정

> Stage 0 조사 결과. 2026-05-26 작성.

---

## 1. 데이터 소스 매핑

### Executive (경영진) — 3~5분

| 카드 | 데이터 소스 | 쿼리 핵심 |
|---|---|---|
| 자사 어제 변동 | `ranking_snapshots` | `is_own=true`, snapshot_date = 어제·그제, category_code='000', gender='A', age='AGE_BAND_ALL' |
| 금주 자사 트렌드 | `ranking_snapshots` | 동일 조건, snapshot_date >= 이번주 월요일 |
| 경쟁사 경영지표 | `dart_financials` + `companies` | fiscal_year 최신, brands.is_own=false join |
| DART 신규 공시 | `dart_disclosures` JOIN `companies` | rcept_dt = 어제 |
| 이상탐지 | `anomalies` | detection_date = 어제, severity='high', module IN ('product_planning','brand_planning') |
| 외부 뉴스 | `external_news` (신규) | collected_date = 어제, relevance >= 3 ORDER BY relevance DESC |

### Staff (임직원) — 7~10분

| 카드 | 데이터 소스 |
|---|---|
| 상품 랭킹 변동 | `ranking_snapshots` 어제 vs 그제 |
| 프로모션 동향 | `promotion_items` + `promotions` snapshot_date = 어제 |
| 이상탐지 (전체) | `anomalies` detection_date = 어제, ALL severity |
| 경쟁사 추이 | `ranking_snapshots` brand_name IN (경쟁사), 어제 vs 7일전 |
| 무신사 트렌드 | `magazine_articles` published_at >= 3일전, view_count DESC |
| 추천판 | `recommend_modules` + `recommend_items` snapshot_date = 어제 |

### CS — 5분

| 카드 | 데이터 소스 |
|---|---|
| 오늘 자사 리뷰 | `reviews` JOIN `products` JOIN `brands(is_own=true)`, review_date = 어제 |
| 저점 리뷰 패턴 | `reviews` rating <= 2, review_date >= 7일전, LIMIT 50 (텍스트 LLM 요약) |
| 고점 리뷰 패턴 | `reviews` rating >= 4, review_date >= 7일전, LIMIT 50 |
| 이상탐지 (CS) | `anomalies` detection_date = 어제, module = 'cs' |

---

## 0. 확정된 설계 결정 (2026-05-26 정호철 확인)

| 항목 | 결정 | 비고 |
|---|---|---|
| `/today` 라우팅 | **탭 UI — 분기 없음** | executive·staff·cs 탭 3개, 누구나 모두 열람 가능 |
| 브리핑 실패 fallback | **당일 재시도 1회** (30분 후) | 재시도도 실패 시 EmptyState |
| `default_briefing` 컬럼 용도 변경 | **기본 선택 탭 저장** | auto='executive', 사용자가 마지막에 본 탭 기억 (선택사항) |

### Stage 4 구조 변경 (원본 DAILY_BRIEFING_PROMPT.md 대비)

```
# 원본 (자동 분기)
/today             → redirect to /today/executive or /today/staff or /today/cs
/today/executive
/today/staff
/today/cs

# 확정 (탭 UI)
/today             → 탭 3개 (executive·staff·cs) 한 페이지에
```

---

## 2. profiles.team 현재 분포

실제 데이터 조회 결과 (2026-05-26 기준, 총 15명):

| team | role | 인원 |
|---|---|---|
| NULL | viewer | 10명 |
| IT팀 | admin | 2명 |
| IT팀 | viewer | 1명 |
| 우먼기획팀 | viewer | 1명 |
| NULL | admin | 1명 |

### 핵심 발견

- **`default_briefing` 컬럼 없음** — `profiles` 테이블에 존재하지 않음. 반드시 추가 필요.
- **team 값이 계획과 다름** — 'executive', 'cs', 'staff' 아님. 실제 팀명('IT팀', '우먼기획팀') 사용 중.
- **team 기반 자동 분기는 현실적으로 불가** — 현재 등록 사용자 대부분이 `team=NULL`.
- **결론**: `default_briefing` 컬럼에 각 사용자가 직접 선택하는 방식이 현실적.
  `/today` 진입점은 `default_briefing != 'auto'`면 그것으로, `'auto'`거나 NULL이면 `role='admin'` → executive, 그 외 → staff로 분기.

### Stage 1 마이그레이션 3 결정

- `profiles.default_briefing TEXT CHECK IN ('executive','staff','cs','auto') DEFAULT 'auto'` — 추가
- `profiles.team` CHECK 제약 **추가하지 않음** — 실제 팀명이 자유 텍스트이므로 현재 TEXT 자유 입력 유지 (Option A)

---

## 3. LLM 호출 방식 결정

### worker에서 사용할 SDK

- **Anthropic Python SDK `0.104.1`**: 이미 worker venv에 설치됨.
- **`pyproject.toml`에 미등재** — Stage 2에서 `"anthropic>=0.100"` 추가 필요.
- **web_search_20250305 도구**: SDK에서 지원 확인 (`WebSearchTool20250305Param` import 성공).

### 뉴스 수집 (news_collector.py)

```python
# 사용 가능한 도구
from anthropic.types import WebSearchTool20250305Param

tool = {"type": "web_search_20250305"}
```

- **TAVILY_API_KEY**: `.env`에 없음 — Tavily 불가. Anthropic `web_search_20250305` 전용 사용.
- **모델**: `claude-haiku-4-5-20251001` (뉴스 요약, 비용 최소)

### 브리핑 생성 (briefing_writer.py)

- **모델**: `claude-sonnet-4-6` (브리핑 3종)
- **web_search 미사용** — 입력 데이터를 DB에서 수집 후 텍스트 전달
- **비동기**: `anthropic.AsyncAnthropic`, `asyncio.gather` 3종 병렬

### viewer에서의 LLM

- **재사용 없음** — 브리핑은 사전 생성 후 DB 저장. viewer는 `daily_briefings` 테이블 SELECT만.
- 기존 `viewer/src/lib/llm/claude.ts` (`ClaudeAdapter`)는 건드리지 않음.

---

## 4. 일정·예상 토큰량

### cron 스케줄 (기존 + 신규)

```
02:00~04:00  기존 수집 (랭킹·프로모션·스냅·매거진·리뷰)
04:00        상품 상세 TOP50
05:00        이상탐지
05:30        ← 신규: 외부 뉴스 수집 (web_search × 9쿼리)
06:00        ← 신규: 브리핑 생성 (executive·staff·cs 3종)
```

### 토큰 예상 (일일)

| 작업 | 모델 | 입력 | 출력 | 일계 |
|---|---|---|---|---|
| 뉴스 9쿼리 수집 | haiku-4-5 | 9 × ~2K = 18K | 9 × ~1K = 9K | 27K |
| briefing executive | sonnet-4-6 | ~6K | ~2K | 8K |
| briefing staff | sonnet-4-6 | ~6K | ~2.5K | 8.5K |
| briefing cs | sonnet-4-6 | ~5K | ~2K | 7K |
| **일계** | | | | **~50K** |
| **월계** | | | | **~1.5M** |

> 비용 추산: haiku-4-5 ($0.80/M input, $4/M output), sonnet-4-6 ($3/M input, $15/M output)
> 월 예상 ≈ 뉴스 $0.45 + 브리핑 $2.10 = **월 약 $2.5 추가**

---

## 5. queries-report.ts 재사용 가능성 분석

`fetchDailyReport()`는 브리핑 입력 데이터로 **직접 재사용 불가** — 이유:
1. 브라우저(client-side) supabase client 사용 (`supabaseBrowser()`). Worker는 서버사이드 service_role 클라이언트 필요.
2. 함수가 단일 날짜 전용. 브리핑 worker는 `target_date` 파라미터가 필요.
3. `competitor_brands` 테이블 사용 — 이 테이블 존재는 확인 필요 (queries-report.ts에서 참조).

**브리핑 worker 전용 `_briefing_queries.py`를 신규 작성** (Stage 3).

### 재사용 가능한 집계 로직

queries-report.ts에서 아래 패턴을 Python으로 재구현:

```python
# 1. 최신 날짜
latest = client.table('ranking_snapshots')...eq('category_code','000')...order('snapshot_date', desc=True).limit(1)

# 2. 자사 브랜드 어제 vs 그제 rank_change
today_own = ... WHERE brand_name IN own_brands AND snapshot_date = yesterday
prev_own  = ... WHERE brand_name IN own_brands AND snapshot_date = day_before

# 3. 이상탐지
anomalies = ... WHERE detection_date = yesterday AND severity = 'high'

# 4. 매거진 최신
magazine = ... ORDER BY view_count DESC LIMIT 5
```

---

## 6. 이상탐지 데이터 현황 (2026-05-29 기준)

| severity | module | 건수 |
|---|---|---|
| medium | product_planning | 385 |
| medium | magazine | 75 |
| medium | brand_planning | 32 |
| high | magazine | 14 |
| high | cs | 10 |
| high | product_planning | 7 |
| low | brand_planning | 5 |
| low | product_planning | 38 |
| high | brand_planning | 2 |

- **누적 총 573건**. 일별로는 10~30건 예상.
- **magazine 모듈 이상탐지 多** — 브리핑 프롬프트에서 magazine 모듈 이상탐지 처리 방법 명시 필요.
- **cs 모듈 10건** — CS 브리핑에서 직접 활용 가능.

---

## 7. DART 공시 현황

- 매일 수집 중 (2026-05-29 최신).
- 패션 경쟁사 직접 공시는 드문 편 — `companies` JOIN으로 패션 관련 회사만 필터.
- 브리핑 기준: `rcept_dt = 어제` + 자사 보유 company_id 또는 알려진 경쟁사 corp_code.

---

## 8. reviews 현황

- **총 206,227건** (oldest: 2015-09-25, newest: 2026-05-29)
- 저점(≤2): 1,126건 (0.55%) — CS 브리핑 패턴 분석 충분
- 고점(≥4): 201,430건 (97.7%)
- 어제 리뷰는 `review_date = 어제` 로 필터. CS 브리핑은 어제 신규 리뷰 + 최근 7일 패턴 혼합.

---

## 9. Stage 1 마이그레이션 파일 목록 초안

| 파일명 | 내용 |
|---|---|
| `01300_daily_briefings.sql` | `daily_briefings` 테이블 (briefing_date, audience PK, headline, daily_brief, weekly_brief, card_comments JSONB, insights JSONB, news_picks JSONB, generated_at, model, input_tokens, output_tokens, generation_ms) |
| `01301_external_news.sql` | `external_news` 테이블 (id UUID, collected_date, category, headline, summary, source_url UNIQUE, source_name, relevance 1~5, related_brands, related_companies, published_at, collected_at) |
| `01302_profiles_briefing.sql` | `profiles.default_briefing TEXT CHECK ('executive','staff','cs','auto') DEFAULT 'auto'` 컬럼 추가. team CHECK 제약 추가 안 함. |

---

## 10. 위험 요소 및 의문점

### 🔴 높음

1. **자동 분기 → 탭 UI로 변경 확정** — `/today`는 탭 3개(executive·staff·cs). 누구나 모두 열람. `default_briefing` 컬럼은 기본 선택 탭 기억 용도로만 사용.

2. **reviews.review_date 수집 갭** — CS 브리핑이 "어제 신규 리뷰"를 사용하는데, 리뷰 수집이 전날 02:00에 이루어지므로 브리핑 생성 시점(06:00)에는 어제 수집이 완료됨. 순서 문제 없음.

### 🟡 중간

3. **web_search_20250305 비용 모니터링** — Anthropic 자체 web search는 검색 결과 토큰도 청구됨. 9쿼리 × 검색결과 수에 따라 실제 토큰이 예측치보다 클 수 있음. 첫 실행 후 실측 필요.

4. **magazine 모듈 이상탐지 비중 大** — magazine high 14건은 매거진 기사 조회수 급등 등. 브리핑에서 의미있게 전달할 방법 별도 고려 필요 (executive는 무시, staff는 트렌드 시그널로 활용).

5. **`anthropic` 미등재 pyproject.toml** — Stage 2 전에 `pyproject.toml`에 `"anthropic>=0.100"` 추가 후 `uv sync` 필요.

6. **브리핑 생성 실패 fallback 확정** — 실패 시 30분 후 1회 재시도. 재시도도 실패 시 collection_jobs.status='error' 기록, 해당 날짜 EmptyState 표시.

### 🟢 낮음

7. **`competitor_brands` 테이블** — queries-report.ts에서 참조됨. worker에서도 경쟁사 필터에 활용할 수 있으나, 없는 경우 `brands.is_own=false` 전체로 대체 가능.

8. **daily_briefings RLS** — SELECT는 모든 authenticated 허용. 같은 회사 구성원이므로 별도 행 수준 필터 불필요. service_role INSERT는 RLS bypass.

---

## 11. 파일 경로 요약 (Stage 1~4 예정)

```
supabase/migrations/
  01300_daily_briefings.sql    ← Stage 1
  01301_external_news.sql      ← Stage 1
  01302_profiles_briefing.sql  ← Stage 1

worker/
  agent/
    __init__.py                ← 이미 존재 (비어있음)
    news_collector.py          ← Stage 2
    briefing_writer.py         ← Stage 3
    _briefing_queries.py       ← Stage 3

scripts/
  run_news.sh                  ← Stage 2
  run_briefing.sh              ← Stage 3

viewer/src/app/(app)/today/
  page.tsx                     ← Stage 4 (자동 분기)
  executive/page.tsx           ← Stage 4
  staff/page.tsx               ← Stage 4
  cs/page.tsx                  ← Stage 4

viewer/src/lib/
  queries-briefing.ts          ← Stage 4

viewer/src/components/briefing/
  BriefingHeadline.tsx         ← Stage 4
  BriefingCard.tsx             ← Stage 4
  BriefingInsight.tsx          ← Stage 4
  NewsPickList.tsx             ← Stage 4
```
