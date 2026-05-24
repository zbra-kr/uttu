# UTTU 관리자 페이지 구현 — 실행 계획

> 작성자: 정호철 (Claude 사전설계 → Claude Code 실행)
> 작성일: 2026-05-25 (마이페이지 완료 후속)
> 대상 저장소: `~/projects/uttu` (zbra-kr/uttu)
> 사용자 규모: B.CAVE 임직원 약 300명

---

## 0. 이 문서의 사용법

Claude Code에 이 파일을 전달하고 **Phase 단위로** 작업 의뢰.
한 Phase 끝날 때마다 정호철이:
1. (있을 시) 마이그레이션 Supabase SQL Editor에서 적용
2. 빌드/dry-run 검증
3. 다음 Phase 진행 결정

**절대 자동 적용·cron 등록·Vercel 배포 금지.**

---

## 1. 결정사항 (정호철 확정)

| 결정 | 내용 |
|---|---|
| 구조 | `/settings`는 본인 환경설정만. `/admin/*`는 관리자 전용. |
| role 모델 | admin/viewer 둘만 유지 |
| 가입 방식 | 자유 가입 (@bcave.co.kr 도메인 게이트만) |
| AI 토큰 default | 신규 가입 시 monthly_token_limit = **100,000** |
| 토큰 무제한 | admin이 limit을 NULL로 두면 그 사용자 무제한 |
| 토큰 enforce | AiPanel 백엔드 작업과 함께 별도 처리 (이번 Phase 범위 외) |

---

## 2. 현재 상태 (참고)

### 이미 있는 인프라 (사용)
- `profiles` (id, full_name, display_name, role, team, teams_webhook_url, telegram_chat_id, avatar_url, ...)
- `ai_sessions`, `ai_messages`, `ai_user_quotas`, `ai_usage_daily` (00309) — 완전한 토큰 인프라
- `exec_ai_query()` (00308) — LLM이 호출하는 SELECT 실행 함수
- `anomalies` (00300) — 이상탐지 결과
- `collection_jobs` (00306) — 수집 작업 상태 + Realtime 구독 준비됨
- `user_notifications`, `user_notes`, `user_bookmarks` 등 (Phase 1~6 완료)
- `/admin/mapping` (1130줄, 실데이터) — DART 매핑 ✅ 살림

### 손볼 거
- `/settings/page.tsx` 249줄 100% mock — 간소화 또는 폐기
- `/admin/page.tsx` 145줄 mock — 진짜 admin 대시보드로 교체
- Sidebar `ADMIN_ONLY` 메뉴 항목 정리 (Phase 0)

---

## 3. 절대 규칙 (모든 Phase 공통)

1. 마이그레이션 SQL 파일만 작성. 실행 금지. 정호철 수동.
2. service_role 키는 워커·서버 API route 전용. 클라이언트 컴포넌트(`'use client'`)에 절대 금지.
3. admin 페이지의 모든 API route는 **서버에서 `is_admin()` 체크 필수**. 클라이언트 게이팅(Sidebar 숨김)은 UI 편의일 뿐 보안 아님.
4. CSS 변수만 사용 (`var(--bg)`, `var(--f1~4)`, `var(--bd)`, hex 금지).
5. 모든 supabase 쿼리에 `{ data, error }` + error 처리.
6. PostgREST 1000행 캡 — `.limit()` 또는 `.range()` 명시.
7. 새 npm 패키지 추가 금지.
8. profiles RLS는 Phase B 좁히기 후 상태 그대로. 다른 사용자 프로필 조회는 `profiles_public` view 경유.
9. Realtime 구독 사용 시 cleanup 함수 필수(useEffect return).

---

## 4. 컨벤션

### 4.1 파일 위치
| 도메인 | 경로 |
|---|---|
| 마이그레이션 | `supabase/migrations/NNNNN_<목적>.sql` |
| 뷰어 admin 페이지 | `viewer/src/app/(app)/admin/<route>/page.tsx` |
| 뷰어 admin API route | `viewer/src/app/api/admin/<목적>/route.ts` |
| 뷰어 admin 공통 컴포넌트 | `viewer/src/components/admin/<Name>.tsx` |
| 뷰어 admin 쿼리 함수 | `viewer/src/lib/queries-admin.ts` (신규) |

### 4.2 admin API 보호 패턴 (모든 admin route에 적용)
```typescript
// viewer/src/lib/auth/require-admin.ts (신규)
import { supabaseServer } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function requireAdmin() {
  const ss = await supabaseServer();
  const { data: { user } } = await ss.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: '인증 필요' }, { status: 401 }), user: null, ss };

  const { data: prof } = await ss.from('profiles').select('role').eq('id', user.id).single();
  if (prof?.role !== 'admin') {
    return { error: NextResponse.json({ error: '관리자 권한 필요' }, { status: 403 }), user: null, ss };
  }
  return { error: null, user, ss };
}
```

모든 admin route에서:
```typescript
const { error, user, ss } = await requireAdmin();
if (error) return error;
// ... 본 작업
```

### 4.3 보고 양식 (각 Phase 완료 시)
```
[1] 작업 요약 (1~2줄)
[2] 생성·수정된 파일
[3] 마이그레이션 (수동 적용)
[4] cron 등록
[5] 검증 (빌드 + grep + 수동 테스트 가이드)
[6] 다음 Phase 권장 시점
[7] commit hash
```

