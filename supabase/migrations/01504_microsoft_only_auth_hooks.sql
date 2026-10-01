-- Phase 3: prepare Microsoft-only fresh viewer authentication, with an
-- existing database-admin fallback. This file does NOT activate either hook.
-- Apply the entire file inside an explicit transaction, after live preflight.
-- Required external configuration, separately approved and verified:
--   before_user_created -> pg-functions://postgres/public/uttu_before_user_created
--   custom_access_token -> pg-functions://postgres/public/uttu_custom_access_token
-- Azure must be the ONLY enabled external OAuth/OIDC/ID-token provider, with
-- the company-specific tenant URL; "oauth" does not identify a social provider.
-- Keep the Email provider enabled for existing administrators. Do not revoke
-- sessions, clear passwords, disable MFA, or replace an existing configured hook.
-- Before activation, verify an actual admin password login, viewer rejection,
-- Microsoft login/signup, an existing viewer refresh/MFA, and the existing
-- OAuth Server/MCP consent, authorization-code exchange, and refresh flows.
-- Preserve OAuth Server/dynamic-client settings: delegated authorization is
-- distinct from the external interactive provider used for Microsoft login.
-- Sources: https://supabase.com/docs/guides/auth/auth-hooks
-- https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook
-- https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook
-- https://supabase.com/docs/guides/auth/oauth-server/token-security

