// Offline PostgreSQL regression suite. This creates only an in-memory PGlite
// database; it never connects to Supabase or accepts a database URL.
// Install @electric-sql/pglite locally, or set PGLITE_MODULE_PATH to an existing
// package directory, then run: node supabase/tests/run_ai_quota_defaults.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

async function createBaseline(hasQuotaTrigger) {
  const db = new PGlite();
    await db.exec(`
      create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable
        as $$ select null::uuid; $$;
      create table auth.users (
        id uuid primary key,
        email text,
        raw_app_meta_data jsonb not null default '{}',
        raw_user_meta_data jsonb not null default '{}'
      );
    `);

    // Execute the actual existing schema and trigger migrations, unmodified.
    const baselineFiles = [
      'migrations/00200_user_profiles.sql',
      'migrations/00309_ai_sessions.sql',
    ];
    if (hasQuotaTrigger) baselineFiles.push('migrations/00310_ai_quota_defaults.sql');
    for (const file of baselineFiles) {
      await db.exec(read(file));
    }
    await db.exec(read('tests/ai_quota_defaults.sql'));
    await db.query('select pg_temp.uttu_quota_defaults_setup($1)', [hasQuotaTrigger]);
    return db;
}

async function checkBaseline(hasQuotaTrigger) {
  const db = await createBaseline(hasQuotaTrigger);
  const baseline = hasQuotaTrigger ? 'repository legacy' : 'production absent';
  const rollbackFile = hasQuotaTrigger
    ? 'rollbacks/01503_ai_quota_signup_defaults_legacy.sql'
    : 'rollbacks/01503_ai_quota_signup_defaults.sql';
  try {

    await db.exec(read('migrations/01503_ai_quota_signup_defaults.sql'));
    await db.query('select pg_temp.uttu_quota_defaults_check_migrated()');
    console.log(`PASS (${baseline}): signup defaults, existing rows, profile chain, conflict safety`);

    // Reapplying CREATE OR REPLACE must not touch data or trigger metadata.
    await db.exec(read('migrations/01503_ai_quota_signup_defaults.sql'));
    await db.query('select pg_temp.uttu_quota_defaults_check_reapplied()');
    console.log(`PASS (${baseline}): migration reapplication is data- and metadata-safe`);

    await db.exec(read(rollbackFile));
    await db.query('select pg_temp.uttu_quota_defaults_check_rolled_back()');
    console.log(`PASS (${baseline}): exact rollback changes future signup behavior only`);

    await db.exec(read(rollbackFile));
    await db.query('select pg_temp.uttu_quota_defaults_check_rollback_reapplied()');
    console.log(`PASS (${baseline}): rollback reapplication is data- and metadata-safe`);

    const { rows } = await db.query('select assertion_count from uttu_quota_test_counts');
    assert.ok(rows[0].assertion_count > 0);
    console.log(`PASS (${baseline}): ${rows[0].assertion_count} PostgreSQL assertions`);
    return rows[0].assertion_count;
  } finally {
    await db.close();
  }
}

async function checkTriggerMismatch() {
  const mutations = [
    ['BEFORE INSERT timing', 'create trigger on_profile_ai_quota_defaults before insert on public.profiles for each row execute function public.handle_user_ai_quota_defaults()'],
    ['UPDATE event', 'create trigger on_profile_ai_quota_defaults after update on public.profiles for each row execute function public.handle_user_ai_quota_defaults()'],
    ['wrong target function', 'create trigger on_profile_ai_quota_defaults after insert on public.profiles for each row execute function public.protect_profile_role()'],
    ['conditional trigger', "create trigger on_profile_ai_quota_defaults after insert on public.profiles for each row when (new.team is not null) execute function public.handle_user_ai_quota_defaults()"],
    ['trigger arguments', "create trigger on_profile_ai_quota_defaults after insert on public.profiles for each row execute function public.handle_user_ai_quota_defaults('unexpected')"],
    ['disabled trigger', 'create trigger on_profile_ai_quota_defaults after insert on public.profiles for each row execute function public.handle_user_ai_quota_defaults(); alter table public.profiles disable trigger on_profile_ai_quota_defaults'],
  ];
  let assertions = 0;
  for (const [label, sql] of mutations) {
    const db = await createBaseline(true);
    try {
      await db.exec('drop trigger on_profile_ai_quota_defaults on public.profiles');
      await db.exec(sql);
      const snapshotQuery = `select pg_temp.uttu_quota_metadata() as metadata,
        pg_get_functiondef('public.handle_user_ai_quota_defaults()'::regprocedure) as definition,
        pg_temp.uttu_quota_rows() as quotas, pg_temp.uttu_profile_rows() as profiles`;
      const before = (await db.query(snapshotQuery)).rows[0];
      await assert.rejects(db.exec(read('migrations/01503_ai_quota_signup_defaults.sql')),
        /Unexpected on_profile_ai_quota_defaults trigger/, label);
      assert.deepEqual((await db.query(snapshotQuery)).rows[0], before,
        `${label}: rejected migration must change nothing`);
      assertions += 2;
      console.log(`PASS: mismatched ${label} aborts without mutation`);
    } finally {
      await db.close();
    }
  }
  return assertions;
}

async function checkProductionRollbackGuards() {
  const mutations = [
    ['changed function body', read('migrations/01503_ai_quota_signup_defaults.sql').replaceAll('500000', '600000'), /Quota function differs from 01503/],
    ['changed function search path', 'alter function public.handle_user_ai_quota_defaults() set search_path = public, pg_temp', /Quota function differs from 01503/],
    ['changed trigger', 'alter table public.profiles disable trigger on_profile_ai_quota_defaults', /Quota trigger differs from 01503/],
    ['unexpected function dependency', `create temporary table quota_dependency_fixture (id uuid);
      create trigger quota_dependency after insert on quota_dependency_fixture
        for each row execute function public.handle_user_ai_quota_defaults()`, /other objects depend on it/],
  ];
  let assertions = 0;
  for (const [label, sql, expectedError] of mutations) {
    const db = await createBaseline(false);
    try {
      await db.exec(read('migrations/01503_ai_quota_signup_defaults.sql'));
      await db.exec(sql);
      const snapshotQuery = `select pg_temp.uttu_quota_metadata() as metadata,
        pg_get_functiondef('public.handle_user_ai_quota_defaults()'::regprocedure) as definition,
        pg_temp.uttu_quota_rows() as quotas, pg_temp.uttu_profile_rows() as profiles`;
      const before = (await db.query(snapshotQuery)).rows[0];
      await assert.rejects(db.exec(read('rollbacks/01503_ai_quota_signup_defaults.sql')),
        expectedError, label);
      assert.deepEqual((await db.query(snapshotQuery)).rows[0], before,
        `${label}: rejected rollback must change nothing, including its first DROP`);
      assertions += 2;
      console.log(`PASS: production rollback with ${label} aborts atomically`);
    } finally {
      await db.close();
    }
  }
  return assertions;
}

async function main() {
  const legacy = await checkBaseline(true);
  const production = await checkBaseline(false);
  const mismatches = await checkTriggerMismatch();
  const rollbackGuards = await checkProductionRollbackGuards();
  console.log(`PASS: ${legacy + production + mismatches + rollbackGuards} assertions across both baselines, trigger mismatches, and rollback guards`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