---

## 5. 데이터 모델 — 신규/추가 요소

### 5.1 자동 quota 부여 트리거 (Phase 1)
신규 profile 생성 시 `ai_user_quotas` row 자동 INSERT, monthly_token_limit=100000.

```sql
-- 00310_ai_quota_defaults.sql
create or replace function public.handle_user_ai_quota_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.ai_user_quotas (user_id, monthly_token_limit, daily_token_limit, is_blocked)
  values (new.id, 100000, null, false)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_profile_ai_quota_defaults on public.profiles;
create trigger on_profile_ai_quota_defaults
  after insert on public.profiles
  for each row execute procedure public.handle_user_ai_quota_defaults();
```

### 5.2 admin이 다른 사용자 quota·사용량 read/write (Phase 1)
현재 RLS는 본인만 select. admin이 모든 사용자의 ai_user_quotas/ai_usage_daily/ai_sessions 조회 가능 + ai_user_quotas 수정 가능.

```sql
-- 00310_ai_quota_defaults.sql (계속)

create policy "admin select all quotas" on public.ai_user_quotas
  for select to authenticated using (public.is_admin());

create policy "admin update all quotas" on public.ai_user_quotas
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "admin select all usage" on public.ai_usage_daily
  for select to authenticated using (public.is_admin());

create policy "admin select all sessions" on public.ai_sessions
  for select to authenticated using (public.is_admin());
```

### 5.3 기존 사용자 backfill (Phase 1 적용 시 수동)
```sql
-- Phase 1 마이그레이션 적용 후 1회 실행
insert into public.ai_user_quotas (user_id, monthly_token_limit, daily_token_limit, is_blocked)
select id, 100000, null, false from public.profiles
on conflict (user_id) do nothing;
```

### 5.4 Phase 5의 detector 룰 테이블 (신규)
```sql
-- 01100_detector_rules.sql
create table public.detector_rules (
  id          uuid primary key default gen_random_uuid(),
  detector_key text unique not null,       -- 'bookmark_brand_delta', 'bookmark_product_top100' 등
  enabled     boolean not null default true,
  params      jsonb not null default '{}'::jsonb,  -- {"threshold": 10} 등
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id)
);

alter table public.detector_rules enable row level security;
create policy "rules select all" on public.detector_rules for select to authenticated using (true);
create policy "rules update admin" on public.detector_rules for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
```

### 5.5 Phase 6 감사 로그 (신규)
```sql
-- 01200_audit_logs.sql
create table public.audit_logs (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references auth.users(id),
  action       text not null,            -- 'role_change', 'quota_update', 'mapping_save' 등
  target_type  text,                     -- 'user', 'company', 'detector' 등
  target_id    text,                     -- 대상 식별자
  payload      jsonb default '{}'::jsonb,
  created_at   timestamptz default now()
);

create index audit_logs_actor_idx on public.audit_logs(actor_id, created_at desc);
create index audit_logs_action_idx on public.audit_logs(action, created_at desc);

alter table public.audit_logs enable row level security;
create policy "audit select admin" on public.audit_logs for select to authenticated using (public.is_admin());
-- INSERT는 service_role 전용
```

---

## 6. Phase 0 — 구조 정리

### 목표
- `/admin/page.tsx` mock 폐기 → 임시 대시보드 placeholder (Phase 4에서 본격 채움)
- Sidebar에 "관리" 섹션 신설 (admin만 보임). 7개 admin 메뉴 항목.
- 기존 `ADMIN_ONLY` 메뉴(매거진/매칭/리뷰/매핑/설정) 재분류
- `/settings` 임시 정리 (mock 일부 제거, Phase 7에서 본격)

### 작업 범위

#### A. Sidebar 메뉴 재구성
`viewer/src/components/shell/Sidebar.tsx`:
- 기존 ADMIN_ONLY 항목 중 admin 영역에 속하는 거 새 "관리" 그룹으로 이동:
  - `/admin` (대시보드, Phase 4 채움)
  - `/admin/users` (사용자 관리, Phase 1)
  - `/admin/jobs` (수집 모니터링, Phase 2)
  - `/admin/notifications` (알림 모니터링, Phase 3)
  - `/admin/mapping` (DART 매핑, **기존 유지**)
  - `/admin/anomalies` (이상탐지 룰, Phase 5)
  - `/admin/audit` (감사 로그, Phase 6)
- 사이드바에 별도 헤더 "관리" 텍스트 + admin만 표시
- 기존 `matching` (자사 매칭), `magazine` (매거진), `reviews` (리뷰) 메뉴는 admin 영역인지 일반 영역인지 정호철과 확인 필요 — **이번 Phase에선 그대로 둠**, Phase 4 대시보드 작업할 때 재분류 검토

#### B. `/admin/page.tsx` 폐기 → placeholder
기존 145줄 mock 다 제거. 임시 안내 페이지:
```tsx
'use client';
import Link from 'next/link';

export default function AdminPage() {
  return (
    <section className="panel" style={{ padding: 32 }}>
      <h1 style={{ fontSize: 24, fontWeight: 500, margin: 0 }}>관리</h1>
      <p style={{ marginTop: 8, color: 'var(--f3)', fontSize: 13 }}>
        좌측 사이드바에서 관리 영역을 선택하세요.
      </p>
      <div className="grid grid-3 gap-8" style={{ marginTop: 24 }}>
        <Link href="/admin/users" className="panel compact" style={{ padding: 14 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>사용자 관리</h3>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--f3)' }}>role, AI 토큰 쿼터</p>
        </Link>
        {/* 같은 패턴으로 jobs, notifications, mapping, anomalies, audit */}
      </div>
    </section>
  );
}
```

