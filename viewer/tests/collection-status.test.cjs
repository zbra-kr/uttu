const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./helpers/load-source.cjs');
const status = load('src/lib/collection-status.ts');
const ok = (count=0,data=[]) => ({count,data,error:null});
const failed = {count:0,data:[],error:{message:'unavailable'}};
const rejected = () => { throw new Error('offline'); };
function harness(responses) {
  const calls=[];
  const client={from(table){
    const ops=[]; calls.push({table,ops});
    assert.ok(responses.length, `Unexpected read ${table}`); const r=responses.shift();
    const query=new Proxy({}, {get(_,method){
      if(method==='then') return (resolve,reject)=>Promise.resolve().then(()=>{
        return typeof r==='function'?r():r;
      }).then(resolve,reject);
      return (...args)=>{ops.push([method,...args]);return query;};
    }}); return query;
  }};
  return {calls,client,queries:load('src/lib/queries.ts',{'./supabase/client':{supabaseBrowser:()=>client}})};
}
for (const [value,expected] of [[0,0],[1,1],[12345,12345],[null,null],[undefined,null],[-1,null],[NaN,null],[Infinity,null],['0',null]]) {
  test(`count validates ${String(value)}`,()=>assert.equal(status.readCount({status:'fulfilled',value:{count:value}}).count,expected));
}
test('error beats even nonzero count; rejection is unavailable',()=>{
  assert.equal(status.readCount({status:'fulfilled',value:{count:99,error:{}}}).state,'unavailable');
  assert.equal(status.readCount({status:'rejected',reason:'offline'}).count,null);
  assert.equal(status.formatStoredCount(null),'조회 불가');
  assert.equal(status.formatStoredCount(0),'0');
});
for(const [timestamp,expected] of [
 ['2026-10-02T14:59:59Z','2026-10-02'],['2026-10-02T15:00:00Z','2026-10-03'],
 ['2026-12-31T15:00:00Z','2027-01-01'],['2026-10-03T00:00:00+09:00','2026-10-03'],
 ['2026-10-03T00:00:00',null],['bad',null],[null,null],
]) test(`KST insert date ${timestamp}`,()=>assert.equal(status.kstInsertDate(timestamp),expected));
for(const mode of ['zero','error','missing','rejected','partial'])test(`collection query ${mode}`,async()=>{
 const responses=Array.from({length:16},()=>ok());
 responses[0]=ok(30,[{snapshot_date:'2026-10-03'}]);
 responses[1]=mode==='error'?failed:mode==='missing'?ok(null,[{snapshot_date:'2026-10-02'}]):mode==='rejected'?rejected:ok(mode==='partial'?null:0,[{snapshot_date:'2026-10-02'}]);
 if (['zero','missing','partial'].includes(mode)) responses.push(mode==='missing'||mode==='partial'?ok(null):ok(0));
 responses[2]=ok(100); responses[3]=mode==='partial'?failed:ok(50); responses[4]=ok(12);
 responses[8]=ok(25,[{created_at:'2026-10-02T15:00:00Z'}]);
 const {queries,calls}=harness(responses);const stats=await queries.fetchCollectionStats();
 assert.equal(stats.length,14);assert.equal(calls.length,['zero','missing','partial'].includes(mode)?17:16);
 const by=id=>stats.find(s=>s.id===id);
 assert.equal(by('ranking').count,30);
 assert.equal(by('brand-ranking').count,mode==='zero'?0:null);
 assert.equal(by('brand-ranking').status,mode==='zero'?'empty':'unknown');
 assert.equal(by('reviews').latestDate,'2026-10-03');
 assert.equal(by('comp-detail').count,12); // not detail - all own products
 assert.equal(by('comp-detail').target,mode==='partial'?null:50);
 assert.equal(by('comp-detail').status,mode==='partial'?'unknown':'stored');
 for(const call of calls.slice(3,5))assert.ok(call.ops.some(o=>o[0]==='eq'&&o[1]==='is_own'&&o[2]===false));
 assert.equal(calls[1].table,'brand_ranking_snapshots');
 assert.equal(by('own-sales').count,0);assert.equal(by('own-sales').status,'empty');
});
for(const mode of ['zero','cap','error','missing','rejected'])test(`running records ${mode}`,async()=>{
 const rows=Array.from({length:20},(_,id)=>({id,script:'musinsa_review',status:'running',started_at:'2000-01-01T00:00:00Z'}));
 const {queries,calls}=harness([mode==='error'?failed:mode==='missing'?{data:null,error:null}:mode==='rejected'?rejected:ok(null,mode==='cap'?rows:[])]);
 const result=await queries.fetchActiveJobs();
 assert.equal(result.state,['zero','cap'].includes(mode)?'available':'unavailable');
 const label=status.runningRecordsLabel(result);
 assert.match(label,mode==='cap'?/20건.*최대 20건/:mode==='zero'?/0건/:/조회 불가/);
 assert.ok(calls[0].ops.some(o=>o[0]==='limit'&&o[1]===20));
 assert.ok(!calls[0].ops.some(o=>['gte','gt','lt'].includes(o[0]))); // no invented age policy
});

