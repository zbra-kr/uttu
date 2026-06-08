# 08-funding — 투자유치/자금조달 수집 (on-demand)

> UTTU 투자정보 도메인 수행 스킬.
> 일반 업무 방식은 `work-style-jhc`, 기술 패턴은 `uttu-execution`, 프로젝트 배경은 `uttu-project` 참고.
> 이 문서는 "투자유치/자금조달" 도메인의 **기반 스펙**이다. 코드 작성 전 반드시 읽는다.

---

## 0. 목적

UTTU에서 추적 중인 기업(companies 마스터)의 **투자유치/자금조달 이력**을 보여준다.
데이터가 방대하므로 **전수 배치 수집을 하지 않는다.** 사용자가 회사 상세 화면에서
`[투자정보 수집]` 버튼을 누른 그 기업만 **그때 수집 + 브리핑 작성**한다 (on-demand / lazy).

대상은 **companies 마스터에 이미 존재하는 회사**로 한정한다.
(마스터에 없는 기업은 먼저 companies에 추가되어야 수집 대상이 된다.)

---

## 1. 데이터 소스 (2-tier)

### Tier 1 — 뉴스 NLP (주력)

비상장 시리즈 라운드는 공시에 안 잡힌다. THE VC도 뉴스 비정형 텍스트에서 추출한다.
**`/today` 기능에서 만든 뉴스 수집기를 재사용**한다 (신규 크롤러 만들지 말 것 — 먼저 기존 모듈 확인).

흐름: 회사명으로 뉴스 검색·본문 확보 → Ollama로 (회사/금액/라운드/투자자/날짜) 추출 → `funding_rounds` 적재.

### Tier 2 — 공시/공공데이터 API (보강)

| 소스 | 엔드포인트(확인된 것) | 키 | 잡히는 것 | 한계 |
|---|---|---|---|---|
| DART 증권신고서 지분증권 | `https://opendart.fss.or.kr/api/estkRs.json` (corp_code,bgn_de,end_de) | 기존 `DART_API_KEY` | 공모 유상증자·IPO (모집총액 slta, 인수인, 자금사용목적) | 공모만. 제3자배정 사모 ✕ |
| DART 주요사항보고서 유상증자결정 | DS005 그룹 (엔드포인트 Stage 0에서 확인) | 기존 `DART_API_KEY` | 공시의무 회사의 유상증자결정(사모 포함) | 비상장 비외감 ✕ |
| 자금조달 공시정보 | `apis.data.go.kr/1160100/...` (15139255, 오퍼레이션 8종) | `DATA_GO_KR_SERVICE_KEY` | 공모·사모 자금사용내역, 채무증권 | DART 파생, 상장/외감 중심 |
| 크라우드펀딩정보 | `apis.data.go.kr/1160100/service/GetFundInfoService/getFundIssuCompInfo` (15059613) | `DATA_GO_KR_SERVICE_KEY` | **비상장 증권형 크라우드펀딩 발행사** | 커버리지 작음 |
| 주식발행정보 | `apis.data.go.kr/1160100/...` (15043423, 오퍼레이션 4종) | `DATA_GO_KR_SERVICE_KEY` | 주식발행내역·발행차수·발행사유 (유상증자 동향) | 상장 중심. 공공누리 2유형(내부용만) |

⚠️ DART와 data.go.kr 자금조달공시는 상당부분 **중복**(둘 다 공시 파생). 신규 가치는 크라우드펀딩정보.
⚠️ data.go.kr 정확한 오퍼레이션 URL·파라미터는 **승인된 API 상세페이지 명세에서 확인** (Stage 0).

---

## 2. on-demand 아키텍처

```
[화면] 회사 상세 → [투자정보 수집] 클릭
   │  (이미 funding_last_collected_at 이 N일 이내면 재수집 안 하고 캐시 표시)
   ▼
[잡 생성] collection_jobs 에 {company_id, type:'funding', status:'pending'} INSERT
   ▼  (Supabase Realtime 또는 polling)
[워커] Mac mini 워커가 pending 잡 픽업 → status:'running'
   │   1) Tier 1 뉴스 검색·추출 (Ollama)
   │   2) Tier 2 DART estkRs + 주요사항보고서 + data.go.kr 3종 조회
   │   3) dedup·merge → funding_rounds upsert
   │   4) briefing writer (/today 패턴) → 기업 투자 브리핑 작성
   │   5) companies.funding_last_collected_at = now()
   ▼
[잡 완료] status:'done', rounds_found=N
   ▼
[화면] Realtime 구독 → 진행 표시 → funding 타임라인 + 브리핑 렌더
```

⚠️ **collection_jobs 신규 생성 금지.** `/today`에서 만든 기존 잡/Realtime 모니터링 테이블이 있으면
`type='funding'` 으로 재사용. 없을 때만 아래 funding_collection_jobs 생성.

---

## 3. 스키마 (제안 — 적용은 정호철이 SQL Editor에서)

### 3.1 funding_rounds

```sql
create table funding_rounds (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  round_type      text,            -- seed/pre-A/series-A.../유상증자/IPO/크라우드펀딩/기타
  amount_krw      bigint,          -- 원 단위, 불명 시 null
  announced_date  date,
  investors       text[] default '{}',
  source_type     text not null,   -- news|dart_estkrs|dart_piic|datago_fund|datago_crowd|datago_stock
  source_url      text,
  source_ref      text,            -- 접수번호/공시ID/기사URL 등 원천 식별자
  confidence      numeric(3,2),    -- 0.00~1.00 (뉴스 추출 신뢰도, 공시는 1.00)
  raw             jsonb,           -- 원본 페이로드 보존
  created_at      timestamptz default now(),

  unique (company_id, source_type, source_ref)   -- 동일 원천 중복 방지
);

create index funding_company_idx on funding_rounds(company_id, announced_date desc);
create index funding_source_idx  on funding_rounds(source_type);
```

