# UTTU 마이페이지 기능 구현 — 실행 계획

> 작성자: 정호철 (Claude 사전설계 → Claude Code 실행)
> 작성일: 2026-05-24
> 대상 저장소: `~/projects/uttu` (zbra-kr/uttu)
> 사용자 규모: B.CAVE 임직원 약 300명
> 채널: Teams (전 사용자, 개인 webhook) + Telegram (관리자 전용)

---

## 0. 이 문서의 사용법

Claude Code에 이 파일을 전달하고 **Phase 단위로** 작업을 의뢰한다.
한 Phase가 끝날 때마다 정호철이 수동으로:

1. 마이그레이션 SQL을 Supabase SQL Editor에서 적용
2. 빌드/dry-run 검증
3. 다음 Phase 진행 결정

**절대 자동으로 마이그레이션 적용·cron 등록·Vercel 배포 하지 않는다.**

---

## 1. 현재 상태 (이미 있는 것)

| 인프라 | 위치 | 비고 |
|---|---|---|
| `profiles` 테이블 (id, full_name, role, team) | `supabase/migrations/00200_user_profiles.sql` | ✅ 있음 |
| `is_admin()` RLS 헬퍼 | 동일 파일 | ✅ |
| @bcave.co.kr 도메인 게이트 | 동일 파일 | ✅ |
| `handle_new_user()` 가입 트리거 | 동일 파일 | ✅ |
| 미들웨어 auth gating | `viewer/src/middleware.ts` | ✅ |
| Supabase SSR (anon + service_role 분리) | `viewer/src/lib/supabase/*.ts` | ✅ |
| Teams + Telegram 알림 송신 유틸 | `worker/tasks/notify.py` | ⚠️ 단일 webhook — 확장 필요 |
| /me 페이지 (mock UI) | `viewer/src/app/(app)/me/page.tsx` | ⚠️ 100% 정적 |
| Sidebar `ADMIN_EMAIL = 'it@bcave.co.kr'` 하드코딩 | `viewer/src/components/shell/Sidebar.tsx:8` | ❌ Phase 0에서 제거 |

---

## 2. 절대 규칙 (모든 Phase 공통)

1. **마이그레이션 자동 적용 금지** — SQL 파일만 작성, 정호철이 SQL Editor에서 수동 적용
2. **cron 자동 등록 금지** — 등록할 라인만 제시
3. **service_role 키는 워커·서버 API route 전용** — 클라이언트 컴포넌트(`'use client'`)에서 절대 금지
4. **모든 user-owned 테이블 RLS 필수** — 정책 빠뜨리면 회사 데이터 leak
5. **CSS 변수만 사용** — hex 하드코딩 금지. `var(--bg)`, `var(--f1~4)`, `var(--bd)`, `var(--hs)` 등 (`viewer/src/styles/tokens.css` 참조)
6. **error 변수 처리 필수** — `const { data, error } = await query;` 패턴, 빈 화면 버그 방지
7. **PostgREST 1000행 캡** — `.limit()` 또는 `.range()` 명시
8. **닉네임/유저ID 수집 금지는 무신사 데이터 대상**. 자사 임직원 데이터(profiles)는 정상 운영
9. **시크릿 노출 금지** — `SUPABASE_SERVICE_ROLE_KEY`, `DART_API_KEY`, 개인 `teams_webhook_url` 등 로그·커밋에 절대 포함 금지
10. **기존 스크래퍼 규칙 유지** — `worker/scrapers/base.py` 의 `SCRAPE_MIN_DELAY_SEC=3.0`, `semaphore=1`, `_BLOCK_SIGNALS` 절대 변경 금지

---

## 3. 컨벤션

### 3.1 파일 위치
| 도메인 | 경로 |
|---|---|
| 마이그레이션 | `supabase/migrations/NNNNN_<목적>.sql` (5자리 번호 순) |
| 워커 신규 모듈 | `worker/notifications/`, `worker/tasks/` |
| 워커 스크립트 | `scripts/run_<목적>.sh` |
| 뷰어 페이지 | `viewer/src/app/(app)/<route>/page.tsx` |
| 뷰어 API route | `viewer/src/app/api/me/<목적>/route.ts` |
| 뷰어 공통 컴포넌트 | `viewer/src/components/me/<Name>.tsx` (마이페이지 전용) |
| 뷰어 쿼리 함수 | `viewer/src/lib/queries-me.ts` (새 파일) |

### 3.2 스타일 토큰 (반드시 사용)
```css
/* 표면 / 경계 */
var(--bg) var(--sur) var(--snk) var(--hov) var(--bd) var(--bs)
/* 텍스트 */
var(--f1) var(--f2) var(--f3) var(--f4)
/* 시그널 */
var(--shf) /* 빨강 */  var(--smf) /* 노랑 */  var(--slf) /* 초록 */
var(--hs) /* 브랜드 */
/* 폰트 */
var(--mono) var(--sans) var(--pixel)
```

### 3.3 Supabase 클라이언트 선택
| 환경 | 키 | 함수 |
|---|---|---|
| 클라이언트 컴포넌트 | anon | `supabaseBrowser()` |
| 서버 컴포넌트/RSC | anon (쿠키 인증) | `supabaseServer()` |
| API route (관리 작업) | **service_role** | `createClient(URL, SERVICE_ROLE_KEY)` |
| 워커 (Python) | **service_role** | `create_client(URL, SERVICE_ROLE_KEY)` |

### 3.4 보고 형식 (각 Phase 완료 시)
```
[1] 작업 요약 (1~2줄)
[2] 생성·수정된 파일 목록
[3] 마이그레이션 (수동 적용 필요)
[4] cron 등록 라인 (수동 등록 필요)
[5] 검증 방법 (dry-run, 빌드, 수동 테스트 단계)
[6] 다음 Phase 권장 진행 시점
[7] commit hash
```

---

## 4. 데이터 모델 — 신규 테이블 총괄

| 테이블 | 신설 Phase | 용도 |
|---|---|---|
| `profiles` (확장만) | 0 | display_name, teams_webhook_url, telegram_chat_id 컬럼 추가 |
| `user_notification_subscriptions` | 1 | 이벤트×채널 토글 |
| `user_notifications` | 1 | 알림 inbox + dispatcher 발송 큐 |
| `user_notes` | 2 | 메모 + @mention |
| `user_bookmarks` | 3 | 북마크 (polymorphic) |
| `user_view_history` | 4 | 최근 본 (rolling 50) |
| `user_saved_filters` | 5 | 저장 필터 |

### Polymorphic ENUM
```sql
create type entity_type as enum ('company', 'brand', 'product', 'ranking_filter');
```
FK는 걸지 않는다 (cross-table 불가). 코드에서 `entity_type` 분기하여 resolve.

---

## 5. Phase 0 — 권한·프로필 인프라 정리

