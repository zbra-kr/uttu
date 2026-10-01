-- REPOSITORY LEGACY BASELINE ONLY: the function and AFTER INSERT quota trigger
-- both existed before 01503. Restore the exact function from migration 00310.
-- Future inserts return to 100000 monthly / NULL daily; existing rows unchanged.
-- Use 01503_ai_quota_signup_defaults.sql for the verified production baseline,
-- where neither the function nor the quota trigger existed before rollout.
-- Requires a separately authorized rollback if applied after rollout.

create or replace function public.handle_user_ai_quota_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.ai_user_quotas (user_id, monthly_token_limit, daily_token_limit, is_blocked)
  values (new.id, 100000, null, false)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
