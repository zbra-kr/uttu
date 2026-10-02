-- LOCAL REVIEW ONLY. Apply manually after reviewing the release cutoff.
-- This migration owns only onboarding objects. It does not change Auth/profile
-- triggers, roles, metadata, or existing users. GET remains read-only.
begin;

create table if not exists public.onboarding_releases (
  version integer primary key check (version = 1),
  released_at timestamptz not null
);

-- Never advance this cutoff on a retry/reapplication. In particular, do not use
-- viewer deployment time, last_sign_in_at, or user-editable metadata.
insert into public.onboarding_releases(version, released_at)
  values (1, clock_timestamp()) on conflict (version) do nothing;

create table if not exists public.user_onboarding (
  user_id uuid not null references auth.users(id) on delete cascade,
  version integer not null default 1 references public.onboarding_releases(version),
  status text not null check (status in ('pending', 'completed', 'skipped')),
  step integer not null check (step between 0 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, version)
);

alter table public.onboarding_releases enable row level security;
alter table public.user_onboarding enable row level security;
revoke all on public.onboarding_releases, public.user_onboarding
  from public, anon, authenticated, service_role;
grant select on public.user_onboarding to authenticated;
drop policy if exists user_onboarding_select_own on public.user_onboarding;
create policy user_onboarding_select_own on public.user_onboarding
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.get_my_onboarding()
returns table (user_id uuid, eligible boolean, status text, step integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_created_at timestamptz;
  v_released_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select u.created_at into v_created_at from auth.users u where u.id = v_user_id;
  if not found or v_created_at is null then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select r.released_at into v_released_at from public.onboarding_releases r where r.version = 1;
  if not found then
    raise exception 'Onboarding release unavailable' using errcode = '55000';
  end if;
  return query select v_user_id, v_created_at >= v_released_at,
    coalesce(s.status, case when v_created_at >= v_released_at then 'pending' else 'legacy' end),
    coalesce(s.step, 0)
  from (values (1)) as release(version)
  left join public.user_onboarding s on s.user_id = v_user_id and s.version = release.version;
end;
$$;

create or replace function public.save_my_onboarding(
  p_status text, p_step integer, p_replay boolean default false
)
returns table (user_id uuid, eligible boolean, status text, step integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_state record;
begin
  if v_user_id is null then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('pending', 'completed', 'skipped')
     or p_step is null or p_step not between 0 and 5 or p_replay is null
     or (p_replay and (p_status <> 'pending' or p_step <> 0)) then
    raise exception 'Invalid onboarding state' using errcode = '22023';
  end if;
  -- Serialize concurrent first saves and completion/skip/replay for this account.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('uttu-onboarding-v1:' || v_user_id::text, 0));
  select * into v_state from public.get_my_onboarding();
  if v_state.status = 'legacy' and not p_replay then
    raise exception 'Explicit replay required' using errcode = '42501';
  end if;
  -- An in-flight progress write from another tab must not reopen a terminal
  -- tour. Only the explicit replay action resets completed/skipped state.
  if v_state.status in ('completed', 'skipped') and not p_replay then
    return query select * from public.get_my_onboarding();
    return;
  end if;
  insert into public.user_onboarding as existing(user_id, version, status, step)
    values (v_user_id, 1, p_status, p_step)
    on conflict on constraint user_onboarding_pkey do update
      set status = excluded.status, step = excluded.step, updated_at = now();
  return query select * from public.get_my_onboarding();
end;
$$;

revoke all on function public.get_my_onboarding(), public.save_my_onboarding(text, integer, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_onboarding(), public.save_my_onboarding(text, integer, boolean)
  to authenticated;

-- Fail closed if inherited/default grants would defeat the intended isolation.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(r, 'public.onboarding_releases', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or has_table_privilege(r, 'public.user_onboarding', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or (r <> 'authenticated' and has_table_privilege(r, 'public.user_onboarding', 'SELECT')) then
      raise exception 'Onboarding preflight: unexpected effective table access';
    end if;
    if r <> 'authenticated' and (
      has_function_privilege(r, 'public.get_my_onboarding()', 'EXECUTE')
      or has_function_privilege(r, 'public.save_my_onboarding(text,integer,boolean)', 'EXECUTE')) then
      raise exception 'Onboarding preflight: unexpected effective function access';
    end if;
  end loop;
end;
$$;

commit;
