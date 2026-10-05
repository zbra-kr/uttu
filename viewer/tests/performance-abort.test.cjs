const { readSource } = require('./performance-source.cjs');
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require('typescript');
function load(file, deferred=false){
 let ledger=[],pending=[];
 const sb={from(table){const call={table,ops:[],aborted:false};let signal;
  const q=new Proxy({}, {get(_,name){if(name==='then')return(resolve,reject)=>{
   ledger.push(call);return new Promise(done=>{
    const finish=()=>{const date=call.ops.find(x=>x[0]==='eq'&&x[1]==='snapshot_date')?.[2]||'2026-10-03';done({error:call.aborted?new Error('aborted'):null,data:call.aborted?null:call.ops.find(x=>x[0]==='select')[1]==='snapshot_date'?[{snapshot_date:date}]:[{snapshot_date:date,musinsa_no:1,rank_position:2,products:{is_own:true}}]})};
    if(signal){signal.addEventListener('abort',()=>{call.aborted=true;finish()},{once:true});if(signal.aborted){call.aborted=true;finish();return;}}
    if(deferred)pending.push(finish);else finish();
   }).then(resolve,reject);
  };return(...args)=>{if(name==='abortSignal')signal=args[0];else call.ops.push([name,...args]);return q;};}});return q;}};
 const exp={};const compiled=ts.transpileModule(readSource(file),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(compiled,{exports:exp,require:id=>id==='./supabase/client'?{supabaseBrowser:()=>sb}:{},console});return{fn:exp.fetchLatestRanking,ledger,pending};
}
(async()=>{
 const checks=[];
 for(const opts of [{},{fromDate:'2026-07-06',toDate:'2026-10-03'},{fromDate:'2026-10-03',toDate:'2026-10-03'}]){
  const a=load('source/queries.ts'),b=load('abort-candidate/queries.ts');const ctl=new AbortController();
  const ar=await a.fn(opts),br=await b.fn({...opts,signal:ctl.signal});
  assert.equal(JSON.stringify(ar),JSON.stringify(br));
  const expected=JSON.parse(JSON.stringify(a.ledger));
  expected.find(call=>call.ops.find(op=>op[0]==='select')?.[1]!=='snapshot_date').ops.find(op=>op[0]==='select')[1]='rank_position, musinsa_no, products!inner(is_own)';
  assert.equal(JSON.stringify(b.ledger),JSON.stringify(expected));checks.push({scenario:opts.fromDate||'latest',queryAndResultParity:true,requests:b.ledger.length});
 }
 const a=load('abort-candidate/queries.ts',true),ctl=new AbortController();const waiting=a.fn({fromDate:'2026-07-06',toDate:'2026-10-03',signal:ctl.signal});for(let i=0;i<10;i++)await Promise.resolve();assert.equal(a.ledger.length,91);ctl.abort();await assert.rejects(waiting,/aborted/);assert.ok(a.ledger.every(x=>x.aborted));checks.push({scenario:'superseded 90-day request',issued:91,mockRequestsReceivingAbort:91,claim:'HTTP mock only; no evidence of database query cancellation'});
 const b=load('abort-candidate/queries.ts',true),c=new AbortController();const latest=b.fn({signal:c.signal});for(let i=0;i<10;i++)await Promise.resolve();c.abort();await latest;assert.equal(b.ledger.length,1);checks.push({scenario:'abort latest-date lookup',requests:1,followupDateQueries:0});
 console.log(JSON.stringify({classification:'Offline query-builder and cancellation mock, not production telemetry',passed:checks.length,checks},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