### 목표
- `profiles` 확장 (display_name, teams_webhook_url, telegram_chat_id)
- Sidebar `ADMIN_EMAIL` 하드코딩 제거 → `profiles.role` 기반
- /me 헤더 + 권한 섹션 실데이터화
- 프로필 편집 모달 (full_name, team, display_name, teams_webhook_url 수정)

### 마이그레이션 — `supabase/migrations/00400_profiles_extension.sql`
```sql
-- pg_trgm: 멘션 자동완성용 부분일치 검색
create extension if not exists pg_trgm;

-- 컬럼 추가
alter table public.profiles add column if not exists display_name      text;
alter table public.profiles add column if not exists teams_webhook_url text;
alter table public.profiles add column if not exists telegram_chat_id  text;

-- display_name UNIQUE — 멘션 모호성 제거 (300명 규모면 동명이인 거의 없음, 있으면 본인이 변경)
create unique index if not exists profiles_display_name_uq
  on public.profiles(display_name)
  where display_name is not null;

-- 멘션 자동완성용 trigram 인덱스
create index if not exists profiles_display_name_trgm
  on public.profiles using gin (display_name gin_trgm_ops);

comment on column public.profiles.display_name      is '멘션 표시명 (예: "정호철"). UNIQUE.';
comment on column public.profiles.teams_webhook_url is 'Teams 개인 webhook URL. 본인만 수정 가능.';
comment on column public.profiles.telegram_chat_id  is 'Telegram 개인 chat_id. admin 전용.';
```

### 코드 변경

#### A. `viewer/src/components/shell/Sidebar.tsx`
- `ADMIN_EMAIL = 'it@bcave.co.kr'` 라인 삭제
- `user` state 확장: `{ name, email, initials, role }`
- `useEffect` 안에서 `profiles` 테이블 조회 추가:
  ```typescript
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, display_name, role')
    .eq('id', user.id)
    .single();
  setUser({
    name: profile?.full_name || email.split('@')[0],
    email,
    initials: getInitials(profile?.full_name || ''),
    role: profile?.role || 'viewer',
  });
  ```
- `isAdmin = user?.role === 'admin'` 으로 교체

#### B. `viewer/src/lib/queries-me.ts` (신규 파일)
```typescript
import { supabaseBrowser } from './supabase/client';
const supabase = supabaseBrowser();

export interface MyProfile {
  id: string;
  email: string;
  full_name: string | null;
  display_name: string | null;
  role: 'admin' | 'viewer';
  team: string | null;
  teams_webhook_url: string | null;
  telegram_chat_id: string | null;
  created_at: string;
  last_sign_in_at: string | null;
}

export async function fetchMyProfile(): Promise<MyProfile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, display_name, role, team, teams_webhook_url, telegram_chat_id, created_at')
    .eq('id', user.id)
    .single();
  if (error) {
    console.error('[fetchMyProfile]', error);
    return null;
  }
  return {
    ...data,
    email: user.email!,
    last_sign_in_at: user.last_sign_in_at ?? null,
  };
}

export async function updateMyProfile(patch: Partial<Pick<MyProfile,
  'full_name' | 'display_name' | 'team' | 'teams_webhook_url' | 'telegram_chat_id'
>>): Promise<{ error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: '로그인 필요' };
  const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
  return { error: error?.message ?? null };
}
```

#### C. `viewer/src/app/(app)/me/page.tsx` — 헤더 + 권한 섹션 실데이터화
- mock 부분(JH 이니셜, 정호철 하드코딩 등) 제거
- `fetchMyProfile()` 호출
- "프로필 편집" 버튼 → 모달 컴포넌트 `viewer/src/components/me/ProfileEditModal.tsx` (신규)
- "내 권한" 섹션은 `profile.role`에 따라 분기 (admin이면 전체 메뉴, viewer면 magazine/matching/reviews/mapping/settings 제외)

#### D. `viewer/src/components/me/ProfileEditModal.tsx` (신규)
- 수정 가능 필드: full_name, display_name, team, teams_webhook_url
- (telegram_chat_id는 admin만 노출)
- 저장 시 `updateMyProfile()` 호출, display_name UNIQUE 충돌 시 23505 에러 메시지 한글 표시

### DoD (Definition of Done)
- [ ] 00400 마이그레이션 적용 후 profiles에 3개 컬럼 존재
- [ ] Sidebar에 `ADMIN_EMAIL` 문자열 grep 결과 0개
- [ ] /me에서 본인 이름/팀/이메일/가입일 실데이터 표시
- [ ] 프로필 편집 모달에서 display_name 수정 후 새로고침해도 유지
- [ ] viewer 사용자가 magazine/matching/reviews 메뉴를 사이드바에서 못 봄
- [ ] `viewer && npm run build` 통과

---

## 6. Phase 1 — 알림 인프라

### 목표
- 이벤트 7종 × 채널 2종 매트릭스 구독
- 워커가 anomaly·mention 등 트리거 시 `user_notifications`에 INSERT
- 별도 dispatcher cron이 unsent를 polling하여 Teams/Telegram 발송
- /me 또는 /settings에 구독 매트릭스 UI

### 이벤트·채널 정의
| event_type | 트리거 | 기본값 |
|---|---|---|
| `daily_summary` | 매일 03:30 cron | Teams ON |
| `mention` | user_notes INSERT 시 멘션됨 | Teams ON (가장 사용자 중심) |
| `anomaly_high` | detectors가 severity HIGH 생성 | Teams OFF |
| `anomaly_med` | detectors가 severity MED 생성 | Teams OFF |
| `dart_new_disclosure` | DART 주간 수집 시 신규 공시 | Teams OFF |
| `review_low_rating` | reviews 별점 1~2 신규 | Teams OFF |
| `rank_change_bookmarked` | 북마크한 브랜드/상품 랭킹 변동 (Phase 3에서 활성화) | Teams ON |

| channel | 대상 |
|---|---|
| `teams` | 전 사용자 (본인 webhook 입력 시 발송, 없으면 스킵) |
| `telegram` | role='admin' 만 (telegram_chat_id 있을 때만 발송) |

