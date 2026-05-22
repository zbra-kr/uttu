# UTTU — Claude Code 지침 (AI 하네스)

> 이 파일은 Claude Code 가 UTTU 프로젝트에서 작업할 때 **가장 먼저, 항상** 읽어야 하는 파일이다.
> 모든 작업 전 이 파일과 관련 스킬 파일을 읽는 것은 선택이 아니라 필수다.

---

## 프로젝트 컨텍스트

**시스템명**: UTTU (고대 바빌론, 실을 엮어 옷을 만든 여신 Uttu — 데이터의 실을 엮어 인텔리전스를 만든다)
**목적**: 무신사 데이터 수집 → B.CAVE 3개 부서 인텔리전스
**오너**: 정호철 (IT팀장, zbra@zbra.co.kr)
**레포**: github.com/zbra-kr/uttu

### 3개 부서 요구사항

| 부서 | 핵심 질문 |
|---|---|
| 상품기획/영업기획 | 어느 성별·나이대가 어떤 상품을 인기 있어하나? 가격·프로모션은? 자사에 유사 상품과 재고는? |
| 재무/회계 | 인기 브랜드는 어떤 회사고 어떤 재무 성격인가? 이상탐지 내역은? |
| CS | 자사 브랜드 리뷰 전체. 저점 리뷰 문제점. 고점 리뷰 강점. |

---

## 기술 스택

| 영역 | 기술 |
|---|---|
| Worker | Python 3.12 + Playwright (stealth) + httpx + asyncio |
| DB | Supabase (Postgres + pgvector + RLS) |
| ERP | Snowflake read-only (Key-pair 인증) |
| Viewer | Next.js 15 App Router + Tailwind v3 + Vercel |
| LLM | Ollama (gemma4:e4b) 로컬 — 비용 $0 |
| 임베딩 | embeddinggemma:300m 768차원 |
| 스케줄러 | macOS crontab |

---

## 작업 전 필수 체크리스트

모든 작업 시작 전 아래를 순서대로 수행한다:

```
1. 이 파일(CLAUDE.md) 읽기 — 완료
2. 작업과 관련된 스킬 파일 읽기:
   - 스크래퍼 작업  → docs/skills/01-scraping.md
   - DB 작업        → docs/skills/02-supabase.md
   - Snowflake 작업 → docs/skills/03-snowflake.md
   - 랭킹 수집      → docs/skills/04-ranking.md
   - 리뷰 수집      → docs/skills/05-reviews.md
   - DART 작업      → docs/skills/06-dart.md
   - Viewer 작업    → docs/skills/07-viewer.md
3. 관련 기존 파일 읽기 (수정 전 반드시)
4. 작업 시작
```

스킬 파일을 읽지 않고 작업하면 이전에 발견한 실수를 반복하게 된다.

---

## 절대 규칙 — 어떤 상황에서도 위반 금지

### DB / Supabase

```
❌ products.current_price 사용 금지 — 컬럼 없음
   → ranking_snapshots LATERAL LIMIT 1 패턴 사용

❌ const { data } = await query 금지 — error 무시하면 빈 화면 버그
   → const { data, error } = await query; if (error) { 처리 }

❌ PostgREST 기본 1,000행 상한 무시 금지
   → limit 명시 또는 .range() 사용

❌ 마이그레이션 자동 적용 금지
   → SQL Editor에서 정호철이 수동 적용

❌ service_role 키를 viewer 코드에 포함 금지 — worker 전용
```

### 스크래핑

```
❌ SCRAPE_MIN_DELAY_SEC = 3.0 미만으로 낮추지 마
❌ 무신사 동시 요청 금지 — semaphore = 1 항상
❌ BotBlockedError 발생 시 retry 금지 — 즉시 raise 후 중단
❌ cron 자동 등록 금지 — 보고만, 정호철이 직접 등록
```

### Viewer

```
❌ CSS hex 하드코딩 금지 — globals.css CSS 변수만 사용
❌ 크로스 링크 하드코딩 금지 — lib/routes.ts ROUTES 상수만
❌ 페이지에서 직접 Supabase 호출 금지 — lib/queries*.ts 경유
❌ mock 데이터 금지 — 데이터 없으면 EmptyState 컴포넌트
```

### 보안

```
❌ .env, API 키, service_role을 코드·로그·커밋에 포함 금지
❌ .secret/ 폴더 .gitignore 누락 금지
❌ Snowflake 쓰기 금지 — read-only 서비스 계정만
❌ 리뷰 닉네임·사용자ID 수집 금지 — 개인정보
```

---

## 코딩 패턴

### Python Worker