#### C. `/settings/page.tsx` 임시 정리
기존 좌측 nav 7항목 중 `users`, `audit` 항목 **제거** (이제 /admin/users, /admin/audit로 이동).
나머지 `profile`, `notif`, `conn`, `jobs` mock은 일단 그대로 (Phase 7에서 정리). nav만 정리하고 admin 분기 제거.

### 마이그레이션
없음.

### DoD
- [ ] Sidebar의 "관리" 섹션 admin에게만 노출
- [ ] viewer 계정으로 로그인 시 "관리" 메뉴 안 보임
- [ ] `/admin/page.tsx`에 mock 데이터(코웰패션, LF 등) 잔여 0건
- [ ] `/settings` nav에 `users`, `audit` 항목 제거됨
- [ ] `npm run build` 통과

---

## 7. Phase 1 — `/admin/users` 사용자 관리 + 토큰 쿼터

### 목표
- 전체 사용자 리스트 (profiles + ai_user_quotas + 이번달 사용량)
- 검색, role 필터, status 필터
- 각 사용자별 액션: role 변경, display_name 강제 변경, quota 수정, is_blocked 토글
- 사용자 상세 모달: 최근 ai_sessions 목록, 일별 사용량 차트

### 마이그레이션
`supabase/migrations/00310_ai_quota_defaults.sql` (위 5.1 + 5.2 SQL 합본)

**적용 후 5.3 backfill SQL 1회 실행** — 기존 사용자에게 default quota 부여.

### API routes

#### `/api/admin/users` (GET) — 리스트
```typescript
// query params: q (검색), role, status, page, limit
// 응답:
{
  users: [{
    id, email, full_name, display_name, role, team, avatar_url,
    created_at, last_sign_in_at,
    quota: { monthly_token_limit, daily_token_limit, is_blocked, note },
    usage_this_month: { input_tokens, output_tokens, total_tokens, session_count }
  }],
  total: number
}
```

구현:
- `requireAdmin()` 가드
- profiles + ai_user_quotas left join
- 이번달 사용량은 별도 query (ai_usage_daily WHERE usage_date >= 이번달 1일, group by user_id, sum)
- auth.users에서 last_sign_in_at 조회 (admin은 admin client로)

#### `/api/admin/users/[id]` (PATCH) — 수정
```typescript
// body:
{
  role?: 'admin' | 'viewer',
  display_name?: string | null,
  team?: string | null,
  quota?: {
    monthly_token_limit?: number | null,   // null = 무제한
    daily_token_limit?: number | null,
    is_blocked?: boolean,
    note?: string | null,
  }
}
```

구현:
- `requireAdmin()` 가드
- profiles update (role, display_name, team)
- ai_user_quotas update (quota.*) — upsert로 처리 (혹시 trigger 누락된 row)
- 본인이 본인 role 'viewer'로 변경 시도 → 거부 (시스템에 admin 남아있어야 함)
  - 또는 admin 총 수가 1명이면 강등 거부
- 감사 로그 INSERT (Phase 6 audit_logs — 지금은 테이블 없으니 일단 console.log, Phase 6에서 추가)

#### `/api/admin/users/[id]/sessions` (GET) — 사용자별 세션
```typescript
// 최근 N개 세션
{
  sessions: [{
    id, route, context, started_at, ended_at,
    message_count, input_tokens, output_tokens, title
  }]
}
```

### UI 구성

#### 페이지: `/admin/users/page.tsx`
- 상단 KPI 4개:
  - 전체 사용자
  - 활성(최근 7일 로그인)
  - 차단됨
  - 이번달 토큰 사용 총합
- 검색바 + role 필터 (전체/admin/viewer)
- 테이블:
  | 사용자 | 이메일 | role | 이번달 사용 | 한도 | 차단 | 마지막 접속 | 액션 |
  |---|---|---|---|---|---|---|---|
- 사용 진행률 bar — 한도 NULL이면 "무제한" 표시, 한도 있으면 사용/한도 비율 visual
- 행 클릭 → UserDetailModal 열림
- 차단 토글 — 인라인 즉시 반영

#### 컴포넌트: `viewer/src/components/admin/UserRow.tsx`
- props: user 객체, onAction 콜백
- 사용량 진행률 bar (이미 있는 HBar 컴포넌트 재사용)

#### 컴포넌트: `viewer/src/components/admin/UserDetailModal.tsx`
- 모달 또는 사이드 드로어 (NoteDrawer 패턴 참고)
- 헤더: 사용자 정보 (아바타, 이름, role chip, 차단 chip)
- 섹션 1: 기본 정보 편집 (role select, team input, display_name input)
- 섹션 2: AI 쿼터 편집
  - monthly_token_limit (number input, 비우면 NULL = 무제한)
  - daily_token_limit (number input, 비우면 NULL)
  - is_blocked (toggle)
  - note (textarea, 차단/제한 사유)