### 마이그레이션 — `supabase/migrations/00500_user_notifications.sql`
```sql
-- ENUMs
do $$ begin
  create type notification_event as enum (
    'daily_summary', 'anomaly_high', 'anomaly_med',
    'mention', 'dart_new_disclosure',
    'review_low_rating', 'rank_change_bookmarked'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_channel as enum ('teams', 'telegram');
exception when duplicate_object then null; end $$;

-- 구독 매트릭스
create table public.user_notification_subscriptions (
  user_id    uuid not null references auth.users(id) on delete cascade,
  event_type notification_event not null,
  channel    notification_channel not null,
  enabled    boolean not null default true,
  params     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, event_type, channel)
);
comment on table public.user_notification_subscriptions is '사용자 알림 구독 매트릭스';

-- inbox + dispatcher 큐 통합
create table public.user_notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  event_type    notification_event not null,
  title         text not null,
  body          text,
  link          text,
  payload       jsonb not null default '{}'::jsonb,
  read_at       timestamptz,
  sent_to_teams_at    timestamptz,
  sent_to_telegram_at timestamptz,
  created_at    timestamptz not null default now()
);
comment on table public.user_notifications is '알림 inbox + dispatcher 발송 큐';

create index user_notifications_inbox_idx
  on public.user_notifications(user_id, created_at desc);
create index user_notifications_unread_idx
  on public.user_notifications(user_id) where read_at is null;
create index user_notifications_unsent_teams_idx
  on public.user_notifications(created_at) where sent_to_teams_at is null;
create index user_notifications_unsent_telegram_idx
  on public.user_notifications(created_at) where sent_to_telegram_at is null;

-- RLS
alter table public.user_notification_subscriptions enable row level security;
create policy "own subs select" on public.user_notification_subscriptions
  for select to authenticated using (user_id = auth.uid());
create policy "own subs upsert" on public.user_notification_subscriptions
  for insert to authenticated with check (user_id = auth.uid());
create policy "own subs update" on public.user_notification_subscriptions
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "own subs delete" on public.user_notification_subscriptions
  for delete to authenticated using (user_id = auth.uid());

alter table public.user_notifications enable row level security;
create policy "own notif select" on public.user_notifications
  for select to authenticated using (user_id = auth.uid());
create policy "own notif update" on public.user_notifications
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "own notif delete" on public.user_notifications
  for delete to authenticated using (user_id = auth.uid());
-- INSERT는 service_role 전용 (워커가 직접 INSERT)

-- 가입 시 기본 구독 자동 생성
create or replace function public.handle_user_subscription_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_notification_subscriptions (user_id, event_type, channel, enabled)
  values
    (new.id, 'daily_summary',          'teams', true),
    (new.id, 'mention',                'teams', true),
    (new.id, 'rank_change_bookmarked', 'teams', true),
    (new.id, 'anomaly_high',           'teams', false),
    (new.id, 'anomaly_med',            'teams', false),
    (new.id, 'dart_new_disclosure',    'teams', false),
    (new.id, 'review_low_rating',      'teams', false)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_profile_subscription_defaults on public.profiles;
create trigger on_profile_subscription_defaults
  after insert on public.profiles
  for each row execute procedure public.handle_user_subscription_defaults();
```

### 워커 — 신규 패키지 `worker/notifications/`

#### `worker/notifications/__init__.py`
```python
from worker.notifications.enqueue import enqueue_notification
from worker.notifications.dispatcher import dispatch_pending
```

#### `worker/notifications/enqueue.py`
```python
"""user_notifications 에 알림 INSERT — detector·메모 멘션 등에서 호출."""
import os
from typing import Literal
from supabase import Client, create_client

EventType = Literal[
    'daily_summary', 'anomaly_high', 'anomaly_med',
    'mention', 'dart_new_disclosure',
    'review_low_rating', 'rank_change_bookmarked',
]


def _client() -> Client:
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ['SUPABASE_SERVICE_KEY']
    return create_client(os.environ['SUPABASE_URL'], key)


def enqueue_notification(
    user_id: str,
    event_type: EventType,
    title: str,
    body: str | None = None,
    link: str | None = None,
    payload: dict | None = None,
    client: Client | None = None,
) -> None:
    """단일 사용자에게 알림 INSERT. 발송은 dispatcher가 처리."""
    c = client or _client()
    c.table('user_notifications').insert({
        'user_id': user_id,
        'event_type': event_type,
        'title': title,
        'body': body,
        'link': link,
        'payload': payload or {},
    }).execute()


def enqueue_for_subscribers(
    event_type: EventType,
    title: str,
    body: str | None = None,
    link: str | None = None,
    payload: dict | None = None,
    client: Client | None = None,
) -> int:
    """이 이벤트를 구독한 모든 사용자에게 알림 INSERT.
    enabled=true 인 구독자만 대상. 중복 방지를 위해 (event_type, channel) 모두 enabled여도 사용자별 1건만 INSERT."""
    c = client or _client()
    subs = (
        c.table('user_notification_subscriptions')
        .select('user_id')
        .eq('event_type', event_type)
        .eq('enabled', True)
        .execute()
        .data or []
    )
    user_ids = list({s['user_id'] for s in subs})
    if not user_ids:
        return 0
    rows = [
        {
            'user_id': uid, 'event_type': event_type,
            'title': title, 'body': body, 'link': link,
            'payload': payload or {},
        }
        for uid in user_ids
    ]
    # 1000건씩 청크
    for i in range(0, len(rows), 1000):
        c.table('user_notifications').insert(rows[i:i+1000]).execute()
    return len(rows)
```

#### `worker/notifications/channels/teams.py`
```python
"""Teams 개인 webhook 발송. profiles.teams_webhook_url 사용."""
import httpx
from loguru import logger


def send_teams(webhook_url: str, title: str, body: str | None, link: str | None) -> bool:
    """단일 webhook으로 Teams 메시지 전송. 성공 시 True."""
    text = f"**{title}**"
    if body:
        text += f"\n\n{body}"
    if link:
        site = "https://uttu.bcave.co.kr"  # NEXT_PUBLIC_SITE_URL과 맞춤
        text += f"\n\n[열기]({site}{link})"
    try:
        resp = httpx.post(webhook_url, json={'text': text}, timeout=10)
        if resp.status_code >= 400:
            logger.warning('teams_send_failed', status=resp.status_code, body=resp.text[:200])
            return False
        return True
    except Exception as e:
        logger.warning('teams_send_exception', error=str(e))
        return False
```

#### `worker/notifications/channels/telegram.py`
```python
"""Telegram 개인 chat_id 발송. admin만."""
import os
import httpx
from loguru import logger


def send_telegram(chat_id: str, title: str, body: str | None, link: str | None) -> bool:
    token = os.environ.get('TELEGRAM_BOT_TOKEN')
    if not token:
        return False
    text = f"<b>{title}</b>"
    if body:
        text += f"\n\n{body}"
    if link:
        site = "https://uttu.bcave.co.kr"
        text += f"\n\n<a href=\"{site}{link}\">열기</a>"
    try:
        resp = httpx.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={'chat_id': chat_id, 'text': text, 'parse_mode': 'HTML', 'disable_web_page_preview': True},
            timeout=10,
        )
        return resp.status_code < 400
    except Exception as e:
        logger.warning('telegram_send_exception', error=str(e))
        return False
```

