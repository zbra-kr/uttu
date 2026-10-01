'use strict';
// Disposable real PostgreSQL/PGlite only. No hosted SQL, tokens, network or sends.
// UTTU_PGLITE_MODULE=/path/to/@electric-sql/pglite node this-file.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.UTTU_PGLITE_MODULE || '@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const sql = file => fs.readFileSync(path.join(root, file), 'utf8');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const TENANT = '09cefcf6-a744-4cc2-a8ec-681fe0d1a85a';
const OID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const identity = { custom_claims: { tid: TENANT, oid: OID }, iss: ISSUER };
const scopes = ['Chat.Create', 'ChatMessage.Send'];
const cipher = 'synthetic-ciphertext-not-a-token-'.repeat(3);
let count = 0;
const pass = text => { count++; console.log(`PASS: ${text}`); };

async function owner(db) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub','',false)"); }
async function actor(db, id = A, role = 'authenticated') {
  await owner(db);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id || '']);
  await db.exec(`set role ${role}`);
}
async function rpc(db, id = A) {
  return (await db.query('select public.uttu_teams_setup_status($1) as status', [id])).rows[0].status;
}
async function expect(db, status) {
  const actual = await rpc(db);
  assert.equal(actual.status, status);
  if (status === 'connected') {
    assert.deepEqual(Object.keys(actual).sort(), ['connection_version', 'status']);
    assert.match(actual.connection_version, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const ownVersion = (await db.query('select version from public.uttu_teams_get_connection($1)', [A])).rows[0].version;
    assert.equal(actual.connection_version, ownVersion);
  } else assert.deepEqual(actual, { status });
  assert.doesNotMatch(JSON.stringify(actual), /ciphertext|refresh_token|access_token|webhook|tenant_id|object_id|epoch/);
}
async function install(db) {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
    create table auth.identities(id uuid primary key default gen_random_uuid(), user_id uuid, provider text, identity_data jsonb);
  `);
  await db.exec(sql('migrations/00200_user_profiles.sql'));
  await db.exec('grant select,update on public.profiles to authenticated');
  await db.exec(sql('migrations/00500_user_notifications.sql'));
  await db.exec(sql('migrations/00600_user_notes.sql'));
  for (const id of [A, B, C]) {
    await db.query('insert into auth.users values($1,$2,$3)', [id, `${id}@bcave.co.kr`, { role: 'admin', custom_claims: identity.custom_claims, iss: ISSUER }]);
  }
  await db.query("insert into auth.identities(user_id,provider,identity_data) values($1,'azure',$2)", [A, identity]);
  await db.query("update public.profiles set role='admin' where id=$1", [B]);
  await db.exec('begin');
  await db.exec(sql('migrations/01505_teams_delegated_mentions.sql'));
  await db.exec('commit');
}
async function migration(db) {
  await owner(db); await db.exec('begin');
  try { await db.exec(sql('migrations/01507_teams_required_setup_status.sql')); await db.exec('commit'); }
  catch (error) { await db.exec('rollback'); throw error; }
}
async function connect(db) {
  await actor(db);
  const epoch = (await db.query('select public.uttu_teams_get_connection_epoch($1) as epoch', [A])).rows[0].epoch;
  const version = (await db.query('select public.uttu_teams_put_connection($1,$2,$3,now()+interval \'1 hour\',null,$4) as version', [A, cipher, scopes, epoch])).rows[0].version;
  return { epoch, version };
}
async function mutateConnection(db, assignment, parameters = []) {
  await owner(db); await db.query(`update public.user_teams_connections set ${assignment} where user_id='${A}'`, parameters); await actor(db);
}
async function catalogs(db) {
  return {
    functions: (await db.query(`select p.proname,pg_get_function_identity_arguments(p.oid) as args,
      p.prosrc,p.prosecdef,p.provolatile,p.proconfig,p.proacl::text as acl
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname like 'uttu_teams_%'
      order by p.proname,args`)).rows,
    tables: (await db.query(`select c.relname,c.relacl::text as acl,c.relrowsecurity,c.relforcerowsecurity
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in
        ('user_teams_connections','user_teams_connection_epochs','user_teams_mention_deliveries')
      order by c.relname`)).rows,
  };
}

(async () => {
  const db = new PGlite();
  try {
    await install(db);
    const originalCatalogs = await catalogs(db);
    const before = (await db.query(`select pg_catalog.jsonb_agg(row_to_json(p) order by p.policyname) as policies from pg_catalog.pg_policies p`)).rows[0].policies;
    await migration(db);
    const after = (await db.query(`select pg_catalog.jsonb_agg(row_to_json(p) order by p.policyname) as policies from pg_catalog.pg_policies p`)).rows[0].policies;
    assert.deepEqual(after, before); pass('existing RLS policies are unchanged');
    const installedCatalogs = await catalogs(db);
    assert.deepEqual(installedCatalogs.tables, originalCatalogs.tables);
    const existingFunctions = installedCatalogs.functions.filter(f => f.proname !== 'uttu_teams_setup_status').map(f => f.proname === 'uttu_teams_claim_delivery'
      ? { ...f, prosrc: f.prosrc.replace('    connection_fingerprint = pg_catalog.md5(v_connection.token_ciphertext),\n', '') } : f);
    assert.deepEqual(existingFunctions, originalCatalogs.functions);
    pass('every baseline function option/ACL/body and table ACL/RLS flag is preserved except one claim fingerprint assignment');
    const meta = (await db.query(`select prosecdef,provolatile,proconfig,pg_get_function_result(oid) as result from pg_proc where oid='public.uttu_teams_setup_status(uuid)'::regprocedure`)).rows[0];
    assert.equal(meta.prosecdef, true); assert.equal(meta.provolatile, 's'); assert.deepEqual(meta.proconfig, ['search_path=""']); assert.equal(meta.result, 'jsonb');
    pass('status is STABLE SECURITY DEFINER with fixed empty search_path and metadata-only JSONB result');
    for (const role of ['anon', 'service_role']) {
      assert.equal((await db.query('select has_function_privilege($1,\'public.uttu_teams_setup_status(uuid)\',\'EXECUTE\') as allowed', [role])).rows[0].allowed, false);
      await actor(db, A, role); await assert.rejects(rpc(db), /permission denied/i);
      pass(`${role} cannot execute setup-status RPC`);
    }
    await actor(db, null); await assert.rejects(rpc(db), /Not authorized/); pass('authenticated role without UID is rejected');
    await actor(db, A); await assert.rejects(rpc(db, B), /Not authorized/); pass('cross-actor lookup rejected even when target is admin');
    await actor(db, B); assert.deepEqual(await rpc(db, B), { status: 'admin_exempt' }); pass('protected DB admin has exemption without any Azure identity or Teams connection');
    await actor(db); await expect(db, 'setup_required'); pass('trusted identity without connection requires setup despite forged raw user metadata admin role');
    await assert.rejects(db.query("update public.profiles set role='admin' where id=$1", [A]), /only admins can change roles/); await expect(db, 'setup_required'); pass('viewer self-promotion is rejected by original role protection');
    await actor(db, C); assert.deepEqual(await rpc(db, C), { status: 'identity_required' }); pass('non-Azure non-admin requires trusted identity');
    await actor(db); const connected = await connect(db); await expect(db, 'connected'); pass('current identity/epoch/required Graph scopes yields metadata connected');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await owner(db);
      for (const table of ['user_teams_connections', 'user_teams_connection_epochs', 'user_teams_mention_deliveries']) {
        assert.equal((await db.query('select has_table_privilege($1,$2,\'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER\') as allowed', [role, `public.${table}`])).rows[0].allowed, false);
      }
      pass(`${role} gets no widened direct Teams-table privileges`);
    }
    await mutateConnection(db, "expires_at=now()-interval '3 hours'"); await expect(db, 'connected'); pass('expired access token alone stays connected for normal on-demand refresh');
    await mutateConnection(db, 'granted_scopes=$1', [['Chat.Create']]); await expect(db, 'setup_required'); pass('missing ChatMessage.Send fails closed');
    await mutateConnection(db, 'granted_scopes=$1', [['ChatMessage.Send']]); await expect(db, 'setup_required'); pass('missing Chat.Create fails closed');
    await mutateConnection(db, 'granted_scopes=$1', [['https://graph.microsoft.com/Chat.Create', 'https://graph.microsoft.com/ChatMessage.Send']]); await expect(db, 'setup_required'); pass('noncanonical unvalidated scope metadata does not pass exact stored-scope contract');
    await mutateConnection(db, 'granted_scopes=$1', [scopes]);
    await owner(db); await db.query('update public.user_teams_connection_epochs set epoch=gen_random_uuid() where user_id=$1', [A]); await actor(db); await expect(db, 'setup_required'); pass('consent epoch drift fails closed');
    await owner(db); await db.query('update public.user_teams_connection_epochs set epoch=$1 where user_id=$2', [connected.epoch, A]); await actor(db);
    for (const badIdentity of [
      { ...identity, iss: `${ISSUER}.evil` },
      { ...identity, custom_claims: { ...identity.custom_claims, tid: C } },
      { ...identity, custom_claims: { ...identity.custom_claims, oid: 'malformed' } },
      { ...identity, custom_claims: { ...identity.custom_claims, oid: '00000000-0000-0000-0000-000000000000' } },
      { tid: TENANT, oid: OID, iss: ISSUER },
    ]) {
      await owner(db); await db.query('update auth.identities set identity_data=$1 where user_id=$2', [badIdentity, A]); await actor(db); await expect(db, 'identity_required'); pass('untrusted issuer/tenant/OID/claim shape fails closed');
    }
    await owner(db); await db.query('update auth.identities set identity_data=$1 where user_id=$2', [{ ...identity, custom_claims: { ...identity.custom_claims, oid: C } }, A]); await actor(db); await expect(db, 'setup_required'); pass('changed trusted Azure object requires a new matching grant');
    await owner(db); await db.query('update auth.identities set identity_data=$1 where user_id=$2', [identity, A]);
    await db.query("insert into auth.identities(user_id,provider,identity_data) values($1,'azure',$2)", [A, identity]); await actor(db); await expect(db, 'identity_required'); pass('ambiguous duplicate Azure identities fail closed');
    await owner(db); await db.query('delete from auth.identities where id=(select id from auth.identities where user_id=$1 limit 1)', [A]); await actor(db); await expect(db, 'connected');
    await owner(db);
    await db.query(`insert into public.user_teams_mention_deliveries(note_id,author_id,recipient_id,body_snapshot,title_snapshot,link_snapshot,status,connection_version,connection_fingerprint) values(gen_random_uuid(),$1,$2,'synthetic body','synthetic title','/me','reconnect_required',gen_random_uuid(),md5('older sealed grant'))`, [A, C]);
    await actor(db); await expect(db, 'connected'); pass('stale sealed-grant reconnect evidence does not poison current grant');
    await owner(db); await db.query('update public.user_teams_mention_deliveries set connection_version=$1,connection_fingerprint=md5($2) where author_id=$3', [connected.version, cipher, A]); await actor(db); await expect(db, 'reconnect_required'); pass('exact sealed-grant known reconnect failure requires setup');
    await owner(db); await db.query("update public.user_teams_mention_deliveries set status='failed' where author_id=$1", [A]); await actor(db); await expect(db, 'connected'); pass('generic/transport delivery failure is not disconnection evidence');
    await owner(db); await db.query("update public.user_teams_mention_deliveries set status='reconnect_required',connection_version=null,connection_fingerprint=null where author_id=$1", [A]); await actor(db); await expect(db, 'connected'); pass('unbound reconnect failure cannot invalidate arbitrary current grant');
    await owner(db); await db.query('update public.user_teams_mention_deliveries set connection_version=$1,connection_fingerprint=md5($2) where author_id=$3', [connected.version, cipher, A]); await actor(db);
    const replay = (await db.query("select public.uttu_teams_put_connection($1,$2,$3,now()+interval '1 hour',$4,null) as version", [A, cipher, scopes, connected.version])).rows[0].version;
    assert.notEqual(replay, connected.version); await expect(db, 'reconnect_required'); pass('replayed revoked sealed value under a new version remains rejected');
    await db.query("select public.uttu_teams_put_connection($1,$2,$3,now()+interval '1 hour',$4,null)", [A, cipher + 'new-sealed-value', scopes, replay]);
    await expect(db, 'connected'); pass('fresh sealed OAuth/refresh value is not poisoned by old in-flight reconnect evidence');
    // Verify the only claim RPC delta against its real actor-bound path.
    await owner(db);
    await db.query("insert into auth.identities(user_id,provider,identity_data) values($1,'azure',$2)", [C, { custom_claims: { tid: TENANT, oid: C }, iss: ISSUER }]);
    const noteId = (await db.query('insert into public.user_notes(user_id,body,mentioned_user_ids) values($1,\'synthetic claimed note\',$2) returning id', [A, [C]])).rows[0].id;
    await db.query("insert into public.user_teams_mention_deliveries(note_id,author_id,recipient_id,body_snapshot,title_snapshot,link_snapshot) values($1,$2,$3,'synthetic claimed note','synthetic','/me')", [noteId, A, C]);
    await actor(db);
    const claimed = (await db.query('select * from public.uttu_teams_claim_delivery($1,$2,$3,gen_random_uuid())', [noteId, A, C])).rows[0];
    assert.equal(claimed.status, 'claimed');
    assert.equal(claimed.connection_fingerprint, (await db.query('select md5($1) as hash', [cipher + 'new-sealed-value'])).rows[0].hash);
    pass('real unchanged claim path adds only fingerprint correlated to the current sealed grant');
    await actor(db); await db.query('select public.uttu_teams_disconnect($1)', [A]); await expect(db, 'setup_required'); pass('explicit disconnect immediately requires setup');
    await connect(db); await expect(db, 'connected'); pass('fresh current-epoch reconnection restores metadata connected');
    await owner(db); await db.query('delete from public.profiles where id=$1', [A]); await actor(db); await expect(db, 'setup_required'); pass('missing protected profile fails closed despite existing connection');
    await owner(db);
    const retained = (await db.query('select row_to_json(c) as row from public.user_teams_connections c where user_id=$1', [A])).rows;
    await db.exec('begin'); await db.exec(sql('rollbacks/01507_teams_required_setup_status.sql')); await db.exec('commit');
    assert.equal((await db.query("select to_regprocedure('public.uttu_teams_setup_status(uuid)') as rpc")).rows[0].rpc, null);
    assert.deepEqual((await db.query('select row_to_json(c) as row from public.user_teams_connections c where user_id=$1', [A])).rows, retained);
    assert.deepEqual((await db.query(`select pg_catalog.jsonb_agg(row_to_json(p) order by p.policyname) as policies from pg_catalog.pg_policies p`)).rows[0].policies, before);
    assert.deepEqual(await catalogs(db), originalCatalogs);
    assert.equal((await db.query("select count(*)::int as n from pg_attribute where attrelid='public.user_teams_mention_deliveries'::regclass and attname='connection_fingerprint' and not attisdropped")).rows[0].n, 0);
    pass('rollback removes status/fingerprint metadata and exactly restores baseline catalogs while preserving connection rows and RLS policies');
  } finally { await db.close(); }
  const historical = new PGlite();
  try {
    await install(historical); const grant = await connect(historical); await owner(historical);
    await historical.query("insert into public.user_teams_mention_deliveries(note_id,author_id,recipient_id,body_snapshot,title_snapshot,link_snapshot,status,connection_version) values(gen_random_uuid(),$1,$2,'history','history','/me','reconnect_required',$3)", [A, C, grant.version]);
    const beforeHistory = (await historical.query('select row_to_json(d) as row from public.user_teams_mention_deliveries d')).rows[0].row;
    await migration(historical);
    const afterHistory = (await historical.query('select row_to_json(d) as row from public.user_teams_mention_deliveries d')).rows[0].row;
    assert.equal(afterHistory.connection_fingerprint, (await historical.query('select md5($1) as hash', [cipher])).rows[0].hash);
    const { connection_fingerprint: ignored, ...unchanged } = afterHistory;
    assert.deepEqual(unchanged, beforeHistory); await actor(historical); await expect(historical, 'reconnect_required');
    pass('matched historical unhealthy evidence gets fingerprint backfill without any outcome/timestamp change');
  } finally { await historical.close(); }
  const inFlight = new PGlite();
  try {
    await install(inFlight); await connect(inFlight); await owner(inFlight);
    await inFlight.query("insert into auth.identities(user_id,provider,identity_data) values($1,'azure',$2)", [C, { custom_claims: { tid: TENANT, oid: C }, iss: ISSUER }]);
    const noteId = (await inFlight.query("insert into public.user_notes(user_id,body,mentioned_user_ids) values($1,'in flight baseline claim',$2) returning id", [A, [C]])).rows[0].id;
    await inFlight.query("insert into public.user_teams_mention_deliveries(note_id,author_id,recipient_id,body_snapshot,title_snapshot,link_snapshot) values($1,$2,$3,'in flight baseline claim','synthetic','/me')", [noteId, A, C]);
    await actor(inFlight);
    const claim = (await inFlight.query('select * from public.uttu_teams_claim_delivery($1,$2,$3,gen_random_uuid())', [noteId, A, C])).rows[0];
    assert.equal(claim.status, 'claimed');
    assert.equal((await inFlight.query('select public.uttu_teams_begin_send($1,$2,$3) as began', [claim.id, A, claim.claim_id])).rows[0].began, true);
    await owner(inFlight);
    const beforeAttempt = (await inFlight.query('select row_to_json(d) as row from public.user_teams_mention_deliveries d')).rows;
    await assert.rejects(migration(inFlight), /existing delivery claims must finish normally/);
    assert.equal((await inFlight.query("select to_regprocedure('public.uttu_teams_setup_status(uuid)') as rpc")).rows[0].rpc, null);
    assert.deepEqual((await inFlight.query('select row_to_json(d) as row from public.user_teams_mention_deliveries d')).rows, beforeAttempt);
    await actor(inFlight);
    assert.equal((await inFlight.query("select public.uttu_teams_finish_delivery($1,$2,$3,'reconnect_required','invalid_grant',null,null,null) as finished", [claim.id, A, claim.claim_id])).rows[0].finished, true);
    await migration(inFlight); await actor(inFlight); await expect(inFlight, 'reconnect_required');
    pass('real pre-migration begun send blocks migration unchanged until normal unhealthy finish can be safely backfilled');
  } finally { await inFlight.close(); }
  const rotating = new PGlite();
  try {
    await install(rotating); const grant = await connect(rotating); await owner(rotating);
    await rotating.query("insert into public.user_teams_mention_deliveries(note_id,author_id,recipient_id,body_snapshot,title_snapshot,link_snapshot,status,connection_version) values(gen_random_uuid(),$1,$2,'history','history','/me','reconnect_required',$3)", [A, C, grant.version]);
    const text = sql('migrations/01507_teams_required_setup_status.sql');
    const split = text.indexOf('update public.user_teams_mention_deliveries d\nset connection_fingerprint');
    assert(split > 0);
    await rotating.exec('begin'); await rotating.exec(text.slice(0, split));
    // Deterministically model a connection-version rotation between preflight
    // and exact-match backfill, without changing the locked delivery history.
    await rotating.query('update public.user_teams_connections set version=gen_random_uuid() where user_id=$1', [A]);
    await assert.rejects(rotating.exec(text.slice(split)), /unhealthy history changed during fingerprint backfill/);
    await rotating.exec('rollback');
    assert.equal((await rotating.query("select to_regprocedure('public.uttu_teams_setup_status(uuid)') as rpc")).rows[0].rpc, null);
    assert.equal((await rotating.query("select count(*)::int as n from pg_attribute where attrelid='public.user_teams_mention_deliveries'::regclass and attname='connection_fingerprint' and not attisdropped")).rows[0].n, 0);
    pass('connection rotation between preflight and backfill aborts instead of leaving unhealthy evidence unbound');
  } finally { await rotating.close(); }
  for (const scenario of ['disabled-role-trigger', 'no-profile-RLS', 'inherited-anon-execute', 'unexpected-claim-body', 'unmatched-historical-unhealthy']) {
    const bad = new PGlite();
    try {
      await install(bad); await owner(bad);
      if (scenario === 'disabled-role-trigger') await bad.exec('alter table public.profiles disable trigger on_profile_update');
      if (scenario === 'no-profile-RLS') await bad.exec('alter table public.profiles disable row level security');
      if (scenario === 'inherited-anon-execute') await bad.exec('grant authenticated to anon');
      if (scenario === 'unexpected-claim-body') await bad.exec("create or replace function public.uttu_teams_claim_delivery(p_note_id uuid,p_author_id uuid,p_recipient_id uuid,p_claim_id uuid) returns setof public.user_teams_mention_deliveries language sql as $$ select * from public.user_teams_mention_deliveries where false $$");
      if (scenario === 'unmatched-historical-unhealthy') await bad.query("insert into public.user_teams_mention_deliveries(note_id,author_id,recipient_id,body_snapshot,title_snapshot,link_snapshot,status,connection_version) values(gen_random_uuid(),$1,$2,'history','history','/me','reconnect_required',gen_random_uuid())", [A, C]);
      await assert.rejects(migration(bad), /Teams setup preflight/);
      assert.equal((await bad.query("select to_regprocedure('public.uttu_teams_setup_status(uuid)') as rpc")).rows[0].rpc, null);
      pass(`${scenario} aborts migration atomically`);
    } finally { await bad.close(); }
  }
  console.log(`PASS: ${count} Teams setup SQL assertions on real local PostgreSQL`);
})().catch(error => { console.error(error); process.exitCode = 1; });