- 섹션 3: 이번달 일별 사용량 차트 (recharts 또는 기존 Spark)
- 섹션 4: 최근 세션 5건 리스트 (route, started_at, message_count, total tokens)
- 저장 버튼 → PATCH /api/admin/users/[id]

### queries-admin.ts (신규)
주요 함수:
- `fetchAdminUsers(filters)`: GET /api/admin/users
- `fetchAdminUserDetail(id)`: GET /api/admin/users/[id]/sessions + 본인 정보
- `updateAdminUser(id, patch)`: PATCH /api/admin/users/[id]

### DoD
- [ ] 00310 마이그레이션 적용 + backfill 1회
- [ ] 신규 가입 시 ai_user_quotas row 자동 생성 (monthly=100000)
- [ ] /admin/users 진입 시 profiles 리스트 실데이터 표시
- [ ] viewer 계정으로 /admin/users 직접 URL 접근 → 차단 (Sidebar 안 보이는 거 + API 403)
- [ ] 사용자 quota 수정 → DB 반영 → 새로고침 후 유지
- [ ] monthly_token_limit 입력란 비우고 저장 → DB에 NULL 저장 → "무제한" 표시
- [ ] is_blocked 토글 → DB 반영
- [ ] 본인 role 'viewer' 강등 시도 거부 (또는 admin 마지막 1명 보호)
- [ ] `npm run build` 통과

---

## 8. Phase 2 — `/admin/jobs` 수집 모니터링

### 목표
- collection_jobs 실데이터 + Realtime 구독
- 오늘 실행 KPI, 14일 추이 차트
- 실패 job 로그 보기
- WARN/ERROR 상태 알림 표시

### 마이그레이션
없음 (collection_jobs 이미 있음 + 00307 anon policy 있음).

다만 admin이 collection_jobs select 가능한지 확인 — 이미 anon select 정책 있으면 OK.

### UI
- 상단 KPI 4개: 오늘 실행 수, 성공, 경고/실패, 평균 실행 시간
- 메인 테이블: 오늘 실행 현황 (script, status, completed_at, rows_done, target, duration)
- Realtime: collection_jobs UPDATE 구독, 화면 자동 갱신
- 14일 추이 차트 (succeed vs failed 라인)
- WARN/ERROR row 클릭 → 로그 모달 (script 출력 일부 표시 — error_message 컬럼 있다고 가정. 없으면 추가 검토)

### Realtime 패턴
```typescript
React.useEffect(() => {
  const channel = supabase
    .channel('collection_jobs_realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'collection_jobs' }, payload => {
      // payload.new로 setState
    })
    .subscribe();
  return () => { channel.unsubscribe(); };
}, []);
```

### DoD
- [ ] /admin/jobs 진입 시 collection_jobs 실데이터 표시
- [ ] dispatcher 또는 worker 실행 후 화면 자동 갱신 (Realtime)
- [ ] 14일 추이 차트 실데이터
- [ ] 실패 row 클릭 시 상세 표시
- [ ] viewer 계정 차단
- [ ] `npm run build` 통과

---

## 9. Phase 3 — `/admin/notifications` 알림 시스템 모니터링

### 목표
- 최근 24시간 / 7일 발송 통계 (성공/실패/스킵)
- 사용자별 webhook 설정 현황 (몇 명이 teams_webhook_url 설정했는지)
- 미전송 큐 사이즈 (sent_to_teams_at is null AND created_at < now() - 10min — stuck)
- dispatcher 마지막 실행 시각 (가장 최근 sent_to_teams_at)
- event_type별 발송 분포

### 마이그레이션
없음.

### UI
- KPI 4개:
  - 최근 24h 발송
  - 최근 24h 실패 (sent_at마킹됐는데 fail 정보가 없음 → 다른 방식 필요. 아래 참고)
  - webhook 설정율 (X / 전체)
  - 미전송 stuck (>10분 대기)
- event_type별 분포 차트 (mention vs anomaly_high vs ...)
- 최근 알림 50건 리스트 (user, event, title, sent_to_teams_at, sent_to_telegram_at)
- 사용자별 webhook 설정 현황 테이블 (profiles where teams_webhook_url is null vs not null)

### 발송 실패 추적 한계
현재 dispatcher 코드는 발송 성공/실패 구분 안 함 — 둘 다 `sent_to_teams_at` 마킹. 실패 추적하려면:
- `user_notifications`에 `dispatch_status` ('success', 'failed', 'skipped') 컬럼 추가 또는
- 별도 `dispatch_log` 테이블

이번 Phase에선 일단 **표시 가능한 metric만**:
- 발송된 알림 vs 미전송 알림 (sent_to_teams_at is null + 10분 이상 경과)
- 실패 추적은 별도 작업으로 보류

### DoD
- [ ] /admin/notifications 진입 시 실데이터 KPI 표시
- [ ] 발송 stuck 알림 (10분 이상) 0건 확인 가능
- [ ] webhook 설정율 정확
- [ ] viewer 계정 차단
- [ ] `npm run build` 통과

---

## 10. Phase 4 — `/admin` 대시보드

### 목표
- 위 3개 admin 영역의 KPI 종합
- 최근 활동 피드 (anomaly 신규, 사용자 가입, 매핑 변경 등)
- 빠른 액션 (실패 job 재시도, 미매핑 회사로 이동 등)