#### `worker/notifications/dispatcher.py`
```python
"""5분마다 unsent 알림을 polling하여 채널별 발송."""
import os
from datetime import datetime
import pytz
from loguru import logger
from supabase import create_client
from dotenv import load_dotenv

from worker.notifications.channels.teams import send_teams
from worker.notifications.channels.telegram import send_telegram

load_dotenv()
KST = pytz.timezone('Asia/Seoul')
BATCH_SIZE = 200


def _client():
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ['SUPABASE_SERVICE_KEY']
    return create_client(os.environ['SUPABASE_URL'], key)


def dispatch_pending() -> dict:
    """unsent 알림을 채널별로 발송. 발송 시각 마킹."""
    c = _client()
    now_iso = datetime.now(KST).isoformat()

    # Teams unsent 처리
    teams_rows = (
        c.table('user_notifications')
        .select('id, user_id, event_type, title, body, link')
        .is_('sent_to_teams_at', 'null')
        .order('created_at', desc=False)
        .limit(BATCH_SIZE)
        .execute()
        .data or []
    )

    # 사용자별 webhook url 일괄 조회
    user_ids = list({r['user_id'] for r in teams_rows})
    webhooks = {}
    if user_ids:
        for i in range(0, len(user_ids), 200):
            chunk = user_ids[i:i+200]
            profs = (
                c.table('profiles')
                .select('id, teams_webhook_url')
                .in_('id', chunk)
                .execute()
                .data or []
            )
            for p in profs:
                if p['teams_webhook_url']:
                    webhooks[p['id']] = p['teams_webhook_url']

    # event_type별 구독 enabled 확인 (per-user)
    enabled_subs: dict[tuple[str, str], bool] = {}
    if teams_rows:
        keys = list({(r['user_id'], r['event_type']) for r in teams_rows})
        for uid, ev in keys:
            sub = (
                c.table('user_notification_subscriptions')
                .select('enabled')
                .eq('user_id', uid).eq('event_type', ev).eq('channel', 'teams')
                .maybeSingle()
                .execute().data
            )
            enabled_subs[(uid, ev)] = bool(sub and sub.get('enabled'))

    teams_sent = 0
    for r in teams_rows:
        # 구독 OFF이거나 webhook 미설정이면 sent_to_teams_at만 마킹하고 스킵
        webhook = webhooks.get(r['user_id'])
        is_enabled = enabled_subs.get((r['user_id'], r['event_type']), False)
        ok = False
        if webhook and is_enabled:
            ok = send_teams(webhook, r['title'], r['body'], r['link'])
        # 마킹 — 성공·실패·스킵 모두. 무한 재시도 방지.
        c.table('user_notifications').update({'sent_to_teams_at': now_iso}).eq('id', r['id']).execute()
        if ok:
            teams_sent += 1

    # Telegram — admin만, 동일 로직
    tg_rows = (
        c.table('user_notifications')
        .select('id, user_id, event_type, title, body, link')
        .is_('sent_to_telegram_at', 'null')
        .order('created_at', desc=False)
        .limit(BATCH_SIZE)
        .execute()
        .data or []
    )
    user_ids = list({r['user_id'] for r in tg_rows})
    tg_targets = {}
    if user_ids:
        for i in range(0, len(user_ids), 200):
            chunk = user_ids[i:i+200]
            profs = (
                c.table('profiles')
                .select('id, role, telegram_chat_id')
                .in_('id', chunk)
                .execute()
                .data or []
            )
            for p in profs:
                if p['role'] == 'admin' and p['telegram_chat_id']:
                    tg_targets[p['id']] = p['telegram_chat_id']

    tg_sent = 0
    for r in tg_rows:
        chat_id = tg_targets.get(r['user_id'])
        ok = False
        if chat_id:
            # Telegram도 구독 체크
            sub = (
                c.table('user_notification_subscriptions')
                .select('enabled')
                .eq('user_id', r['user_id']).eq('event_type', r['event_type']).eq('channel', 'telegram')
                .maybeSingle().execute().data
            )
            if sub and sub.get('enabled'):
                ok = send_telegram(chat_id, r['title'], r['body'], r['link'])
        c.table('user_notifications').update({'sent_to_telegram_at': now_iso}).eq('id', r['id']).execute()
        if ok:
            tg_sent += 1

    logger.info('dispatch_done', teams_sent=teams_sent, teams_total=len(teams_rows),
                tg_sent=tg_sent, tg_total=len(tg_rows))
    return {'teams_sent': teams_sent, 'teams_total': len(teams_rows),
            'telegram_sent': tg_sent, 'telegram_total': len(tg_rows)}


def main():
    dispatch_pending()


if __name__ == '__main__':
    main()
```

#### `scripts/run_dispatcher.sh`
```bash
#!/bin/bash
set -euo pipefail
LOG_DIR="/Users/macmini/projects/uttu/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/dispatcher_$(date +%Y%m%d).log"
cd /Users/macmini/projects/uttu
source .env 2>/dev/null || true
worker/.venv/bin/python3 -m worker.notifications.dispatcher >> "$LOG" 2>&1
```

#### cron 라인 (정호철이 수동 등록)
```cron
# 5분마다 알림 발송
*/5 * * * * /Users/macmini/projects/uttu/scripts/run_dispatcher.sh
```

### 워커 detector 통합

#### `worker/detectors/runner.py` — 수정
- `save_anomalies()` 직후 `enqueue_for_subscribers()` 호출
- severity HIGH → `anomaly_high`, MED → `anomaly_med` 이벤트로 분리
- title/body는 anomaly_type 한글 매핑 ("rank_spike" → "순위 급등 — {brand} {product}")
- link: `/anomaly?date=YYYY-MM-DD` 또는 `/product?id={product_id}`

### 뷰어 — 구독 매트릭스 UI

#### `viewer/src/lib/queries-me.ts` 추가
```typescript
export type NotificationEvent =
  | 'daily_summary' | 'anomaly_high' | 'anomaly_med'
  | 'mention' | 'dart_new_disclosure'
  | 'review_low_rating' | 'rank_change_bookmarked';

export type NotificationChannel = 'teams' | 'telegram';

export interface SubscriptionRow {
  event_type: NotificationEvent;
  channel: NotificationChannel;
  enabled: boolean;
}

export async function fetchMySubscriptions(): Promise<SubscriptionRow[]> {
  const { data, error } = await supabase
    .from('user_notification_subscriptions')
    .select('event_type, channel, enabled');
  if (error) { console.error('[fetchMySubscriptions]', error); return []; }
  return data ?? [];
}

export async function toggleSubscription(
  event_type: NotificationEvent,
  channel: NotificationChannel,
  enabled: boolean,
): Promise<{ error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: '로그인 필요' };
  const { error } = await supabase
    .from('user_notification_subscriptions')
    .upsert({ user_id: user.id, event_type, channel, enabled });
  return { error: error?.message ?? null };
}

export interface NotificationInbox {
  id: string;
  event_type: NotificationEvent;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export async function fetchInbox(limit = 50): Promise<NotificationInbox[]> {
  const { data, error } = await supabase
    .from('user_notifications')
    .select('id, event_type, title, body, link, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.error('[fetchInbox]', error); return []; }
  return data ?? [];
}

export async function markRead(id: string): Promise<void> {
  await supabase.from('user_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id);
}

export async function markAllRead(): Promise<void> {
  await supabase.from('user_notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);
}
```

