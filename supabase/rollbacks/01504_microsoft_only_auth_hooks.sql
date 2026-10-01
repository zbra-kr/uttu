-- FIRST disable/restore BOTH Auth hook configurations in the dashboard.
-- Do not drop a function while its Auth hook remains enabled: login/refresh
-- would fail. This rollback SQL cannot inspect hosted Auth configuration.
-- Verify no later hook/work relies on any public-schema USAGE grant added by
-- 01504. Restore the recorded baseline, not permissions belonging to others.
-- Execute the entire file inside one explicit transaction.
-- Never delete accounts, profiles, sessions, refresh tokens, factors, or data.

do $$
declare
  description text;
  delta jsonb;
begin
  description := pg_catalog.obj_description(
    'public.uttu_custom_access_token(jsonb)'::regprocedure, 'pg_proc'
  );
  if description is null
     or description not like 'UTTU auth-hook ACL delta v1: %' then
    raise exception 'Cannot safely roll back auth hooks: original ACL delta is missing';
  end if;
  delta := pg_catalog.substr(description, pg_catalog.length('UTTU auth-hook ACL delta v1: ') + 1)::jsonb;
  if pg_catalog.jsonb_typeof(delta->'public_usage') is distinct from 'boolean'
     or pg_catalog.jsonb_typeof(delta->'profiles_id_select') is distinct from 'boolean'
     or pg_catalog.jsonb_typeof(delta->'profiles_role_select') is distinct from 'boolean' then
    raise exception 'Cannot safely roll back auth hooks: original ACL delta is invalid';
  end if;

  drop policy "uttu auth hook: read profile role" on public.profiles;
  if (delta->>'profiles_id_select')::boolean then
    revoke select (id) on public.profiles from supabase_auth_admin;
  end if;
  if (delta->>'profiles_role_select')::boolean then
    revoke select (role) on public.profiles from supabase_auth_admin;
  end if;
  if (delta->>'public_usage')::boolean then
    revoke usage on schema public from supabase_auth_admin;
  end if;
  drop function public.uttu_before_user_created(jsonb);
  drop function public.uttu_custom_access_token(jsonb);
end;
$$;