### 3.2 companies 캐시 컬럼

```sql
alter table companies add column if not exists funding_last_collected_at timestamptz;
```

### 3.3 funding_collection_jobs (기존 잡 테이블 없을 때만)

```sql
create table funding_collection_jobs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending','running','done','failed')),
  requested_by  text,
  started_at    timestamptz,
  finished_at   timestamptz,
  rounds_found  int default 0,
  error         text,
  created_at    timestamptz default now()
);
create index funding_jobs_status_idx on funding_collection_jobs(status, created_at);
```

⚠️ Realtime 활성화(Supabase 대시보드)는 정호철이 직접.

---

## 4. 모듈 구조 (worker/funding/)

```
worker/funding/
├── __init__.py
├── orchestrator.py     잡 픽업·상태전이·전체 흐름
├── news_source.py      Tier1 — /today 뉴스 수집기 재사용 래퍼
├── dart_source.py      Tier2 — estkRs + 유상증자결정
├── datago_source.py    Tier2 — 자금조달공시·크라우드펀딩·주식발행정보
├── merge.py            dedup·merge 정책
└── brief_writer.py     /today briefing writer 재사용
worker/agent/funding_extractor.py   Ollama 추출 (review_analyst.py 패턴)
```

main.py 에 `--mode funding --company-id <uuid>` 추가.

---

## 5. Ollama 추출 (worker/agent/funding_extractor.py)

`review_analyst.py` 패턴 그대로 (`format:"json"`, `gemma4:e4b`, httpx timeout 120).

```
프롬프트(고정):
"다음 뉴스 본문에서 투자유치 정보를 추출해 JSON만 출력해. 설명·markdown 금지. 정보 없으면 rounds: [].
{ "rounds": [ {
  "company": "...", "round_type": "seed|pre-A|series-A|...|유상증자|IPO|크라우드펀딩|기타",
  "amount_krw": 정수(원 단위, 불명 null), "investors": ["..."],
  "announced_date": "YYYY-MM-DD|null", "confidence": 0.0~1.0
} ] }
본문: \"\"\"{기사}\"\"\""
```

추출 후 company 필드는 검색에 쓴 회사명과 매칭 검증(엉뚱한 회사 기사 거르기).

---

## 6. dedup·merge 정책 (merge.py)

- 동일 `(company_id, source_type, source_ref)` → unique 제약으로 자동 차단.
- 같은 라운드가 뉴스+공시 양쪽에 잡히면 **공시(confidence=1.00) 우선**, 뉴스는 보조로 유지.
- amount_krw 단위는 항상 **원**으로 정규화 (기사 "50억" → 5000000000).
- announced_date 없으면 null 허용. 정렬은 announced_date desc nulls last.

---

## 7. 캐시 정책

- `[투자정보 수집]` 클릭 시 `companies.funding_last_collected_at`이 **7일 이내**면 재수집 안 함(캐시 표시 + "강제 재수집" 옵션).
- 7일 초과 또는 최초면 잡 생성.

---

## 8. Viewer (회사 상세 페이지)

`viewer/app/(app)/market/[slug]/` 에 추가:

- `[투자정보 수집]` 버튼 → 잡 INSERT (anon 권한 INSERT 정책 필요) → Realtime 구독으로 진행 표시.
- `FUNDING` 태그 Cell 2개: ① 라운드 타임라인 ② AI 브리핑.
- 디자인 규칙 그대로 — CSS 변수만, mono 폰트, 웜톤, 파라미터는 `source=news` 식 노출.
- `lib/queries-funding.ts` 신규, `lib/routes.ts`에 경로 상수 추가.

---

## 9. 한계 (화면에 명시)

- 비상장 제3자배정 사모 라운드는 공시 면제 → **뉴스에만 의존**, 누락 가능.
- 뉴스 추출은 confidence 동반, 1.0 미만은 "미검증" 뱃지.
- 크라우드펀딩 외 비상장 raise는 커버리지 한계 있음.
- **부채분류 RCPS/CB/BW 는 자본변동표(SCE) 미포착** — 재무상 부채로 분류된 상환전환우선주(RCPS)·전환사채(CB)·신주인수권부사채(BW)는 외감 감사보고서 SCE 에 자본 증가 행으로 기록되지 않아 audit_source 에서 잡히지 않는다. (dart_piic 공시에서 별도 포착 가능성 있음)
- **이름이 짧은(≤4자) 회사의 뉴스 수집**: 브랜드명 동반이 필수. 브랜드 없는 경우 공시(DART/audit) 만 사용.

---

## 10. 절대 규칙

```
[ ] collection_jobs 신규 생성 전 기존 테이블 존재 확인 (있으면 재사용)
[ ] 마이그레이션 번호 하드코딩 금지 — 기존 최신 +1
[ ] 마이그레이션 자동 적용 금지 — 정호철 SQL Editor 수동
[ ] client에 service_role 금지 — 워커만 service_role
[ ] PostgREST 1000행 상한 — limit 항상 명시
[ ] CSS hex 하드코딩 금지 — 변수만
[ ] 링크 하드코딩 금지 — routes.ts 상수
[ ] 외부 API 응답 구조 가정 금지 — Stage 0 curl 먼저
[ ] 금액 단위 원으로 정규화
[ ] 뉴스 IP 우회·재시도 금지 (BotBlockedError 즉시 중단)
```