test('admin KPI preserves partial failures and successful zero',async()=>{
 const {client,calls}=harness([failed,ok(0),rejected,ok(2),ok(null,[])]);
 const {GET}=load('src/app/api/admin/jobs/kpi/route.ts',{'@/lib/auth/require-admin':{requireAdmin:async()=>({error:null,ss:client})},'next/server':{NextResponse:{json:x=>x}}});
 assert.deepEqual(await GET(),{total_today:null,success_today:0,error_today:null,running_today:2,avg_duration_7d_sec:null});
 assert.equal(calls.length,5);
});

test('admin today client distinguishes HTTP error, null, rejected, empty and rows',async()=>{
 const previous=global.fetch;
 try {
  const queries=load('src/lib/queries-admin.ts');
  for(const [reply,expected] of [[{ok:false},null],[{ok:true,json:async()=>({jobs:null})},null],[{ok:true,json:async()=>({jobs:[]})},[]],[{ok:true,json:async()=>({jobs:[{id:1}]})},[{id:1}]]]){
   global.fetch=async()=>reply;assert.deepEqual(await queries.fetchTodayJobs(),expected);
  }
  global.fetch=async()=>{throw Error('offline')};assert.equal(await queries.fetchTodayJobs(),null);
 }finally{global.fetch=previous;}
});

function renderHome(stats,result){
 const states=[true,stats,result,'A','A',0,0,{key:'0:A:0',rows:[],status:'ready'},0,0,{key:'0:A:0',rows:[],status:'ready'},[],[],null,[],false];
 const {default:Home}=load('src/app/(app)/page.tsx',{
  react:{...React,useState:()=>[states.shift(),()=>{}],useEffect:()=>{},useRef:v=>({current:v}),useCallback:f=>f},
  '@/hooks/useViewport':{useIsMobile:()=>false},
  'next/navigation':{useRouter:()=>({push:()=>{}})},
  'next/link':({children,...p})=>React.createElement('a',p,children),
  '@/lib/queries':{},'@/lib/supabase/client':{supabaseBrowser:()=>({})},
 });
 const html=renderToStaticMarkup(React.createElement(Home));assert.equal(states.length,0);return html;
}
test('home actual UI keeps zero, unknown denominator, KST and cap explicit',()=>{
 const html=renderHome([
  {id:'brand-ranking',label:'브랜드 랭킹 스냅샷',count:null,latestDate:null,target:null,status:'unknown',link:null},
  {id:'own-sales',label:'자사 매출 (ERP)',count:0,latestDate:null,target:null,status:'empty',link:null},
  {id:'comp-detail',label:'자사 외 상품 상세',count:12,latestDate:null,target:null,hasTarget:true,status:'unknown',link:null},
  {id:'reviews',label:'저장 리뷰 (전체)',count:25,latestDate:'2026-10-03',target:null,status:'stored',link:null},
 ],{state:'available',jobs:Array.from({length:20},(_,id)=>({id,script:'unknown'})),limit:20});
 assert.match(html,/조회 불가/);assert.match(html,/>0</);assert.match(html,/12<\/span><span class="dim">\/조회 불가/);
 assert.match(html,/running 기록 20건 \(최근 최대 20건\)/);assert.match(html,/행 저장 시각\(KST\)/);
 assert.doesNotMatch(html,/20수집중|활성 ·|undefined|NaN/);
});
for(const rows of [null,[],[{id:'1',script:'test',status:'running',started_at:'2026-10-03T00:00:00Z',rows_done:1,target:2}]])test(`mobile admin renders ${rows===null?'unknown':rows.length?'running':'empty'}`,()=>{
 const states=[rows,false];
 const {default:Page}=load('src/app/(app)/admin/jobs/MobileAdminJobsView.tsx',{react:{...React,useState:()=>[states.shift(),()=>{}],useEffect:()=>{}},'@/lib/queries-admin':{}});
 const html=renderToStaticMarkup(React.createElement(Page));
 assert.match(html,rows===null?/조회 불가/:rows.length?/running 기록/:/기록이 없습니다/);
 if(rows?.length)assert.match(html,/최대 200건.*실제 실행 여부 미확인/);
});

