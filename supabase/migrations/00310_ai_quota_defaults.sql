-- 00310_ai_quota_defaults.sql
-- 1. profiles INSERT 시 ai_user_quotas row 자동 생성 (monthly=100000)
-- 2. admin이 다른 사용자 quota/usage/sessions 조회·수정 가능 RLS 정책
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

-- ── 1. 트리거 함수 ────────────────────────────────────────────────────────────
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

-- ── 2. admin RLS 정책 ─────────────────────────────────────────────────────────
-- ai_user_quotas
create policy "admin select all quotas" on public.ai_user_quotas
  for select to authenticated using (public.is_admin());

create policy "admin update all quotas" on public.ai_user_quotas
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ai_usage_daily
create policy "admin select all usage" on public.ai_usage_daily
  for select to authenticated using (public.is_admin());

-- ai_sessions
create policy "admin select all sessions" on public.ai_sessions
  for select to authenticated using (public.is_admin());

-- ── Rollback ──────────────────────────────────────────────────────────────────
-- drop trigger if exists on_profile_ai_quota_defaults on public.profiles;
-- drop function if exists public.handle_user_ai_quota_defaults();
-- drop policy if exists "admin select all quotas" on public.ai_user_quotas;
-- drop policy if exists "admin update all quotas" on public.ai_user_quotas;
-- drop policy if exists "admin select all usage" on public.ai_usage_daily;
-- drop policy if exists "admin select all sessions" on public.ai_sessions;
