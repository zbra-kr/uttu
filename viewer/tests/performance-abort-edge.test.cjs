const { readSource } = require('./performance-source.cjs');
// Independent deterministic source checks, not Supabase/fetch/browser execution.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require('typescript');
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();await new Promise(setImmediate);};
function load(file,mode){
 const calls=[]; const exp={};
 const sb={from(table){const call={table,ops:[],signal:false};let signal;
  const q=new Proxy({}, {get(_,key){
   if(key==='then')return(resolve,reject)=>{calls.push(call);const lookup=call.ops.find(x=>x[0]==='select')?.[1]==='snapshot_date';const date=call.ops.find(x=>x[0]==='eq'&&x[1]==='snapshot_date')?.[2];
    const error=signal?.aborted?Error('aborted'):(mode==='error'&&!lookup?Error('query failed'):null);
    const data=error||mode==='empty'||(mode==='partial'&&date==='2026-10-02')?[]:lookup?[{snapshot_date:'2026-10-03'}]:[{snapshot_date:date,musinsa_no:1,rank_position:2,products:{is_own:true}}];
    return Promise.resolve({data,error}).then(resolve,reject);};
   return(...args)=>{if(key==='abortSignal'){signal=args[0];call.signal=true;}else call.ops.push([key,...args]);return q;};
  }});return q;}};
 const compiled=ts.transpileModule(readSource(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(compiled,{exports:exp,require:id=>id==='./supabase/client'?{supabaseBrowser:()=>sb}:{},console});
 return{fetch:exp.fetchLatestRanking,calls};
}
(async()=>{
 const checks=[];
 for(const mode of ['normal','empty','partial','error']){
  const a=load('source/queries.ts',mode),b=load('abort-candidate/queries.ts',mode);
  const opts={categoryCode:'001',genderFilter:'F',ageFilter:'AGE_BAND_30',limit:17,fromDate:'2026-10-02',toDate:'2026-10-03'};
  const read=async x=>{try{return {rows:await x.fetch(opts)}}catch(e){return {error:e.message}}};
  assert.equal(JSON.stringify(await read(a)),JSON.stringify(await read(b)));
  assert.equal(JSON.stringify(b.calls),JSON.stringify(a.calls));checks.push({case:'optional signal absent: '+mode,resultErrorAndRequestShapeParity:true});
 }
 for(const explicit of [false,true]){
  const b=load('abort-candidate/queries.ts','normal'),ctl=new AbortController();ctl.abort();
  const pending=b.fetch({signal:ctl.signal,...(explicit?{fromDate:'2026-10-02',toDate:'2026-10-03'}:{})});
  if(explicit)await assert.rejects(pending,/aborted/);else assert.equal(JSON.stringify(await pending),'[]');
  assert.ok(b.calls.every(x=>x.signal));assert.equal(b.calls.length,explicit?3:1);
  checks.push({case:'already-aborted '+(explicit?'explicit range':'latest'),builderAttempts:b.calls.length,allCarrySignal:true});
 }
 // Deferred fetch ignores abort on purpose: closure guard must still protect every setter.
 const src=readSource('abort-candidate/ranking-page.tsx');
 const start=src.indexOf('  React.useEffect(() => {\n    let cancelled = false;');const ending='  }, [selectedCategory, gender, age, queryFrom, queryTo]);';
 const code=ts.transpileModule(src.slice(start,src.indexOf(ending,start)+ending.length),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 let cleanup,requests=[],writes=[];
 function mount(id){const box={AbortController,React:{useEffect:f=>{cleanup=f()}},selectedCategory:id,gender:'A',age:'AGE_BAND_ALL',queryFrom:undefined,queryTo:undefined,initialPageRef:{current:null},fetchLatestRanking:opts=>new Promise((resolve,reject)=>requests.push({opts,resolve,reject}))};for(const key of ['Loading','Error','SnapshotDate','AllRows','Page'])box['set'+key]=v=>writes.push({id,key,v});vm.runInNewContext(code,box);}
 mount('A');cleanup();assert.equal(requests[0].opts.signal.aborted,true);mount('B');const count=writes.length;
 requests[0].resolve([{snapshot_date:'OLD'}]);await flush();assert.equal(writes.length,count);
 requests[1].resolve([{snapshot_date:'NEW'}]);await flush();assert.equal(writes.filter(x=>x.key==='SnapshotDate').at(-1).v,'NEW');
 checks.push({case:'superseded ranking ignores abort but resolves late',noStaleStateOrFinallyWrite:true});
 console.log(JSON.stringify({classification:'Independent VM and query-builder mocks; no runtime/typecheck or actual request cancellation verification',passed:checks.length,checks},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
