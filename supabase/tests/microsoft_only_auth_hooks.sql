-- LOCAL-ONLY contract tests. Requires the synthetic fixture in the adjacent
-- runner; do not run against production users or Auth tables.
-- Run as supabase_auth_admin to exercise column grants and actual RLS.
set local role supabase_auth_admin;

do $tests$
declare
  base jsonb := '{"iss":"https://example.test/auth/v1","aud":"authenticated","iat":1700000000,"exp":1700003600,"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal1","session_id":"99999999-9999-4999-8999-999999999999","email":"viewer@example.test","phone":"","is_anonymous":false,"app_metadata":{"provider":"azure","providers":["email","azure"]},"user_metadata":{"role":"admin","provider":"azure"},"amr":[{"method":"password","timestamp":1700000000}]}'::jsonb;
  claims jsonb;
  payload jsonb;
  actual jsonb;
  sample record;
  user_sample record;
  method text;
  expected_allowed boolean;
  count_passed integer := 0;
begin
  -- Existing viewer, database admin, and missing-profile account.
  for user_sample in select * from (values
    ('viewer', '11111111-1111-4111-8111-111111111111', false, true),
    ('admin', '22222222-2222-4222-8222-222222222222', true, true),
    ('missing', '33333333-3333-4333-8333-333333333333', false, false)
  ) as users(label, id, is_admin, has_profile) loop
    foreach method in array array[
      'password', 'oauth', 'token_refresh', 'otp', 'recovery', 'magiclink',
      'invite', 'email/signup', 'email_change', 'anonymous', 'sso/saml',
      'passkey', 'future/unknown'
    ] loop
      claims := pg_catalog.jsonb_set(base, '{sub}', pg_catalog.to_jsonb(user_sample.id));
      payload := pg_catalog.jsonb_build_object('user_id', user_sample.id,
        'claims', claims, 'authentication_method', method);
      expected_allowed := user_sample.is_admin or method = 'token_refresh'
        or (user_sample.has_profile and method = 'oauth');
      actual := public.uttu_custom_access_token(payload);
      if expected_allowed then
        if actual is distinct from pg_catalog.jsonb_build_object('claims', claims) then
          raise exception 'Token passthrough failed: % / %', user_sample.label, method;
        end if;
      elsif actual->'error'->>'http_code' is distinct from '403' then
        raise exception 'Fresh-login deny failed: % / %', user_sample.label, method;
      end if;
      count_passed := count_passed + 1;
    end loop;
  end loop;

  -- Existing Supabase OAuth Server/MCP authorization-code issuance is a
  -- distinct delegated-auth continuation. Auth already verified consent,
  -- user/client/code binding, expiry, and PKCE; never reinterpret it as Azure.
  for user_sample in select * from (values
    ('viewer', '11111111-1111-4111-8111-111111111111'),
    ('admin', '22222222-2222-4222-8222-222222222222'),
    ('missing', '33333333-3333-4333-8333-333333333333')
  ) as users(label, id) loop
    claims := pg_catalog.jsonb_set(base, '{sub}', pg_catalog.to_jsonb(user_sample.id));
    claims := claims || '{"client_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","scope":"openid email profile","app_metadata":{"provider":"email","providers":["email"]},"amr":[{"method":"oauth_provider/authorization_code","timestamp":1700000010}]}'::jsonb;
    payload := pg_catalog.jsonb_build_object('user_id', user_sample.id,
      'claims', claims, 'authentication_method', 'oauth_provider/authorization_code');
    actual := public.uttu_custom_access_token(payload);
    if actual is distinct from pg_catalog.jsonb_build_object('claims', claims) then
      raise exception 'OAuth Server/MCP claims passthrough failed: %', user_sample.label;
    end if;
    count_passed := count_passed + 1;
    actual := public.uttu_custom_access_token(pg_catalog.jsonb_set(
      payload, '{authentication_method}', '"token_refresh"'
    ));
    if actual is distinct from pg_catalog.jsonb_build_object('claims', claims) then
      raise exception 'OAuth Server/MCP refresh changed claims: %', user_sample.label;
    end if;
    count_passed := count_passed + 1;

    for sample in select * from (values
      ('no client', claims - 'client_id'),
      ('null client', pg_catalog.jsonb_set(claims, '{client_id}', 'null')),
      ('numeric client', pg_catalog.jsonb_set(claims, '{client_id}', '123')),
      ('empty client', pg_catalog.jsonb_set(claims, '{client_id}', '""')),
      ('invalid client', pg_catalog.jsonb_set(claims, '{client_id}', '"mcp-client"')),
      ('nil client', pg_catalog.jsonb_set(claims, '{client_id}', '"00000000-0000-0000-0000-000000000000"')),
      ('metadata client spoof', (claims - 'client_id') || '{"user_metadata":{"client_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}}'),
      ('no session', claims - 'session_id'),
      ('nil session', pg_catalog.jsonb_set(claims, '{session_id}', '"00000000-0000-0000-0000-000000000000"')),
      ('wrong user', pg_catalog.jsonb_set(claims, '{sub}', '"55555555-5555-4555-8555-555555555555"'))
    ) as bad(label, claims) loop
      actual := public.uttu_custom_access_token(pg_catalog.jsonb_set(payload, '{claims}', sample.claims));
      if actual->'error'->>'http_code' is distinct from '403' then
        raise exception 'Malformed OAuth Server payload allowed: % / %', user_sample.label, sample.label;
      end if;
      count_passed := count_passed + 1;
    end loop;
  end loop;

  -- Merely attaching a valid-looking client_id must never unlock a blocked
  -- fresh interactive method. Existing admin password fallback still works.
  claims := base || '{"client_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","scope":"openid email profile"}'::jsonb;
  foreach method in array array['password', 'otp', 'recovery', 'magiclink', 'invite', 'email_change'] loop
    actual := public.uttu_custom_access_token(pg_catalog.jsonb_build_object(
      'user_id', base->>'sub', 'claims', claims, 'authentication_method', method
    ));
    if actual->'error'->>'http_code' is distinct from '403' then
      raise exception 'Client ID bypasses viewer fresh-login policy: %', method;
    end if;
    count_passed := count_passed + 1;
  end loop;
  claims := pg_catalog.jsonb_set(claims, '{sub}', '"22222222-2222-4222-8222-222222222222"');
  actual := public.uttu_custom_access_token(pg_catalog.jsonb_build_object(
    'user_id', claims->>'sub', 'claims', claims, 'authentication_method', 'password'
  ));
  if actual is distinct from pg_catalog.jsonb_build_object('claims', claims) then
    raise exception 'Admin password fallback changed with a client ID';
  end if;
  count_passed := count_passed + 1;

  -- MFA is a verified continuation of an existing session, even if its
  -- original method was password. Do not require OAuth primary AMR.
  foreach method in array array['totp', 'mfa/phone', 'mfa/webauthn', 'mfa/recovery_code'] loop
    claims := pg_catalog.jsonb_set(base, '{aal}', '"aal2"');
    claims := pg_catalog.jsonb_set(claims, '{amr}', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('method', method, 'timestamp', 1700000010),
      pg_catalog.jsonb_build_object('method', 'password', 'timestamp', 1700000000)
    ));
    payload := pg_catalog.jsonb_build_object('user_id', base->>'sub', 'claims', claims,
      'authentication_method', method);
    actual := public.uttu_custom_access_token(payload);
    if actual is distinct from pg_catalog.jsonb_build_object('claims', claims) then
      raise exception 'Verified MFA continuation failed: %', method;
    end if;
    count_passed := count_passed + 1;

    -- Verified continuation must also survive a missing legacy profile.
    actual := public.uttu_custom_access_token(pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(payload, '{user_id}', '"33333333-3333-4333-8333-333333333333"'),
      '{claims,sub}', '"33333333-3333-4333-8333-333333333333"'
    ));
    if actual->'claims' is distinct from pg_catalog.jsonb_set(
      claims, '{sub}', '"33333333-3333-4333-8333-333333333333"'
    ) then
      raise exception 'Missing-profile MFA continuation failed: %', method;
    end if;
    count_passed := count_passed + 1;

    -- Wrong AAL, missing/malformed AMR, wrong method, or invalid session must
    -- never turn the MFA exception into a generic fresh-login path.
    for sample in select * from (values
      ('aal1', pg_catalog.jsonb_set(claims, '{aal}', '"aal1"')),
      ('no amr', claims - 'amr'),
      ('null amr', pg_catalog.jsonb_set(claims, '{amr}', 'null')),
      ('object amr', pg_catalog.jsonb_set(claims, '{amr}', '{}')),
      ('scalar amr entry', pg_catalog.jsonb_set(claims, '{amr}', '["totp"]')),
      ('wrong amr method', pg_catalog.jsonb_set(claims, '{amr}', '[{"method":"otp"}]')),
      ('no session', claims - 'session_id'),
      ('empty session', pg_catalog.jsonb_set(claims, '{session_id}', '""')),
      ('invalid session', pg_catalog.jsonb_set(claims, '{session_id}', '"invalid"')),
      ('nil session', pg_catalog.jsonb_set(claims, '{session_id}', '"00000000-0000-0000-0000-000000000000"'))
    ) as bad(label, claims) loop
      actual := public.uttu_custom_access_token(pg_catalog.jsonb_set(payload, '{claims}', sample.claims));
      if actual->'error'->>'http_code' is distinct from '403' then
        raise exception 'Malformed MFA allowed: % / %', method, sample.label;
      end if;
      count_passed := count_passed + 1;
    end loop;
  end loop;

  payload := pg_catalog.jsonb_build_object('user_id', base->>'sub', 'claims', base,
    'authentication_method', 'password');
  for sample in select * from (values
    ('null payload', 'null'::jsonb),
    ('no claims', payload - 'claims'),
    ('null claims', pg_catalog.jsonb_set(payload, '{claims}', 'null')),
    ('claims array', pg_catalog.jsonb_set(payload, '{claims}', '[]')),
    ('no user', payload - 'user_id'),
    ('invalid user', pg_catalog.jsonb_set(payload, '{user_id}', '"invalid"')),
    ('different subject', pg_catalog.jsonb_set(payload, '{user_id}', '"22222222-2222-4222-8222-222222222222"')),
    ('no method', payload - 'authentication_method'),
    ('null method', pg_catalog.jsonb_set(payload, '{authentication_method}', 'null')),
    ('empty method', pg_catalog.jsonb_set(payload, '{authentication_method}', '""')),
    ('no subject', pg_catalog.jsonb_set(payload, '{claims}', base - 'sub')),
    ('invalid subject', pg_catalog.jsonb_set(payload, '{claims,sub}', '"invalid"'))
  ) as bad(label, payload) loop
    actual := public.uttu_custom_access_token(sample.payload);
    if actual->'error'->>'http_code' is distinct from '403' then
      raise exception 'Malformed token payload allowed: %', sample.label;
    end if;
    count_passed := count_passed + 1;
  end loop;

  -- Only the singular server-assigned provider allows a new account; linked
  -- provider history, metadata, domain strings, and claims cannot substitute.
  for sample in select * from (values
    ('azure', '{"user":{"app_metadata":{"provider":"azure"}}}'::jsonb, true),
    ('email', '{"user":{"app_metadata":{"provider":"email"}}}', false),
    ('other oauth', '{"user":{"app_metadata":{"provider":"google"}}}', false),
    ('user metadata spoof', '{"user":{"app_metadata":{"provider":"email"},"user_metadata":{"provider":"azure","role":"admin"}}}', false),
    ('providers history', '{"user":{"app_metadata":{"provider":"email","providers":["azure","email"]}}}', false),
    ('providers alone', '{"user":{"app_metadata":{"providers":["azure"]}}}', false),
    ('company domain alone', '{"user":{"email":"staff@bcave.co.kr"}}', false),
    ('uppercase provider', '{"user":{"app_metadata":{"provider":"AZURE"}}}', false),
    ('null provider', '{"user":{"app_metadata":{"provider":null}}}', false),
    ('null user', '{"user":null}', false),
    ('missing user', '{}', false),
    ('null payload', 'null', false)
  ) as signup(label, payload, allowed) loop
    actual := public.uttu_before_user_created(sample.payload);
    if sample.allowed then
      if actual is distinct from '{}'::jsonb then
        raise exception 'Azure creation rejected';
      end if;
    elsif actual->'error'->>'http_code' is distinct from '403' then
      raise exception 'Non-Azure creation allowed: %', sample.label;
    end if;
    count_passed := count_passed + 1;
  end loop;

  -- This query is intentionally permitted through RLS without auth.uid().
  if (select role from public.profiles where id = '22222222-2222-4222-8222-222222222222')
       is distinct from 'admin' then
    raise exception 'Auth cannot see the real admin role through RLS';
  end if;
  count_passed := count_passed + 1;
  begin
    perform p.teams_webhook_url from public.profiles as p limit 1;
    raise exception 'Auth can read sensitive profile fields';
  exception when insufficient_privilege then
    count_passed := count_passed + 1;
  end;
  begin
    update public.profiles set role = 'admin' where id = '11111111-1111-4111-8111-111111111111';
    raise exception 'Auth hook has profile write privileges';
  exception when insufficient_privilege then
    count_passed := count_passed + 1;
  end;
  raise notice 'PASS: % auth-hook SQL assertions under supabase_auth_admin', count_passed;
