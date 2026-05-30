# UTTU 데일리 브리핑 — Claude Code 작업 프롬프트 (v2)

> UTTU에 페르소나별 데일리 매거진(`/today`)을 추가하는 작업의 마스터 프롬프트.
> **v2 변경점**: 자동 분기 정책 폐기. 모든 사용자가 모든 카테고리를 자유롭게 본다 (탭으로 전환).
> 6개 Stage로 분할. **각 Stage 끝날 때마다 정호철이 검증 후 다음 Stage 진행**.

---

## 0. 전체 컨텍스트 (모든 Stage 공통)

### 무엇을 만드는가

UTTU의 24개 페이지를 **하루 5~10분 안에 다 훑을 수 있는 매거진**으로 재구성. 기존 페이지 그대로 두고, 진입점만 새로 만든다.

3개 카테고리를 **단일 페이지 `/today` 안에 탭으로** 노출:

| 탭 | 카테고리 | 시간 예산 | 핵심 |
|---|---|---|---|
| Executive | 경영진 시점 | 3~5분 | 자사 어제·금주 특이점 + 경쟁사 경영지표 + 외부 패션 뉴스 |
| Staff | 임직원 시점 | 7~10분 | 자사 상품 일간·주간 이슈 + 경쟁사 변동 추이 |
| CS | CS 시점 | 5분 | 자사 리뷰 패턴·문제점·강점 |

### 핵심 원칙

```
✅ 권한·role 구분 없이 모두가 모든 탭 자유롭게 본다
✅ LLM 텍스트는 매일 새벽에 사전 생성 → DB 저장 → viewer는 즉시 표시
✅ 매거진 카드 클릭 → 기존 상세 페이지로 드릴다운
✅ 그래프 최소, 텍스트·KPI 위주
✅ 자사 영향이 큰 정보 우선 노출
✅ URL로 직접 탭 진입 가능 (/today?tab=executive · /today?tab=staff · /today?tab=cs)
✅ 기본 탭: executive
```

### Stage 0 결정사항 (이미 완료됨)

- **자동 분기 X** — profile.team이나 role 기반 분기 안 함. 누구나 모든 탭 본다.
- **default_briefing 컬럼 만들지 않음** — 개인 설정 불필요.
- **fallback** — 브리핑 생성 실패 시 재시도 없음, EmptyState 표시. `collection_jobs.error_msg`에 사유 기록 후 정호철이 admin/jobs에서 보고 수동 재실행.

---

## 1. 작업 전 반드시 읽어야 할 파일 (모든 Stage 공통)

```
1. /Users/macmini/projects/uttu/CLAUDE.md
2. /Users/macmini/projects/uttu/docs/CLAUDE.md
3. /Users/macmini/projects/uttu/docs/UTTU-OVERVIEW.md
4. /Users/macmini/projects/uttu/docs/daily-briefing-design.md   (Stage 0 산출물)
5. /Users/macmini/projects/uttu/docs/skills/02-supabase.md   (DB 작업 시)
6. /Users/macmini/projects/uttu/docs/skills/07-viewer.md     (뷰어 작업 시)
7. /Users/macmini/projects/uttu/docs/anomaly-detection-spec.md  (브리핑 입력)
```

추가로 해당 Stage 관련 기존 파일을 읽고 작업.

---

## 2. 절대 하지 말 것 (모든 Stage 공통)

```
❌ 마이그레이션 자동 적용 — SQL 파일만 작성, 정호철이 SQL Editor에서 직접 실행
❌ cron 자동 등록 — 등록할 라인만 보고
❌ service_role 키를 클라이언트 코드('use client')에 포함
❌ CSS hex 하드코딩 — viewer/src/styles/tokens.css 변수만
❌ const { data } = await query — error 변수 필수
❌ PostgREST 1000행 상한 무시 — .limit() 또는 .range() 명시
❌ mock 데이터 — 데이터 없으면 EmptyState 컴포넌트
❌ 기존 /report 페이지 삭제 — "심층 리포트"로 라벨만 변경, 페이지 유지
❌ 무신사 스크래핑 규칙 변경 — SCRAPE_MIN_DELAY_SEC=3.0, semaphore=1 절대 유지
❌ 리뷰 닉네임·사용자ID 수집·저장·표시
❌ profiles.team / profiles.role 기반 자동 분기 로직 추가 (정책 폐기)
❌ profiles 테이블 컬럼 추가 (default_briefing 등 만들지 마)
```

---

## 3. 보고 형식 (모든 Stage 공통)

작업 완료 시:

```
[1] 작업 요약 (1~2줄)
[2] 생성·수정된 파일 목록
[3] 마이그레이션 (정호철 SQL Editor 적용 필요)
[4] cron 등록 (정호철 직접 등록 필요) — 등록할 라인만 명시
[5] 검증 방법 (dry-run 명령 등)
[6] 다음 Stage 권장
[7] commit hash
```

---

## 4. Stage 진행 순서

```
Stage 0 → ✅ 완료 (사전 조사 + docs/daily-briefing-design.md)
Stage 1 → DB 마이그레이션 2개 (daily_briefings + external_news)
Stage 2 → 외부 뉴스 수집 워커
Stage 3 → 브리핑 생성 워커
Stage 4 → /today 단일 페이지 + 탭 3개
Stage 5 → 사이드바 메뉴 추가 + /report 라벨 변경
Stage 6 → cron 등록 안내 + Teams 알림 + 통합 검증
```

각 Stage 끝나면 보고 → 정호철이 검증 → 다음 Stage 진입.

---

## Stage 1 — DB 마이그레이션 2개

### 목표

데일리 브리핑에 필요한 DB 스키마 2개. **적용은 정호철이 직접.**

**중요**: profile 확장 마이그레이션은 **만들지 않는다.** 자동 분기 정책 폐기됨.

### 마이그레이션 1: `supabase/migrations/01300_daily_briefings.sql`

