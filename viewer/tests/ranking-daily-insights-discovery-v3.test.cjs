const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const React=require('react'),Renderer=require('react-test-renderer'),load=require('./helpers/load-source.cjs');
const core=load('src/lib/ranking-discovery.ts');
const agg=load('src/lib/ranking-discovery-aggregate.ts',{'./ranking-discovery':core});
const api=load('src/lib/ranking-discovery-api.ts',{'./ranking-discovery':core,'./ranking-discovery-aggregate':agg});
const client=load('src/lib/ranking-discovery-client.ts');
const uuid=n=>`00000000-0000-0000-0000-${n.toString(16).padStart(12,'0')}`;
const scope=()=>core.parseDiscoveryRequest(client.initialDiscoveryScope('2026-10-13')).scope;
const common=s=>({version:3,scope:s,sourceCompleteness:'unknown',paginationConsistency:'keyset-best-effort',ownClassification:'current-product-master'});
function summary(s,{total=101,observations=26866,after=null}={}){
 const start=after?parseInt(after.slice(-12),16):0,remainingCount=Math.max(0,total-start),length=Math.min(s.pageSize,remainingCount);
 const products=Array.from({length},(_,i)=>({productId:uuid(start+i+1),musinsaNo:String(start+i+1),name:'상품 '+(start+i+1),brand:'합성',own:true,observedDays:1,observedCohorts:201,observationCount:201,latestObservedDate:s.fromDate}));
 return{...common(s),mode:'products',totalProducts:total,matchingObservations:observations,remainingCount,products,hasMore:remainingCount>s.pageSize,nextId:remainingCount>s.pageSize?products.at(-1).productId:null};
}
function evidence(s,id,{total=201,after=null}={}){
 const start=after?parseInt(after.slice(-12),16):0,remainingCount=Math.max(0,total-start),length=Math.min(100,remainingCount);
 const tuples=[];for(const c of s.categories)for(const g of s.genders)for(const a of s.ages)tuples.push([c,g,a]);
 const rows=Array.from({length},(_,i)=>({id:uuid(start+i+1),date:s.fromDate,category:tuples[start+i][0],gender:tuples[start+i][1],age:tuples[start+i][2],rank:i+1,rankStatus:'unknown',changeStatus:'not-read'}));
 return{...common(s),mode:'evidence',productId:id,totalObservations:total,remainingCount,evidence:rows,hasMore:remainingCount>100,nextId:remainingCount>100?rows.at(-1).id:null};
}
function db({error=null,total=101,observations=26866,pending=false}={}){
 const calls=[];let started;
 const began=new Promise(resolve=>started=resolve);
 const value={from(){throw Error('RAW_SCAN_FORBIDDEN');},rpc(name,args){calls.push({name,args});return{abortSignal(signal){calls.at(-1).signal=signal;started();
 if(pending)return new Promise(()=>{});
 const data=args.p_product?evidence(args.p_scope,args.p_product,{after:args.p_evidence_after}):summary(args.p_scope,{total,observations,after:args.p_after});
 return Promise.resolve({data,error:error?{code:error,message:'private-SQL-secret'}:null});}};},auth:{getUser:async()=>({data:{user:{id:'account-A'}},error:null})}};
 return{value,calls,began};
}
const input=(s=scope(),more={})=>({version:3,mode:'products',scope:s,cursor:null,productId:null,...more});
function route(database){return load('src/app/api/ranking/discovery/route.ts',{'@/lib/supabase/server':{supabaseServer:async()=>database.value},'@/lib/ranking-discovery-api':api,'@/lib/ranking-discovery-aggregate':agg});}
const req=body=>new Request('https://example.test/api/ranking/discovery',{method:'POST',body:JSON.stringify(body)});
test('v3 product summaries accept26,866+ observed rows in exactly one RPC with no raw reads',async()=>{
 const d=db(),r=await route(d).POST(req(input()));assert.equal(r.status,200);const json=await r.json();assert.equal(json.matchingObservations,26866);assert.equal(json.products.length,50);assert.equal(json.products[0].evidence,undefined);assert.equal(d.calls.length,1);assert.equal(d.calls[0].name,'get_ranking_discovery_page_v3');assert.equal(r.headers.get('cache-control'),'private, no-store');
});
for(const [code,status,text]of[['PGRST202',503,'aggregate-function-unavailable'],['42883',503,'aggregate-function-unavailable'],['42501',403,'aggregate-permission-denied'],['57014',504,'aggregate-query-timeout']])test('RPC '+code+' is explicit '+text+' without scan fallback',async()=>{
 const d=db({error:code}),r=await route(d).POST(req(input()));assert.equal(r.status,status);assert.deepEqual(await r.json(),{error:text});assert.equal(d.calls.length,1);
});
test('cursor binds scope, account, mode/product; changed exact dataset totals produce409',async()=>{
 const d=db(),c=new AbortController(),q=api.parseDiscoveryApiRequest(input());
 const first=await api.queryDiscoveryApi(d.value,q,'account-A',c.signal);
 const next=api.parseDiscoveryApiRequest(input(q.scope,{cursor:first.nextCursor}));
 assert.equal((await api.queryDiscoveryApi(d.value,next,'account-A',c.signal)).products[0].productId,uuid(51));
 await assert.rejects(api.queryDiscoveryApi(d.value,next,'account-B',c.signal),e=>e.code==='invalid-request');
 const changed=api.parseDiscoveryApiRequest(input({...q.scope,ownOnly:false},{cursor:first.nextCursor}));await assert.rejects(api.queryDiscoveryApi(d.value,changed,'account-A',c.signal),e=>e.code==='invalid-request');
 const wrong=api.parseDiscoveryApiRequest(input(q.scope,{mode:'evidence',productId:uuid(1),cursor:first.nextCursor}));await assert.rejects(api.queryDiscoveryApi(d.value,wrong,'account-A',c.signal),e=>e.code==='invalid-request');
 await assert.rejects(api.queryDiscoveryApi(db({total:102}).value,next,'account-A',c.signal),e=>e.code==='stale-cursor');
});
test('selected product evidence has independent100-row cursor pages with no other-product continuation',async()=>{
 const d=db(),c=new AbortController(),q=api.parseDiscoveryApiRequest(input(scope(),{mode:'evidence',productId:uuid(1)}));
 const first=await api.queryDiscoveryApi(d.value,q,'account-A',c.signal);assert.equal(first.evidence.length,100);assert.equal(first.totalObservations,201);
 const second=await api.queryDiscoveryApi(d.value,{...q,cursor:first.nextCursor},'account-A',c.signal);assert.equal(second.evidence[0].id,uuid(101));
 const third=await api.queryDiscoveryApi(d.value,{...q,cursor:second.nextCursor},'account-A',c.signal);assert.equal(third.evidence.length,1);assert.equal(third.nextCursor,null);
 await assert.rejects(api.queryDiscoveryApi(d.value,{...q,productId:uuid(2),cursor:first.nextCursor},'account-A',c.signal),e=>e.code==='invalid-request');
});
test('actual route cancels a nonsettling RPC, denies unauthenticated and rejects legacyv2 before RPC',async()=>{
 const d=db({pending:true}),c=new AbortController(),pending=route(d).POST(new Request('https://example.test',{method:'POST',body:JSON.stringify(input()),signal:c.signal}));await d.began;c.abort();assert.equal((await pending).status,499);
 const denied=db();denied.value.auth.getUser=async()=>({data:{user:null},error:null});assert.equal((await route(denied).POST(req(input()))).status,401);assert.equal(denied.calls.length,0);
 const legacy=db();assert.equal((await route(legacy).POST(req(scope()))).status,400);assert.equal(legacy.calls.length,0);
});
test('client uses v3 product/evidence envelopes, validates expected count and incomplete responses',async()=>{
 const original=global.fetch,s=scope(),calls=[],signal=new AbortController().signal;
 try{
 global.fetch=async(_url,options)=>{const body=JSON.parse(options.body);calls.push(body);const r=body.mode==='products'?summary(s):evidence(s,body.productId);return Response.json({...r,nextCursor:r.hasMore?'synthetic-cursor':null});};
 assert.equal((await client.fetchDiscovery(s,null,signal)).products.length,50);assert.equal((await client.fetchDiscoveryEvidence(s,uuid(1),201,null,signal)).evidence.length,100);
 assert.deepEqual(calls.map(c=>c.mode),['products','evidence']);assert.ok(calls.every(c=>c.version===3));
 await assert.rejects(client.fetchDiscoveryEvidence(s,uuid(1),202,null,signal),e=>e.code==='stale-cursor');
 global.fetch=async()=>Response.json({...summary(s),products:[],hasMore:false,nextId:null,nextCursor:null});await assert.rejects(client.fetchDiscovery(s,null,signal),e=>e.code==='invalid-receipt');
 }finally{global.fetch=original;}
});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;const act=React.act;
const text=root=>{const read=v=>v==null?'':typeof v==='string'?v:Array.isArray(v)?v.map(read).join(''):read(v.children);return read(root.toJSON());};
const button=(root,label)=>root.root.findAllByType('button').find(b=>b.props.children===label);
async function click(root,label){await act(async()=>button(root,label).props.onClick());}
async function apply(root){await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));}
function fixture(){
 const calls=[],listeners=new Set();
 const auth={getUser:async()=>({data:{user:{id:'account-A'}},error:null}),onAuthStateChange(fn){listeners.add(fn);return{data:{subscription:{unsubscribe(){listeners.delete(fn);}}}};}};
 const fetcher=(mode)=>(s,idOrCursor,expectedOrSignal,cursor,signal)=>new Promise((resolve,reject)=>{
   calls.push(mode==='products'?{mode,scope:s,cursor:idOrCursor,signal:expectedOrSignal,resolve,reject}:{mode,scope:s,productId:idOrCursor,expected:expectedOrSignal,cursor,signal,resolve,reject});});
 const fake={...client,fetchDiscovery:fetcher('products'),fetchDiscoveryEvidence:fetcher('evidence')};
 const mocks={'./supabase/client':{supabaseBrowser:()=>({auth})},'./ranking-discovery-client':fake};
 const summaryHook=load('src/lib/use-ranking-discovery.ts',mocks),evidenceHook=load('src/lib/use-ranking-evidence.ts',mocks);
 const Component=load('src/app/(app)/ranking/discovery/page.tsx',{'@/lib/use-ranking-discovery':summaryHook,'@/lib/use-ranking-evidence':evidenceHook,'@/lib/ranking-discovery-client':client,'./discovery.module.css':{__esModule:true,default:new Proxy({},{get:(_o,k)=>String(k)})}}).default;
 return{calls,listeners,Component,async identity(id){await act(async()=>{for(const fn of listeners)fn('SIGNED_IN',id?{user:{id}}:null);});}};
}
async function mount(f){let root;await act(async()=>root=Renderer.create(React.createElement(f.Component)));return root;}
async function finish(f,i){const c=f.calls[i],r=c.mode==='products'?summary(c.scope):evidence(c.scope,c.productId);await act(async()=>c.resolve({...r,nextCursor:r.hasMore?'synthetic-'+i:null}));}
test('UI loads summaries only; selecting/closing/switching product cancels evidence and rejects late result',async()=>{
 const f=fixture(),root=await mount(f);try{
 assert.equal(f.calls.length,0);await apply(root);await finish(f,0);assert.equal(root.root.findAllByType('article').length,50);assert.equal(f.calls.length,1);assert.equal(root.root.findAllByType('table').length,0);
 await click(root,'조합별 근거 펼치기');assert.equal(f.calls[1].mode,'evidence');assert.equal(f.calls[1].productId,uuid(1));assert.match(text(root),/근거를 조회/);
 await act(async()=>root.root.findAllByType('button').filter(b=>b.props.children==='조합별 근거 펼치기')[0].props.onClick());assert.equal(f.calls[1].signal.aborted,true);assert.equal(f.calls[2].productId,uuid(2));
 await finish(f,1);assert.equal(root.root.findAllByType('table').length,0);await finish(f,2);assert.equal(root.root.findAllByType('tbody')[0].findAllByType('tr').length,100);
 await click(root,'근거 접기');assert.equal(root.root.findAllByType('table').length,0);
 }finally{await act(async()=>root.unmount());}
});
test('duplicate evidence next/retry are deduplicated and pagination clears old evidence',async()=>{
 const f=fixture(),root=await mount(f);try{
 await apply(root);await finish(f,0);await click(root,'조합별 근거 펼치기');await finish(f,1);
 const next=button(root,'다음 근거 페이지').props.onClick;await act(async()=>{next();next();});assert.equal(f.calls.length,3);assert.equal(root.root.findAllByType('table').length,0);
 await act(async()=>f.calls[2].reject(new client.DiscoveryClientError('aggregate-query-timeout')));assert.match(text(root),/초과/);
 const retry=button(root,'근거 다시 시도').props.onClick;await act(async()=>{retry();retry();});assert.equal(f.calls.length,4);
 }finally{await act(async()=>root.unmount());}
});
test('account/logout/unmount cancel summaries and evidence; stale requests cannot repopulate',async()=>{
 const f=fixture(),root=await mount(f);let done=false;try{
 await apply(root);await finish(f,0);await click(root,'조합별 근거 펼치기');await f.identity('account-B');assert.equal(f.calls[1].signal.aborted,true);await finish(f,1);assert.equal(root.root.findAllByType('article').length,0);
 await apply(root);await f.identity(null);assert.equal(f.calls[2].signal.aborted,true);await finish(f,2);assert.match(text(root),/로그인 후/);assert.equal(root.root.findAllByType('article').length,0);
 await f.identity('account-C');await apply(root);const last=f.calls.at(-1);await act(async()=>root.unmount());done=true;assert.equal(last.signal.aborted,true);assert.equal(f.listeners.size,0);
 }finally{if(!done)await act(async()=>root.unmount());}
});
for(const code of ['aggregate-function-unavailable','aggregate-permission-denied','aggregate-query-timeout'])test('UI '+code+' never renders empty success or falls back',async()=>{
 const f=fixture(),root=await mount(f);try{await apply(root);await act(async()=>f.calls[0].reject(new client.DiscoveryClientError(code)));assert.ok(root.root.findAllByProps({role:'alert'}).length);assert.equal(root.root.findAllByType('article').length,0);assert.doesNotMatch(text(root),/保存|저장 관측을 찾지 못/);assert.equal(f.calls.length,1);}finally{await act(async()=>root.unmount());}
});
test('evidence stale state restarts product summaries, not the stale card count',async()=>{
 const f=fixture(),root=await mount(f);try{await apply(root);await finish(f,0);await click(root,'조합별 근거 펼치기');await act(async()=>f.calls[1].reject(new client.DiscoveryClientError('stale-cursor')));await click(root,'상품 목록부터 다시 조회');assert.equal(f.calls[2].mode,'products');assert.equal(f.calls[2].cursor,null);assert.equal(root.root.findAllByType('article').length,0);}finally{await act(async()=>root.unmount());}
});
test('active API has no scan fallback and CI discovers this test without editing ERP package scripts',()=>{
 const source=fs.readFileSync('src/app/api/ranking/discovery/route.ts','utf8');assert.doesNotMatch(source,/discoverRankingProducts|createDiscoveryReader|ranking-discovery-reader|\.from\(/);
 const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));assert.match(pkg.scripts['test:ranking-daily'],/ranking-daily-insights\*\.test\.cjs/);
});
test('real Supabase SDK serializes oneRPC summary and evidence args with abort, not a raw PostgREST select',async()=>{
 const{createClient}=require('@supabase/supabase-js'),calls=[],c=new AbortController();
 const sdk=createClient('https://example.test','fake-public',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,options)=>{
  const a=JSON.parse(options.body);calls.push({url:new URL(url),options,args:a});
  return Response.json(a.p_product?evidence(a.p_scope,a.p_product,{after:a.p_evidence_after}):summary(a.p_scope,{after:a.p_after}));
 }}});
 sdk.from=()=>{throw Error('RAW_SCAN_FORBIDDEN');};
 await api.queryDiscoveryApi(sdk,api.parseDiscoveryApiRequest(input()),'account-A',c.signal);
 await api.queryDiscoveryApi(sdk,api.parseDiscoveryApiRequest(input(scope(),{mode:'evidence',productId:uuid(1)})),'account-A',c.signal);
 assert.equal(calls.length,2);assert.ok(calls.every(x=>x.url.pathname==='/rest/v1/rpc/get_ranking_discovery_page_v3'));
 assert.equal(calls[0].args.p_limit,50);assert.equal(calls[1].args.p_limit,100);assert.equal(calls[1].args.p_product,uuid(1));assert.equal(calls[1].args.p_evidence_after,null);
 c.abort();assert.ok(calls.every(x=>x.options.signal.aborted));
});
test('duplicate first submit is deduplicated; a distinct draft scope cancels prior summary',async()=>{
 const f=fixture(),root=await mount(f);try{
 const submit=root.root.findByType('form').props.onSubmit;await act(async()=>{submit({preventDefault(){}});submit({preventDefault(){}});});assert.equal(f.calls.length,1);
 await act(async()=>root.root.findAllByType('input').find(i=>i.props.type==='radio'&&!i.props.checked).props.onChange());await apply(root);
 assert.equal(f.calls.length,2);assert.equal(f.calls[0].signal.aborted,true);await finish(f,0);assert.equal(root.root.findAllByType('article').length,0);await finish(f,1);assert.equal(root.root.findAllByType('article').length,50);
 }finally{await act(async()=>root.unmount());}
});
test('same full totals but changed continuation membership count is stale rather than silent paging',async()=>{
 const d=db(),s=scope(),signal=new AbortController().signal,first=await api.queryDiscoveryApi(d.value,api.parseDiscoveryApiRequest(input(s)),'account-A',signal);
 const shifted=db();const original=shifted.value.rpc.bind(shifted.value);shifted.value.rpc=(name,args)=>{const pending=original(name,args);return{abortSignal:async sig=>{const r=await pending.abortSignal(sig);r.data.remainingCount++;return r;}};};
 await assert.rejects(api.queryDiscoveryApi(shifted.value,api.parseDiscoveryApiRequest(input(s,{cursor:first.nextCursor})),'account-A',signal),e=>e.code==='stale-cursor');
});
test('server deadline releases nonsettling aggregate call as explicit504 without raw fallback',async()=>{
 const original=AbortSignal.timeout,deadline=new AbortController(),d=db({pending:true});
 try{
 AbortSignal.timeout=()=>deadline.signal;const pending=route(d).POST(req(input()));await d.began;deadline.abort(new DOMException('synthetic deadline','TimeoutError'));
 const r=await pending;assert.equal(r.status,504);assert.deepEqual(await r.json(),{error:'aggregate-query-timeout'});assert.equal(d.calls.length,1);
 }finally{AbortSignal.timeout=original;}
});
test('client evidence timeout aborts pending request and exposes timeout rather than empty evidence',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(),root=await mount(f);
 try{await apply(root);await finish(f,0);await click(root,'조합별 근거 펼치기');const pending=f.calls[1];
 await act(async()=>t.mock.timers.tick(15000));assert.equal(pending.signal.aborted,true);assert.match(text(root),/조회 시간이 초과/);assert.equal(root.root.findAllByType('table').length,0);
 }finally{await act(async()=>root.unmount());t.mock.timers.reset();}
});
test('desktop and default mobile both expose discovery entry without replacing single-cohort controls',()=>{
 for(const name of ['page.tsx','MobileRankingView.tsx']){const source=fs.readFileSync('src/app/(app)/ranking/'+name,'utf8');assert.match(source,/href="\/ranking\/discovery"/);}
 const desktop=fs.readFileSync('src/app/(app)/ranking/page.tsx','utf8');assert.match(desktop,/SavedFiltersDropdown/);assert.match(desktop,/onLoad=\{handleLoadFilter\}/);
});
