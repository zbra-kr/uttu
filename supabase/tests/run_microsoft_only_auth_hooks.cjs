'use strict';

// Local real-Postgres (PGlite) contract tests. No network, credentials, hosted
// Auth configuration, or production connection is used by this runner.
// npm dependency: @electric-sql/pglite. To reuse an installed copy:
// UTTU_PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite node this-file.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.UTTU_PGLITE_MODULE || '@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const migration = read('migrations/01504_microsoft_only_auth_hooks.sql');
const rollback = read('rollbacks/01504_microsoft_only_auth_hooks.sql');
const contracts = read('tests/microsoft_only_auth_hooks.sql');

async function fixture(db) {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create role supabase_auth_admin;
    create schema auth;
    grant usage on schema auth, public to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb,
      raw_app_meta_data jsonb
    );
    create table auth.sessions (id uuid primary key, user_id uuid, aal text);
    create table auth.mfa_factors (id uuid primary key, user_id uuid, status text);
    create table auth.identities (id uuid primary key, user_id uuid, provider text);
  `);
  // Real checked-in profile/domain and role-protection code, rather than a
  // JavaScript reproduction of the policy being tested.
  await db.exec(read('migrations/00200_user_profiles.sql'));
  await db.exec(read('migrations/01502_microsoft_company_email_domain.sql'));
  await db.exec(`
    alter table public.profiles add column display_name text;
    alter table public.profiles add column teams_webhook_url text;
    alter table public.profiles add column telegram_chat_id text;
    grant select, update on public.profiles to authenticated;
    insert into auth.users values
      ('11111111-1111-4111-8111-111111111111', 'viewer@bcave.co.kr', '{}', '{"provider":"email","providers":["email","azure"]}'),
      ('22222222-2222-4222-8222-222222222222', 'admin@bcave.co.kr', '{}', '{"provider":"email"}'),
      ('33333333-3333-4333-8333-333333333333', 'missing@bcave.co.kr', '{}', '{"provider":"email"}'),
      ('44444444-4444-4444-8444-444444444444', 'new@barrelsco.onmicrosoft.com', '{"role":"admin","provider":"azure"}', '{"provider":"azure"}');
    update public.profiles set role = 'admin' where id = '22222222-2222-4222-8222-222222222222';
    delete from public.profiles where id = '33333333-3333-4333-8333-333333333333';
    insert into auth.sessions values ('99999999-9999-4999-8999-999999999999', '11111111-1111-4111-8111-111111111111', 'aal1');
    insert into auth.mfa_factors values ('88888888-8888-4888-8888-888888888888', '11111111-1111-4111-8111-111111111111', 'verified');
    insert into auth.identities values ('77777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111', 'azure');
  `);
  const { rows } = await db.query(`select role from public.profiles where id = '44444444-4444-4444-8444-444444444444'`);
  assert.equal(rows[0].role, 'viewer', 'new Azure metadata cannot promote its profile');
}

async function state(db) {
  return (await db.query(`select
    (select jsonb_agg(to_jsonb(p) order by id) from public.profiles p) as profiles,
    (select jsonb_agg(to_jsonb(u) order by id) from auth.users u) as users,
    (select jsonb_agg(to_jsonb(s) order by id) from auth.sessions s) as sessions,
    (select jsonb_agg(to_jsonb(f) order by id) from auth.mfa_factors f) as factors,
    (select jsonb_agg(to_jsonb(i) order by id) from auth.identities i) as identities
  `)).rows[0];
}

async function privileges(db) {
  return {
    columns: (await db.query(`select attname,
      has_column_privilege('supabase_auth_admin', attrelid, attnum, 'SELECT') as can_select
      from pg_attribute where attrelid = 'public.profiles'::regclass
      and attnum > 0 and not attisdropped order by attnum`)).rows,
    schema: (await db.query(`select has_schema_privilege('supabase_auth_admin', 'public', 'USAGE') as can_use`)).rows[0],
  };
}

async function positive(name, configure) {
  const db = new PGlite();
  try {
    await fixture(db);
    await db.exec(configure);
    const before = await state(db);
    const aclBefore = await privileges(db);
    await db.exec('begin');
    await db.exec(migration);
    await db.exec(contracts, { onNotice: (n) => {
      if (n.message.startsWith('PASS:')) console.log(`${name}: ${n.message}`);
    } });
    assert.deepEqual(await state(db), before, 'hook calls must not mutate users or sessions');
    const safety = (await db.query(`select
      not bool_or(prosecdef) as invoker_only,
      bool_and(proconfig = array['search_path=""']::text[]) as empty_path
      from pg_proc where oid in ('public.uttu_before_user_created(jsonb)'::regprocedure,
        'public.uttu_custom_access_token(jsonb)'::regprocedure)`)).rows[0];
    assert.equal(safety.invoker_only, true);
    assert.equal(safety.empty_path, true);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const checks = (await db.query(`select
        has_function_privilege($1, 'public.uttu_before_user_created(jsonb)', 'EXECUTE') as before,
        has_function_privilege($1, 'public.uttu_custom_access_token(jsonb)', 'EXECUTE') as token`, [role])).rows[0];
      assert.deepEqual(checks, { before: false, token: false });
    }
    // SQL preparation does not toggle Auth. Here the hooks are never enabled,
    // so rollback has no hosted-config dependency and is safe to exercise.
    await db.exec(rollback);
    assert.deepEqual(await privileges(db), aclBefore, 'rollback must restore original effective ACLs');
    assert.deepEqual(await state(db), before, 'rollback must leave account data untouched');
    const removed = (await db.query(`select
      to_regprocedure('public.uttu_before_user_created(jsonb)') is null as before,
      to_regprocedure('public.uttu_custom_access_token(jsonb)') is null as token,
      not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles'
        and policyname = 'uttu auth hook: read profile role') as policy`)).rows[0];
    assert.deepEqual(removed, { before: true, token: true, policy: true });
    await db.exec('commit');
    console.log(`PASS: ${name}; execution isolation, no writes, exact ACL rollback`);
  } finally {
    await db.close();
  }
}

async function negative(name, configure, message) {
  const db = new PGlite();
  try {
    await fixture(db);
    await db.exec(configure);
    const before = await state(db);
    const aclBefore = await privileges(db);
    const hookBefore = (await db.query(`select to_regprocedure('public.uttu_custom_access_token(jsonb)') is null as absent`)).rows[0];
    await db.exec('begin');
    await assert.rejects(db.exec(migration), (error) => error.message.includes(message));
    await db.exec('rollback');
    assert.deepEqual(await privileges(db), aclBefore);
    assert.deepEqual(await state(db), before);
    const hookAfter = (await db.query(`select to_regprocedure('public.uttu_custom_access_token(jsonb)') is null as absent`)).rows[0];
    assert.deepEqual(hookAfter, hookBefore);
    console.log(`PASS: preflight rejects ${name}; transaction leaves baseline untouched`);
  } finally {
    await db.close();
  }
}

(async () => {
  await positive('no prior auth-admin access', `
    revoke usage on schema public from public;
    grant usage on schema public to anon, authenticated, service_role;
  `);
  await positive('preexisting narrow auth-admin access', `
    grant usage on schema public to supabase_auth_admin;
    grant select(id, role) on public.profiles to supabase_auth_admin;
  `);
  await positive('mixed inherited/direct narrow access', `
    create role hook_reader;
    grant select(id) on public.profiles to hook_reader;
    grant hook_reader to supabase_auth_admin;
  `);
  await negative('direct table-level SELECT', `grant select on public.profiles to supabase_auth_admin;`, 'additional profile columns');
  await negative('PUBLIC table-level SELECT', `grant select on public.profiles to public;`, 'additional profile columns');
  await negative('inherited table-level SELECT', `
    create role broad_reader;
    grant select on public.profiles to broad_reader;
    grant broad_reader to supabase_auth_admin;
  `, 'additional profile columns');
  await negative('direct sensitive-column SELECT', `grant select(teams_webhook_url) on public.profiles to supabase_auth_admin;`, 'additional profile columns');
  await negative('direct column-level UPDATE', `grant update(role) on public.profiles to supabase_auth_admin;`, 'profile write privileges');
  await negative('PUBLIC INSERT', `grant insert on public.profiles to public;`, 'profile write privileges');
  await negative('inherited column-level UPDATE', `
    create role profile_writer;
    grant update(role) on public.profiles to profile_writer;
    grant profile_writer to supabase_auth_admin;
    create policy legacy_auth_update on public.profiles for update to profile_writer using (true) with check (true);
  `, 'profile write privileges');
  await negative('column-level INSERT', `grant insert(id) on public.profiles to supabase_auth_admin;`, 'profile write privileges');
  await negative('DELETE', `grant delete on public.profiles to supabase_auth_admin;`, 'profile write privileges');
  await negative('TRUNCATE', `grant truncate on public.profiles to supabase_auth_admin;`, 'profile write privileges');
  await negative('TRIGGER', `grant trigger on public.profiles to supabase_auth_admin;`, 'profile write privileges');
  await negative('BYPASSRLS', `alter role supabase_auth_admin bypassrls;`, 'bypasses RLS');
  await negative('disabled profiles RLS', `alter table public.profiles disable row level security;`, 'enforced RLS');
  await negative('API role inherits auth admin', `grant supabase_auth_admin to authenticated;`, 'API role inherits');
  await negative('PUBLIC restrictive policy', `create policy hide_roles on public.profiles as restrictive for select to public using (false);`, 'restrictive profiles policy');
  await negative('auth-admin restrictive policy', `create policy hide_roles on public.profiles as restrictive for select to supabase_auth_admin using (false);`, 'restrictive profiles policy');
  await negative('inherited default-function EXECUTE', `
    create role rpc_reader;
    grant rpc_reader to authenticated;
    alter default privileges in schema public grant execute on functions to rpc_reader;
  `, 'retains effective hook execution');
  await negative('unexpected hook function collision', `create function public.uttu_custom_access_token(jsonb) returns jsonb language sql as $$ select $1 $$;`, 'already exists');
  console.log('All local auth-hook contract, privilege-preflight, and rollback tests passed');
})().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
