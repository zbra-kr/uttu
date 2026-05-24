-- 00312_ai_allowed_models.sql
-- UTTU AI 허용 모델 목록 — 관리자가 활성/비활성 제어
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

create table public.ai_allowed_models (
  id           uuid        primary key default gen_random_uuid(),
  provider     text        not null,   -- 'anthropic' | 'openai' | 'google'
  model_id     text        not null unique,
  display_name text        not null,
  is_default   boolean     not null default false,
  is_active    boolean     not null default true,
  max_tokens   integer,
  created_at   timestamptz not null default now()
);

comment on table public.ai_allowed_models is 'UTTU AI 허용 모델 목록 — 관리자가 관리, viewer는 읽기 전용';

-- 초기 데이터
insert into public.ai_allowed_models (provider, model_id, display_name, is_default, is_active, max_tokens)
values
  ('anthropic', 'claude-sonnet-4-6',        'Claude Sonnet 4.6',  true,  true, 8192),
  ('anthropic', 'claude-haiku-4-5-20251001', 'Claude Haiku 4.5',   false, true, 4096);

-- RLS
alter table public.ai_allowed_models enable row level security;

create policy "admin_manage_models" on public.ai_allowed_models
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "authenticated_read_active_models" on public.ai_allowed_models
  for select to authenticated using (is_active = true);

-- Rollback:
-- drop table if exists public.ai_allowed_models;