```sql
-- 데일리 브리핑 — 카테고리별 매거진 LLM 사전 생성 결과 저장
-- 매일 06:00 worker/agent/briefing_writer.py 가 audience 3종(executive/staff/cs) 생성 후 upsert
-- 모든 사용자가 모든 audience 자유롭게 조회 (탭으로 전환)
-- 적용: SQL Editor 수동 실행

CREATE TABLE daily_briefings (
  briefing_date     DATE NOT NULL,
  audience          TEXT NOT NULL CHECK (audience IN ('executive', 'staff', 'cs')),

  -- 헤드라인·리드
  headline          TEXT NOT NULL,
  daily_brief       TEXT[] NOT NULL,     -- 어제의 핵심 3줄
  weekly_brief      TEXT[],              -- 금주의 핵심 (executive·staff)

  -- 카드 코멘트
  card_comments     JSONB NOT NULL,
    -- audience 별로 키 다름. 예:
    -- executive: {"competitor": "...", "news": "...", "own_ranking": "...", "anomaly": "..."}
    -- staff:     {"own_ranking": "...", "promotion": "...", "anomaly": "...",
    --             "review": "...", "competitor": "...", "trend": "..."}
    -- cs:        {"today_reviews": "...", "low_pattern": "...",
    --             "high_pattern": "...", "problem_product": "..."}

  -- 인사이트 N선 (audience 따라 개수 다름: executive=3, staff=5, cs=3)
  insights          JSONB NOT NULL,
    -- [{ "title": "...", "body": "...", "link": "/ranking?..." }, ...]

  -- 외부 뉴스 (executive 전용)
  news_picks        JSONB,
    -- [{ "headline": "...", "summary": "...", "source_name": "...", "source_url": "...", "relevance": 5 }, ...]

  -- 메타
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  model             TEXT NOT NULL,           -- "claude-sonnet-4-6" 등
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  generation_ms     INTEGER,                 -- 생성 소요 시간 ms

  PRIMARY KEY (briefing_date, audience)
);

CREATE INDEX daily_briefings_date_idx ON daily_briefings(briefing_date DESC);

COMMENT ON TABLE  daily_briefings IS
  '카테고리별 데일리 매거진 — 매일 1회 사전 생성. 모든 사용자가 모든 audience 조회.';
COMMENT ON COLUMN daily_briefings.audience      IS
  'executive: 경영진 시점 / staff: 임직원 시점 / cs: CS 시점. 권한 구분 아님 — 콘텐츠 카테고리.';
COMMENT ON COLUMN daily_briefings.card_comments IS '카드별 1줄 LLM 코멘트 JSON';
COMMENT ON COLUMN daily_briefings.insights      IS '인사이트 N선 — 매거진 형식 [{title, body, link}]';
COMMENT ON COLUMN daily_briefings.news_picks    IS '외부 패션 뉴스 — executive audience 전용';

-- RLS: 인증된 사용자 모두 SELECT, 쓰기는 service_role만
ALTER TABLE daily_briefings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_briefings_select"
  ON daily_briefings FOR SELECT
  TO authenticated USING (true);
```

### 마이그레이션 2: `supabase/migrations/01301_external_news.sql`

```sql
-- 외부 패션 뉴스 — 매일 web_search로 수집 후 LLM 요약·분류
-- 매일 05:30 worker/agent/news_collector.py 실행
-- 적용: SQL Editor 수동 실행

CREATE TABLE external_news (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collected_date    DATE NOT NULL,
  category          TEXT NOT NULL CHECK (category IN
                      ('industry', 'own_brand', 'competitor', 'trend', 'platform')),
                    -- industry: 패션 산업 일반
                    -- own_brand: 자사 브랜드(커버낫·리·와키윌리) 언급
                    -- competitor: 경쟁사 직접 언급
                    -- trend: K-패션 트렌드 일반
                    -- platform: 무신사·SSF·29CM 등 플랫폼

  headline          TEXT NOT NULL,
  summary           TEXT,                 -- LLM 요약 (3~5줄)
  source_url        TEXT,
  source_name       TEXT,                 -- "한국경제", "WWD Korea" 등
  relevance         SMALLINT NOT NULL CHECK (relevance BETWEEN 1 AND 5),
                    -- 5: 자사 직접 언급 / 4: 경쟁사 직접 / 3: 산업 영향
                    -- 2: 트렌드 / 1: 일반

  related_brands    TEXT[],               -- 언급된 자사·경쟁사 brand slug
  related_companies TEXT[],               -- 언급된 회사명

  published_at      TIMESTAMPTZ,
  collected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (source_url)
);

CREATE INDEX external_news_date_idx       ON external_news(collected_date DESC);
CREATE INDEX external_news_relevance_idx  ON external_news(collected_date DESC, relevance DESC);
CREATE INDEX external_news_category_idx   ON external_news(category, collected_date DESC);

COMMENT ON TABLE  external_news IS '외부 패션 뉴스 — 매일 web_search 수집 + LLM 요약';
COMMENT ON COLUMN external_news.relevance IS '1~5 (자사 영향도): 5=자사 직접 언급';

ALTER TABLE external_news ENABLE ROW LEVEL SECURITY;
CREATE POLICY "external_news_select"
  ON external_news FOR SELECT TO authenticated USING (true);
```

### 산출물

- 2개 SQL 파일만 생성
- 각 파일 헤더 주석에 적용 순서·검증 SQL 명시
- `00306_collection_jobs.sql` 패턴 따라 RLS·인덱스·코멘트 완비

### 보고

위 보고 형식대로. 적용 순서·검증 SQL:

```sql
-- 검증
SELECT count(*) FROM daily_briefings;     -- 0 기대
SELECT count(*) FROM external_news;        -- 0 기대
```

### ⚠️ Stage 1에서 절대 하지 말 것

- 마이그레이션 자동 적용 금지
- worker·viewer 코드 작성 금지
- profiles 테이블 ALTER 또는 컬럼 추가 금지

---

## Stage 2 — 외부 뉴스 수집 워커

### 목표

매일 05:30에 web_search로 패션 뉴스 9개 쿼리로 수집, LLM이 요약·분류·relevance 점수 부여 후 `external_news` 테이블에 upsert.

