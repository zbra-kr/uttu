'use strict';
// Local real-Postgres (PGlite) tests only. No hosted DB or external API calls.
// UTTU_PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite node this-file.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.UTTU_PGLITE_MODULE || '@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const TENANT = '09cefcf6-a744-4cc2-a8ec-681fe0d1a85a';
const OID = { [A]: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', [B]: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', [C]: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
let nextId = 0;
const uuid = () => `90000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`;
const scopes = ['Chat.Create', 'ChatMessage.Send', 'offline_access'];
const ciphertext = 'v1.' + 'ciphertext-only-for-local-fixture-'.repeat(3);
const tomorrow = () => new Date(Date.now() + 86400000).toISOString();
let assertions = 0;
const pass = name => { assertions++; console.log(`PASS: ${name}`); };

async function fixture(db, beforeMigration = '') {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
    create table auth.identities(id uuid primary key default gen_random_uuid(), user_id uuid, provider text, identity_data jsonb);
    create table public.profiles(id uuid primary key, display_name text, full_name text, teams_webhook_url text);
    create view public.profiles_public as select id, display_name, full_name from public.profiles;
    grant select on public.profiles_public to authenticated;
  `);
  await db.exec(read('migrations/00500_user_notifications.sql'));
  await db.exec(read('migrations/00600_user_notes.sql'));
  for (const uid of [A, B, C]) {
    await db.query('insert into auth.users values ($1,$2,$3)', [uid, `${uid}@example.invalid`, { custom_claims: { tid: TENANT, oid: OID[uid] }, iss: ISSUER }]);
    await db.query('insert into auth.identities(user_id, provider, identity_data) values ($1,\'azure\',$2)', [uid, { custom_claims: { tid: TENANT, oid: OID[uid] }, iss: ISSUER }]);
    await db.query('insert into public.profiles values ($1,$2,$3,$4)', [uid, 'Author', 'Local fixture', 'never-expose-webhook']);
  }
  await db.exec(beforeMigration);
  await db.exec('begin');
  await db.exec(read('migrations/01505_teams_delegated_mentions.sql'));
  await db.exec('commit');
}
async function admin(db) { await db.exec('reset role'); }
async function actor(db, id = A, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id || '']);
  await db.exec(`set role ${role}`);
}
async function rpc(db, name, args = []) {
  return (await db.query(`select * from public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args)).rows;
}
async function note(db, recipients = [B], body = 'Original mention body', owner = A) {
  await admin(db);
  const id = uuid();
  await db.query('insert into public.user_notes(id,user_id,body,mentioned_user_ids) values ($1,$2,$3,$4)', [id,owner,body,recipients]);
  await actor(db, owner);
  return id;
}
async function connect(db, expected = null) {
  const epoch=expected===null ? (await rpc(db,'uttu_teams_get_connection_epoch',[A]))[0].uttu_teams_get_connection_epoch : null;
  const rows = await rpc(db,'uttu_teams_put_connection',[A,ciphertext,scopes,tomorrow(),expected,epoch]);
  return rows[0].uttu_teams_put_connection;
}
async function prepare(db, noteId, author = A, sendRequested = true) {
  await admin(db);
  const snapshot=(await db.query('select body,mentioned_user_ids from public.user_notes where id=$1',[noteId])).rows[0];
  await actor(db,author);
  return rpc(db,'uttu_teams_prepare_mentions',[noteId,author,'Ignored forged title','https://evil.example',sendRequested,
    snapshot?.body ?? null,snapshot?.mentioned_user_ids ?? null]);
}
async function claim(db,noteId,recipient=B,claimId=uuid()) {
  return { claimId, rows: await rpc(db,'uttu_teams_claim_delivery',[noteId,A,recipient,claimId]) };
}
async function delivery(db,id) {
  await admin(db);
  const row = (await db.query('select * from public.user_teams_mention_deliveries where id=$1',[id])).rows[0];
  await actor(db);
  return row;
}
async function rejected(promise, pattern = /Not authorized|permission denied/i) {
  await assert.rejects(promise, pattern);
}

