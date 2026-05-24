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