-- No CREATE OR REPLACE: fail rather than overwrite an unexpected live hook.
create function public.uttu_before_user_created(event jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Auth, not the public signup request, assigns app_metadata.provider before
  -- this hook. Never accept user_metadata.provider or a providers-array match.
  -- The existing INSERT domain trigger continues to enforce company domains.
  if pg_catalog.jsonb_typeof(event->'user') = 'object'
     and pg_catalog.jsonb_typeof(event->'user'->'app_metadata') = 'object'
     and event->'user'->'app_metadata'->>'provider' = 'azure' then
    return '{}'::jsonb;
  end if;

  return pg_catalog.jsonb_build_object('error', pg_catalog.jsonb_build_object(
    'http_code', 403,
    'message', 'Sign up with your company Microsoft account.'
  ));
end;
$$;

create function public.uttu_custom_access_token(event jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claims jsonb := event->'claims';
  method text := event->>'authentication_method';
  user_id uuid;
  session_id uuid;
  client_id uuid;
  profile_role text;
  denied jsonb := pg_catalog.jsonb_build_object('error', pg_catalog.jsonb_build_object(
    'http_code', 403,
    'message', 'Sign in with your company Microsoft account.'
  ));
begin
  -- The payload is only callable by Auth. Validate its identity/shape anyway,
  -- fail closed on malformed events, and preserve EVERY original JWT claim.
  if pg_catalog.jsonb_typeof(claims) is distinct from 'object'
     or pg_catalog.jsonb_typeof(event->'user_id') is distinct from 'string'
     or pg_catalog.jsonb_typeof(event->'authentication_method') is distinct from 'string'
     or method = ''
     or pg_catalog.jsonb_typeof(claims->'sub') is distinct from 'string'
     or pg_catalog.jsonb_typeof(claims->'session_id') is distinct from 'string' then
    return denied;
  end if;

  begin
    user_id := (event->>'user_id')::uuid;
    session_id := (claims->>'session_id')::uuid;
    if user_id is distinct from (claims->>'sub')::uuid
       or user_id = '00000000-0000-0000-0000-000000000000'::uuid
       or session_id = '00000000-0000-0000-0000-000000000000'::uuid then
      return denied;
    end if;
  exception when invalid_text_representation then
    return denied;
  end;

  -- Refresh is validated by Auth before this hook. Preserve existing sessions,
  -- including pre-rollout password sessions and accounts missing a profile.
  if method = 'token_refresh' then
    return pg_catalog.jsonb_build_object('claims', claims);
  end if;

  -- Existing OAuth Server/MCP clients delegate an already authenticated user
  -- through consent and an Auth-verified, user/client-bound authorization code.
  -- Auth sets the registered UUID client_id and scopes BEFORE calling this hook.
  -- This is continuation (including a grandfathered login), not evidence that
  -- the interactive login provider was Azure. Do not infer it from client_id
  -- alone or user_metadata, or require primary OAuth AMR in the new delegated
  -- session. No new auth.oauth_clients/session permissions are needed.
  if method = 'oauth_provider/authorization_code' then
    if pg_catalog.jsonb_typeof(claims->'client_id') is distinct from 'string' then
      return denied;
    end if;
    begin
      client_id := (claims->>'client_id')::uuid;
      if client_id = '00000000-0000-0000-0000-000000000000'::uuid then
        return denied;
      end if;
    exception when invalid_text_representation then
      return denied;
    end;
    return pg_catalog.jsonb_build_object('claims', claims);
  end if;

  -- Auth's MFA verifier requires an existing authenticated session, validates
  -- the factor, and appends its AMR before generating the hook's payload.
  -- Thus a verified MFA elevation is continuation, not a fresh-login bypass.
  -- This also preserves MFA for deliberately grandfathered password sessions.
  -- No additional auth.sessions/factor/secret permissions are needed.
  if method in ('totp', 'mfa/phone', 'mfa/webauthn', 'mfa/recovery_code')
     and claims->>'aal' = 'aal2'
     and pg_catalog.jsonb_typeof(claims->'amr') = 'array' then
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(claims->'amr') as entry(value)
      where pg_catalog.jsonb_typeof(entry.value) = 'object'
        and entry.value->>'method' = method
    ) then
      return pg_catalog.jsonb_build_object('claims', claims);
    end if;
  end if;

  select p.role into profile_role
  from public.profiles as p
  where p.id = user_id;

  -- Only the server-owned DB role authorizes the existing administrator
  -- fallback. No email, user_metadata, or JWT app_metadata can confer it.
  if profile_role = 'admin' then
    return pg_catalog.jsonb_build_object('claims', claims);
  end if;

  -- Missing/unrecognized profiles get no fresh-login exception.
  if profile_role is distinct from 'viewer' then
    return denied;
  end if;

  if method = 'oauth' then
    return pg_catalog.jsonb_build_object('claims', claims);
  end if;

  -- Includes password, OTP, recovery, magic link, signup, invite, email change,
  -- anonymous, SAML, and future methods. A client_id cannot exempt these.
  return denied;
end;
$$;

revoke all on function public.uttu_before_user_created(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.uttu_custom_access_token(jsonb)
  from public, anon, authenticated, service_role;

-- Check EFFECTIVE privileges, including inherited and PUBLIC grants. An RLS
-- policy must not expose teams_webhook_url, telegram_chat_id, or any other
-- profile column. Abort instead of silently modifying existing permissions.
-- Store only this migration's exact nonsecret ACL delta for a safe rollback.
do $$
declare
  delta jsonb;
begin
  if exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'supabase_auth_admin' and (rolsuper or rolbypassrls)
  ) then
    raise exception 'Auth-hook preflight failed: auth admin bypasses RLS';
  end if;
  if pg_catalog.pg_has_role('anon', 'supabase_auth_admin', 'MEMBER')
     or pg_catalog.pg_has_role('authenticated', 'supabase_auth_admin', 'MEMBER')
     or pg_catalog.pg_has_role('service_role', 'supabase_auth_admin', 'MEMBER') then
    raise exception 'Auth-hook preflight failed: an API role inherits auth admin';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class
    where oid = 'public.profiles'::regclass and relrowsecurity
      and relowner <> (select oid from pg_catalog.pg_roles where rolname = 'supabase_auth_admin')
  ) then
    raise exception 'Auth-hook preflight failed: profiles must have enforced RLS for auth admin';
  end if;
  if pg_catalog.has_table_privilege('supabase_auth_admin', 'public.profiles', 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
     or exists (
       select 1 from pg_catalog.pg_attribute as a
       where a.attrelid = 'public.profiles'::regclass
         and a.attnum > 0 and not a.attisdropped
         and pg_catalog.has_column_privilege('supabase_auth_admin', a.attrelid, a.attnum, 'INSERT,UPDATE')
     ) then
    raise exception 'Auth-hook preflight failed: auth admin has effective profile write privileges; review existing direct/inherited/PUBLIC grants first';
  end if;
  if exists (
    select 1 from pg_catalog.pg_attribute as a
    where a.attrelid = 'public.profiles'::regclass
      and a.attnum > 0 and not a.attisdropped
      and a.attname not in ('id', 'role')
      and pg_catalog.has_column_privilege('supabase_auth_admin', a.attrelid, a.attnum, 'SELECT')
  ) then
    raise exception 'Auth-hook preflight failed: auth admin can read additional profile columns; review existing direct/inherited/PUBLIC grants first';
  end if;
  if exists (
    select 1 from pg_catalog.pg_policies as p
    where p.schemaname = 'public' and p.tablename = 'profiles'
      and p.permissive = 'RESTRICTIVE' and p.cmd in ('SELECT', 'ALL')
      and exists (
        select 1 from pg_catalog.unnest(p.roles) as policy_role(name)
        where case when policy_role.name = 'public' then true
          else pg_catalog.pg_has_role('supabase_auth_admin', policy_role.name, 'USAGE') end
      )
  ) then
    raise exception 'Auth-hook preflight failed: an applicable restrictive profiles policy could hide administrator roles; review it first';
  end if;

  delta := pg_catalog.jsonb_build_object(
    'public_usage', not pg_catalog.has_schema_privilege('supabase_auth_admin', 'public', 'USAGE'),
    'profiles_id_select', not pg_catalog.has_column_privilege('supabase_auth_admin', 'public.profiles', 'id', 'SELECT'),
    'profiles_role_select', not pg_catalog.has_column_privilege('supabase_auth_admin', 'public.profiles', 'role', 'SELECT')
  );
  execute pg_catalog.format(
    'comment on function public.uttu_custom_access_token(jsonb) is %L',
    'UTTU auth-hook ACL delta v1: ' || delta::text
  );
  if (delta->>'public_usage')::boolean then
    grant usage on schema public to supabase_auth_admin;
  end if;
  if (delta->>'profiles_id_select')::boolean then
    grant select (id) on public.profiles to supabase_auth_admin;
  end if;
  if (delta->>'profiles_role_select')::boolean then
    grant select (role) on public.profiles to supabase_auth_admin;
  end if;
end;
$$;

create policy "uttu auth hook: read profile role"
  on public.profiles for select to supabase_auth_admin using (true);

grant execute on function public.uttu_before_user_created(jsonb) to supabase_auth_admin;
grant execute on function public.uttu_custom_access_token(jsonb) to supabase_auth_admin;

-- Direct revocation cannot remove privileges inherited from another default-
-- ACL recipient/owner role. Abort rather than leave either hook forgeable.
do $$
begin
  if exists (
    select 1 from (values ('anon'), ('authenticated'), ('service_role')) as api(role_name)
    where pg_catalog.has_function_privilege(api.role_name, 'public.uttu_before_user_created(jsonb)', 'EXECUTE')
       or pg_catalog.has_function_privilege(api.role_name, 'public.uttu_custom_access_token(jsonb)', 'EXECUTE')
  ) then
    raise exception 'Auth-hook preflight failed: an API role retains effective hook execution; review inherited/default function grants first';
  end if;
end;
$$;

comment on function public.uttu_before_user_created(jsonb) is
  'Microsoft-only new-account hook; server-assigned app_metadata.provider; SECURITY INVOKER; activation is separate.';
