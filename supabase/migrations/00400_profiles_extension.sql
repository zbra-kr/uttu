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