test('admin overview derived success rate checks both counts; mobile preserves null',()=>{
 const desktop=fs.readFileSync(path.join(__dirname,'../src/app/(app)/admin/page.tsx'),'utf8');
 assert.match(desktop,/total_today != null && kpi.jobs.success_today != null/);
 assert.doesNotMatch(desktop,/jobs\.(?:total_today|success_today) \?\? 0/);
 assert.match(desktop,/최대 500건/);
 const mobile=fs.readFileSync(path.join(__dirname,'../src/app/(app)/admin/MobileAdminDashboardView.tsx'),'utf8');
 assert.match(mobile,/formatStoredCount\(kpi.jobs.total_today\)/);
});

for(const mode of ['error','rejected','zero','success'])test(`admin overview job sample ${mode}`,async()=>{
 const responses=Array.from({length:14},()=>ok(0));
 responses[3]=mode==='error'?failed:mode==='rejected'?rejected:ok(null,mode==='success'?[{status:'done',started_at:'2026-10-03T00:00:00Z',finished_at:'2026-10-03T00:00:01Z'}]:[]);
 responses[4]=failed;
 // Auth listUsers is a separate non-table promise, so only 13 table queries + pending rows.
 responses[13]=ok(null,[]);
 const {client,calls}=harness(responses);client.auth={admin:{listUsers:async()=>({data:{users:[]},error:null})}};
 const {GET}=load('src/app/api/admin/dashboard/kpi/route.ts',{
  '@supabase/supabase-js':{createClient:()=>client},
  '@/lib/auth/require-admin':{requireAdmin:async()=>({error:null})},
  'next/server':{NextResponse:{json:x=>x}},
 });
 const result=await GET();
 const expected=mode==='zero'?0:mode==='success'?1:null;
 assert.equal(result.jobs.total_today,expected);assert.equal(result.jobs.success_today,expected);
 assert.equal(result.jobs.error_today,expected===null?null:0);
 assert.equal(result.jobs.avg_duration_7d_sec,null);
 assert.equal(result.data.total_products,0);
 assert.ok(calls[3].ops.some(o=>o[0]==='limit'&&o[1]===500));
 assert.ok(calls[4].ops.some(o=>o[0]==='limit'&&o[1]===2000));
});
for(const rows of [null,[]])test(`desktop admin renders ${rows===null?'unknown':'empty'}`,()=>{
 const states=[rows,{total_today:null,success_today:0,error_today:null,running_today:null,avg_duration_7d_sec:null},[],false,null,false];
 const {default:Page}=load('src/app/(app)/admin/jobs/page.tsx',{
  react:{...React,useState:()=>[states.shift(),()=>{}],useEffect:()=>{},useCallback:f=>f,useRef:v=>({current:v})},
  '@/hooks/useViewport':{useIsMobile:()=>false},'@/lib/queries-admin':{},
  '@/lib/supabase/client':{supabaseBrowser:()=>({})},'@/components/ui/charts':{Line:()=>null},
 });
 const html=renderToStaticMarkup(React.createElement(Page));
 assert.match(html,rows===null?/작업 기록 조회 불가/:/오늘 시작된 작업 기록이 없습니다/);
 assert.match(html,/running 기록 조회 불가/);assert.match(html,/>0</);
 assert.match(html,/최대 200건/);assert.doesNotMatch(html,/개 실행 중|● LIVE/);
});

