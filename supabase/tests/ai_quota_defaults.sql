-- DISPOSABLE DATABASE ONLY: run through run_ai_quota_defaults.cjs.
-- Synthetic auth/profile/quota fixtures exercise the actual 00200/00309/00310
-- migrations, followed by 01503 and its rollback. Never run in a live project.

create temporary table uttu_quota_test_counts (assertion_count integer not null);
insert into uttu_quota_test_counts values (0);
create temporary table uttu_quota_test_snapshots (label text primary key, value jsonb);

create function pg_temp.uttu_quota_assert(condition boolean, label text)
returns void language plpgsql as $$
begin
  if condition is distinct from true then
    raise exception 'Quota regression failed: %', label;
  end if;
  update uttu_quota_test_counts set assertion_count = assertion_count + 1;
end;
$$;

create function pg_temp.uttu_quota_rows()
returns jsonb language sql as $$
  select coalesce(jsonb_agg(to_jsonb(q) order by q.user_id), '[]'::jsonb)
  from public.ai_user_quotas q;
$$;

create function pg_temp.uttu_profile_rows()
returns jsonb language sql as $$
  select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb)
  from public.profiles p;
$$;

create function pg_temp.uttu_quota_metadata(include_quota boolean default true)
returns jsonb language sql as $$
  select jsonb_build_object(
    'function', case when include_quota then (select jsonb_build_object(
      'oid', p.oid, 'owner', p.proowner, 'acl', p.proacl,
      'security_definer', p.prosecdef, 'config', p.proconfig,
      'return_type', p.prorettype, 'argument_count', p.pronargs,
      'volatility', p.provolatile)
      from pg_proc p where p.oid = to_regprocedure('public.handle_user_ai_quota_defaults()')) else null end,
    'triggers', (select jsonb_agg(jsonb_build_object(
      'oid', t.oid, 'definition', pg_get_triggerdef(t.oid), 'enabled', t.tgenabled)
      order by t.oid) from pg_trigger t
      where t.tgrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
        and not t.tgisinternal
        and (include_quota or t.tgname <> 'on_profile_ai_quota_defaults')),
    'tables', (select jsonb_agg(jsonb_build_object(
      'oid', c.oid, 'owner', c.relowner, 'acl', c.relacl,
      'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity)
      order by c.oid) from pg_class c
      where c.oid in ('public.profiles'::regclass, 'public.ai_user_quotas'::regclass)),
    'policies', (select jsonb_agg(to_jsonb(p) order by p.oid)
      from pg_policy p
      where p.polrelid in ('public.profiles'::regclass, 'public.ai_user_quotas'::regclass)),
    'columns', (select jsonb_agg(to_jsonb(c) order by c.table_name, c.ordinal_position)
      from information_schema.columns c
      where c.table_schema = 'public' and c.table_name in ('profiles', 'ai_user_quotas'))
  );
$$;

create function pg_temp.uttu_quota_defaults_setup(baseline_has_quota boolean)
returns void language plpgsql as $$
begin
  -- A preexisting explicit function grant must survive CREATE OR REPLACE.
  if baseline_has_quota then
    grant execute on function public.handle_user_ai_quota_defaults() to authenticated;
  end if;
  insert into auth.users (id, email, raw_user_meta_data) values
    ('00000000-0000-0000-0000-000000000001', 'old@bcave.co.kr', '{"full_name":"Existing User"}'),
    ('00000000-0000-0000-0000-000000000002', 'custom@bcave.co.kr', '{"full_name":"Custom User"}'),
    ('00000000-0000-0000-0000-000000000003', 'unlimited@bcave.co.kr', '{}'),
    ('00000000-0000-0000-0000-000000000004', 'missing@bcave.co.kr', '{}'),
    ('00000000-0000-0000-0000-000000000005', 'preprovisioned@bcave.co.kr', '{}');
  if not baseline_has_quota then
    perform pg_temp.uttu_quota_assert(
      not exists (select 1 from public.ai_user_quotas),
      'production absent baseline creates profiles without quota rows');
    -- Existing manually managed production rows must still be preserved.
    insert into public.ai_user_quotas (user_id, monthly_token_limit)
    select id, 100000 from auth.users
    where id <> '00000000-0000-0000-0000-000000000004';
  end if;
  perform pg_temp.uttu_quota_assert(
    (select monthly_token_limit = 100000 and daily_token_limit is null and not is_blocked
     from public.ai_user_quotas where user_id = '00000000-0000-0000-0000-000000000001'),
    'baseline signup is 100000 monthly, unlimited daily, unblocked');

  update public.ai_user_quotas
  set monthly_token_limit = 7500000, daily_token_limit = 42000, is_blocked = true,
      note = 'Custom blocked quota', created_at = '2026-01-01 00:00:00+00',
      updated_at = '2026-02-01 00:00:00+00'
  where user_id = '00000000-0000-0000-0000-000000000002';
  update public.ai_user_quotas
  set monthly_token_limit = null, daily_token_limit = null, note = 'Explicit unlimited'
  where user_id = '00000000-0000-0000-0000-000000000003';
  delete from public.ai_user_quotas
  where user_id = '00000000-0000-0000-0000-000000000004';
  -- Removing a profile does not remove its separately auth.users-linked quota.
  delete from public.profiles where id = '00000000-0000-0000-0000-000000000005';
  update public.ai_user_quotas
  set monthly_token_limit = 650000, daily_token_limit = 25000, is_blocked = true,
      note = 'Preprovisioned quota must win'
  where user_id = '00000000-0000-0000-0000-000000000005';

  insert into public.ai_sessions (id, user_id, input_tokens, output_tokens)
  values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 123, 456);
  insert into public.ai_usage_daily (user_id, usage_date, input_tokens, output_tokens)
  values ('00000000-0000-0000-0000-000000000002', '2026-09-30', 123, 456);

  insert into uttu_quota_test_snapshots values
    ('baseline_has_quota', to_jsonb(baseline_has_quota)),
    ('baseline_quotas', pg_temp.uttu_quota_rows()),
    ('baseline_profiles', pg_temp.uttu_profile_rows()),
    ('metadata', pg_temp.uttu_quota_metadata()),
    ('baseline_function', to_jsonb(pg_get_functiondef(to_regprocedure('public.handle_user_ai_quota_defaults()')))),
    ('usage', (select jsonb_agg(to_jsonb(u) order by u.user_id, u.usage_date) from public.ai_usage_daily u)),
    ('sessions', (select jsonb_agg(to_jsonb(s) order by s.id) from public.ai_sessions s));