### UI
- KPI 12개 (3 col × 4 row 또는 6 × 2):
  - 전체 사용자, 7일 활성, AI 사용 (이번달), 차단 사용자
  - 오늘 실행 작업, 성공률, 평균 시간, 실패 작업
  - 24h 알림 발송, webhook 설정율, 미전송 stuck
  - 미매핑 회사, 신규 anomaly (24h), HIGH severity 미해소
- 빠른 링크 그리드: /admin/users, /admin/jobs, /admin/notifications, /admin/mapping, /admin/anomalies, /admin/audit
- 최근 활동 피드 (audit_logs 사용 — Phase 6 완료 후. Phase 4 단계에선 시간순 최근 anomalies + users 가입 정도)

### DoD
- [ ] 모든 KPI 실데이터
- [ ] 빠른 링크 작동
- [ ] viewer 계정 차단

---

## 11. Phase 5 — `/admin/anomalies` 이상탐지 룰 관리

### 목표
- 현재 코드에 하드코딩된 detector 임계값들을 DB 기반으로
- admin이 임계값 조정 + detector on/off

### 마이그레이션
`supabase/migrations/01100_detector_rules.sql` (위 5.4)

기존 detector 목록 INSERT (worker/detectors 디렉토리 보고 키 정의):
- `bookmark_brand_delta` (params: {threshold: 10})
- `bookmark_product_top100` (params: {})
- `rank_spike` (params: {threshold: ...})
- 등등 — Claude Code가 worker/detectors/ 보고 자동 추출

### 워커 변경
각 detector 모듈에서 하드코딩 상수 제거하고 `detector_rules` 조회:
- `worker/detectors/bookmark_detector.py`의 `BRAND_DELTA_THRESHOLD = 10` →
  ```python
  from worker.detectors.rules import get_rule
  threshold = get_rule('bookmark_brand_delta').get('threshold', 10)
  ```
- `worker/detectors/rules.py` 신규 — DB에서 룰 조회 + 캐시

### UI
- 테이블: detector_key, enabled toggle, params JSON 편집
- 변경 사항 저장 → DB UPDATE + 다음 detector 실행 시 반영

### DoD
- [ ] detector_rules 테이블 + 초기 row INSERT
- [ ] worker가 하드코딩 임계값 대신 DB 룰 사용
- [ ] /admin/anomalies에서 임계값 수정 → DB 반영 → 다음 detector 실행에 영향

---

## 12. Phase 6 — `/admin/audit` 감사 로그

### 목표
- 누가 언제 뭘 했는지 기록
- ISMS 인증 진행 시 필요
- admin action 자동 logging

### 마이그레이션
`supabase/migrations/01200_audit_logs.sql` (위 5.5)

### 통합 지점
다음 API route에서 audit log INSERT:
- `/api/admin/users/[id]` PATCH (role/quota 변경)
- `/api/admin/anomalies/[id]` PATCH (룰 변경)
- `/api/companies/[id]/corp-code` PATCH (DART 매핑)
- 기타 admin 액션

헬퍼 함수 `viewer/src/lib/audit.ts`:
```typescript
export async function logAudit(action: string, target: { type: string; id: string }, payload?: object) {
  // service_role client로 audit_logs INSERT
}
```

### UI
- 최근 N건 리스트 (actor, action, target, created_at)
- 필터: actor, action 종류, 기간
- 행 클릭 → payload JSON 펼침

### DoD
- [ ] audit_logs 테이블 생성
- [ ] admin API route 호출 시 자동 로그
- [ ] /admin/audit에서 최근 활동 표시

---

## 13. Phase 7 — `/settings` 마무리

### 목표
- 본인 환경설정만 (테마, 비밀번호, 2FA placeholder)
- Phase 0에서 임시 정리한 mock 다 제거

### 작업
- `/settings/page.tsx` 단순화:
  - 테마 토글 (light/dark — 이미 Topbar에 있음)
  - 비밀번호 변경 (Supabase auth.updateUser({password}))
  - 2FA placeholder ("준비 중")
- nav 사이드바 제거 (한 화면)

### DoD
- [ ] /settings에 mock 데이터 잔여 0건 (정호철·JH·IT팀장 하드코딩 X)
- [ ] 비밀번호 변경 동작 (Supabase auth)

---

## 8.5. Phase 1.5A — AiPanel 백엔드 + Claude only + 토큰 quota 실시간 + enforce

### 목표
- 현재 dead code인 AiPanel (`window.claude.complete()`)을 실제 백엔드 API로 전환
- **Claude API만** 동작 (OpenAI/Gemini 어댑터는 Phase 1.5B)
- 사용자가 UTTU AI 페이지 내에서 본인 (이번달 사용 토큰 / 한도) %를 **실시간 확인**
- LLM 호출 전 quota 체크 → 초과 시 차단
- Phase 1에서 깐 admin 측 quota 관리가 실제 동작 시작

### 마이그레이션

#### `supabase/migrations/00311_ai_messages_insert_policy.sql`
ai_messages는 SELECT 정책만 있고 INSERT 정책 없음. service_role 우회는 가능하지만 RLS-friendly하게 만드는 게 안전:
```sql
create policy "own messages insert" on public.ai_messages
  for insert to authenticated
  with check (
    exists (select 1 from public.ai_sessions
              where id = session_id and user_id = auth.uid())
  );
```