for (const data of [null,[]])test(`today API itself preserves ${data===null?'unavailable':'empty'}`,async()=>{
 const {client}=harness([{data,error:null}]);
 const {GET}=load('src/app/api/admin/jobs/today/route.ts',{
  '@/lib/auth/require-admin':{requireAdmin:async()=>({error:null,ss:client})},
  'next/server':{NextResponse:{json:(body,opts)=>({body,status:opts?.status??200})}},
 });
 const result=await GET();assert.equal(result.status,data===null?502:200);
 if(data!==null)assert.deepEqual(result.body.jobs,[]);
});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('admin initial history rejection retains successful jobs and partial KPI',async()=>{
 const effects=[], updates=[];let i=0;
 const jobs=[{id:'1'}],kpi={total_today:0,running_today:null};
 const {default:Page}=load('src/app/(app)/admin/jobs/page.tsx',{
  react:{...React,useState:v=>{const index=i++;return [v,x=>updates.push([index,x])]},useEffect:fn=>effects.push(fn),useRef:v=>({current:v}),useCallback:f=>f},
  '@/hooks/useViewport':{useIsMobile:()=>false},
  '@/lib/queries-admin':{fetchTodayJobs:async()=>jobs,fetchJobsKpi:async()=>kpi,fetchJobsHistory:async()=>{throw Error('history unavailable')}},
  '@/lib/supabase/client':{supabaseBrowser:()=>({channel:()=>({on(){return this},subscribe(){return this}}),removeChannel(){}})},
  '@/components/ui/charts':{Line:()=>null},
 });
 renderToStaticMarkup(React.createElement(Page));const cleanup=effects[0]();await flush();
 assert.ok(updates.some(([i,v])=>i===0&&v===jobs));assert.ok(updates.some(([i,v])=>i===1&&v===kpi));
 assert.ok(!updates.some(([i,v])=>i===0&&v===null));cleanup();
});
test('home overlapping refreshes keep newest failure and ignore old success and disposed results',async()=>{
 const effects=[], updates=[];let i=0,onChange;
 // HomePage's viewport-ready phase precedes the desktop view's own hooks.
 let firstState=true,firstEffect=true;
 const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
 const jobs=[deferred(),deferred(),deferred()],stats=[deferred(),deferred()];let jobCall=0,statCall=0;
 const priorInterval=global.setInterval,priorClear=global.clearInterval;
 global.setInterval=()=>1;global.clearInterval=()=>{};
 const channel={on(_a,_b,fn){onChange=fn;return this},subscribe(){return this}};
 const {default:Home}=load('src/app/(app)/page.tsx',{
  react:{...React,useState:v=>{if(firstState){firstState=false;return [true,()=>{}]}const index=i++;return [v,x=>updates.push([index,x])]},useEffect:fn=>{if(firstEffect){firstEffect=false;return}effects.push(fn)},useRef:v=>({current:v}),useCallback:f=>f},
  '@/hooks/useViewport':{useIsMobile:()=>false},'next/navigation':{useRouter:()=>({push(){}})},
  'next/link':({children,...p})=>React.createElement('a',p,children),
  '@/lib/supabase/client':{supabaseBrowser:()=>({channel:()=>channel,removeChannel(){}})},
  '@/lib/queries':{fetchCollectionStats:()=>stats[statCall++].promise,fetchActiveJobs:()=>jobs[jobCall++].promise,
   fetchOwnBrandBreakdown:async()=>[],fetchAnomalySignals:async()=>[],fetchReviewStats:async()=>null,fetchActivePromotions:async()=>[]},
 });
 try {
  renderToStaticMarkup(React.createElement(Home));
  const statsEffect=effects.find(fn=>String(fn).includes('fetchOwnBrandBreakdown'));
  const jobsEffect=effects.find(fn=>String(fn).includes('collection_jobs'));
  assert.equal(typeof statsEffect,'function');assert.equal(typeof jobsEffect,'function');
  const cleanupStats=statsEffect();const cleanupJobs=jobsEffect();
  onChange({new:{status:'done'}});
  const unknown={state:'unavailable',jobs:[],limit:20};const unknownStats=[{id:'ranking',count:null}];
  jobs[1].resolve(unknown);stats[1].resolve(unknownStats);await flush();
  jobs[0].resolve({state:'available',jobs:[{id:'stale'}],limit:20});stats[0].resolve([{id:'ranking',count:123}]);await flush();
  assert.deepEqual(updates.filter(([idx])=>idx===1).map(([,v])=>v),[unknown]);
  assert.deepEqual(updates.filter(([idx])=>idx===0).map(([,v])=>v),[unknownStats]);
  onChange({new:{status:'running'}});cleanupJobs();cleanupStats();jobs[2].resolve(unknown);await flush();
  assert.equal(updates.filter(([idx])=>idx===1).length,1);
 }finally{global.setInterval=priorInterval;global.clearInterval=priorClear;}
});