#### `viewer/src/components/me/SubscriptionMatrix.tsx` (신규)
- 7개 이벤트 × 2개 채널 (telegram 컬럼은 admin만 표시) 그리드
- 각 셀에 토글
- "이벤트 설명" 툴팁

#### `viewer/src/app/(app)/me/page.tsx` — "알림 구독" 섹션 교체
- 기존 mock 6개 행 → `SubscriptionMatrix` 컴포넌트
- 상단에 inbox 미리보기 5건 추가 ("받은 알림" 새 섹션)

#### Topbar 알림 뱃지 추가
- `viewer/src/components/shell/Topbar.tsx` 에 종 아이콘 + unread count 뱃지
- 클릭 시 드롭다운으로 inbox 최근 10건 표시

### Phase 1 DoD
- [ ] 00500 마이그레이션 적용 후 2개 테이블 존재
- [ ] 신규 가입자 profile 생성 시 `user_notification_subscriptions` 7건 자동 INSERT 확인
- [ ] 정호철 본인 계정에 teams_webhook_url 입력 후 detector dry-run → user_notifications INSERT → dispatcher 실행 → Teams 메시지 수신
- [ ] /me 구독 매트릭스에서 토글 변경 → DB 반영 → dispatcher 행동 변화
- [ ] Topbar 종 아이콘 unread count 정확
- [ ] dispatcher 5분 cron 등록 라인 보고

---

## 7. Phase 2 — 메모 + @mention

### 목표
- 본인 메모: company/brand/product/ranking_filter 페이지에 부착
- @mention: 메모 작성 중 `@` 입력 → 사내 사용자 자동완성 → 멘션된 사용자에게 알림
- /me에서 "받은 멘션" + "내 메모" 두 섹션

### v1 정책 (이번 Phase 범위)
- 메모는 본인 소유 (작성자만 수정/삭제)
- 멘션된 사용자도 그 메모만 RLS로 read 가능
- **답글(스레드)은 v2로 미룸** — 멘션받은 사람이 응답하려면 본인이 그 페이지로 가서 본인 메모를 새로 적고 작성자를 멘션

### 마이그레이션 — `supabase/migrations/00600_user_notes.sql`
```sql
do $$ begin
  create type entity_type as enum ('company', 'brand', 'product', 'ranking_filter');
exception when duplicate_object then null; end $$;

create table public.user_notes (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  body                text not null check (length(body) <= 4000),
  entity_type         entity_type,
  entity_id           text,
  tags                text[] not null default '{}',
  mentioned_user_ids  uuid[] not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index user_notes_owner_idx    on public.user_notes(user_id, created_at desc);
create index user_notes_entity_idx   on public.user_notes(entity_type, entity_id)
  where entity_type is not null;
create index user_notes_mentions_gin on public.user_notes using gin (mentioned_user_ids);
create index user_notes_tags_gin     on public.user_notes using gin (tags);

-- updated_at 자동 갱신
create or replace function public.touch_user_notes_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists touch_user_notes on public.user_notes;
create trigger touch_user_notes before update on public.user_notes
  for each row execute procedure public.touch_user_notes_updated_at();

-- RLS
alter table public.user_notes enable row level security;

create policy "notes select own or mentioned" on public.user_notes
  for select to authenticated
  using (user_id = auth.uid() or auth.uid() = any(mentioned_user_ids));

create policy "notes insert own" on public.user_notes
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "notes update own" on public.user_notes
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "notes delete own" on public.user_notes
  for delete to authenticated
  using (user_id = auth.uid());
```

### 뷰어 — 컴포넌트

#### `viewer/src/components/me/NoteDrawer.tsx` (신규)
- 사이드 드로어 (right slide-in)
- 현재 entity_type + entity_id에 부착된 본인 메모 리스트
- "새 메모" 입력창
- @ 입력 시 mention autocomplete (아래)
- 태그 입력 (스페이스로 추가)
- 메모 카드 hover 시 수정/삭제 액션

#### `viewer/src/components/me/MentionAutocomplete.tsx` (신규)
- textarea 위에 floating
- `@` + 한 글자 이상 입력 시 `profiles.display_name ilike '%{query}%'` 조회 (limit 8)
- 키보드 ↑↓Enter 지원
- 선택 시 `@{display_name}` 텍스트 삽입 + `mentioned_user_ids[]`에 user_id 추가

#### `viewer/src/lib/queries-me.ts` 추가
```typescript
export interface MentionCandidate {
  id: string;
  display_name: string;
  full_name: string | null;
  team: string | null;
}

export async function searchMentionCandidates(query: string, limit = 8): Promise<MentionCandidate[]> {
  if (!query) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, full_name, team')
    .ilike('display_name', `%${query}%`)
    .not('display_name', 'is', null)
    .limit(limit);
  if (error) { console.error('[searchMentionCandidates]', error); return []; }
  return data ?? [];
}

export interface MyNote {
  id: string;
  user_id: string;
  body: string;
  entity_type: 'company' | 'brand' | 'product' | 'ranking_filter' | null;
  entity_id: string | null;
  tags: string[];
  mentioned_user_ids: string[];
  created_at: string;
  updated_at: string;
}

export async function fetchNotesForEntity(
  entity_type: MyNote['entity_type'],
  entity_id: string,
): Promise<MyNote[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('user_notes')
    .select('*')
    .eq('user_id', user.id)         // 본인 메모만 (멘션받은 메모는 /me에서 별도)
    .eq('entity_type', entity_type!)
    .eq('entity_id', entity_id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) { console.error('[fetchNotesForEntity]', error); return []; }
  return data ?? [];
}

export async function createNote(input: {
  body: string;
  entity_type?: MyNote['entity_type'];
  entity_id?: string;
  tags?: string[];
  mentioned_user_ids?: string[];
}): Promise<{ data: MyNote | null; error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: '로그인 필요' };
  const { data, error } = await supabase
    .from('user_notes')
    .insert({
      user_id: user.id,
      body: input.body,
      entity_type: input.entity_type ?? null,
      entity_id: input.entity_id ?? null,
      tags: input.tags ?? [],
      mentioned_user_ids: input.mentioned_user_ids ?? [],
    })
    .select('*')
    .single();
  if (error) return { data: null, error: error.message };
  // 멘션 알림 트리거 (서버 라우트로 위임)
  if ((input.mentioned_user_ids ?? []).length > 0) {
    fetch('/api/me/notes/notify-mentions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note_id: data.id }),
    }).catch(e => console.error('[notify-mentions]', e));
  }
  return { data, error: null };
}

export async function fetchMyRecentNotes(limit = 10): Promise<MyNote[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('user_notes')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return data ?? [];
}

export async function fetchMentionsForMe(limit = 20): Promise<MyNote[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('user_notes')
    .select('*')
    .contains('mentioned_user_ids', [user.id])
    .neq('user_id', user.id)     // 본인이 본인을 멘션한 건 제외
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return data ?? [];
}
```

