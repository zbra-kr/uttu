-- Restore the pre-change signup guard. This affects future INSERTs only.
-- It does not remove accounts, identities, profiles, roles, or sessions.
-- Requires a separately authorized rollback if applied after rollout.
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