end;
$tests$;

reset role;

-- API roles must not be able to forge hook events, even with server-looking
-- claims. Test actual execution denial, not just a pg_proc ACL inspection.
set local role authenticated;
do $tests$
begin
  begin
    perform public.uttu_custom_access_token('{}'::jsonb);
    raise exception 'Authenticated caller can execute the access-token hook';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.uttu_before_user_created('{}'::jsonb);
    raise exception 'Authenticated caller can execute the creation hook';
  exception when insufficient_privilege then null;
  end;
  -- The actual existing trigger prevents self-promotion through an allowed
  -- own-profile UPDATE. User metadata cannot grant an admin exception.
  perform pg_catalog.set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  begin
    update public.profiles set role = 'admin' where id = '11111111-1111-4111-8111-111111111111';
    raise exception 'Viewer self-promotion succeeded';
  exception when raise_exception then
    if sqlerrm <> 'Permission denied: only admins can change roles' then
      raise;
    end if;
  end;
end;
$tests$;
reset role;

set local role anon;
do $tests$
begin
  begin
    perform public.uttu_custom_access_token('{}'::jsonb);
    raise exception 'Anon caller can execute the access-token hook';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.uttu_before_user_created('{}'::jsonb);
    raise exception 'Anon caller can execute the creation hook';
  exception when insufficient_privilege then null;
  end;
end;
$tests$;
reset role;