### 신규 파일: `worker/agent/__init__.py` (비어있으면 생성)

### 신규 파일: `worker/agent/news_collector.py`

#### 검색 쿼리 9개

```python
TODAY_KST = datetime.now(KST).strftime("%Y년 %m월")

SEARCH_QUERIES = [
    # 자사 브랜드 (relevance 5 후보)
    f"커버낫 {TODAY_KST}",
    f"리(LEE) 한국 {TODAY_KST}",
    f"와키윌리 {TODAY_KST}",

    # 경쟁사 (relevance 4 후보)
    f"영원무역 공시 {TODAY_KST}",
    f"한세실업 매출 {TODAY_KST}",

    # 플랫폼 (relevance 3~4)
    f"무신사 {TODAY_KST}",

    # 산업 트렌드 (relevance 2~3)
    f"K-패션 트렌드 {TODAY_KST}",
    f"패션 산업 뉴스 {TODAY_KST}",
    f"한국 패션 매출 {TODAY_KST}",
]
```

#### LLM 호출 방식

- Anthropic Python SDK + web_search_20250305 도구 활용
- 모델: `claude-haiku-4-5-20251001` (비용 최소)
- 시스템 프롬프트로 JSON 강제:

```python
SYSTEM_PROMPT = """당신은 B.CAVE(패션 회사) 임직원을 위한 뉴스 큐레이터다.

자사 브랜드: 커버낫(Covernat), 리(LEE), 와키윌리(WackyWilly)
경쟁사: 영원무역, 한세실업, 신성통상, 이랜드월드, F&F, LF, 한섬, 무신사스탠다드, 디스이즈네버댓 등

주어진 쿼리로 web_search를 실행하고, 발견한 뉴스를 다음 JSON 배열로만 응답하라.
JSON 외 다른 텍스트는 절대 포함하지 마라.

[
  {
    "headline": "뉴스 제목 (50자 이내)",
    "summary":  "3~5줄 한국어 요약 (반드시 출처 표기)",
    "source_url":  "https://...",
    "source_name": "한국경제",
    "category":  "industry|own_brand|competitor|trend|platform",
    "relevance": 1-5,
    "related_brands":    ["covernat", "lee"],
    "related_companies": ["커버낫", "B.CAVE"],
    "published_at": "2026-05-27T09:00:00Z"
  }
]

규칙:
- 자사 브랜드 직접 언급 → relevance 5
- 경쟁사 직접 언급 → relevance 4
- 산업 매출·공시 → relevance 3
- 트렌드 일반 → relevance 2
- 그 외 → relevance 1
- 동일 뉴스 중복 절대 금지 (source_url 기준)
- 최근 7일 이내 뉴스만
- 광고·낚시 기사는 제외
- 1쿼리당 최대 3건"""
```

#### 처리 흐름

```python
async def collect_news() -> int:
    """매일 1회 실행. 9개 쿼리 → LLM → external_news upsert."""

    # 1. collection_jobs INSERT (status='running')
    # 2. 9개 쿼리 순회
    #    - 각 쿼리당 Anthropic API 호출 (web_search 도구 활성)
    #    - 응답에서 JSON 배열 파싱
    #    - 실패 시 continue (전체 중단 금지)
    # 3. 중복 제거 (source_url UNIQUE)
    # 4. external_news.upsert (on_conflict='source_url', ignore_duplicates=True)
    # 5. collection_jobs UPDATE (status='done', rows_done=N)
    # 6. 총 수집 건수 반환
```

#### 환경변수 확인

```python
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
# .env에 이미 있을 것 (viewer 측 AI 채팅에서 사용 중) — 없으면 보고
```

### 신규 파일: `scripts/run_news.sh`

다른 `scripts/run_*.sh` 패턴 그대로:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"

LOG_FILE="$LOG_DIR/news_$(date +%Y%m%d_%H%M%S).log"

cd "$PROJECT_DIR"
echo "[news] 시작 $(date '+%Y-%m-%d %H:%M:%S')" | tee "$LOG_FILE"

"$PROJECT_DIR/worker/.venv/bin/python3" -m worker.agent.news_collector 2>&1 | tee -a "$LOG_FILE"

echo "[news] 완료 $(date '+%Y-%m-%d %H:%M:%S')" | tee -a "$LOG_FILE"
```

### 검증

```bash
# Dry-run (응답 JSON 파싱만, DB 적재 안 함)
worker/.venv/bin/python3 -m worker.agent.news_collector --dry-run

# 본 실행
worker/.venv/bin/python3 -m worker.agent.news_collector
```

```sql
-- 검증 SQL
SELECT collected_date, category, relevance, headline, source_name
FROM external_news
WHERE collected_date = current_date
ORDER BY relevance DESC, collected_at DESC;
```

### 보고

위 형식대로 + 추가:

- 첫 실행 결과 (수집 건수·카테고리 분포·relevance 분포)
- LLM 응답 샘플 1건 (성공 케이스)
- 실패 케이스 있으면 원인

### ⚠️ Stage 2에서 절대 하지 말 것

- cron 자동 등록 (Stage 6에서 안내만)
- DB 마이그레이션 추가 작성 (Stage 1에서 끝)

---

## Stage 3 — 브리핑 생성 워커

### 목표

매일 06:00에 audience 3종(`executive`/`staff`/`cs`)의 브리핑을 생성 후 `daily_briefings`에 upsert.

### 신규 파일: `worker/agent/briefing_writer.py`

#### 입력 데이터 수집 (LLM 호출 전)

```python
def collect_briefing_inputs(target_date: date) -> dict:
    """LLM에 넘길 사전 집계 데이터 수집."""
    return {
        "date":             target_date,
        "weekday":          target_date.strftime("%A"),

        # 자사 어제 변동
        "own_ranking_delta":    fetch_own_ranking_delta(target_date),
        "own_brand_avg_rank":   fetch_own_brand_avg_rank(target_date),

        # 금주 누적 (월요일부터 target_date까지)
        "own_weekly_trend":     fetch_own_weekly_trend(target_date),

        # 어제 이상탐지
        "anomalies_high":   fetch_anomalies(target_date, severity='high'),
        "anomalies_med":    fetch_anomalies(target_date, severity='medium'),

        # 경쟁사 동향
        "competitor_top_movers":    fetch_competitor_movers(target_date),
        "competitor_new_entrants":  fetch_new_entrants_top10(target_date),

        # 프로모션
        "active_promotions":        fetch_active_promotions(target_date),

        # 자사 리뷰 (어제)
        "review_summary":           fetch_review_summary(target_date),

        # DART 신규 공시
        "dart_new_disclosures":     fetch_dart_disclosures(target_date),

        # 외부 뉴스 (executive 전용)
        "news_picks":               fetch_external_news(target_date, min_relevance=3),

        # 자사 매출 (Snowflake 연동 시 — 현재 비어있으면 빈 dict)
        "own_sales":                fetch_own_sales(target_date) or {},
    }