```python
# 1. 환경변수
from dotenv import load_dotenv
load_dotenv()

# 2. 로거
from loguru import logger
logger.info("task_start", task="ranking", combos=189)

# 3. Supabase 클라이언트 (worker만)
from supabase import create_client
client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"]  # viewer에 절대 사용 금지
)

# 4. rate limit
import random, asyncio
await asyncio.sleep(random.uniform(MIN_DELAY, MIN_DELAY + JITTER))
```

### Supabase LATERAL 패턴

```sql
-- 최신 랭킹·가격 조회 (ranking_snapshots 기준)
SELECT p.*, rs.rank_position, rs.list_price
FROM products p
LEFT JOIN LATERAL (
  SELECT rank_position, list_price
  FROM ranking_snapshots rs
  WHERE rs.product_id = p.id
    AND rs.category_code = '000'
    AND rs.gender_filter = 'A'
    AND rs.age_filter = 'A'
  ORDER BY rs.snapshot_date DESC
  LIMIT 1
) rs ON true
```

### Next.js 쿼리 패턴

```typescript
// ✅ 올바름 — error 반드시 처리
const { data, error } = await supabase
  .from('ranking_snapshots')
  .select('...')
  .limit(100);

if (error) {
  console.error('[ranking] query failed', error);
  return <ErrorState description={error.message} />;
}

// ❌ 금지
const { data } = await supabase.from('ranking_snapshots').select('...');
```

---

## 파일 구조

```
~/projects/uttu/
├── CLAUDE.md                    ← 이 파일 (루트)
├── .env                         ← 환경변수 (gitignore)
├── .gitignore
├── pyproject.toml
│
├── docs/
│   ├── UTTU-OVERVIEW.md
│   └── skills/
│       ├── 00-HOWTO.md
│       ├── 01-scraping.md
│       ├── 02-supabase.md
│       ├── 03-snowflake.md
│       ├── 04-ranking.md
│       ├── 05-reviews.md
│       ├── 06-dart.md
│       └── 07-viewer.md
│
├── worker/
│   ├── scrapers/
│   │   ├── base.py              ← BaseScraper (모든 스크래퍼 상속)
│   │   ├── musinsa_ranking.py
│   │   ├── musinsa_product.py
│   │   ├── musinsa_event.py
│   │   └── musinsa_review.py
│   ├── ingest/
│   │   ├── supabase_writer.py
│   │   └── detail_writer.py
│   ├── matchers/
│   │   ├── snowflake_erp.py
│   │   └── snowflake_pull.py
│   ├── detectors/
│   │   └── base.py
│   ├── agent/
│   │   └── review_analyst.py
│   └── dart/
│       ├── fetcher.py
│       └── parser.py
│
├── viewer/                      ← Next.js 15
│   ├── app/
│   │   ├── globals.css          ← CSS 변수 (hex 금지)
│   │   └── (app)/
│   └── lib/
│       ├── routes.ts            ← 크로스링크 상수 (하드코딩 금지)
│       ├── queries-market.ts
│       ├── queries-own.ts
│       └── queries-cs.ts
│
├── supabase/
│   └── migrations/              ← SQL Editor 수동 적용
│
├── scripts/
│   ├── run_ranking.sh
│   ├── run_product.sh
│   ├── run_event.sh
│   ├── run_review.sh
│   ├── run_erp.sh
│   └── run_dart.sh
│
└── .secret/                     ← gitignore 필수
    ├── pbi_it_svc_pkcs8.pem
    └── pbi_it_svc_public.pem
```

---

## 보고 형식

작업 완료 시 항상:

```
[1] 작업 내용 요약
[2] 생성·수정된 파일 목록
[3] 마이그레이션: 파일명 + 적용 순서
[4] cron: 등록할 라인 (정호철 직접 등록)
[5] 검증 방법
[6] commit hash
```

---

## MDA에서 배운 실수 — 반복 금지

| 실수 | 교훈 |
|---|---|
| 랭킹 5회/일 실시간 | DAILY 1회가 맞다. 실시간은 노이즈 |
| 성별·나이대 없이 수집 | 차원 없으면 실무 활용 불가 |
| 리뷰 집계값만 | CS 분석엔 텍스트 필수 |
| error 변수 무시 | 빈 화면 버그의 주원인 |
| CSS hex 하드코딩 | 테마 변경 시 전체 깨짐 |
| 기반 없이 바로 코드 | 나중에 전부 뜯어고침 |
| Vercel USE_MOCK 누락 | mock 모드로 동작, 데이터 안 나옴 |
| PostgREST 1000행 상한 | 데이터 잘림 버그 |
| 마이그레이션 자동 적용 | 롤백 불가능한 사고 위험 |