### 뷰어 — API route

#### `viewer/src/app/api/me/notes/notify-mentions/route.ts` (신규)
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase/server';

function adminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY 미설정');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key);
}

export async function POST(req: NextRequest) {
  // 인증된 사용자만 호출 가능 — note의 author와 일치하는지 확인
  const ss = await supabaseServer();
  const { data: { user } } = await ss.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { note_id } = await req.json().catch(() => ({}));
  if (!note_id) return NextResponse.json({ error: 'note_id 필수' }, { status: 400 });

  const admin = adminClient();
  const { data: note } = await admin
    .from('user_notes')
    .select('id, user_id, body, entity_type, entity_id, mentioned_user_ids')
    .eq('id', note_id)
    .single();
  if (!note || note.user_id !== user.id) {
    return NextResponse.json({ error: '권한 없음' }, { status: 403 });
  }

  // 본인 제외 멘션 대상자
  const targets = (note.mentioned_user_ids ?? []).filter((uid: string) => uid !== user.id);
  if (targets.length === 0) return NextResponse.json({ inserted: 0 });

  // 작성자 표시명
  const { data: author } = await admin
    .from('profiles').select('display_name, full_name').eq('id', user.id).single();
  const authorLabel = author?.display_name || author?.full_name || '누군가';

  // entity_type별 link 구성
  const link = note.entity_type && note.entity_id
    ? `/${note.entity_type === 'ranking_filter' ? 'ranking' : note.entity_type}?id=${encodeURIComponent(note.entity_id)}`
    : '/me';

  const rows = targets.map((uid: string) => ({
    user_id: uid,
    event_type: 'mention',
    title: `${authorLabel}님이 회원님을 멘션했습니다`,
    body: note.body.slice(0, 200),
    link,
    payload: { note_id: note.id, author_id: user.id },
  }));

  const { error } = await admin.from('user_notifications').insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ inserted: rows.length });
}
```

### 각 entity 페이지에 NoteDrawer 통합
| 페이지 | entity_type | entity_id 결정 방법 |
|---|---|---|
| `/company` | `'company'` | URL searchParam `id` |
| `/brand` | `'brand'` | URL searchParam `id` |
| `/product` | `'product'` | URL searchParam `id` |
| `/ranking` | `'ranking_filter'` | 필터 직렬화 (예: `cat=000&gf=A&age=AGE_BAND_ALL`) |

각 페이지 상단(또는 우측)에 메모 버튼 — 카운트 뱃지 포함.

### /me 페이지 변경
- 기존 "내 메모" mock 4건 → `fetchMyRecentNotes(10)` 실데이터
- 신규 섹션 "받은 멘션" — `fetchMentionsForMe(20)` 실데이터, 작성자 display_name + 메모 body + entity link

### Phase 2 DoD
- [ ] 00600 마이그레이션 적용 후 user_notes 테이블 존재
- [ ] `/brand?id=...` 페이지에서 NoteDrawer 열고 메모 작성 → DB 저장
- [ ] 같은 페이지 새로고침 → 메모 목록 그대로 노출
- [ ] 다른 계정으로 로그인 → 해당 페이지에서 본인 메모 안 보임 (RLS)
- [ ] 메모에 `@정호철` 입력 → 자동완성 → 저장 → /me "받은 멘션"에 노출 + user_notifications에 INSERT + dispatcher → Teams 알림 수신
- [ ] 멘션 대상자가 /me에서 멘션 메모 내용 볼 수 있음 (RLS 통과)
- [ ] 멘션받은 사용자는 그 메모를 수정·삭제할 수 없음 (RLS 차단)

---

## 8. Phase 3 — 북마크 + 북마크 기반 알림

### 목표
- company/brand/product 페이지에 ⭐ 토글
- /me 북마크 섹션 실데이터
- 신규 알림 이벤트 `rank_change_bookmarked` 활성화 — 북마크한 brand/product의 랭킹 변동 시 알림

### 마이그레이션 — `supabase/migrations/00700_user_bookmarks.sql`
```sql
create table public.user_bookmarks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  entity_type entity_type not null,
  entity_id   text not null,
  label       text,
  created_at  timestamptz not null default now(),
  unique (user_id, entity_type, entity_id)
);

create index user_bookmarks_owner_idx     on public.user_bookmarks(user_id, created_at desc);
create index user_bookmarks_lookup_idx    on public.user_bookmarks(entity_type, entity_id);

alter table public.user_bookmarks enable row level security;
create policy "own bookmarks" on public.user_bookmarks for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

### 뷰어 — 컴포넌트
#### `viewer/src/components/me/BookmarkToggle.tsx` (신규)
- props: `entity_type`, `entity_id`, `label`
- 마운트 시 본인 북마크 여부 1회 조회 → 토글 상태
- 클릭 시 INSERT/DELETE

#### 통합 위치
- `company/page.tsx` 헤더
- `brand/page.tsx` 헤더
- `product/page.tsx` 헤더

#### /me 페이지
- 기존 mock 5그룹 → `fetchBookmarks()` 실데이터 + entity_type별 group
- 각 chip 클릭 시 해당 entity 페이지로 이동
- label은 entity resolve해서 채움 (예: brand bookmark면 brands 테이블에서 name)

#### `viewer/src/lib/queries-me.ts` 추가
```typescript
export interface Bookmark {
  id: string;
  entity_type: 'company' | 'brand' | 'product' | 'ranking_filter';
  entity_id: string;
  label: string | null;
  created_at: string;
}

export async function fetchBookmarks(): Promise<Bookmark[]> {
  const { data, error } = await supabase
    .from('user_bookmarks')
    .select('id, entity_type, entity_id, label, created_at')
    .order('created_at', { ascending: false });
  if (error) return [];
  return data ?? [];
}

export async function isBookmarked(entity_type: Bookmark['entity_type'], entity_id: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from('user_bookmarks')
    .select('id')
    .eq('user_id', user.id)
    .eq('entity_type', entity_type)
    .eq('entity_id', entity_id)
    .maybeSingle();
  return !!data;
}

export async function addBookmark(entity_type: Bookmark['entity_type'], entity_id: string, label?: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: '로그인 필요' };
  const { error } = await supabase.from('user_bookmarks')
    .insert({ user_id: user.id, entity_type, entity_id, label: label ?? null });
  return { error: error?.message ?? null };
}

export async function removeBookmark(entity_type: Bookmark['entity_type'], entity_id: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: '로그인 필요' };
  const { error } = await supabase.from('user_bookmarks')
    .delete()
    .eq('user_id', user.id)
    .eq('entity_type', entity_type)
    .eq('entity_id', entity_id);
  return { error: error?.message ?? null };
}
```

