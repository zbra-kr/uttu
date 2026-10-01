-- Scoped Microsoft signup exception, approved 2026-10-01.
-- Prerequisite: Supabase Azure Tenant URL must remain exactly
-- https://login.microsoftonline.com/09cefcf6-a744-4cc2-a8ec-681fe0d1a85a
-- Supabase validates the token issuer against this configured tenant before
-- inserting auth.users. Do not change the provider to common/organizations.
--
-- Auth sets raw_app_meta_data.provider before auth.users INSERT; ordinary
-- signups cannot set it. Do NOT trust raw_user_meta_data for the provider.
-- Only replace the existing function: preserve trigger timing, owner, grants,
-- original @bcave.co.kr/NULL behavior, profiles, roles, and all RLS policies.
-- Apply only after comparing the live function and trigger with the baseline.

create or replace function public.check_email_domain()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.email not ilike '%@bcave.co.kr' then
    if new.raw_app_meta_data->>'provider' = 'azure'
       and new.email ~* '^[^@[:space:]]+@barrelsco[.]onmicrosoft[.]com$' then
      return new;
    end if;
    raise exception 'Unauthorized domain: only @bcave.co.kr accounts or approved company Microsoft accounts are allowed'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
