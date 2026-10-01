'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.UTTU_PGLITE_MODULE||'@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('migrations/01506_notification_dispatch_edge.sql'),rollback=read('rollbacks/01506_notification_dispatch_edge.sql');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
let tests=0;const pass=s=>{tests++;console.log('PASS: '+s)};
async function rootRole(db){await db.exec('reset role');}
async function service(db){await db.exec(`set role service_role;select set_config('request.jwt.claim.role','service_role',false);`);}
async function rpc(db,name,args=[]){return(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).rows[0]?.result;}
async function claims(db,channels=['teams','telegram'],limit=20){return(await db.query('select * from public.uttu_dispatch_claim($1,$2)',[channels,limit])).rows;}
async function notification(db,user=A,event='anomaly_high',teams=null,tg=null){await rootRole(db);return(await db.query(`insert into public.user_notifications(user_id,event_type,title,body,link,sent_to_teams_at,sent_to_telegram_at) values($1,$2,'Title','Body','/today',$3,$4) returning id`,[user,event,teams,tg])).rows[0].id;}
async function state(db,id){await rootRole(db);return(await db.query('select * from public.user_notification_dispatch_deliveries where notification_id=$1 order by channel',[id])).rows;}
async function legacy(db,id){await rootRole(db);return(await db.query('select sent_to_teams_at,sent_to_telegram_at from public.user_notifications where id=$1',[id])).rows[0];}
async function fixture(db,before=''){
 await db.exec(`create role anon;create role authenticated;create role service_role;create role supabase_auth_admin;create schema auth;
 grant usage on schema public,auth to anon,authenticated,service_role;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
 create table public.profiles(id uuid primary key,role text not null default 'viewer',full_name text,teams_webhook_url text,telegram_chat_id text);
 `);
 await db.exec(read('migrations/00500_user_notifications.sql'));
 await db.query('insert into auth.users values($1,$2,$3),($4,$5,$6)',[A,'a@example.invalid',{},B,'b@example.invalid',{}]);
 await db.query(`insert into public.profiles values($1,'admin','Admin','https://tenant.webhook.office.com/fixture','123'),($2,'viewer','Viewer','https://tenant.webhook.office.com/fixture','456')`,[A,B]);
 await db.exec(`update public.user_notification_subscriptions set enabled=true;
 insert into public.user_notification_subscriptions(user_id,event_type,channel,enabled) values('${A}','anomaly_high','telegram',true),('${A}','mention','telegram',true),('${B}','anomaly_high','telegram',true);`);
 await db.exec(before);await db.exec('begin');await db.exec(migration);await db.exec('commit');
}
async function enable(db){await rootRole(db);await db.exec("update public.user_notification_dispatch_control set legacy_stopped_at=coalesce(legacy_stopped_at,clock_timestamp()),enabled=true");}
async function begin(db,c){await service(db);return rpc(db,'uttu_dispatch_begin',[c.notification_id,c.channel,c.claim_id]);}
async function finish(db,c,status='accepted',message=null){await service(db);return rpc(db,'uttu_dispatch_finish',[c.notification_id,c.channel,c.claim_id,status,null,message,null]);}
(async()=>{
 const db=new PGlite();try{
 await fixture(db);const oldId=await notification(db);await service(db);assert.deepEqual(await claims(db),[]);assert.deepEqual(await state(db,oldId),[]);pass('installation disabled with untouched backlog');
 for(const r of ['anon','authenticated','service_role'])for(const t of ['user_notification_dispatch_deliveries','user_notification_dispatch_control'])assert.equal((await db.query(`select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') ok`,[r,'public.'+t])).rows[0].ok,false);
 for(const role of ['anon','authenticated']){await db.exec(`set role ${role};select set_config('request.jwt.claim.role','service_role',false)`);await assert.rejects(claims(db));await rootRole(db);}
 await service(db);await db.exec("select set_config('request.jwt.claim.role','authenticated',false)");await assert.rejects(claims(db));await rootRole(db);pass('RLS/effective ACLs and service-claim guard protect queue and private targets');
 await enable(db);const id=await notification(db);await service(db);const batch=await claims(db);assert.equal(batch.length,2);assert.equal(new Set(batch.map(c=>c.channel)).size,2);assert.equal((await claims(db)).length,0);pass('atomic per-channel claim prevents a duplicate concurrent batch');
 const team=batch.find(c=>c.channel==='teams');const tg=batch.find(c=>c.channel==='telegram');
 assert.equal(await finish(db,team),false);const body=await begin(db,team);assert.equal(body.target,'https://tenant.webhook.office.com/fixture');assert.equal(await begin(db,team),null);assert.equal(await finish(db,team),true);assert.equal(await finish(db,team),false);
 let stamp=await legacy(db,id);assert(stamp.sent_to_teams_at);assert.equal(stamp.sent_to_telegram_at,null);pass('confirmed begin/acceptance marks only its channel once');
 await begin(db,tg);await assert.rejects(finish(db,tg,'accepted'));assert.equal(await finish(db,tg,'accepted','77'),true);assert((await legacy(db,id)).sent_to_telegram_at);pass('Telegram acceptance requires a provider message id');
 const mention=await notification(db,A,'mention');await service(db);const mentions=await claims(db);assert.equal(mentions.length,1);assert.equal(mentions[0].channel,'telegram');assert.equal(mentions[0].notification_id,mention);await begin(db,mentions[0]);await finish(db,mentions[0],'failed');assert.equal((await legacy(db,mention)).sent_to_teams_at,null);pass('Teams mentions never enter dispatcher; existing administrator Telegram mention flow remains');
 const viewer=await notification(db,B);await service(db);let rows=await claims(db);const vt=rows.find(x=>x.notification_id===viewer&&x.channel==='telegram');assert.equal(await begin(db,vt),null);assert.equal((await state(db,viewer)).find(x=>x.channel==='telegram').status,'skipped');assert.equal((await legacy(db,viewer)).sent_to_telegram_at,null);pass('viewer Telegram target is skipped without fake sent timestamp');
 const vteam=rows.find(x=>x.notification_id===viewer&&x.channel==='teams');await rootRole(db);await db.query("update public.user_notification_subscriptions set enabled=false where user_id=$1 and event_type='anomaly_high' and channel='teams'",[B]);assert.equal(await begin(db,vteam),null);assert.equal((await state(db,viewer)).find(x=>x.channel==='teams').status,'skipped');pass('subscription changes after claim are rechecked before sending');
 const lease=await notification(db);await service(db);rows=await claims(db,['teams']);const first=rows.find(x=>x.notification_id===lease);await rootRole(db);await db.query("update public.user_notification_dispatch_deliveries set lease_expires_at=now()-interval '1 second' where notification_id=$1",[lease]);await service(db);const second=(await claims(db,['teams'])).find(x=>x.notification_id===lease);assert.notEqual(first.claim_id,second.claim_id);assert.equal(await begin(db,first),null);assert(await begin(db,second));await rootRole(db);await db.query("update public.user_notification_dispatch_deliveries set lease_expires_at=now()-interval '1 second' where notification_id=$1",[lease]);await service(db);assert(!(await claims(db,['teams'])).some(x=>x.notification_id===lease));assert.equal((await state(db,lease))[0].status,'unknown');assert.equal((await legacy(db,lease)).sent_to_teams_at,null);assert.equal(await finish(db,first),false);assert.equal(await finish(db,second),true);pass('expired unattempted lease reclaims; attempted lease becomes unknown and never resends; exact late acceptance may resolve');
 const failed=await notification(db);await service(db);const failedClaim=(await claims(db,['teams'])).find(x=>x.notification_id===failed);await begin(db,failedClaim);await finish(db,failedClaim,'failed');assert.equal((await legacy(db,failed)).sent_to_teams_at,null);await service(db);assert(!(await claims(db,['teams'])).some(x=>x.notification_id===failed));pass('definite failure is honest terminal state, without silent replay or queue starvation');
 const paused=await notification(db);await service(db);const pauseClaim=(await claims(db,['teams'])).find(x=>x.notification_id===paused);await rootRole(db);await db.exec('update public.user_notification_dispatch_control set enabled=false');assert.equal(await begin(db,pauseClaim),null);await service(db);assert.equal(await rpc(db,'uttu_dispatch_release',[paused,'teams',pauseClaim.claim_id]),true);assert.equal(await rpc(db,'uttu_dispatch_release',[lease,'teams',second.claim_id]),false);pass('kill switch stops new sends; release cannot reopen attempted work');
 await enable(db);const historic=await notification(db,A,'anomaly_high','2020-01-01','2020-01-01');await service(db);rows=await claims(db);assert(!rows.some(x=>x.notification_id===historic));pass('historical processed markers preserved without replay');
 const marked=await notification(db);await service(db);const markedClaim=(await claims(db,['teams'])).find(x=>x.notification_id===marked);await rootRole(db);await db.query('update public.user_notifications set sent_to_teams_at=now() where id=$1',[marked]);assert.equal(await begin(db,markedClaim),null);assert.equal((await state(db,marked))[0].error_code,'legacy_processed_before_attempt');pass('legacy completion between claim and send prevents a second attempt');
 await rootRole(db);await assert.rejects(db.exec('begin;'+rollback));await db.exec('rollback');assert.equal((await db.query('select count(*) count from public.user_notifications')).rows[0].count,9);pass('rollback refuses to erase used delivery history and preserves inbox');
 await service(db);for(const args of [[['teams'],0],[['teams'],26],[['unknown'],20],[[null],20],[[],20]])await assert.rejects(claims(db,...args));pass('batch/channel limits fail closed');
 }finally{await db.close();}
 const cutoffDb=new PGlite();try{
 await fixture(cutoffDb);
 await cutoffDb.exec(`insert into public.user_notifications(user_id,event_type,title,body,created_at) select '${A}','anomaly_high','Old title','Old body',now()-interval '1 day' from generate_series(1,12631);
 insert into public.user_notifications(user_id,event_type,title,body,created_at) values('${A}','mention','Old mention','Old body',now()-interval '1 day');`);
 const prior=(await cutoffDb.query(`select count(*) total,count(*) filter(where event_type<>'mention') teams,count(*) filter(where sent_to_teams_at is not null or sent_to_telegram_at is not null) marked from public.user_notifications`)).rows[0];
 assert.deepEqual(prior,{total:12632,teams:12631,marked:0});
 await assert.rejects(cutoffDb.exec('update public.user_notification_dispatch_control set enabled=true'));
 await assert.rejects(cutoffDb.exec("update public.user_notification_dispatch_control set enabled=true,legacy_stopped_at=now()+interval '1 day'"));
 await assert.rejects(cutoffDb.exec("update public.user_notification_dispatch_control set dispatch_created_after=now()-interval '1 day'"));
 pass('activation requires shutdown proof; supplied past/future cutoffs are rejected');
 await enable(cutoffDb);const control=(await cutoffDb.query('select * from public.user_notification_dispatch_control')).rows[0];assert(control.dispatch_created_after);assert(control.dispatch_created_after>=control.legacy_stopped_at);
 await service(cutoffDb);assert.deepEqual(await claims(cutoffDb),[]);await rootRole(cutoffDb);
 assert.equal((await cutoffDb.query('select count(*) total from public.user_notification_dispatch_deliveries')).rows[0].total,0);
 assert.deepEqual((await cutoffDb.query(`select count(*) total,count(*) filter(where event_type<>'mention') teams,count(*) filter(where sent_to_teams_at is not null or sent_to_telegram_at is not null) marked from public.user_notifications`)).rows[0],prior);
 pass('12,631 old Teams and 12,632 old Telegram rows remain untouched and never enter the new queue');
 const before=await notification(cutoffDb),equal=await notification(cutoffDb),after=await notification(cutoffDb);
 await cutoffDb.query(`update public.user_notifications set created_at=(select dispatch_created_after from public.user_notification_dispatch_control)-interval '1 microsecond' where id=$1`,[before]);
 await cutoffDb.query(`update public.user_notifications set created_at=(select dispatch_created_after from public.user_notification_dispatch_control) where id=$1`,[equal]);
 await service(cutoffDb);let boundary=await claims(cutoffDb);assert.equal(boundary.length,4);assert(!boundary.some(c=>c.notification_id===before));assert(boundary.some(c=>c.notification_id===equal));assert(boundary.some(c=>c.notification_id===after));
 pass('cutover microsecond boundary excludes earlier rows and accepts equal/later creation');
 await rootRole(cutoffDb);for(const expression of ["dispatch_created_after=null","dispatch_created_after=dispatch_created_after-interval '1 day'","dispatch_created_after=dispatch_created_after+interval '1 day'","legacy_stopped_at=legacy_stopped_at-interval '1 day'"])await assert.rejects(cutoffDb.exec('update public.user_notification_dispatch_control set '+expression));
 await cutoffDb.exec('update public.user_notification_dispatch_control set enabled=false');const paused=await notification(cutoffDb);await enable(cutoffDb);
 assert.deepEqual((await cutoffDb.query('select dispatch_created_after from public.user_notification_dispatch_control')).rows[0].dispatch_created_after,control.dispatch_created_after);
 await service(cutoffDb);assert((await claims(cutoffDb,['teams'])).some(c=>c.notification_id===paused));
 pass('cutoff and stop proof are immutable; pause/resume preserves eligible post-cutover notifications');
 await rootRole(cutoffDb);await cutoffDb.query(`insert into public.user_notification_dispatch_deliveries(notification_id,channel) values($1,'teams')`,[before]);await service(cutoffDb);assert(!(await claims(cutoffDb,['teams'])).some(c=>c.notification_id===before));
 const claimed=boundary.find(c=>c.notification_id===equal&&c.channel==='teams');await rootRole(cutoffDb);await cutoffDb.query(`update public.user_notifications set created_at=(select dispatch_created_after from public.user_notification_dispatch_control)-interval '1 microsecond' where id=$1`,[equal]);assert.equal(await begin(cutoffDb,claimed),null);assert.equal((await state(cutoffDb,equal)).find(c=>c.channel==='teams').error_code,'before_dispatch_cutover');assert.equal((await legacy(cutoffDb,equal)).sent_to_teams_at,null);
 pass('pending ledger and pre-send recheck cannot bypass historical cutoff');
 await rootRole(cutoffDb);const status=(await cutoffDb.exec(read('operations/01506_notification_dispatch_status.sql'))).filter(r=>r.fields?.length).flatMap(r=>r.rows);assert(status.some(r=>r.category==='control'&&r.status==='cutoff'));assert(status.some(r=>r.category==='excluded_history'&&r.channel==='teams'&&r.item_count===12631));
 pass('single-resultset operations counts distinguish excluded history from eligible backlog');
 }finally{await cutoffDb.close();}
 const empty=new PGlite();try{await fixture(empty);await empty.exec('begin;'+rollback+'commit;');assert.equal((await empty.query("select to_regclass('public.user_notification_dispatch_deliveries') as table_name")).rows[0].table_name,null);pass('unused disabled schema rollback is exact');}finally{await empty.close();}
 for(const [label,setup] of [['inherited table grant',`create role inherited_dispatch;grant inherited_dispatch to service_role;alter default privileges in schema public grant select on tables to inherited_dispatch;`],['inherited public execute',`create role inherited_dispatch;grant inherited_dispatch to authenticated;alter default privileges in schema public grant execute on functions to inherited_dispatch;`]]){const db=new PGlite();try{await assert.rejects(fixture(db,setup));await db.exec('rollback');assert.equal((await db.query("select to_regclass('public.user_notification_dispatch_deliveries') as table_name")).rows[0].table_name,null);pass('preflight rejects '+label+' atomically');}finally{await db.close();}}
 console.log(`All ${tests} local PostgreSQL dispatch contract groups passed`);
})().catch(e=>{console.error(e);process.exitCode=1});
