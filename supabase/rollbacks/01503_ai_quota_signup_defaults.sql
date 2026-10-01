-- VERIFIED PRODUCTION ABSENT BASELINE ONLY: neither function nor quota trigger
-- existed before 01503. Remove only the function/trigger newly introduced by it.
-- Future profiles again receive no automatic quota row; existing rows unchanged.
-- Use 01503_ai_quota_signup_defaults_legacy.sql if both objects predated 01503.
-- Requires a separately authorized rollback if applied after rollout.

do $rollback$
declare
  installed_function record;
  installed_trigger record;
begin
  select p.* into installed_function from pg_proc p
  where p.oid = to_regprocedure('public.handle_user_ai_quota_defaults()');
  if found then
    if not installed_function.prosecdef
       or installed_function.proconfig is distinct from array['search_path=public']
       or installed_function.prosrc is distinct from $expected$
begin
  insert into public.ai_user_quotas (user_id, monthly_token_limit, daily_token_limit, is_blocked)
  values (new.id, 500000, 100000, false)
  on conflict (user_id) do nothing;
  return new;
end;
$expected$ then
      raise exception 'Quota function differs from 01503: compare live definition before rollback';
    end if;
  end if;

  select t.* into installed_trigger from pg_trigger t
  where t.tgrelid = 'public.profiles'::regclass
    and t.tgname = 'on_profile_ai_quota_defaults';
  if found then
    if installed_trigger.tgtype <> 5
       or installed_trigger.tgenabled <> 'O'
       or installed_trigger.tgfoid is distinct from to_regprocedure('public.handle_user_ai_quota_defaults()')
       or installed_trigger.tgisinternal
       or installed_trigger.tgconstraint <> 0
       or installed_trigger.tgqual is not null
       or installed_trigger.tgnargs <> 0 then
      raise exception 'Quota trigger differs from 01503: compare live definition before rollback';
    end if;
    drop trigger on_profile_ai_quota_defaults on public.profiles;
  end if;
  -- No CASCADE: unexpected dependencies abort this whole rollback atomically.
  drop function if exists public.handle_user_ai_quota_defaults();
end;
$rollback$;