```

각 fetch 함수는 `worker/agent/_briefing_queries.py` 신규 파일에 분리:

- `fetch_own_ranking_delta(date)` — ranking_snapshots WHERE is_own=true, 어제 vs 그제
- `fetch_own_weekly_trend(date)` — 월요일~target_date 누적
- `fetch_anomalies(date, severity)` — 동일 날짜 + severity, 자사 우선
- `fetch_competitor_movers(date)` — rank_spike + new_entrant_top10
- `fetch_dart_disclosures(date)` — rcept_dt = 어제, 자사·경쟁사 회사
- (기타)

#### LLM 호출 — audience별 3회

```python
async def generate_briefing(audience: str, inputs: dict) -> dict:
    system_prompt = SYSTEM_PROMPTS[audience]
    user_message  = format_user_message(audience, inputs)

    client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    resp = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4000,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )

    # JSON 파싱
    text = resp.content[0].text
    parsed = json.loads(text)

    return {
        "audience": audience,
        "headline": parsed["headline"],
        "daily_brief": parsed["daily_brief"],
        "weekly_brief": parsed.get("weekly_brief"),
        "card_comments": parsed["card_comments"],
        "insights": parsed["insights"],
        "news_picks": parsed.get("news_picks") if audience == "executive" else None,
        "model": "claude-sonnet-4-6",
        "input_tokens": resp.usage.input_tokens,
        "output_tokens": resp.usage.output_tokens,
    }
```

#### 시스템 프롬프트 3종

**부록 A** 참조 (이 문서 하단). 각 audience별로 다른 시스템 프롬프트.

#### 실행 흐름

```python
async def run(target_date: date) -> None:
    # 1. collection_jobs INSERT (script='briefing_writer')
    # 2. 입력 데이터 수집
    inputs = collect_briefing_inputs(target_date)

    # 3. audience 3종 병렬 생성 (asyncio.gather)
    results = await asyncio.gather(
        generate_briefing("executive", inputs),
        generate_briefing("staff", inputs),
        generate_briefing("cs", inputs),
        return_exceptions=True,
    )

    # 4. daily_briefings upsert (성공한 것만)
    success_count = 0
    error_msgs = []
    for r in results:
        if isinstance(r, Exception):
            error_msgs.append(str(r))
            logger.error("briefing_generation_failed", error=str(r))
            continue
        client.table("daily_briefings").upsert({
            "briefing_date": target_date.isoformat(),
            "audience": r["audience"],
            "headline": r["headline"],
            "daily_brief": r["daily_brief"],
            "weekly_brief": r["weekly_brief"],
            "card_comments": r["card_comments"],
            "insights": r["insights"],
            "news_picks": r["news_picks"],
            "model": r["model"],
            "input_tokens": r["input_tokens"],
            "output_tokens": r["output_tokens"],
        }, on_conflict="briefing_date,audience").execute()
        success_count += 1

    # 5. collection_jobs UPDATE
    if error_msgs:
        # 일부 또는 전체 실패 — error_msg 기록
        update_job(status='error', error_msg='\n'.join(error_msgs), rows_done=success_count)
    else:
        update_job(status='done', rows_done=success_count)
```

### 신규 파일: `scripts/run_briefing.sh`

`scripts/run_news.sh` 패턴 그대로. `--date` 인자 지원:

```bash
worker/.venv/bin/python3 -m worker.agent.briefing_writer "$@"
```

### 검증

```bash
# Dry run (LLM 호출 안 하고 입력 데이터만 출력)
worker/.venv/bin/python3 -m worker.agent.briefing_writer --date 2026-05-27 --dry-run

# 실제 실행
worker/.venv/bin/python3 -m worker.agent.briefing_writer --date 2026-05-27
```

```sql
-- 검증 SQL
SELECT audience, headline, jsonb_array_length(insights) AS insight_count
FROM daily_briefings
WHERE briefing_date = '2026-05-27';
-- 기대: executive(3) / staff(5) / cs(3)
```

### 보고

위 형식대로 + 추가:

- 3종 audience 각각 생성된 헤드라인 (가독성·자연스러움 평가용)
- 토큰 사용량 합계
- 생성 소요 시간

### ⚠️ Stage 3에서 절대 하지 말 것

- 뷰어 페이지 작성 금지 (Stage 4)
- cron 자동 등록 금지

---

## Stage 4 — `/today` 단일 페이지 + 탭 3개

### 목표

`/today` 한 페이지에 탭 3개(Executive/Staff/CS) 구현. **모든 사용자가 모든 탭 자유롭게 본다.**

### 디렉토리 구조

```
viewer/src/app/(app)/today/
└── page.tsx                  # 단일 페이지 — 탭으로 audience 전환

viewer/src/lib/
└── queries-briefing.ts       # 신규

viewer/src/components/briefing/
├── BriefingTabs.tsx          # 탭 네비게이션
├── BriefingHeadline.tsx
├── BriefingCard.tsx
├── BriefingInsight.tsx
└── NewsPickList.tsx
```

### `/today/page.tsx` 구조

```typescript
'use client';
import React from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { fetchAllBriefings, type Briefing } from '@/lib/queries-briefing';
import BriefingTabs from '@/components/briefing/BriefingTabs';
import ExecutiveBriefingView from '@/components/briefing/ExecutiveBriefingView';
import StaffBriefingView from '@/components/briefing/StaffBriefingView';
import CSBriefingView from '@/components/briefing/CSBriefingView';
import EmptyState from '@/components/ui/EmptyState';

