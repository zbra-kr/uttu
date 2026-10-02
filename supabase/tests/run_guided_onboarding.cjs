'use strict';
// Offline PostgreSQL regression suite. This creates only an in-memory PGlite
// database and never connects to Supabase or accepts a database URL.
// UTTU_PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite node this-file.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.UTTU_PGLITE_MODULE || '@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const migration = read('migrations/01509_guided_onboarding.sql');
const rollback = read('rollbacks/01509_guided_onboarding.sql');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const MISSING = '44444444-4444-4444-8444-444444444444';
let assertions = 0;
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; };
const rejected = async (promise, pattern = /Not authorized|permission denied/i) => {
  await assert.rejects(promise, pattern); assertions++;
};

async function actor(db, id = A, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id || '']);
  await db.exec(`set role ${role}`);
}
async function admin(db) { await db.exec('reset role'); }
async function get(db) { return (await db.query('select * from public.get_my_onboarding()')).rows[0]; }
async function save(db, status, step, replay = false) {
  return (await db.query('select * from public.save_my_onboarding($1,$2,$3)', [status, step, replay])).rows[0];
}
const state = (user_id, eligible, status, step) => ({ user_id, eligible, status, step });

async function fixture(db) {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table auth.users (id uuid primary key, created_at timestamptz not null, raw_user_meta_data jsonb default '{}');
    create table public.profiles (id uuid primary key, display_name text, role text default 'member');
    create function public.fixture_profile_hook() returns trigger language plpgsql as $$
      begin insert into public.profiles(id,display_name) values(new.id,'Unchanged profile'); return new; end;
    $$;
    create trigger fixture_auth_insert after insert on auth.users
      for each row execute function public.fixture_profile_hook();
  `);
  await db.query("insert into auth.users(id,created_at) values ($1,now()-interval '1 day')", [A]);
}

async function metadata(db) {
  return (await db.query(`select
    (select jsonb_agg(row_to_json(p) order by p.id) from public.profiles p) as profiles,
    (select jsonb_agg(pg_get_triggerdef(t.oid) order by t.tgname) from pg_trigger t
      where t.tgrelid in ('auth.users'::regclass,'public.profiles'::regclass) and not t.tgisinternal) as triggers,
    pg_get_functiondef('public.fixture_profile_hook()'::regprocedure) as hook,
    (select jsonb_agg(row_to_json(c) order by c.table_schema,c.table_name,c.ordinal_position)
      from information_schema.columns c where (c.table_schema,c.table_name) in (('auth','users'),('public','profiles'))) as columns,
    (select jsonb_agg(row_to_json(r) order by r.rolname) from pg_roles r
      where r.rolname in ('anon','authenticated','service_role')) as roles`)).rows[0];
}

(async () => {
  const db = new PGlite();
  try {
    await fixture(db);
    const original = await metadata(db);
    await db.exec(migration);
    equal(await metadata(db), original, 'migration leaves Auth/profile data, triggers, columns, and roles unchanged');
    const cutoff = (await db.query('select released_at from public.onboarding_releases where version=1')).rows[0];
    equal((await db.query(`select count(*)::int as count from public.user_onboarding`)).rows[0].count, 0);
    equal((await db.query(`select count(*)::int as count from pg_class where relrowsecurity
      and oid in ('public.onboarding_releases'::regclass,'public.user_onboarding'::regclass)`)).rows[0].count, 2);

    await actor(db, A);
    equal(await get(db), state(A, false, 'legacy', 0));
    await rejected(save(db, 'pending', 0), /Explicit replay required/);
    await admin(db);
    equal((await db.query('select count(*)::int as count from public.user_onboarding')).rows[0].count, 0,
      'legacy GET/failed save never enrolls existing accounts');

    // Exact cutoff is new; one second after it is new. This fixture avoids wall
    // clock timing assumptions and checks the authoritative Auth creation date.
    await db.query(`insert into auth.users(id,created_at,raw_user_meta_data)
      select $1,released_at,$2 from public.onboarding_releases where version=1`, [B, { onboarding_eligible: false }]);
    await db.query(`insert into auth.users(id,created_at)
      select $1,released_at+interval '1 second' from public.onboarding_releases where version=1`, [C]);
    await db.query('update auth.users set raw_user_meta_data=$1 where id=$2',
      [{ onboarding_eligible: true, created_at: '2099-01-01' }, A]);
    await actor(db, B);
    equal(await get(db), state(B, true, 'pending', 0));
    await admin(db);
    equal((await db.query('select count(*)::int as count from public.user_onboarding')).rows[0].count, 0,
      'new-account GET is read-only');
    await actor(db, B);
    equal(await save(db, 'pending', 3), state(B, true, 'pending', 3));
    equal(await get(db), state(B, true, 'pending', 3), 'progress survives separate reads');
    await actor(db, C);
    equal(await get(db), state(C, true, 'pending', 0), 'new accounts have independent progress');
    equal((await db.query('select * from public.user_onboarding')).rows, [], 'RLS hides another account');
    await actor(db, A);
    equal(await get(db), state(A, false, 'legacy', 0), 'mutable metadata cannot manufacture eligibility');
    equal(await save(db, 'pending', 0, true), state(A, false, 'pending', 0));
    equal(await save(db, 'pending', 4), state(A, false, 'pending', 4));
    equal(await save(db, 'completed', 5), state(A, false, 'completed', 5));
    equal(await save(db, 'pending', 1), state(A, false, 'completed', 5), 'stale progress cannot reopen completion');
    equal(await save(db, 'skipped', 1), state(A, false, 'completed', 5), 'terminal state is sticky until replay');
    equal(await save(db, 'pending', 0, true), state(A, false, 'pending', 0), 'explicit replay restarts without automatic eligibility');
    equal(await save(db, 'skipped', 2), state(A, false, 'skipped', 2));
    equal(await save(db, 'pending', 3), state(A, false, 'skipped', 2), 'stale progress cannot reopen skip');
    equal((await db.query('select user_id,version,status,step from public.user_onboarding')).rows,
      [{ user_id: A, version: 1, status: 'skipped', step: 2 }], 'owner SELECT exposes only own row');
    console.log('PASS: new-only eligibility, immutable cutoff source, read-only GET, replay, resume, completion/skip, and account isolation');

    for (const [status, step, replay] of [
      [null, 0, false], ['legacy', 0, false], ['invalid', 0, false],
      ['pending', null, false], ['pending', -1, false], ['pending', 6, false],
      ['pending', 0, null], ['completed', 5, true], ['pending', 1, true],
    ]) await rejected(save(db, status, step, replay), /Invalid onboarding state/);
    await rejected(db.query("insert into public.user_onboarding(user_id,version,status,step) values ($1,1,'pending',0)", [C]));
    await rejected(db.query("update public.user_onboarding set step=4 where user_id=$1", [A]));
    await rejected(db.query('delete from public.user_onboarding where user_id=$1', [A]));
    await rejected(db.query('select * from public.onboarding_releases'));
    await rejected(db.query("update public.onboarding_releases set released_at=now()"));
    await rejected(db.query('select * from auth.users'));
    await actor(db, null);
    await rejected(get(db)); await rejected(save(db, 'pending', 0, true));
    await actor(db, MISSING);
    await rejected(get(db)); await rejected(save(db, 'pending', 0, true));
    for (const role of ['anon', 'service_role']) {
      await actor(db, A, role);
      await rejected(get(db)); await rejected(save(db, 'pending', 0, true));
      await rejected(db.query('select * from public.user_onboarding'));
      await rejected(db.query('select * from public.onboarding_releases'));
    }
    await admin(db);
    equal((await db.query(`select proname,prosecdef,proconfig from pg_proc
      where oid in ('public.get_my_onboarding()'::regprocedure,'public.save_my_onboarding(text,integer,boolean)'::regprocedure)
      order by proname`)).rows, [
      { proname: 'get_my_onboarding', prosecdef: true, proconfig: ['search_path=""'] },
      { proname: 'save_my_onboarding', prosecdef: true, proconfig: ['search_path=""'] },
    ]);
    console.log('PASS: strict validation, authenticated-only RPCs, owner RLS, no direct writes, no anonymous/service-role or missing-user access');

    const beforeReapply = await metadata(db);
    const savedRows = (await db.query('select * from public.user_onboarding order by user_id')).rows;
    await db.exec(migration);
    equal((await db.query('select released_at from public.onboarding_releases where version=1')).rows[0], cutoff,
      'migration reapplication preserves the original cutoff');
    equal((await db.query('select * from public.user_onboarding order by user_id')).rows, savedRows);
    equal(await metadata(db), beforeReapply);
    await actor(db, B);
    equal(await get(db), state(B, true, 'pending', 3), 'new-account eligibility survives migration reapplication');
    equal(await save(db, 'completed', 5), state(B, true, 'completed', 5));
    equal(await get(db), state(B, true, 'completed', 5));
    await admin(db);
    await db.query('delete from auth.users where id=$1', [B]);
    equal((await db.query('select count(*)::int as count from public.user_onboarding where user_id=$1', [B])).rows[0].count, 0);
    console.log('PASS: migration retries preserve cutoff/state and deleted accounts cascade only their onboarding row');

    const beforeRollback = await metadata(db);
    await db.exec('create view public.onboarding_dependency_fixture as select user_id from public.user_onboarding');
    await rejected(db.exec(rollback), /other objects depend on it/);
    await db.exec('rollback');
    equal((await db.query("select to_regprocedure('public.get_my_onboarding()') is not null as exists")).rows[0].exists, true,
      'unexpected dependency aborts rollback atomically, restoring dropped functions');
    await db.exec('drop view public.onboarding_dependency_fixture');
    await db.exec(rollback);
    await db.exec(rollback);
    equal(await metadata(db), beforeRollback, 'rollback leaves Auth/profiles/roles unchanged');
    equal((await db.query("select to_regclass('public.user_onboarding') as state, to_regclass('public.onboarding_releases') as release")).rows[0],
      { state: null, release: null });
    console.log(`PASS: atomic, repeatable rollback without unrelated changes; ${assertions} PostgreSQL assertions`);
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
