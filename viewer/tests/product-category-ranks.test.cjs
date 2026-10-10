const test = require('node:test'), assert = require('node:assert/strict');
const load = require('./helpers/load-source.cjs');
const row = (overrides = {}) => ({ musinsa_no: 123, store_code: 'musinsa', snapshot_date: '2026-10-05', category_code: '001', rank_position: 7, gender_filter: 'A', age_filter: 'AGE_BAND_ALL', ...overrides });
function reader(rows, fail) {
 const calls = []; const client = { from() { const call={filters:{},offset:0,end:0,select:''};calls.push(call);
 const q={select(s){call.select=s;return q;},eq(k,v){call.filters[k]=v;return q;},order(){return q;},limit(){return q;},range(a,b){call.offset=a;call.end=b;return q;},abortSignal(s){call.signal=s;return q;},then(resolve,reject){
 let data=rows.filter(r=>Object.entries(call.filters).every(([k,v])=>String(r[k])===String(v)));
 if(call.select==='snapshot_date')data=data.sort((a,b)=>b.snapshot_date.localeCompare(a.snapshot_date)).slice(0,1);
 else data=data.sort((a,b)=>a.rank_position-b.rank_position).slice(call.offset,call.end+1);
 return Promise.resolve({data,error:calls.length===fail?Error('SDK failure'):null}).then(resolve,reject);}};return q;}};
 const fn=load(process.env.CATEGORY_BASELINE ? 'src/lib/.category-baseline.ts' : 'src/lib/queries.ts',{'./supabase/client':{supabaseBrowser:()=>client}}).fetchProductCategoryRanks;return {fn,calls};
}
test('other-store latest and same-date segment cannot alter date, best rank or count',async()=>{
 const {fn,calls}=reader([row(),row({store_code:'beauty',snapshot_date:'2026-10-09',rank_position:1}),row({store_code:'kids',rank_position:2}),row({musinsa_no:456,rank_position:1})]);
 const r=await fn('123');assert.equal(r.snapshot_date,'2026-10-05');assert.equal(r.rows[0].best_rank,7);assert.equal(r.rows[0].combo_count,1);
 for(const c of calls){assert.equal(c.filters.store_code,'musinsa');assert.equal(c.filters.musinsa_no,123);}
});
test('same-date other-store duplicate segment does not inflate count or best rank',async()=>{
 const {fn}=reader([row(),row({store_code:'kids',rank_position:1})]);const r=await fn('123');assert.equal(r.rows[0].combo_count,1);assert.equal(r.rows[0].best_rank,7);
});
test('abort signal reaches both reads and prevents second dispatch after late first receipt',async()=>{
 const controller=new AbortController();const r=reader([row()]);await r.fn('123',controller.signal);assert.ok(r.calls.every(c=>c.signal===controller.signal));
 controller.abort();await assert.rejects(r.fn('123',controller.signal));
});
for(const phase of [1,2])test('SDK failure phase '+phase+' rejects instead of empty',async()=>{await assert.rejects(reader([row()],phase).fn('123'),/SDK failure/);});
for(const rank of [0,-1,null,1.5,'7'])test('invalid rank '+rank+' is never presented as valid',async()=>{await assert.rejects(reader([row({rank_position:rank})]).fn('123'),/Invalid category rank/);});
test('empty results and pagination have exact counts',async()=>{
 assert.deepEqual(await reader([]).fn('123'),{snapshot_date:'',rows:[]});
 const {fn,calls}=reader(Array.from({length:501},(_,i)=>row({category_code:String(i),rank_position:i+1})));assert.equal((await fn('123')).rows.length,501);assert.equal(calls.length,3);
});
test('malformed product and snapshot date fail closed',async()=>{for(const no of ['123abc','0','-1','9007199254740992']){const r=reader([]);await assert.rejects(r.fn(no));assert.equal(r.calls.length,0);}await assert.rejects(reader([row({snapshot_date:'2026-02-30'})]).fn('123'));});
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function storeFixture(){let authEvent,resolveUser;const reads=[];let unsub=0;
 const client={auth:{onAuthStateChange(fn){authEvent=fn;return{data:{subscription:{unsubscribe(){unsub++;}}}};},getUser(){return new Promise(resolve=>resolveUser=resolve);}}};
 const {createCategoryRanksStore}=load('src/lib/use-product-category-ranks.ts',{'@/lib/queries':{},'@/lib/supabase/client':{supabaseBrowser:()=>client}});
 const store=createCategoryRanksStore(client,(no,signal)=>new Promise((resolve,reject)=>reads.push({no,signal,resolve,reject})));
 return {store,reads,event:id=>authEvent('SIGNED_IN',id?{user:{id}}:null),initial:id=>resolveUser({data:{user:{id}}}),get unsub(){return unsub;}};
}
const receipt=name=>({snapshot_date:'2026-10-05',rows:[{category_code:name}]});
test('desktop/mobile share one read and retry, account change rejects late receipt',async()=>{
 const f=storeFixture(),a=f.store.subscribe('123',()=>{}),b=f.store.subscribe('123',()=>{});f.event('A');f.initial('old');await flush();assert.equal(f.reads.length,1);
 f.event('A');assert.equal(f.reads.length,1);f.event('B');assert.equal(f.reads[0].signal.aborted,true);assert.equal(f.reads.length,2);
 f.reads[0].resolve(receipt('A'));await flush();assert.equal(f.store.getSnapshot('123').status,'loading');
 f.reads[1].reject(Error('failed'));await flush();assert.equal(f.store.getSnapshot('123').status,'error');f.store.retry('123');f.store.retry('123');assert.equal(f.reads.length,3);
 f.reads[2].resolve(receipt('B'));await flush();assert.equal(f.store.getSnapshot('123').data.rows[0].category_code,'B');
 a();assert.equal(f.reads[2].signal.aborted,false);b();assert.equal(f.unsub,1);assert.equal(f.store.getSnapshot('123').data,null);
});
test('navigation, logout and unmount clear receipts even when transport ignores abort',async()=>{
 const f=storeFixture(),a=f.store.subscribe('123',()=>{});f.event('A');a();const b=f.store.subscribe('456',()=>{});f.event('B');f.reads[0].resolve(receipt('old'));await flush();assert.equal(f.store.getSnapshot('456').status,'loading');
 f.event(null);assert.equal(f.store.getSnapshot('456').status,'signedout');f.reads[1].resolve(receipt('late'));await flush();assert.equal(f.store.getSnapshot('456').data,null);b();assert.equal(f.unsub,2);
});
test('deadline becomes retryable error and ignores late response',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=storeFixture(),off=f.store.subscribe('123',()=>{});f.event('A');t.mock.timers.tick(15000);assert.equal(f.store.getSnapshot('123').status,'error');f.reads[0].resolve(receipt('late'));await flush();assert.equal(f.store.getSnapshot('123').data,null);f.store.retry('123');assert.equal(f.reads.length,2);off();
});