test('admin KPI realtime newer failure survives older initial success and slow history',async()=>{
 const effects=[],updates=[];let i=0,onChange,timerCallback;
 const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
 const old=deferred(),newer=deferred(),history=deferred();let kpiCall=0;
 const priorTimeout=global.setTimeout,priorClear=global.clearTimeout;
 global.setTimeout=fn=>{timerCallback=fn;return 1};global.clearTimeout=()=>{};
 const {default:Page}=load('src/app/(app)/admin/jobs/page.tsx',{
  react:{...React,useState:v=>{const index=i++;return [v,x=>updates.push([index,x])]},useEffect:fn=>effects.push(fn),useRef:v=>({current:v}),useCallback:f=>f},
  '@/hooks/useViewport':{useIsMobile:()=>false},
  '@/lib/queries-admin':{fetchTodayJobs:async()=>[],fetchJobsKpi:()=>kpiCall++===0?old.promise:newer.promise,fetchJobsHistory:()=>history.promise},
  '@/lib/supabase/client':{supabaseBrowser:()=>({channel:()=>({on(_a,_b,fn){onChange=fn;return this},subscribe(){return this}}),removeChannel(){}})},
  '@/components/ui/charts':{Line:()=>null},
 });
 try {
  renderToStaticMarkup(React.createElement(Page));const cleanup=effects[0]();
  onChange({eventType:'UPDATE',new:{id:'1'}});timerCallback();
  newer.resolve(null);await flush();old.resolve({total_today:123});history.resolve([]);await flush();
  assert.deepEqual(updates.filter(([idx])=>idx===1).map(([,v])=>v),[null]);cleanup();
 }finally{global.setTimeout=priorTimeout;global.clearTimeout=priorClear;}
});


