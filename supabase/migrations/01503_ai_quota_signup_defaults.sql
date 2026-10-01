-- New profiles receive 500000 monthly / 100000 daily AI tokens.
-- Production was verified to have neither the quota function nor its trigger.
-- Also supports the repository's 00310 baseline: preserve an existing expected
-- trigger and function owner/grants. Never backfill or update existing quotas.
-- Apply manually after comparing the live function/trigger and choosing the
-- matching rollback (production absent baseline or repository legacy baseline).

-- One DO statement is atomic even when used without an enclosing transaction.
do $migration$
declare
  existing_trigger record;
  quota_trigger_exists boolean;
begin
  select t.* into existing_trigger from pg_trigger t
  where t.tgrelid = 'public.profiles'::regclass
    and t.tgname = 'on_profile_ai_quota_defaults';
  quota_trigger_exists := found;
  if quota_trigger_exists then
    if existing_trigger.tgtype <> 5 -- ROW | INSERT, AFTER
       or existing_trigger.tgenabled <> 'O'
       or existing_trigger.tgfoid is distinct from to_regprocedure('public.handle_user_ai_quota_defaults()')
       or existing_trigger.tgisinternal
       or existing_trigger.tgconstraint <> 0
       or existing_trigger.tgqual is not null
       or existing_trigger.tgnargs <> 0 then
      raise exception 'Unexpected on_profile_ai_quota_defaults trigger: compare live definition before applying 01503';
    end if;
  end if;

  execute $function$
create or replace function public.handle_user_ai_quota_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.ai_user_quotas (user_id, monthly_token_limit, daily_token_limit, is_blocked)
  values (new.id, 500000, 100000, false)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
$function$;

  if not quota_trigger_exists then
    create trigger on_profile_ai_quota_defaults
      after insert on public.profiles
      for each row execute function public.handle_user_ai_quota_defaults();
  end if;
end;
$migration$;