#### `supabase/migrations/00312_ai_allowed_models.sql`
```sql
create table public.ai_allowed_models (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null check (provider in ('claude', 'openai', 'gemini')),
  model_id      text not null,
  display_name  text not null,
  enabled       boolean not null default true,
  is_default    boolean not null default false,
  display_order int  not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (provider, model_id)
);

-- is_default 는 한 번에 하나만
create unique index ai_allowed_models_one_default
  on public.ai_allowed_models((1)) where is_default = true;

-- Claude 기본 모델 2개 INSERT (Phase 1.5B에서 OpenAI/Gemini 추가될 때)
insert into public.ai_allowed_models (provider, model_id, display_name, enabled, is_default, display_order) values
  ('claude', 'claude-sonnet-4-5', 'Claude Sonnet 4.5', true, true,  1),
  ('claude', 'claude-haiku-4-5',  'Claude Haiku 4.5',  true, false, 2);

-- RLS
alter table public.ai_allowed_models enable row level security;
create policy "models select all" on public.ai_allowed_models
  for select to authenticated using (true);
create policy "models manage admin" on public.ai_allowed_models
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
```

#### `supabase/migrations/00313_profiles_preferred_model.sql`
```sql
alter table public.profiles add column if not exists preferred_ai_model text;
comment on column public.profiles.preferred_ai_model is
  'ai_allowed_models.model_id 참조. NULL 또는 비활성 모델이면 is_default 모델로 fallback.';

-- ai_sessions에 provider/model 컬럼 추가 (감사·비용 분석용)
alter table public.ai_sessions add column if not exists ai_provider text default 'claude';
alter table public.ai_sessions add column if not exists ai_model    text;
```

### 시스템 흐름
```
사용자 → AiPanel UI 입력
       ↓
/api/ai/chat POST { session_id, message, context }
       ↓
1. supabaseServer().auth.getUser() → user_id
2. ai_user_quotas + 이번달 ai_usage_daily 조회 → quota 체크
3. 초과 시 차단 응답 { blocked: true, reason, monthly_used, monthly_limit }
4. 정상 시:
   a. 사용자 preferred_ai_model (없으면 is_default) 조회 + enabled 확인
   b. ai_messages INSERT (user 턴)
   c. Claude SDK 호출 (system + tools[exec_ai_query])
   d. tool_use 루프 (최대 5회): SELECT 생성 → exec_ai_query RPC → 결과 → 자연어 응답
   e. ai_messages INSERT (assistant 턴)
   f. ai_sessions UPDATE (input/output tokens 누적, ai_provider/ai_model 마킹)
   g. ai_usage_daily UPSERT
5. 응답:
   { content, tool_uses, usage: {input_tokens, output_tokens},
     quota: {monthly_used, monthly_limit, daily_used, daily_limit, is_blocked} }
```

### 작업 범위

#### 1. LLM 어댑터 구조 (Claude만 구현)
```
viewer/src/lib/llm/
├── types.ts          공통 인터페이스 (Message, Tool, ChatResult, LLMProvider)
├── claude.ts         Anthropic SDK 어댑터 (이번에 구현)
├── openai.ts         placeholder (Phase 1.5B)
├── gemini.ts         placeholder (Phase 1.5B)
└── index.ts          getProvider(provider) → 어댑터 분기 (지금은 claude만)
```

공통 인터페이스 (types.ts):
```typescript
export interface LLMTool {
  name: string;
  description: string;
  input_schema: object;
}

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMResult {
  content: string;
  tool_uses: { name: string; input: any; result: any }[];
  usage: { input_tokens: number; output_tokens: number };
  stop_reason: string;
}

export interface LLMProvider {
  runChat(input: {
    model: string;
    messages: LLMMessage[];
    tools?: LLMTool[];
    system?: string;
    max_iterations?: number;
  }): Promise<LLMResult>;
}
```

#### 2. API route `/api/ai/chat` (POST) 신규
- `requireAuth()` (Phase 1에서 만든 헬퍼 또는 신규)
- quota 체크 헬퍼: `checkUserQuota(user_id) → { allowed, reason, usage }`
- 어댑터 호출: `getProvider('claude').runChat({...})`
- exec_ai_query tool: 
  ```typescript
  { name: 'exec_ai_query', description: '...', input_schema: { type: 'object', properties: { query: { type: 'string' }}, required: ['query'] } }
  ```
- tool_use loop은 어댑터 내부에서 처리 (claude.ts가 supabase.rpc 호출 받아서 실행 — 또는 callback 패턴)
- ai_messages / ai_sessions / ai_usage_daily 갱신은 route에서

#### 3. API route `/api/ai/quota` (GET) 신규
사용자 본인 quota + 사용량 polling용:
```typescript
{
  monthly_limit: number | null,
  monthly_used: number,
  daily_limit: number | null,
  daily_used: number,
  is_blocked: boolean,
  note: string | null,
}
```

#### 4. API route `/api/ai/sessions` (POST/GET) 신규
- POST: 새 세션 생성 → session_id 반환
- GET: 본인 최근 N개 세션 리스트

#### 5. queries-me.ts 확장
```typescript
export interface MyAiQuota { monthly_limit, monthly_used, daily_limit, daily_used, is_blocked, note }
export async function fetchMyAiQuota(): Promise<MyAiQuota | null> { /* GET /api/ai/quota */ }
```