// The latest-date counter must never scan/count the lifetime table.
for (const [name, latest, countReply, expectedCount, expectedDate] of [
 ['latest', ok(null,[{snapshot_date:'2026-10-03'}]), ok(52447), 52447, '2026-10-03'],
 ['stale', ok(null,[{snapshot_date:'2025-12-31'}]), ok(9), 9, '2025-12-31'],
 ['year rollover', ok(null,[{snapshot_date:'2027-01-01'}]), ok(10), 10, '2027-01-01'],
 ['empty table', ok(null,[]), undefined, 0, null],
 ['missing data', {data:null,error:null}, undefined, null, null],
 ['date error', failed, undefined, null, null],
 ['date rejection', rejected, undefined, null, null],
 ['missing date', ok(null,[{}]), undefined, null, null],
 ['malformed date', ok(null,[{snapshot_date:'2026-10-03T00:00:00Z'}]), undefined, null, null],
 ['impossible date', ok(null,[{snapshot_date:'2026-02-30'}]), undefined, null, null],
 ['count zero', ok(null,[{snapshot_date:'2026-10-03'}]), ok(0), 0, '2026-10-03'],
 ['count error', ok(null,[{snapshot_date:'2026-10-03'}]), failed, null, '2026-10-03'],
 ['count missing', ok(null,[{snapshot_date:'2026-10-03'}]), ok(null), null, '2026-10-03'],
 ['count rejection', ok(null,[{snapshot_date:'2026-10-03'}]), rejected, null, '2026-10-03'],
]) test('bounded brand count: '+name,async()=>{
 const responses=countReply===undefined?[latest]:[latest,countReply];
 const {queries,calls}=harness(responses);
 const result=await queries.fetchLatestBrandSnapshotCount();
 assert.equal(result.count,expectedCount);
 assert.equal(result.data[0]?.snapshot_date??null,expectedDate);
 assert.deepEqual(calls[0],{table:'brand_ranking_snapshots',ops:[
  ['select','snapshot_date'],['order','snapshot_date',{ascending:false}],['limit',1],
 ]});
 assert.equal(calls.length,countReply===undefined?1:2);
 if(countReply!==undefined) assert.deepEqual(calls[1],{table:'brand_ranking_snapshots',ops:[
  ['select','*',{count:'exact',head:true}],['eq','snapshot_date',expectedDate],
 ]});
 assert.equal(responses.length,0);
});

test('rollover between reads stays pinned; next refresh discovers newer date',async()=>{
 const {queries,calls}=harness([
  ok(null,[{snapshot_date:'2026-12-31'}]),ok(21),
  ok(null,[{snapshot_date:'2027-01-01'}]),ok(3),
 ]);
 const old=await queries.fetchLatestBrandSnapshotCount();
 const next=await queries.fetchLatestBrandSnapshotCount();
 assert.deepEqual(old,{count:21,data:[{snapshot_date:'2026-12-31'}]});
 assert.deepEqual(next,{count:3,data:[{snapshot_date:'2027-01-01'}]});
 assert.deepEqual(calls[1].ops.at(-1),['eq','snapshot_date','2026-12-31']);
 assert.deepEqual(calls[3].ops.at(-1),['eq','snapshot_date','2027-01-01']);
});

test('home KPI and collection row identify latest-date segment rows with full stale year',async()=>{
 const responses=Array.from({length:16},()=>ok());
 responses[1]=ok(null,[{snapshot_date:'2025-12-31'}]);responses.push(ok(52447));
 const {queries}=harness(responses);const stats=await queries.fetchCollectionStats();
 const brank=stats.find(s=>s.id==='brand-ranking');
 assert.equal(brank.count,52447);assert.equal(brank.latestDate,'2025-12-31');
 assert.equal(brank.label,'브랜드 랭킹 (최근일)');assert.equal(brank.status,'stored');
 const html=renderHome(stats,{state:'available',jobs:[],limit:20});
 assert.equal((html.match(/브랜드 랭킹 \(최근일\)/g)||[]).length,2);
 assert.match(html,/2025-12-31 · 스냅샷 행/);
 assert.match(html,/세그먼트별 저장 스냅샷 행 수의 합/);
 assert.match(html,/고유 브랜드 수가 아닙니다/);
 assert.match(html,/수집 완전성·실제 실행 여부는 확인되지 않았습니다/);
});