### 워커 — 북마크 기반 랭킹 변동 알림
#### `worker/detectors/bookmark_detector.py` (신규)
- 매일 랭킹 수집 후 실행
- 각 사용자의 북마크 (brand/product) 리스트 조회
- 어제 vs 오늘 랭킹 비교 — 변동폭 |Δ| ≥ 5 이상 또는 TOP100 진입/이탈 시
- `enqueue_notification(user_id, 'rank_change_bookmarked', ...)` 호출

#### `worker/detectors/runner.py` 수정
- 기존 detect_ranking 후에 `from worker.detectors.bookmark_detector import detect_bookmark_changes` 호출 추가

### Phase 3 DoD
- [ ] 00700 마이그레이션 적용
- [ ] /brand 페이지 ⭐ 클릭 → DB INSERT, 새로고침 후 채워진 상태
- [ ] /me 북마크 섹션에 브랜드명 chip 표시 + 클릭 시 이동
- [ ] 북마크한 브랜드의 랭킹이 변동된 다음날 dispatcher 실행 → Teams 알림 수신
- [ ] `rank_change_bookmarked` 구독 OFF인 사용자는 알림 안 옴

---

## 9. Phase 4 — 최근 본

### 목표
- 각 entity 상세 페이지 진입 시 fire-and-forget POST
- /me "최근 본" 섹션 실데이터
- 유저당 50건만 유지 (trigger로 자동 trim)

### 마이그레이션 — `supabase/migrations/00800_user_view_history.sql`
```sql
create table public.user_view_history (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  entity_type entity_type not null,
  entity_id   text not null,
  label       text,
  viewed_at   timestamptz not null default now()
);

create index user_view_history_recent_idx
  on public.user_view_history(user_id, viewed_at desc);

-- INSERT 시 동일 (user_id, entity_type, entity_id) 기존 행은 viewed_at 갱신만
create or replace function public.upsert_view_history(
  p_entity_type entity_type, p_entity_id text, p_label text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then return; end if;
  -- 같은 entity가 이미 있으면 viewed_at만 갱신
  update public.user_view_history
     set viewed_at = now(), label = coalesce(p_label, label)
   where user_id = v_user and entity_type = p_entity_type and entity_id = p_entity_id;
  if not found then
    insert into public.user_view_history (user_id, entity_type, entity_id, label)
      values (v_user, p_entity_type, p_entity_id, p_label);
    -- 50개 초과 시 oldest 삭제
    delete from public.user_view_history
     where user_id = v_user
       and id not in (
         select id from public.user_view_history
          where user_id = v_user
          order by viewed_at desc
          limit 50
       );
  end if;
end;
$$;

alter table public.user_view_history enable row level security;
create policy "own view history" on public.user_view_history for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

### 뷰어
#### `viewer/src/lib/queries-me.ts` 추가
```typescript
export async function logView(entity_type: 'company'|'brand'|'product'|'ranking_filter', entity_id: string, label?: string) {
  await supabase.rpc('upsert_view_history', {
    p_entity_type: entity_type,
    p_entity_id: entity_id,
    p_label: label ?? null,
  });
}

export interface ViewHistoryRow {
  id: string;
  entity_type: 'company'|'brand'|'product'|'ranking_filter';
  entity_id: string;
  label: string | null;
  viewed_at: string;
}