#### 6. AiPanel UI 개편
`viewer/src/components/shell/AiPanel.tsx` 대대적 수정.

**기존 `window.claude.complete()` 호출 제거** → `fetch('/api/ai/chat')` 교체.

추가 UI:
- 패널 헤더에 quota 진행률:
  - 무제한: `"AI 토큰: 무제한"` chip
  - 한도 있음: progress bar + 텍스트 `"73,400 / 100,000 (73%)"`, 80% 노란, 95% 빨간
- 메시지 전송 후 응답의 `quota` 필드로 즉시 갱신 (실시간)
- quota 초과 시 입력란 disabled + 빨간 안내
- is_blocked=true 시 패널 진입 자체 차단 (note 표시)

**Phase 1.5A에선 모델 picker UI 안 만듦** — is_default 모델만 사용. 1.5B에서 추가.

#### 7. /me 페이지 KPI 카드 추가 (옵션)
기존 6개 KPI 중 적당한 슬롯에 "AI 토큰 (이번달)" 추가:
- 값: `monthly_used / monthly_limit (백분율)` 또는 "무제한"
- /api/me/stats 응답에 추가 또는 별도 fetchMyAiQuota 호출

### 환경변수 추가
```bash
ANTHROPIC_API_KEY=sk-ant-...    # 필수
```

### 신규 npm 패키지
- `@anthropic-ai/sdk` — Anthropic 공식 SDK

Phase 1.5A 작업 시점에 Claude Code가 명시적으로 정호철 동의 받고 설치.

### DoD
- [ ] 4개 마이그레이션 적용 (00311, 00312, 00313 + Phase 1의 00310)
- [ ] `ANTHROPIC_API_KEY` 환경변수 설정
- [ ] `@anthropic-ai/sdk` 설치
- [ ] `/api/ai/chat` 호출 시 Claude 응답 반환
- [ ] tool_use loop 동작 — LLM이 SELECT 생성 → exec_ai_query 호출 → 결과 기반 자연어 응답
- [ ] quota 초과 사용자: 차단 응답 + AiPanel 입력 비활성화
- [ ] is_blocked=true 사용자: 패널 진입 자체 차단
- [ ] 무제한 사용자: 진행률 대신 "무제한" 표시
- [ ] 메시지 전송 후 진행률 즉시 갱신
- [ ] ai_sessions / ai_messages / ai_usage_daily 정상 기록
- [ ] /admin/users에서 본 사용자별 사용량과 일치
- [ ] `npm run build` 통과

---

## 8.6. Phase 1.5B — Multi-provider 확장 (OpenAI / Gemini + 사용자 picker + /admin/llm)

### 목표
- OpenAI / Gemini 어댑터 추가
- AiPanel에 사용자 모델 picker 드롭다운
- `/admin/llm` 신설 — admin이 모델 리스트 관리

### 마이그레이션
없음. ai_allowed_models 테이블에 row INSERT만 (admin UI 또는 수동 SQL).

### 작업 범위

#### 1. LLM 어댑터 — OpenAI / Gemini 구현
`viewer/src/lib/llm/openai.ts` — Chat Completions API + tools (`tool_calls` 형식)
`viewer/src/lib/llm/gemini.ts` — `@google/generative-ai` SDK + function calling

각 어댑터에서 tool_use loop 구현, 결과를 LLMResult 공통 포맷으로 정규화:
- OpenAI `prompt_tokens` → `input_tokens`
- OpenAI `completion_tokens` → `output_tokens`
- Gemini `promptTokenCount` → `input_tokens`
- Gemini `candidatesTokenCount` → `output_tokens`

`viewer/src/lib/llm/index.ts`의 `getProvider()`가 provider 문자열 받아 적절한 어댑터 반환.

#### 2. `/api/ai/chat` 수정
- 사용자의 `profiles.preferred_ai_model` 조회
- 빈값이면 `ai_allowed_models WHERE is_default=true`
- 선택된 model의 enabled 확인 (false면 fallback to default)
- 해당 provider 어댑터 호출

#### 3. API route `/api/admin/llm/models` (CRUD)
`viewer/src/app/api/admin/llm/models/route.ts`:
- GET: 전체 모델 리스트
- POST: 새 모델 추가 (admin only)

`viewer/src/app/api/admin/llm/models/[id]/route.ts`:
- PATCH: enabled, is_default, display_order, display_name 수정
- DELETE: 모델 삭제 (사용자의 preferred_ai_model에 영향 — fallback 메커니즘으로 안전)

모두 `requireAdmin()` 가드.

#### 4. `/admin/llm` 페이지 신규
`viewer/src/app/(app)/admin/llm/page.tsx`:
- 모델 리스트 테이블
- 행별: provider chip, model_id, display_name, enabled toggle, is_default radio, display_order
- 환경변수 누락 검증:
  - `ANTHROPIC_API_KEY` 없으면 Claude 모델 enabled 강제 false + 경고
  - `OPENAI_API_KEY` 없으면 OpenAI 모델 동일
  - `GEMINI_API_KEY` 없으면 Gemini 모델 동일
- "새 모델 추가" 모달: provider 선택 + model_id 입력 + display_name 입력
- 미리 정의된 모델 옵션 (편의):
  - Claude: claude-sonnet-4-5, claude-haiku-4-5, claude-opus-4-5
  - OpenAI: gpt-4o, gpt-4o-mini, gpt-4-turbo
  - Gemini: gemini-1.5-pro, gemini-1.5-flash, gemini-2.0-flash-exp