end;
$$;

create function pg_temp.uttu_quota_defaults_check_migrated()
returns void language plpgsql as $$
declare
  baseline_has_quota boolean := (select value::boolean from uttu_quota_test_snapshots where label = 'baseline_has_quota');
begin
  perform pg_temp.uttu_quota_assert(
    pg_temp.uttu_quota_metadata(baseline_has_quota) = (select value from uttu_quota_test_snapshots where label = 'metadata'),
    'existing function metadata/triggers, table RLS/policies/columns unchanged');
  if baseline_has_quota then
  perform pg_temp.uttu_quota_assert(
    pg_get_functiondef('public.handle_user_ai_quota_defaults()'::regprocedure) =
      replace((select value #>> '{}' from uttu_quota_test_snapshots where label = 'baseline_function'),
              'values (new.id, 100000, null, false)', 'values (new.id, 500000, 100000, false)'),
    'only function insert constants change');
  else
    perform pg_temp.uttu_quota_assert(
      exists (select 1 from pg_proc p
              where p.oid = to_regprocedure('public.handle_user_ai_quota_defaults()')
                and p.prosecdef and p.prorettype = 'trigger'::regtype
                and p.proconfig = array['search_path=public']),
      'production missing quota function is installed as search-path-pinned SECURITY DEFINER');
    perform pg_temp.uttu_quota_assert(
      exists (select 1 from pg_trigger t where t.tgrelid = 'public.profiles'::regclass
              and t.tgname = 'on_profile_ai_quota_defaults' and t.tgtype = 5
              and t.tgenabled = 'O' and t.tgfoid = to_regprocedure('public.handle_user_ai_quota_defaults()')
              and t.tgqual is null and t.tgnargs = 0),
      'production missing quota trigger is installed as unconditional AFTER INSERT ROW');
  end if;
  perform pg_temp.uttu_quota_assert(
    pg_temp.uttu_quota_rows() = (select value from uttu_quota_test_snapshots where label = 'baseline_quotas'),
    'all existing old/custom/blocked/unlimited quotas, notes and timestamps unchanged');
  perform pg_temp.uttu_quota_assert(
    pg_temp.uttu_profile_rows() = (select value from uttu_quota_test_snapshots where label = 'baseline_profiles'),
    'all existing profiles unchanged by migration');

  insert into auth.users (id, email, raw_user_meta_data) values
    ('00000000-0000-0000-0000-000000000006', 'new@bcave.co.kr', '{"full_name":"New User"}'),
    ('00000000-0000-0000-0000-000000000007', 'emptyname@bcave.co.kr', '{}');
  perform pg_temp.uttu_quota_assert(
    (select count(*) = 2 and bool_and(monthly_token_limit = 500000 and daily_token_limit = 100000 and not is_blocked)
     from public.ai_user_quotas where user_id in
       ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000007')),
    'auth signup -> profile -> exactly one new 500000/100000 unblocked quota');
  perform pg_temp.uttu_quota_assert(
    (select full_name = 'New User' and role = 'viewer' and team is null
     from public.profiles where id = '00000000-0000-0000-0000-000000000006'),
    'existing profile metadata/name and viewer role defaults preserved');
  perform pg_temp.uttu_quota_assert(
    (select full_name = '' and role = 'viewer'
     from public.profiles where id = '00000000-0000-0000-0000-000000000007'),
    'missing profile name metadata keeps existing empty-name behavior');

  insert into public.profiles (id, full_name)
  values ('00000000-0000-0000-0000-000000000005', 'Restored Profile');
  perform pg_temp.uttu_quota_assert(
    (select to_jsonb(q) = (select existing.value from uttu_quota_test_snapshots snapshots,
       lateral jsonb_array_elements(snapshots.value) existing
       where snapshots.label = 'baseline_quotas' and existing.value->>'user_id' = q.user_id::text)
     from public.ai_user_quotas q where q.user_id = '00000000-0000-0000-0000-000000000005'),
    'ON CONFLICT DO NOTHING preserves a preexisting blocked/custom quota');

  update public.profiles set full_name = 'Updated Profile'
  where id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004',
               '00000000-0000-0000-0000-000000000006');
  perform pg_temp.uttu_quota_assert(
    (select monthly_token_limit = 100000 and daily_token_limit is null and not is_blocked
     from public.ai_user_quotas where user_id = '00000000-0000-0000-0000-000000000001'),
    'existing profile updates do not reset old quotas');
  perform pg_temp.uttu_quota_assert(
    (select monthly_token_limit = 500000 and daily_token_limit = 100000 and not is_blocked
     from public.ai_user_quotas where user_id = '00000000-0000-0000-0000-000000000006'),
    'new profile updates do not reset new quotas');
  perform pg_temp.uttu_quota_assert(
    not exists (select 1 from public.ai_user_quotas where user_id = '00000000-0000-0000-0000-000000000004'),
    'no migration/update backfill for an existing account missing a quota');
  perform pg_temp.uttu_quota_assert(
    (select jsonb_agg(to_jsonb(q) order by q.user_id) from public.ai_user_quotas q
     where q.user_id < '00000000-0000-0000-0000-000000000006') =
      (select value from uttu_quota_test_snapshots where label = 'baseline_quotas'),
    'existing custom blocked/unlimited quotas remain byte-for-byte unchanged after new signup/update');
  perform pg_temp.uttu_quota_assert(
    (select jsonb_agg(to_jsonb(u) order by u.user_id, u.usage_date) from public.ai_usage_daily u) =
      (select value from uttu_quota_test_snapshots where label = 'usage'),
    'existing usage unchanged');
  perform pg_temp.uttu_quota_assert(
    (select jsonb_agg(to_jsonb(s) order by s.id) from public.ai_sessions s) =
      (select value from uttu_quota_test_snapshots where label = 'sessions'),
    'existing sessions unchanged');

  insert into uttu_quota_test_snapshots values
    ('migrated_metadata', pg_temp.uttu_quota_metadata()),
    ('migrated_quotas', pg_temp.uttu_quota_rows()),
    ('migrated_profiles', pg_temp.uttu_profile_rows());
end;
$$;

create function pg_temp.uttu_quota_defaults_check_reapplied()
returns void language plpgsql as $$
begin
  perform pg_temp.uttu_quota_assert(
    pg_temp.uttu_quota_rows() = (select value from uttu_quota_test_snapshots where label = 'migrated_quotas'),
    'reapplying migration leaves all quotas unchanged');
  perform pg_temp.uttu_quota_assert(
    pg_temp.uttu_profile_rows() = (select value from uttu_quota_test_snapshots where label = 'migrated_profiles'),
    'reapplying migration leaves all profiles unchanged');
  perform pg_temp.uttu_quota_assert(
    pg_temp.uttu_quota_metadata() = (select value from uttu_quota_test_snapshots where label = 'migrated_metadata'),
    'reapplying migration preserves metadata');
end;
$$;

create function pg_temp.uttu_quota_defaults_check_rolled_back()
returns void language plpgsql as $$
declare
  baseline_has_quota boolean := (select value::boolean from uttu_quota_test_snapshots where label = 'baseline_has_quota');
begin
  if baseline_has_quota then
  perform pg_temp.uttu_quota_assert(
    pg_get_functiondef('public.handle_user_ai_quota_defaults()'::regprocedure) =
      (select value #>> '{}' from uttu_quota_test_snapshots where label = 'baseline_function'),
    'rollback restores the exact original function definition');
  else
    perform pg_temp.uttu_quota_assert(
      to_regprocedure('public.handle_user_ai_quota_defaults()') is null
      and not exists (select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass
                      and tgname = 'on_profile_ai_quota_defaults'),
      'production rollback removes only the newly introduced function/trigger');
  end if;
  perform pg_temp.uttu_quota_assert(
    pg_temp.uttu_quota_metadata() = (select value from uttu_quota_test_snapshots where label = 'metadata'),
    'rollback preserves owner/grants/search path/security, trigger and RLS metadata');
  perform pg_temp.uttu_quota_assert(
    pg_temp.uttu_quota_rows() = (select value from uttu_quota_test_snapshots where label = 'migrated_quotas'),
    'rollback leaves every existing quota including new defaults unchanged');
  perform pg_temp.uttu_quota_assert(
    pg_temp.uttu_profile_rows() = (select value from uttu_quota_test_snapshots where label = 'migrated_profiles'),
    'rollback leaves every existing profile unchanged');
  insert into auth.users (id, email, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000008', 'afterrollback@bcave.co.kr', '{"full_name":"Rollback User"}');
  if baseline_has_quota then
    perform pg_temp.uttu_quota_assert(
      (select monthly_token_limit = 100000 and daily_token_limit is null and not is_blocked
       from public.ai_user_quotas where user_id = '00000000-0000-0000-0000-000000000008'),
      'legacy rollback affects only future signup defaults');
  else
    perform pg_temp.uttu_quota_assert(
      not exists (select 1 from public.ai_user_quotas where user_id = '00000000-0000-0000-0000-000000000008'),
      'production rollback restores future signup behavior: no automatic quota row');
  end if;
  perform pg_temp.uttu_quota_assert(
    (select full_name = 'Rollback User' and role = 'viewer'
     from public.profiles where id = '00000000-0000-0000-0000-000000000008'),
    'rollback preserves the existing auth -> profile trigger chain');
  perform pg_temp.uttu_quota_assert(
    (select jsonb_agg(to_jsonb(q) order by q.user_id) from public.ai_user_quotas q
     where q.user_id < '00000000-0000-0000-0000-000000000008') =
      (select value from uttu_quota_test_snapshots where label = 'migrated_quotas'),
    'pre-rollback quota rows remain unchanged after a rollback-era signup');
  insert into uttu_quota_test_snapshots values
    ('rolled_back_quotas', pg_temp.uttu_quota_rows()),
    ('rolled_back_profiles', pg_temp.uttu_profile_rows());
end;
$$;

create function pg_temp.uttu_quota_defaults_check_rollback_reapplied()
returns void language plpgsql as $$
begin
  perform pg_temp.uttu_quota_assert(
    pg_get_functiondef(to_regprocedure('public.handle_user_ai_quota_defaults()')) is not distinct from
      (select value #>> '{}' from uttu_quota_test_snapshots where label = 'baseline_function'),
    'reapplying rollback retains the exact original function or its absence');
  perform pg_temp.uttu_quota_assert(
    pg_temp.uttu_quota_metadata() = (select value from uttu_quota_test_snapshots where label = 'metadata'),
    'reapplying rollback preserves metadata');
  perform pg_temp.uttu_quota_assert(
    pg_temp.uttu_quota_rows() = (select value from uttu_quota_test_snapshots where label = 'rolled_back_quotas'),
    'reapplying rollback leaves all quotas unchanged');
  perform pg_temp.uttu_quota_assert(
    pg_temp.uttu_profile_rows() = (select value from uttu_quota_test_snapshots where label = 'rolled_back_profiles'),
    'reapplying rollback leaves all profiles unchanged');
end;
$$;