export async function fetchViewHistory(limit = 8): Promise<ViewHistoryRow[]> {
  const { data, error } = await supabase
    .from('user_view_history')
    .select('id, entity_type, entity_id, label, viewed_at')
    .order('viewed_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return data ?? [];
}
```

#### entity 페이지에 useEffect 추가
```typescript
React.useEffect(() => {
  if (entityId) {
    logView('brand', entityId, brandName).catch(() => {});
  }
}, [entityId]);
```

### /me 페이지
- 기존 mock 8건 → `fetchViewHistory(8)` 실데이터

### Phase 4 DoD
- [ ] 00800 마이그레이션 적용
- [ ] /brand 페이지 진입 → user_view_history 행 1건 신설
- [ ] 같은 brand 재진입 → 행 추가 안 되고 viewed_at만 갱신
- [ ] 51번째 entity 진입 → 가장 오래된 1건 자동 삭제

---

## 10. Phase 5 — 저장 필터

### 목표
- 페이지마다 다른 필터 구조를 JSONB로 저장
- 필터 컴포넌트(`viewer/src/components/ui/filters.tsx`)에 save/load UI 통합

### 마이그레이션 — `supabase/migrations/00900_user_saved_filters.sql`
```sql
create table public.user_saved_filters (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  page        text not null,        -- '/ranking', '/anomaly', '/promo' 등
  name        text not null,
  filter_data jsonb not null,
  created_at  timestamptz not null default now(),
  unique (user_id, page, name)
);

create index user_saved_filters_owner_idx on public.user_saved_filters(user_id, page);

alter table public.user_saved_filters enable row level security;
create policy "own saved filters" on public.user_saved_filters for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

### 뷰어
#### `viewer/src/components/me/SavedFiltersDropdown.tsx` (신규)
- 페이지별 필터 컴포넌트 옆에 배치
- "💾 저장" 입력창 + "📂 불러오기" 드롭다운
- 불러오기 선택 시 callback으로 부모에 filter_data 전달

#### 통합 우선 페이지 (사용 빈도순)
1. `/ranking` — category/gender/age 필터
2. `/anomaly` — severity/area/date 필터
3. `/promo` — promotion_type 필터
4. `/reviews` — rating/date 필터

### /me 페이지
- 기존 mock "저장 필터 6" KPI → 실데이터 count

### Phase 5 DoD
- [ ] 00900 마이그레이션 적용
- [ ] /ranking에서 필터 설정 → 저장 → 새로고침 후 불러오기 동작
- [ ] 같은 이름 저장 시 덮어쓰기 (또는 에러)

---

## 11. Phase 6 — KPI 집계 + 마무리

### 목표
- /me 헤더의 6개 KPI 카드 실데이터화
- activity score는 일단 보류 (구현 의미 모호 시 skip)

### 뷰어 — 통합 API route
#### `viewer/src/app/api/me/stats/route.ts` (신규)
```typescript
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export async function GET() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const [bookmarks, notes, recent7dNotes, savedFilters, activeSubs, unreadInbox] = await Promise.all([
    sb.from('user_bookmarks').select('*', { count: 'exact', head: true }),
    sb.from('user_notes').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
    sb.from('user_notes').select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()),
    sb.from('user_saved_filters').select('*', { count: 'exact', head: true }),
    sb.from('user_notification_subscriptions').select('*', { count: 'exact', head: true }).eq('enabled', true),
    sb.from('user_notifications').select('*', { count: 'exact', head: true }).is('read_at', null),
  ]);

  return NextResponse.json({
    bookmarks: bookmarks.count ?? 0,
    notes: notes.count ?? 0,
    notes_recent_7d: recent7dNotes.count ?? 0,
    saved_filters: savedFilters.count ?? 0,
    active_subscriptions: activeSubs.count ?? 0,
    unread_inbox: unreadInbox.count ?? 0,
  });
}
```

### /me 페이지
- 6개 KPI 카드 → `/api/me/stats` 호출 결과
- "활동 점수" 카드는 제거 또는 후속 작업

### Phase 6 DoD
- [ ] /api/me/stats 호출 결과가 실데이터와 일치
- [ ] /me 헤더 카드 6개 모두 실데이터 표시
- [ ] 빌드·배포 완료

---

## 12. 환경변수 — 추가될 것

### 새 변수
```bash
# 알림 SITE URL (Teams 메시지 내 링크용)
NEXT_PUBLIC_SITE_URL=https://uttu.bcave.co.kr   # Vercel 배포 후 실 URL
```
※ 이미 .env에 있을 수 있음. localhost 금지.

### 변경 없음
- `TEAMS_WEBHOOK_URL` (worker/.env) → **제거 가능** (이제 profiles.teams_webhook_url 사용)
- `TELEGRAM_BOT_TOKEN` → **유지** (admin chat_id로 발송 시 사용)
- `TELEGRAM_CHAT_ID` → **제거 가능** (이제 profiles.telegram_chat_id 사용)

기존 `worker/tasks/notify.py`의 단일 webhook 발송은 dispatcher 가동 후 deprecate. 다만 시스템 알림(수집 실패 등)은 별도로 운영자(정호철) 단일 채널에 보내는 게 깔끔하니, 그 용도는 유지하고 새 사용자 알림과 분리.

---

## 13. cron 등록 — 정호철이 수동 등록

Phase 1 완료 후:
```cron
# 5분마다 사용자 알림 발송
*/5 * * * * /Users/macmini/projects/uttu/scripts/run_dispatcher.sh
```

Phase 3 완료 후 (북마크 기반 알림 활성화):
```cron
# 기존 run_detect.sh 안에서 bookmark_detector도 호출되므로 별도 등록 불필요
# 단 detection이 매일 어느 시각에 도는지 확인 (현재 미확정으로 추정)
0 6 * * *   /Users/macmini/projects/uttu/scripts/run_detect.sh
```

Phase 6 또는 그 전이라도:
```cron
# 매일 03:30 — daily_summary 알림 발송 트리거 (요약 생성 후 enqueue_for_subscribers)
30 3 * * *  /Users/macmini/projects/uttu/scripts/run_daily_summary.sh
```
(daily_summary 생성 로직은 Phase별 핵심에서 빠져있음 — 별도 작업으로 분리)

---

## 14. 마이그레이션 적용 순서 (정호철 수동)

```
00400_profiles_extension.sql        ← Phase 0
00500_user_notifications.sql         ← Phase 1
00600_user_notes.sql                 ← Phase 2
00700_user_bookmarks.sql             ← Phase 3
00800_user_view_history.sql          ← Phase 4
00900_user_saved_filters.sql         ← Phase 5
```

적용 후 검증 쿼리:
```sql
-- 전체 테이블 확인
select table_name from information_schema.tables
 where table_schema = 'public' and table_name like 'user_%'
 order by table_name;

-- RLS 정책 확인
select tablename, policyname, cmd from pg_policies
 where schemaname = 'public' and tablename like 'user_%'
 order by tablename, policyname;
```

---

## 15. 작업 흐름 (Claude Code 측)

각 Phase 작업 시:

```
1. 이 문서의 해당 Phase 섹션만 발췌해서 본다
2. 의존 Phase 완료 확인 (Phase 2 → Phase 1 완료 필수)
3. 새 파일 생성 / 기존 파일 수정
4. 빌드 검증: cd viewer && npm run build
5. 워커 dry-run (해당 시): worker/.venv/bin/python3 -m worker.notifications.dispatcher 등
6. 보고 형식대로 정호철에게 보고
7. 정호철이 마이그레이션 적용 + 수동 검증
8. 다음 Phase 진행 승인 대기
```

---

## 16. 권장 진행 속도

| Phase | 추정 일수 | 누적 |
|---|---|---|
| 0. 권한·프로필 | 1일 | 1일 |
| 1. 알림 인프라 | 3~4일 | 5일 |
| 2. 메모·멘션 | 3~4일 | 9일 |
| 3. 북마크 + 알림 | 2일 | 11일 |
| 4. 최근 본 | 1일 | 12일 |
| 5. 저장 필터 | 2일 | 14일 |
| 6. KPI 집계 | 0.5일 | 14.5일 |

**약 3주.** 다만 각 Phase 사이 정호철 검증·피드백 시간 별도.

---

## 17. 보류 / 후속 작업

이 문서에서 의도적으로 제외한 것:

- **메모 스레드(답글)** — v2. 멘션받은 사람이 같은 메모에 답할 수 있는 구조. 현재는 새 메모 + 작성자 멘션으로 우회.
- **메모 공유 (공개·팀 공개)** — v2. 현재는 본인 메모 + 멘션받은 사람 read만.
- **AiPanel 부활** — 별도 작업. 메모 시스템과 통합 시 "이 화면 컨텍스트로 메모 자동 초안" 같은 기능 가능.
- **검색 — Cmd+K 통합** — /me의 "검색 횟수" KPI 채우려면 검색 로그 필요. Cmd+K 확장 작업과 함께.
- **알림 토픽 추가** — 새 이벤트(예: ISMS 일정, 결재 등) 추가 시 마이그레이션 + ENUM ALTER 필요.
- **dispatcher 재시도 로직** — 현재 발송 실패해도 sent_to_*_at 마킹해버려 무한 재시도 방지. 실패 별도 카운터 두고 N회 재시도 후 dead-letter 처리는 v2.
- **daily_summary 생성 로직** — Phase 6 이후 또는 별도. anomaly·메모·랭킹 요약을 LLM(Ollama gemma4:e4b)로 생성하면 좋음.

---

## 18. 최종 체크리스트 (전 Phase 완료 후)

```
[ ] 6개 마이그레이션 모두 적용
[ ] 모든 user_* 테이블에 RLS 정책 존재
[ ] Sidebar.tsx에 ADMIN_EMAIL 문자열 없음
[ ] /me 페이지 mock 데이터 흔적 없음 (정호철·JH·하드코딩 카운트 등)
[ ] 정호철 본인 + 임직원 테스트 계정 1개로 메모·멘션·알림 cross-test
[ ] dispatcher cron 등록 + 5분 단위로 정상 동작 확인
[ ] Vercel 배포 후 NEXT_PUBLIC_SITE_URL이 메시지 링크에 정확
[ ] CLAUDE.md에 마이페이지 관련 룰 한 줄 추가 ("사용자 데이터 테이블은 user_ 접두어, 반드시 RLS")
```