#### 5. AiPanel에 모델 picker
패널 헤더의 quota 진행률 옆에 작은 드롭다운:
- enabled=true 모델만 표시
- 선택 시 즉시 `profiles.preferred_ai_model` UPDATE + 다음 메시지부터 적용
- 현재 모델은 display_name으로 표시

API route `/api/ai/models` (GET) 신규: 사용자가 활성 모델 리스트 조회용. 단순 select.

#### 6. queries-admin.ts 또는 queries-me.ts 확장
- `fetchAllowedModels()` — enabled 모델만 (사용자용)
- `fetchAllModels()` — admin용 (전체)
- `updateUserPreferredModel(model_id)`

### 환경변수 추가
```bash
OPENAI_API_KEY=sk-...          # OpenAI 사용 시
GEMINI_API_KEY=...             # Gemini 사용 시
```

### 신규 npm 패키지
- `openai` — OpenAI 공식 SDK
- `@google/generative-ai` — Google AI SDK

### DoD
- [ ] OpenAI 어댑터 구현 + Chat Completions tool_calls 호환
- [ ] Gemini 어댑터 구현 + function calling 호환
- [ ] `/admin/llm` 페이지에서 모델 CRUD 정상 동작
- [ ] enabled 토글 → 사용자 측에서 즉시 반영
- [ ] is_default 변경 → preferred_ai_model 없는 사용자에게 적용
- [ ] AiPanel 모델 picker에서 변경 → 다음 메시지부터 새 provider 사용
- [ ] 사용자가 preferred_ai_model로 비활성 모델 선택돼있다면 default로 fallback
- [ ] API key 환경변수 누락 → /admin/llm 경고 표시 + enabled 토글 시 거부
- [ ] OpenAI/Gemini 호출도 ai_sessions/ai_messages/ai_usage_daily 정상 기록 (정규화된 토큰 단위)
- [ ] /admin/users에서 사용자별 사용량 모델 무관하게 합산 표시
- [ ] `npm run build` 통과

### 검증 시나리오
1. admin: /admin/llm에서 OpenAI 모델 1개 추가 + enabled=true
2. 본인이 AiPanel에서 모델 picker → OpenAI 선택
3. 질문 전송 → OpenAI 응답 받음
4. ai_sessions에 ai_provider='openai', ai_model='gpt-4o' 기록 확인
5. admin이 그 OpenAI 모델 enabled=false → 본인 다음 메시지 시 default(Claude)로 fallback
6. /admin/users 본인 row 사용량 — Claude + OpenAI 토큰 합산 (양쪽 호출 다 포함)

---

## 15. 마이그레이션 적용 순서

```
00310_ai_quota_defaults.sql           ← Phase 1   (가입 트리거 + admin RLS)
00311_ai_messages_insert_policy.sql   ← Phase 1.5A (ai_messages INSERT 정책)
00312_ai_allowed_models.sql           ← Phase 1.5A (모델 리스트 테이블 + Claude row 2개)
00313_profiles_preferred_model.sql    ← Phase 1.5A (profiles에 preferred_ai_model 컬럼)
01100_detector_rules.sql              ← Phase 5
01200_audit_logs.sql                  ← Phase 6
```

Phase 1.5B에서는 마이그레이션 없음 — ai_allowed_models에 row INSERT만 (admin UI 통해 또는 수동 SQL).

Phase 1 마이그레이션 적용 후 즉시:
```sql
-- 기존 사용자 backfill
insert into public.ai_user_quotas (user_id, monthly_token_limit, daily_token_limit, is_blocked)
select id, 100000, null, false from public.profiles
on conflict (user_id) do nothing;
```

---

## 16. 진행 권장 순서 (정호철 시간 분배)

| 시점 | Phase | 작업량 | 메모 |
|---|---|---|---|
| Day 1 | 0 | 반나절 | 구조 정리, 위험 없음 |
| Day 1~3 | 1 | 2~3일 | admin이 사용자 quota 관리 |
| Day 4~6 | **1.5A** | **2~3일** | **AiPanel 백엔드 + Claude only + quota 실시간 + enforce** |
| Day 7~8 | **1.5B** | **1~2일** | **Multi-provider 확장 (OpenAI/Gemini) + 사용자 picker + /admin/llm** |
| Day 9~10 | 2 | 2일 | 수집 모니터링, Realtime 학습 |
| Day 11~12 | 3 | 2일 | 알림 모니터링 |
| Day 13 | 4 | 1일 | 대시보드, 위 3개 종합 |
| --- | --- | --- | --- |
| Day 14~15 | 5 | 2일 | detector 룰 (선택) |
| Day 16~17 | 6 | 2일 | 감사 로그 (ISMS 준비) |
| Day 18 | 7 | 반나절 | settings 마무리 |

총 13~18일. 0~1.5B까지 끝나면 토큰 시스템 + LLM 전환 완성됨 (UTTU AI 완성).
0~4까지가 운영 가시화 MVP (9~10일).

---

## 17. 다음 단계

Phase 0 프롬프트부터 시작. 각 Phase 완료 시:
1. 정호철이 마이그레이션 적용
2. 수동 검증
3. 다음 Phase 프롬프트 요청
