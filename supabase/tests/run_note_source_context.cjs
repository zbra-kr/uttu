// Disposable PostgreSQL/PGlite only; synthetic users, no hosted database or sends.
const {PGlite}=require(process.env.UTTU_PGLITE_MODULE || '@electric-sql/pglite');
const fs=require('node:fs'); const path=require('node:path'); const assert=require('node:assert/strict');
(async()=>{const db=new PGlite();try{
 await db.exec(`create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/00600_user_notes.sql'),'utf8'));
 await db.exec('grant usage on schema auth to authenticated; grant select,insert,update on public.user_notes to authenticated');
 const before=(await db.query(`select policyname,qual,with_check from pg_policies where tablename='user_notes' order by policyname`)).rows;
 await db.exec(`insert into auth.users values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222'),('33333333-3333-4333-8333-333333333333');insert into user_notes(id,user_id,body,mentioned_user_ids) values ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','old note',array['22222222-2222-4222-8222-222222222222']::uuid[]);`);
 await db.exec('begin');await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/01508_note_source_context.sql'),'utf8'));await db.exec('commit');
 assert.deepEqual((await db.query(`select policyname,qual,with_check from pg_policies where tablename='user_notes' order by policyname`)).rows,before);
 assert.equal((await db.query('select source_context from user_notes')).rows[0].source_context,null);
 const role=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated')};
 await role('11111111-1111-4111-8111-111111111111');await db.exec(`update user_notes set source_context='{"version":1,"kind":"ranking"}'`);
 await role('22222222-2222-4222-8222-222222222222'); assert.equal((await db.query('select * from user_notes')).rows.length,1);assert.equal((await db.query('update user_notes set body=\'no\' returning id')).rows.length,0);
 await role('33333333-3333-4333-8333-333333333333');assert.equal((await db.query('select * from user_notes')).rows.length,0);
 await role('11111111-1111-4111-8111-111111111111');for(const json of ['[]','"text"',JSON.stringify({huge:'x'.repeat(8192)})]){await assert.rejects(db.query('update user_notes set source_context=$1::jsonb',[json]),/check constraint/)}
 console.log('PASS migration: unchanged RLS, old-row null, own write, recipient read-only, unrelated denied, malformed/oversize rejected');
 }finally{await db.close()}})().catch(e=>{console.error(e);process.exit(1)});