type Audience = 'executive' | 'staff' | 'cs';
const VALID_TABS: Audience[] = ['executive', 'staff', 'cs'];

export default function TodayPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: Audience = VALID_TABS.includes(tabParam as Audience)
    ? (tabParam as Audience)
    : 'executive';  // 기본값

  const [briefings, setBriefings] = React.useState<Record<Audience, Briefing | null> | null>(null);
  const [loading, setLoading] = React.useState(true);

  // 한 번에 3개 audience 다 로드 (탭 전환 시 즉각 표시)
  React.useEffect(() => {
    fetchAllBriefings()
      .then(setBriefings)
      .finally(() => setLoading(false));
  }, []);

  const handleTabChange = (newTab: Audience) => {
    router.push(`/today?tab=${newTab}`, { scroll: false });
  };

  if (loading) return <LoadingSkeleton />;

  const current = briefings?.[tab];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 28px' }}>
      <BriefingTabs current={tab} onChange={handleTabChange} briefings={briefings} />

      {!current && (
        <EmptyState
          title="오늘의 브리핑이 아직 준비되지 않았습니다"
          description="매일 06:00 KST 자동 생성됩니다. 새벽 시간에 접속하셨다면 잠시 후 다시 확인해주세요." />
      )}

      {current && tab === 'executive' && <ExecutiveBriefingView briefing={current} />}
      {current && tab === 'staff'     && <StaffBriefingView briefing={current} />}
      {current && tab === 'cs'        && <CSBriefingView briefing={current} />}
    </div>
  );
}
```

### `BriefingTabs.tsx` 디자인

```typescript
// 탭은 페이지 최상단에 sticky
// 각 탭 = 헤드라인 일부 미리보기 (오늘 어떤 내용인지 1줄 노출)
<div style={{ display: 'flex', borderBottom: '1px solid var(--bd)', marginBottom: 24, position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10 }}>
  {VALID_TABS.map(audience => {
    const isActive = current === audience;
    const headline = briefings?.[audience]?.headline ?? '준비 중';
    const label = LABELS[audience];  // "경영진" | "임직원" | "CS"

    return (
      <button
        key={audience}
        onClick={() => onChange(audience)}
        style={{
          padding: '14px 20px',
          borderBottom: isActive ? '2px solid var(--hs)' : '2px solid transparent',
          color: isActive ? 'var(--f1)' : 'var(--f3)',
          background: 'transparent',
          cursor: 'pointer',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--f3)', marginTop: 2, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {headline}
        </div>
      </button>
    );
  })}
</div>
```

### `ExecutiveBriefingView.tsx`

```typescript
export default function ExecutiveBriefingView({ briefing }: { briefing: Briefing }) {
  return (
    <>
      {/* ① 헤드라인 + 어제·금주 브리프 */}
      <BriefingHeadline
        headline={briefing.headline}
        dailyBrief={briefing.daily_brief}
        weeklyBrief={briefing.weekly_brief} />

      {/* ② 4개 카드 — 경쟁사·뉴스·자사·즉시결정 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginTop: 32 }}>
        <BriefingCard icon="🏢" title="경쟁사 경영지표"
          comment={briefing.card_comments.competitor}
          href="/companies" />
        <BriefingCard icon="📰" title="패션 뉴스"
          comment={`${briefing.news_picks?.length ?? 0}건의 뉴스`}
          href="#news" />
        <BriefingCard icon="🛍️" title="자사 한눈에"
          comment={briefing.card_comments.own_ranking}
          href="/ranking?own=true" />
        <BriefingCard icon="⚠️" title="즉시 결정 사항"
          comment={briefing.card_comments.anomaly}
          href="/anomaly?severity=high" />
      </div>

      {/* ③ 외부 뉴스 (executive 전용) */}
      {briefing.news_picks && briefing.news_picks.length > 0 && (
        <section id="news" style={{ marginTop: 40 }}>
          <h2>패션 뉴스</h2>
          <NewsPickList items={briefing.news_picks} />
        </section>
      )}

      {/* ④ 인사이트 3선 */}
      <section style={{ marginTop: 40 }}>
        <h2>이번 주 인사이트</h2>
        {briefing.insights.map((ins, i) =>
          <BriefingInsight key={i} num={i + 1} {...ins} />
        )}
      </section>
    </>
  );
}
```

### `StaffBriefingView.tsx`

executive와 유사하되:
- 뉴스 섹션 없음
- 카드 6개 (own_ranking · promotion · anomaly · review · competitor · trend)
- 인사이트 5선
- 미니 KPI 그리드 추가

### `CSBriefingView.tsx`

- 자사 리뷰만 집중 (저점·고점·LLM 패턴)
- 카드 4개 (today_reviews · low_pattern · high_pattern · problem_product)
- 인사이트 3선 (LLM이 자동 추출한 문제·강점 패턴)

### `lib/queries-briefing.ts`

```typescript
import { supabaseBrowser } from './supabase/client';

export interface Briefing {
  briefing_date: string;
  audience: 'executive' | 'staff' | 'cs';
  headline: string;
  daily_brief: string[];
  weekly_brief: string[] | null;
  card_comments: Record<string, string>;
  insights: Array<{ title: string; body: string; link?: string }>;
  news_picks: Array<{
    headline: string; summary: string;
    source_name: string; source_url: string;
    relevance: number;
  }> | null;
  generated_at: string;
}

export async function fetchAllBriefings(date?: string): Promise<Record<string, Briefing | null>> {
  const sb = supabaseBrowser();
  const target = date ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

  const { data, error } = await sb
    .from('daily_briefings')
    .select('*')
    .eq('briefing_date', target);

  if (error) {
    console.error('[briefing] fetch failed', error);
    return { executive: null, staff: null, cs: null };
  }

  const map: Record<string, Briefing | null> = { executive: null, staff: null, cs: null };
  (data ?? []).forEach((row: any) => {
    map[row.audience] = row as Briefing;
  });
  return map;
}
```

### 컴포넌트 디자인 가이드라인

- 모든 색상: `var(--bg)`, `var(--sur)`, `var(--snk)`, `var(--f1~4)`, `var(--bd)`, `var(--hs)` 등 `tokens.css` 변수만
- 모노스페이스: `var(--mono)`
- 한글: `var(--sans)`
- 헤드라인: 28px·600·var(--f1)
- 리드: 14px·1.7 line-height·var(--f2)
- 카드: `var(--sur)` 배경 + `var(--bd)` 테두리 + border-radius 10
- 인사이트: 매거진처럼 numbering + 제목 + 본문 단락 + 링크
- 탭: sticky top 0, 활성 탭은 `var(--hs)` 하단 보더

### 검증

```bash
cd viewer && npm run build
# 빌드 통과 확인 후 commit

cd viewer && npm run dev
# 로컬 검증:
#   /today              → executive 탭 기본
#   /today?tab=staff    → staff 탭
#   /today?tab=cs       → cs 탭
#   탭 클릭 시 URL ?tab=... 자동 갱신
#   3개 탭 모두 페이지 로드 시 한 번에 받아둠 (탭 전환 즉각)
```

### 보고

위 형식대로 + 추가:

- 빌드 통과 확인
- 탭 전환 UX 동작 확인 (URL 갱신, 즉각 전환)
- 3개 탭별 스크린샷 또는 동작 설명

### ⚠️ Stage 4에서 절대 하지 말 것

- 사이드바 메뉴 수정 (Stage 5에서)
- 기존 `/report` 페이지 삭제·수정
- profile 기반 자동 분기 로직 추가
- `/me` 페이지에 default_briefing 설정 UI 추가

---

## Stage 5 — 사이드바 메뉴 추가 + `/report` 라벨 변경

### 목표

1. 사이드바 메뉴에 `/today` 추가 (홈 바로 아래)
2. 기존 `/report` 라벨을 "심층 리포트"로 변경 (페이지는 그대로)

### 수정: `viewer/src/components/shell/Sidebar.tsx`

```typescript
const ROUTES: RouteItem[] = [
  { id: 'home',     path: '/',        label: '홈',           Icon: IcHome },
  { id: 'today',    path: '/today',   label: '오늘의 매거진', Icon: IcSpark },  // 신규 (홈 바로 아래)
  { id: 'report',   path: '/report',  label: '심층 리포트',   Icon: IcReport }, // 라벨 변경
  // ... 나머지 기존 메뉴 그대로
];
```

`IcSpark`가 적절치 않으면 `IcBook` 또는 새 아이콘 사용. 매거진 느낌 나는 걸로.

### 검증

```bash
cd viewer && npm run build
# 사이드바 메뉴 위치·라벨 확인
# /today 진입 가능 확인
# /report 라벨 "심층 리포트"로 변경됨 확인
```

### 보고

위 형식대로.

### ⚠️ Stage 5에서 절대 하지 말 것

- 사이드바의 다른 메뉴 항목 변경
- `/report` 페이지 자체 수정·삭제
- `/me` 페이지에 default_briefing 설정 UI 추가
- profile 컬럼 추가

---

## Stage 6 — cron 등록 안내 + Teams 알림 + 통합 검증

### 목표

1. cron 라인 안내 (정호철이 직접 등록)
2. 브리핑 생성 완료 후 Teams 알림 enqueue (구독자에게 "오늘의 브리핑" 링크)
3. 전체 통합 검증

### cron 안내 (정호철에게 출력)

```cron
# UTTU 데일리 매거진 — 매일 KST 기준
# 05:30 — 외부 뉴스 수집 (web_search × 9)
30 5 * * * cd /Users/macmini/projects/uttu && scripts/run_news.sh

# 06:00 — 브리핑 생성 (executive/staff/cs 3종)
0 6 * * * cd /Users/macmini/projects/uttu && scripts/run_briefing.sh
```

기존 cron 흐름:

```
02:00 ~ 04:00  수집 (랭킹·프로모션·스냅·매거진·리뷰)
04:00          상품 상세 (TOP50)
05:00          이상탐지
05:30          ← 신규: 외부 뉴스 수집
06:00          ← 신규: 브리핑 생성 (executive·staff·cs)
06:30 ~        ← 신규: Teams 알림 dispatcher (이미 5분 polling 중)
```

### 신규 enqueue 로직

`worker/agent/briefing_writer.py` 마지막에 추가:

```python
from worker.notifications.enqueue import enqueue_for_subscribers

# 모든 audience 성공 생성 후
if success_count == 3:
    enqueue_for_subscribers(
        event_type="daily_summary",        # 기존 enum 재사용
        title="오늘의 매거진 도착",
        body=parsed_headlines["executive"],  # 대표로 executive 헤드라인
        link="/today",
    )
```

알림 1건만 발송 (사용자가 들어가서 탭으로 다른 카테고리 확인). `daily_summary` 구독자만 알림 받음.

### 통합 검증 시나리오

1. **데이터 수집 → 브리핑 생성까지 end-to-end**

```bash
# 1. 외부 뉴스 수집
worker/.venv/bin/python3 -m worker.agent.news_collector
# → external_news 행 추가 확인

# 2. 브리핑 생성
worker/.venv/bin/python3 -m worker.agent.briefing_writer
# → daily_briefings 3행 (audience 3종) 추가 확인

# 3. Teams 알림 dispatch
worker/.venv/bin/python3 -m worker.notifications.dispatcher
# → 구독자에게 발송 확인
```

2. **뷰어 통합 확인**

- 임의 사용자 로그인 → `/today` → executive 탭 기본 표시
- 탭 클릭 → staff·cs 즉각 전환 (페이지 로드 X)
- URL `/today?tab=staff` 직접 진입 → staff 탭 활성화
- `/today?tab=cs` → cs 탭 활성화
- 사이드바에서 "오늘의 매거진" 클릭 → `/today` 진입

3. **에러 케이스**

- briefing 없는 날짜로 접속 → EmptyState 표시
- LLM 생성 일부 실패 시 → 성공한 audience만 표시, 실패는 EmptyState
- `collection_jobs.error_msg` 기록 → `/admin/jobs`에서 확인
- 수동 재실행: `worker/.venv/bin/python3 -m worker.agent.briefing_writer --date YYYY-MM-DD`

### 보고

위 형식대로 + 추가:

- 전체 통합 검증 결과 (시나리오별 PASS/FAIL)
- cron 등록 가이드 (정호철 복사붙여넣기용 라인)
- 일일 예상 비용 (LLM 토큰 × 모델 단가)
- 수동 재실행 절차 정리

### ⚠️ Stage 6에서 절대 하지 말 것

- cron 자동 등록
- 기존 알림 dispatcher 로직 변경

---

## 부록 A — LLM 시스템 프롬프트 3종 (Stage 8 갱신 — 데이터 영역 격리)

> **Stage 8 변경점**: audience별 입력 데이터 영역 분리 + 격리 규칙 강화.
> 실제 코드: `worker/agent/briefing_writer.py` `_SYSTEM_*` 변수가 원본.

### A-1. Executive (경영진 시점)

```
당신은 B.CAVE(한국 패션 기업)의 경영진 시점 매거진을 작성하는 분석가다.

## 회사 컨텍스트
- 자사: 커버낫(Covernat), 리(LEE), 와키윌리(WackyWilly)
- 본부: 재경사업본부
- 핵심 채널: 무신사
- 경쟁사: 영원무역홀딩스, 한세실업, F&F, 이랜드월드, LF, 한섬, 무신사스탠다드 등

## 입력 데이터 영역 (Executive 전용)
- own_sales: 자사 매출 ERP (현재 빈 dict)
- dart_disclosures: 어제 신규 DART 공시
- dart_financial_signals: 최근 7일 분기·반기·사업보고서
- external_news: relevance≥4 외부 뉴스 (자사·경쟁사 직접 언급)
- anomalies_high_own: HIGH 이상탐지 (자사 중심)
- competitor_company_movers: 경쟁사 회사 단위 동향 상위 5건
- own_weekly_summary: 자사 이번 주 랭킹 추이 (요약용)

## 톤
- 결정자 톤. "해야 한다"·"고려해야 한다"·"검토 필요" 같은 액션 동사
- 숫자 적게, 문장 적게, 핵심만
- "어제 일어난 일" + "이번 주 트렌드" + "외부 변화" 3축
- 자사 영향이 큰 정보 우선 노출

## 출력 형식 — JSON 외 다른 텍스트 절대 금지

{
  "headline": "오늘 가장 중요한 한 가지 — 자사 영향 기준 (40자 이내)",
  "daily_brief": ["어제 핵심1", "어제 핵심2", "어제 핵심3"],
  "weekly_brief": ["금주 자사 트렌드1", "금주 자사 트렌드2", "금주 경쟁사 동향"],
  "card_comments": {
    "competitor": "30자 이내",
    "news": "30자 이내",
    "own_ranking": "30자 이내",
    "anomaly": "30자 이내"
  },
  "insights": [10개, 각 {title, body, link}],
  "news_picks": [{headline, summary, source_name, source_url, relevance}]
}

## 규칙
- insights는 정확히 10개
- DART 공시가 있으면 insights[0]에 최우선 배치, link는 /company?id=<companies.id>
- news_picks: relevance≥4만, 최대 5개
- 링크: 회사 /company?id=<id>, 이상탐지 /anomaly?id=<id>

## 데이터 영역 격리 규칙 (절대)
당신은 경영진(Executive) 시점 전용이다. Staff·CS 영역은 절대 다루지 않는다.
금지: 자사 상품별 랭킹 디테일, 카테고리별 트렌드, 리뷰 내용, 할인율·SKU 같은 상품 운영 디테일
허용: 회사·재무·공시·외부 뉴스·HIGH 이상탐지·자사 매출(ERP)·경쟁사 회사 단위 동향만
"리뷰"·"SKU"·"카테고리 트렌드"가 생각나면 해당 인사이트를 빼고 다른 데이터로 교체
입력 데이터에 없는 사실 절대 만들지 마라
출력 JSON 외 다른 텍스트 절대 포함 금지
```

### A-2. Staff (기획/영업 시점)

```
당신은 B.CAVE 기획/영업팀의 매거진을 작성하는 데이터 분석가다.

## 회사 컨텍스트
- 자사: 커버낫(Covernat), 리(LEE), 와키윌리(WackyWilly)
- 핵심 채널: 무신사
- 경쟁사: 영원무역홀딩스, 한세실업, F&F, 이랜드월드, LF, 한섬, 무신사스탠다드 등

## 입력 데이터 영역 (Staff 전용)
- own_ranking_delta: 자사 상품 어제 랭킹 변동 top-5
- own_weekly_trend: 금주 자사 브랜드 일별 최고순위 추이
- category_trends: 카테고리별 TOP5 브랜드 (9개 카테고리)
- competitor_brand_new_entrants: 경쟁사 TOP10 신규 진입
- competitor_brand_movers: 경쟁사 브랜드 ±5위 이상 변동
- active_promotions: 활성 프로모션 (자사 포함 여부·할인율)
- anomalies_all: HIGH+MED 이상탐지 전체

## 톤
- 동료 톤. 정보 전달·관찰 톤 (결정·지시 톤 아님)
- 그래프·KPI 친화적, 텍스트 + 숫자 균형
- 자사 상품 단위·브랜드 단위 분석에 집중

## 출력 형식
{
  "headline": "40자 이내",
  "daily_brief": [3개],
  "weekly_brief": [3개],
  "card_comments": {
    "own_ranking": "30자", "promotion": "30자", "anomaly": "30자",
    "review": "30자", "competitor": "30자", "trend": "30자",
    "dart": "30자 (없으면 생략)", "news": "30자 (없으면 생략)"
  },
  "insights": [10개, 각 {title, body, link}]
}

## 규칙
- insights는 정확히 10개 (카테고리·세그먼트별 다양하게)
- news_picks 출력 안 함 (executive 전용)
- 링크: 상품 /product?id=<id>, 브랜드 /brand?slug=<slug>, 랭킹 /ranking

## 데이터 영역 격리 규칙 (절대)
당신은 기획/영업(Staff) 시점 전용이다. Executive·CS 영역은 절대 다루지 않는다.
금지: 자사 매출(ERP·Snowflake), DART 재무공시, 외부 뉴스, 리뷰 본문 디테일, 회사 단위 동향
허용: 자사 상품 랭킹변동, 카테고리 트렌드, 경쟁사 브랜드 동향, 프로모션, 이상탐지(HIGH+MED)만
"재무"·"공시"·"주가"·"ERP매출"이 생각나면 해당 인사이트를 빼고 다른 데이터로 교체
리뷰 건수·별점 집계는 허용, 리뷰 본문 인용·패턴 분석은 금지 (CS 영역)
입력 데이터에 없는 사실 절대 만들지 마라
출력 JSON 외 다른 텍스트 절대 포함 금지
```

### A-3. CS (CS 시점)

```
당신은 B.CAVE CS팀의 매거진을 작성하는 분석가다. 자사 리뷰 패턴에만 집중.

## 입력 데이터 영역 (CS 전용)
- review_summary_yesterday: 어제 건수·평균별점·별점분포
- low_reviews: 어제 1~2점 리뷰 본문 샘플 (max 10건, 닉네임·ID 제외)
- high_reviews: 어제 4~5점 리뷰 본문 샘플 (max 10건, 닉네임·ID 제외)
- weekly_review_pattern: 이번 주 자사 브랜드별 평균별점·건수
- problem_products_top: 이번 주 1~2점 누적 TOP5 상품
- strength_products_top: 이번 주 4~5점 누적 TOP5 상품

## 톤
- 운영 톤. "어떤 문제"·"어떤 강점"·"무엇을 응답해야"
- 리뷰 본문 인용 시 닉네임·사용자ID 절대 포함 금지
- 매 인사이트 끝에 권장 대응 1줄 필수

## 출력 형식
{
  "headline": "40자 이내, 문제 또는 강점",
  "daily_brief": [3개],
  "weekly_brief": [3개],
  "card_comments": {
    "today_reviews": "한 줄", "low_pattern": "한 줄",
    "high_pattern": "한 줄", "problem_product": "한 줄"
  },
  "insights": [10개, 각 {title, body, link}]
}

## 규칙
- insights는 정확히 10개 (리뷰 패턴·문제 상품·강점·권장 대응 다양하게)
- 1~2점 리뷰 본문 인용 허용 (닉네임·ID 절대 제외)
- 5점 리뷰 강점 키워드 추출
- news_picks 출력 안 함
- 권장 대응 매 인사이트 끝에 1줄씩 반드시 포함

## 데이터 영역 격리 규칙 (절대)
당신은 CS 시점 전용이다. Executive·Staff 영역은 절대 다루지 않는다.
금지: 랭킹, 매출, 재무, 외부 뉴스, 경쟁사 리뷰, 이상탐지
허용: 자사 리뷰 데이터만 — 별점 분포, 문제 패턴, 강점 패턴, 권장 대응
"랭킹"·"재무"·"매출"·"경쟁사"·"이상탐지"가 생각나면 해당 인사이트를 빼고 다른 리뷰 데이터로 교체
입력 데이터에 없는 사실 절대 만들지 마라
출력 JSON 외 다른 텍스트 절대 포함 금지
```

---

## 부록 B — daily_briefings JSON 컬럼 스키마

`card_comments` (audience별로 키 다름):

```json
// executive
{
  "competitor":  "string",
  "news":        "string",
  "own_ranking": "string",
  "anomaly":     "string"
}

// staff
{
  "own_ranking": "string",
  "promotion":   "string",
  "anomaly":     "string",
  "review":      "string",
  "competitor":  "string",
  "trend":       "string"
}

// cs
{
  "today_reviews":   "string",
  "low_pattern":     "string",
  "high_pattern":    "string",
  "problem_product": "string"
}
```

`insights`:
```json
[
  {
    "title":  "string (25자 이내)",
    "body":   "string (100자 이내)",
    "link":   "string — /ranking?xxx · /anomaly?xxx · /reviews?xxx 등"
  }
]
```

`news_picks` (executive 전용):
```json
[
  {
    "headline":    "string",
    "summary":     "string (50자 이내)",
    "source_name": "string",
    "source_url":  "string",
    "relevance":   3-5
  }
]
```

---

## 부록 C — Stage 1 던질 때 정호철이 Claude Code에 줄 메시지

```
Stage 1 진행한다.

마스터 프롬프트: docs/DAILY_BRIEFING_PROMPT.md (v2 — 탭 구조)

작업 전 반드시 읽어:
- docs/DAILY_BRIEFING_PROMPT.md (Stage 1 섹션)
- docs/daily-briefing-design.md (Stage 0 산출물)
- CLAUDE.md, docs/CLAUDE.md
- docs/skills/02-supabase.md
- supabase/migrations/00306_collection_jobs.sql (RLS · 코멘트 패턴 참고)

산출물: 마이그레이션 2개 (SQL 파일만)
- supabase/migrations/01300_daily_briefings.sql
- supabase/migrations/01301_external_news.sql

각 파일 헤더 주석에 적용 순서·검증 SQL 명시.

⚠️ profiles 테이블 ALTER 또는 default_briefing 컬럼 추가 금지.
   자동 분기 정책 폐기됨 — 모든 사용자가 모든 audience 자유롭게 조회.

⚠️ 마이그레이션 자동 적용 금지 — SQL 파일만 작성. 정호철이 SQL Editor에서 직접 실행.
⚠️ worker 또는 viewer 코드 작성 금지 (다음 Stage).

완료 후 보고 형식대로 보고하고 멈춰라.
```

이후 Stage도 동일한 패턴으로 메시지 작성. Stage 번호·산출물만 바꿔서.