(async () => {
  const db = new PGlite();
  try {
    await fixture(db);
    const acl = (await db.query(`select bool_and(relrowsecurity) as rls from pg_class
      where oid in ('public.user_teams_connection_epochs'::regclass,'public.user_teams_connections'::regclass,'public.user_teams_mention_deliveries'::regclass)`)).rows[0];
    assert.equal(acl.rls,true);
    for(const role of ['anon','authenticated','service_role']) {
      for(const table of ['user_teams_connection_epochs','user_teams_connections','user_teams_mention_deliveries']) {
        assert.equal((await db.query(`select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') as ok`,[role,`public.${table}`])).rows[0].ok,false);
      }
    }
    await actor(db);
    await rejected(db.query('select * from public.user_teams_connections'));
    await rejected(rpc(db,'uttu_teams_verified_identity',[B]));
    await rejected(rpc(db,'uttu_teams_get_author_identity',[B]));
    await actor(db,null);
    await rejected(rpc(db,'uttu_teams_get_author_identity',[A]));
    await actor(db,A,'service_role');
    await rejected(rpc(db,'uttu_teams_get_author_identity',[A]));
    await actor(db,A,'anon');
    await rejected(rpc(db,'uttu_teams_get_author_identity',[A]));
    pass('RLS and effective ACLs deny all direct table access, helper execution, anonymous/service-role calls, and UID spoofing');

    await actor(db);
    const identity = await rpc(db,'uttu_teams_get_author_identity',[A]);
    assert.deepEqual(identity,[{tenant_id:TENANT,object_id:OID[A],issuer:ISSUER}]);
    for(const invalid of [
      {custom_claims:{tid:TENANT,oid:OID[A]},iss:ISSUER+'.evil'},
      {custom_claims:{tid:'00000000-0000-0000-0000-000000000000',oid:OID[A]},iss:ISSUER},
      {custom_claims:{tid:TENANT,oid:'malformed'},iss:ISSUER},
      {custom_claims:{tid:TENANT,oid:OID[A]}},
      {tid:TENANT,oid:OID[A],iss:ISSUER},
      {custom_claims:{tid:TENANT,oid:123},iss:ISSUER},
    ]) {
      await admin(db);
      await db.query('update auth.identities set identity_data=$1 where user_id=$2',[invalid,A]);
      await actor(db);
      assert.equal((await rpc(db,'uttu_teams_get_author_identity',[A])).length,0);
      await rejected(connect(db),/Verified Microsoft identity required/);
    }
    await admin(db);
    await db.query('update auth.identities set identity_data=$1 where user_id=$2',[{custom_claims:{tid:TENANT,oid:OID[A]},iss:ISSUER},A]);
    await db.query("insert into auth.identities(user_id,provider,identity_data) select user_id,provider,identity_data from auth.identities where user_id=$1",[A]);
    await actor(db);
    assert.equal((await rpc(db,'uttu_teams_get_author_identity',[A])).length,0);
    await admin(db);
    await db.query('delete from auth.identities where id=(select id from auth.identities where user_id=$1 limit 1)',[A]);
    await actor(db);
    pass('Azure identity uses only single Auth-owned identity custom claims and exact trusted tenant issuer; mutable metadata cannot substitute');

    const version1 = await connect(db);
    assert.ok(version1);
    assert.equal(await connect(db),null);
    assert.equal(await connect(db,uuid()),null);
    const version2 = await connect(db,version1);
    assert.ok(version2 && version2 !== version1);
    const connection = (await rpc(db,'uttu_teams_get_connection',[A]))[0];
    assert.equal(connection.token_ciphertext,ciphertext);
    assert.equal(connection.tenant_id,TENANT);
    assert.equal(connection.object_id,OID[A]);
    assert.equal(connection.version,version2);
    assert.equal(connection.consent_epoch,(await rpc(db,'uttu_teams_get_connection_epoch',[A]))[0].uttu_teams_get_connection_epoch);
    await admin(db);
    await rejected(db.query('update public.user_teams_connections set consent_epoch=$1 where user_id=$2',[uuid(),A]),/connection identity is immutable/);
    await actor(db);
    await rejected(rpc(db,'uttu_teams_get_connection',[B]));
    pass('Connection ciphertext is own-UID only; create/refresh CAS rejects stale versions and preserves immutable consent epoch');

    const n1 = await note(db,[A,B,B,C]);
    let rows = await prepare(db,n1);
    assert.equal(rows.length,2);
    assert.ok(rows.every(row=>row.title_snapshot==='Author님이 회원님을 멘션했습니다'));
    assert.ok(rows.every(row=>row.link_snapshot===`/me/notes/${n1}`));
    await prepare(db,n1);
    await admin(db);
    assert.equal((await db.query("select count(*)::int n from public.user_notifications where payload->>'note_id'=$1",[n1])).rows[0].n,2);
    assert.equal((await db.query("select count(*)::int n from public.user_notifications where payload->>'note_id'=$1 and payload->>'teams_delivery'='delegated' and sent_to_teams_at is null",[n1])).rows[0].n,2);
    await db.query('update public.user_notes set body=$1 where id=$2',['Edited after snapshot',n1]);
    await actor(db);
    rows = await prepare(db,n1);
    assert.ok(rows.every(row=>row.body_snapshot==='Original mention body'));
    await actor(db,B);
    await rejected(prepare(db,n1,B));
    await rejected(rpc(db,'uttu_teams_get_recipient_identity',[n1,B,C]));
    await actor(db);
    await rejected(rpc(db,'uttu_teams_get_recipient_identity',[n1,A,A]));
    assert.equal((await rpc(db,'uttu_teams_get_recipient_identity',[n1,A,B]))[0].object_id,OID[B]);
    pass('Prepare deduplicates self/repeated recipients and request replay, freezes body, derives safe title/link, and enforces actual note author');

    const nLegacy = await note(db,[B]);
    await admin(db);
    for(let i=0;i<2;i++) await db.query("insert into public.user_notifications(user_id,event_type,title,payload) values ($1,'mention','legacy',$2)",[B,{note_id:nLegacy,author_id:A}]);
    await actor(db);
    await prepare(db,nLegacy);
    await prepare(db,nLegacy);
    await admin(db);
    assert.equal((await db.query("select count(*)::int n from public.user_notifications where payload->>'note_id'=$1",[nLegacy])).rows[0].n,2);
    assert.equal((await db.query("select count(*)::int n from public.user_notifications where payload->>'note_id'=$1 and payload->>'teams_delivery'='delegated'",[nLegacy])).rows[0].n,2);
    await actor(db);
    pass('Historical duplicate inbox rows do not break migration/prepare and are not multiplied or falsely marked sent');


    const nUnchecked=await note(db);
    const dUnchecked=(await prepare(db,nUnchecked,A,false))[0];
    assert.equal(dUnchecked.status,'skipped');
    assert.equal(dUnchecked.error_code,'author_did_not_request');
    assert.equal((await prepare(db,nUnchecked,A,true))[0].status,'skipped');
    assert.equal((await claim(db,nUnchecked)).rows.length,0);
    const nDefault=await note(db);
    assert.equal((await rpc(db,'uttu_teams_prepare_mentions',[nDefault,A]))[0].error_code,'author_did_not_request');
    const nOld=await note(db);
    await admin(db); await db.query("update public.user_notes set created_at=now()-interval '6 minutes' where id=$1",[nOld]); await actor(db);
    assert.equal((await prepare(db,nOld))[0].error_code,'submission_expired');
    const nMany=await note(db,[B,...Array.from({length:10},uuid)]);
    assert.equal((await prepare(db,nMany))[0].error_code,'too_many_recipients');
    pass('Unchecked/default-false, expired, and over-limit submissions keep inbox-only terminal rows that replay cannot upgrade');


    const nAtomicReview=await note(db);
    for(const [body,recipients] of [[null,[B]],['Original mention body',null],['Different reviewed text',[B]],['Original mention body',[C]],['Original mention body',[B,null]]]) {
      await rejected(rpc(db,'uttu_teams_prepare_mentions',[nAtomicReview,A,null,null,true,body,recipients]),/submission does not match note/);
    }
    assert.equal((await rpc(db,'uttu_teams_get_delivery_status',[nAtomicReview,A])).length,0);
    await rpc(db,'uttu_teams_prepare_mentions',[nAtomicReview,A,null,null,true,'Original mention body',[B,B,A]]);
    assert.equal((await rpc(db,'uttu_teams_get_delivery_status',[nAtomicReview,A])).length,1);
    await actor(db,B);
    await rejected(rpc(db,'uttu_teams_get_delivery_status',[nAtomicReview,A]));
    assert.equal((await rpc(db,'uttu_teams_get_delivery_status',[nAtomicReview,B])).length,0);
    await actor(db);
    pass('Prepare atomically checks reviewed body and normalized recipients; status reconciliation is read-only and owner-bound');

    const nEdited=await note(db); const dEdited=(await prepare(db,nEdited))[0];
    await admin(db); await db.query('update public.user_notes set body=$1 where id=$2',['New body',nEdited]); await actor(db);
    assert.equal((await claim(db,nEdited)).rows.length,0);
    assert.equal((await delivery(db,dEdited.id)).error_code,'mention_changed_or_expired');
    const nEditAfterClaim=await note(db); const dEditAfterClaim=(await prepare(db,nEditAfterClaim))[0]; const cEditAfterClaim=await claim(db,nEditAfterClaim);
    await admin(db); await db.query('update public.user_notes set body=$1 where id=$2',['New body',nEditAfterClaim]); await actor(db);
    assert.equal((await rpc(db,'uttu_teams_begin_send',[dEditAfterClaim.id,A,cEditAfterClaim.claimId]))[0].uttu_teams_begin_send,false);
    pass('Body changes before claim or between claim/begin-send cannot send a stale or unsnapshotted body');

    for (const status of ['failed','unknown','skipped','reconnect_required','throttled']) {
      const nTerminal=await note(db); const dTerminal=(await prepare(db,nTerminal))[0]; const cTerminal=await claim(db,nTerminal);
      if(status==='unknown') await rpc(db,'uttu_teams_begin_send',[dTerminal.id,A,cTerminal.claimId]);
      assert.equal((await rpc(db,'uttu_teams_finish_delivery',[dTerminal.id,A,cTerminal.claimId,status,'safe_error_code',null,null,null]))[0].uttu_teams_finish_delivery,true);
      assert.equal((await claim(db,nTerminal)).rows.length,0);
      await prepare(db,nTerminal);
      assert.equal((await delivery(db,dTerminal.id)).status,status);
      await admin(db);
      assert.equal((await db.query('select sent_to_teams_at from public.user_notifications where id=$1',[dTerminal.notification_id])).rows[0].sent_to_teams_at,null);
      await actor(db);
    }
    pass('Failed, unknown, skipped, reconnect-required, and throttled states never replay or falsely stamp inbox delivery');

    const nRemoved=await note(db); const dRemoved=(await prepare(db,nRemoved))[0];
    await admin(db); await db.query("update public.user_notes set mentioned_user_ids='{}' where id=$1",[nRemoved]); await actor(db);
    assert.equal((await claim(db,nRemoved)).rows.length,0);
    assert.equal((await delivery(db,dRemoved.id)).status,'skipped');
    await rejected(rpc(db,'uttu_teams_get_recipient_identity',[nRemoved,A,B]));
    pass('Current mention membership is rechecked at identity lookup and claim');

    const nDisabled=await note(db); const dDisabled=(await prepare(db,nDisabled))[0];
    await admin(db); await db.query("update public.user_notification_subscriptions set enabled=false where user_id=$1 and event_type='mention' and channel='teams'",[B]); await actor(db);
    assert.equal((await claim(db,nDisabled)).rows.length,0);
    assert.equal((await delivery(db,dDisabled.id)).error_code,'recipient_opted_out');
    await admin(db); await db.query("update public.user_notification_subscriptions set enabled=true where user_id=$1 and event_type='mention' and channel='teams'",[B]); await actor(db);
    pass('Explicit recipient Teams opt-out prevents delivery');


    const nLateOptOut=await note(db); const dLateOptOut=(await prepare(db,nLateOptOut))[0]; const cLateOptOut=await claim(db,nLateOptOut);
    await admin(db); await db.query("update public.user_notification_subscriptions set enabled=false where user_id=$1 and event_type='mention' and channel='teams'",[B]); await actor(db);
    assert.equal((await rpc(db,'uttu_teams_begin_send',[dLateOptOut.id,A,cLateOptOut.claimId]))[0].uttu_teams_begin_send,false);
    await admin(db); await db.query("update public.user_notification_subscriptions set enabled=true where user_id=$1 and event_type='mention' and channel='teams'",[B]); await actor(db);
    pass('Recipient opt-out occurring after claim is rechecked at begin-send');

    const nRace=await note(db); const dRace=(await prepare(db,nRace))[0];
    const contenders=await Promise.all([claim(db,nRace),claim(db,nRace),claim(db,nRace)]);
    assert.deepEqual(contenders.map(c=>c.rows.length).sort(),[0,0,1]);
    const winner=contenders.find(c=>c.rows.length===1);
    const wrong=uuid();
    assert.equal((await rpc(db,'uttu_teams_begin_send',[dRace.id,A,wrong]))[0].uttu_teams_begin_send,false);
    assert.equal((await rpc(db,'uttu_teams_begin_send',[dRace.id,A,winner.claimId]))[0].uttu_teams_begin_send,true);
    assert.equal((await rpc(db,'uttu_teams_begin_send',[dRace.id,A,winner.claimId]))[0].uttu_teams_begin_send,false);
    await rejected(rpc(db,'uttu_teams_finish_delivery',[dRace.id,A,winner.claimId,'sent',null,null,null,null]),/Confirmed send response required/);
    assert.equal((await rpc(db,'uttu_teams_finish_delivery',[dRace.id,A,winner.claimId,'sent',null,'msg-123','chat-123',null]))[0].uttu_teams_finish_delivery,true);
    assert.equal((await claim(db,nRace)).rows.length,0);
    assert.equal((await rpc(db,'uttu_teams_finish_delivery',[dRace.id,A,winner.claimId,'failed',null,null,null,null]))[0].uttu_teams_finish_delivery,false);
    await admin(db);
    assert.ok((await db.query('select sent_to_teams_at from public.user_notifications where id=$1',[dRace.notification_id])).rows[0].sent_to_teams_at);
    await actor(db);
    pass('Competing/replayed claims yield one winner; begin-send CAS yields one POST authorization; confirmed sent is terminal');


    const nLongIds=await note(db); const dLongIds=(await prepare(db,nLongIds))[0]; const cLongIds=await claim(db,nLongIds);
    await rpc(db,'uttu_teams_begin_send',[dLongIds.id,A,cLongIds.claimId]);
    await rejected(rpc(db,'uttu_teams_finish_delivery',[dLongIds.id,A,cLongIds.claimId,'sent',null,'m'.repeat(1025),'chat',null]),/Invalid delivery result/);
    assert.equal((await rpc(db,'uttu_teams_finish_delivery',[dLongIds.id,A,cLongIds.claimId,'sent',null,'m'.repeat(1024),'c'.repeat(1024),null]))[0].uttu_teams_finish_delivery,true);
    assert.equal((await delivery(db,dLongIds.id)).message_id.length,1024);
    pass('Graph transport and durable completion agree on 1024-character message/chat ID bounds');


    await admin(db);
    await db.query('delete from public.user_notes where id=$1',[nRace]);
    assert.equal((await db.query('select status from public.user_teams_mention_deliveries where id=$1',[dRace.id])).rows[0].status,'sent');
    await db.query('insert into public.user_notes(id,user_id,body,mentioned_user_ids) values ($1,$2,$3,$4)',[nRace,A,'Original mention body',[B]]);
    await actor(db);
    assert.equal((await prepare(db,nRace))[0].status,'sent');
    assert.equal((await claim(db,nRace)).rows.length,0);
    pass('Deleting/recreating a note UUID cannot erase durable dedup or authorize a second message');

    const nLease=await note(db); const dLease=(await prepare(db,nLease))[0];
    const stale=await claim(db,nLease);
    await admin(db); await db.query("update public.user_teams_mention_deliveries set lease_expires_at=now()-interval '1 second' where id=$1",[dLease.id]); await actor(db);
    const fresh=await claim(db,nLease);
    assert.equal(fresh.rows.length,1);
    assert.equal((await rpc(db,'uttu_teams_begin_send',[dLease.id,A,stale.claimId]))[0].uttu_teams_begin_send,false);
    assert.equal((await rpc(db,'uttu_teams_begin_send',[dLease.id,A,fresh.claimId]))[0].uttu_teams_begin_send,true);
    await admin(db); await db.query("update public.user_teams_mention_deliveries set lease_expires_at=now()-interval '1 second' where id=$1",[dLease.id]); await actor(db);
    assert.equal((await claim(db,nLease)).rows.length,0);
    assert.equal((await delivery(db,dLease.id)).status,'unknown');
    assert.equal((await claim(db,nLease)).rows.length,0);
    assert.equal((await rpc(db,'uttu_teams_finish_delivery',[dLease.id,A,fresh.claimId,'failed',null,null,null,null]))[0].uttu_teams_finish_delivery,false);
    pass('Only a pre-send expired lease can be reclaimed; a possible POST becomes unknown and never auto-retries');

    const nMutation=await note(db); const dMutation=(await prepare(db,nMutation))[0]; const cMutation=await claim(db,nMutation);
    await admin(db); await db.query("update public.user_notes set mentioned_user_ids='{}' where id=$1",[nMutation]); await actor(db);
    assert.equal((await rpc(db,'uttu_teams_begin_send',[dMutation.id,A,cMutation.claimId]))[0].uttu_teams_begin_send,false);
    assert.equal((await delivery(db,dMutation.id)).status,'skipped');
    pass('Removal between claim and begin-send stops POST authorization');

    const nPending=await note(db); const dPending=(await prepare(db,nPending))[0];
    const nClaimed=await note(db); const dClaimed=(await prepare(db,nClaimed))[0]; const cClaimed=await claim(db,nClaimed);
    const nStarted=await note(db); const dStarted=(await prepare(db,nStarted))[0]; const cStarted=await claim(db,nStarted);
    await rpc(db,'uttu_teams_begin_send',[dStarted.id,A,cStarted.claimId]);
    await rpc(db,'uttu_teams_disconnect',[A]);
    assert.equal((await rpc(db,'uttu_teams_get_connection',[A])).length,0);
    assert.equal(await connect(db,version2),null);
    assert.equal((await delivery(db,dPending.id)).status,'skipped');
    assert.equal((await delivery(db,dClaimed.id)).status,'skipped');
    assert.equal((await delivery(db,dStarted.id)).status,'claimed');
    assert.equal((await delivery(db,dRace.id)).status,'sent');
    assert.equal((await delivery(db,dLease.id)).status,'unknown');
    assert.equal((await rpc(db,'uttu_teams_begin_send',[dClaimed.id,A,cClaimed.claimId]))[0].uttu_teams_begin_send,false);
    pass('Disconnect atomically deletes grant and cancels only unsent work; stale refresh cannot resurrect grant; sent/in-flight/unknown stay intact');


    const oldEpoch=(await rpc(db,'uttu_teams_get_connection_epoch',[A]))[0].uttu_teams_get_connection_epoch;
    await rpc(db,'uttu_teams_disconnect',[A]);
    const newEpoch=(await rpc(db,'uttu_teams_get_connection_epoch',[A]))[0].uttu_teams_get_connection_epoch;
    assert.notEqual(newEpoch,oldEpoch);
    assert.equal((await rpc(db,'uttu_teams_put_connection',[A,ciphertext,scopes,tomorrow(),null,oldEpoch]))[0].uttu_teams_put_connection,null);
    assert.equal((await rpc(db,'uttu_teams_put_connection',[A,ciphertext,scopes,tomorrow(),null,null]))[0].uttu_teams_put_connection,null);
    assert.equal((await rpc(db,'uttu_teams_get_connection',[A])).length,0);
    await actor(db,B);
    await rejected(rpc(db,'uttu_teams_get_connection_epoch',[A]));
    await actor(db);
    pass('Disconnect rotates a durable epoch even with no grant; pending initial callback and missing-epoch creation fail closed');

    await connect(db);
    const nChanged=await note(db); const dChanged=(await prepare(db,nChanged))[0];
    await admin(db);
    await db.query('update auth.identities set identity_data=$1 where user_id=$2',[{custom_claims:{tid:TENANT,oid:OID[C]},iss:ISSUER},A]);
    await actor(db);
    const staleConnection=(await rpc(db,'uttu_teams_get_connection',[A]))[0];
    assert.equal(staleConnection.object_id,OID[A]);
    assert.equal(staleConnection.token_ciphertext,ciphertext);
    assert.equal((await rpc(db,'uttu_teams_get_author_identity',[A]))[0].object_id,OID[C]);
    assert.equal((await claim(db,nChanged)).rows.length,0);
    assert.equal((await delivery(db,dChanged.id)).status,'reconnect_required');
    pass('Changed identity cannot claim an old grant, but its owner can still discover ciphertext for disconnect');

    await admin(db);
    await db.query("update auth.identities set provider='email' where user_id=$1",[A]);
    await actor(db);
    assert.equal((await rpc(db,'uttu_teams_get_author_identity',[A])).length,0);
    assert.equal((await rpc(db,'uttu_teams_get_connection',[A]))[0].token_ciphertext,ciphertext);
    await actor(db,B);
    await rejected(rpc(db,'uttu_teams_get_connection',[A]));
    await actor(db);
    await rpc(db,'uttu_teams_disconnect',[A]);
    assert.equal((await rpc(db,'uttu_teams_get_connection',[A])).length,0);
    pass('Missing Azure identity fails verification while own grant remains discoverable and disconnectable with cross-actor access denied');

    await admin(db);
    await db.query("update auth.identities set provider='azure', identity_data=$1 where user_id=$2",[{custom_claims:{tid:TENANT,oid:OID[A]},iss:ISSUER},A]);
    await actor(db);
    await connect(db);
    const nRecipientChanged=await note(db); const dRecipientChanged=(await prepare(db,nRecipientChanged))[0]; const cRecipientChanged=await claim(db,nRecipientChanged);
    await admin(db); await db.query('update auth.identities set identity_data=$1 where user_id=$2',[{custom_claims:{tid:TENANT,oid:OID[C]},iss:ISSUER},B]); await actor(db);
    assert.equal((await rpc(db,'uttu_teams_begin_send',[dRecipientChanged.id,A,cRecipientChanged.claimId]))[0].uttu_teams_begin_send,false);
    await admin(db); await db.query('update auth.identities set identity_data=$1 where user_id=$2',[{custom_claims:{tid:TENANT,oid:OID[B]},iss:ISSUER},B]); await actor(db);
    pass('Recipient identity is revalidated between claim and the irreversible message boundary');

    await admin(db);
    await rejected(db.query('update public.user_teams_mention_deliveries set body_snapshot=$1 where id=$2',['Mutated',dRace.id]),/snapshot is immutable/);
    const notesBefore=(await db.query('select count(*)::int n from public.user_notes')).rows[0].n;
    const notificationsBefore=(await db.query('select count(*)::int n from public.user_notifications')).rows[0].n;
    await db.exec(read('rollbacks/01505_teams_delegated_mentions.sql'));
    assert.equal((await db.query('select count(*)::int n from public.user_notes')).rows[0].n,notesBefore);
    assert.equal((await db.query('select count(*)::int n from public.user_notifications')).rows[0].n,notificationsBefore);
    assert.equal((await db.query("select to_regclass('public.user_teams_connections') as t")).rows[0].t,null);
    assert.equal((await db.query("select count(*)::int n from pg_proc where proname like 'uttu_teams_%'")).rows[0].n,0);
    pass('Snapshot mutation is blocked and rollback removes only owned Teams objects while preserving notes/inbox');

  } finally { await db.close(); }
  for (const [name, setup, expected] of [
    ['inherited table SELECT', `create role inherited_reader; grant inherited_reader to authenticated;
      alter default privileges in schema public grant select on tables to inherited_reader;`, /retains direct table access/],
    ['inherited private helper EXECUTE', `create role inherited_caller; grant inherited_caller to authenticated;
      alter default privileges in schema public grant execute on functions to inherited_caller;`, /client can execute a private helper/],
    ['inherited anonymous EXECUTE', `create role inherited_anon; grant inherited_anon to anon;
      alter default privileges in schema public grant execute on functions to inherited_anon;`, /unexpected effective function access/],
  ]) {
    const bad = new PGlite();
    try {
      await assert.rejects(fixture(bad,setup),expected);
      await bad.exec('rollback');
      assert.equal((await bad.query("select to_regclass('public.user_teams_connections') as t")).rows[0].t,null);
      pass(`Privilege preflight rejects ${name} and transaction rollback restores absent Teams schema`);
    } finally { await bad.close(); }
  }
  console.log(`All ${assertions} local PostgreSQL Teams contract groups passed`);
})().catch(error=>{ console.error(error); process.exitCode=1; });
