-- ============================================================
-- UTTU — User Profiles & Auth
-- Version: 1.0  Date: 2026-05-20
--
-- 변경 내용:
--   1. profiles 테이블 신설 (auth.users 연동)
--   2. is_admin() 헬퍼 함수 (security definer — RLS 재귀 방지)
--   3. handle_new_user() 트리거 — 가입 시 profiles 자동 생성
--   4. check_email_domain() 트리거 — @bcave.co.kr 도메인 제한
--   5. profiles RLS 정책 (본인 read/write, admin 전체 read)
--
-- ⚠️  자동 적용 금지 — 정호철이 Supabase SQL Editor에서 수동 적용.
-- ⚠️  전체 파일을 한 번에 실행.
--
-- 첫 admin 설정 (가입 후 별도 실행):
--   update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'zbra@bcave.co.kr');
-- ============================================================

-- ─── 1. profiles 테이블 ──────────────────────────────────────────────────────

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  role        text not null default 'viewer'
                check (role in ('admin', 'viewer')),
  team        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is 'Supabase Auth 사용자 프로필';
comment on column public.profiles.role is 'admin: 쓰기·관리 | viewer: 읽기 전용. 기본값 viewer.';

-- ─── 2. is_admin() — RLS 헬퍼 (security definer) ─────────────────────────────

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()),
    false
  );
$$;

-- ─── 3. protect_profile_role() — role 컬럼 무단 변경 방지 ────────────────────

create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    new.updated_at = now();
    return new;
  end if;
  if new.role <> old.role and not public.is_admin() then
    raise exception 'Permission denied: only admins can change roles'
      using errcode = 'P0001';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_profile_update on public.profiles;
create trigger on_profile_update
  before update on public.profiles
  for each row execute procedure public.protect_profile_role();

-- ─── 4. handle_new_user() — 가입 시 profiles 자동 생성 ───────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─── 5. check_email_domain() — @bcave.co.kr 도메인 제한 ──────────────────────

create or replace function public.check_email_domain()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.email not ilike '%@bcave.co.kr' then
    raise exception 'Unauthorized domain: only @bcave.co.kr accounts are allowed'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists before_user_insert_domain_check on auth.users;
create trigger before_user_insert_domain_check
  before insert on auth.users
  for each row execute procedure public.check_email_domain();

-- ─── 6. profiles RLS ────────────────────────────────────────────────────────

alter table public.profiles enable row level security;

create policy "profiles: select own or admin"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id or public.is_admin());

create policy "profiles: update own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ────────────────────────────────────────────────────────────────────────────
-- 검증 SQL (적용 후 실행)
-- ────────────────────────────────────────────────────────────────────────────
-- select column_name, data_type from information_schema.columns
--   where table_schema = 'public' and table_name = 'profiles';
-- select public.is_admin();  -- admin 계정: true / viewer 계정: false
