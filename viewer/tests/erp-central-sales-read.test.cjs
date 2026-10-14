const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const load=require('./helpers/load-source.cjs'),React=require('react'),SSR=require('react-dom/server');
const M=load('src/lib/erp/central-sales-read.ts'),S=load('src/lib/erp/central-sales-server.ts'),Panel=load('src/components/erp-insights/CentralSalesReadPanel.tsx').default;
const q={brand:'CO',from:'2026-10-01',to:'2026-10-10'};
function deps(result={complete:true,rows:[{BRANDCD:'CO',STYLECD:'SYN-STYLE',SALEDT:'20261001',SALES_VAT_EX:123.45}]}){const calls=[];return {calls,currentActor:async()=>({userId:'SYN-ACTOR',role:'admin'}),grantFor:async(a,s)=>({kind:'allowed',principalId:a.userId,brand:s.brand,roles:['admin'],evidenceRef:'SYN-GRANT'}),executor:{execute:async query=>{calls.push(query);return result;}}};}
test('authenticated branded query displays approximate rows while exact money and private identity stay withheld',async()=>{
 const d=deps(),v=await S.readCentralSales(q,d);assert.equal(v.kind,'observed');assert.deepEqual(v.reasons,['EIS_APPROXIMATE_DISPLAY']);assert.equal(v.value,null);assert.equal(v.rows[0].amount.exactValue,null);assert.equal(v.rows[0].styleId,'SYN-STYLE');assert.equal(v.groupsObserved,1);
 assert.equal(d.calls[0].sql,M.CENTRAL_SQL);assert.deepEqual(d.calls[0].binds,['CO','20261001','20261010']);assert.equal(d.calls[0].statementTimeoutSeconds,10);assert.equal(d.calls[0].maxRows,201);assert.equal(d.calls[0].maxEstimatedScanBytes,16777216);
 const h=SSR.renderToStaticMarkup(React.createElement(Panel,{state:v}));assert.match(h,/FLOAT 근사값/);assert.match(h,/SYN-STYLE/);assert.doesNotMatch(h,/123\.45|SYN-ACTOR|SYN-GRANT/);
});
test('brand and date binding stays separate from fixed SQL and excludes only confirmed transfer shops',async()=>{
 assert.match(M.CENTRAL_SQL,/SHOPCD NOT IN \('B6055','B6057','B6063'\)/);assert.doesNotMatch(M.CENTRAL_SQL,/COLORCD|SIZECD|YEARCD|COF001|COF002|WAF005/);
 for(const brand of ['CO','LE','WA','CK','LK']){const d=deps({complete:true,rows:[]});await S.readCentralSales({...q,brand},d);assert.equal(d.calls[0].binds[0],brand);assert.equal(d.calls[0].sql,M.CENTRAL_SQL);}
});
test('no actor or grant no query; platform admin alone is not ERP permission',async()=>{
 const a=deps();a.currentActor=async()=>null;let v=await S.readCentralSales(q,a);assert.deepEqual(v.reasons,['AUTH_REQUIRED']);assert.equal(a.calls.length,0);
 const b=deps();b.grantFor=async()=>null;v=await S.readCentralSales(q,b);assert.deepEqual(v.reasons,['ERP_GRANT_UNVERIFIED']);assert.equal(b.calls.length,0);
});
test('ordinary viewer cannot inherit admin worker permission; explicit principal/role/brand grants required',async()=>{
 for(const mutate of [d=>d.currentActor=async()=>({userId:'SYN-ACTOR',role:'viewer'}),d=>d.grantFor=async()=>({kind:'allowed',principalId:'OTHER',brand:'CO',roles:['admin'],evidenceRef:'x'}),d=>d.grantFor=async()=>({kind:'allowed',principalId:'SYN-ACTOR',brand:'CK',roles:['admin'],evidenceRef:'x'}),d=>d.grantFor=async()=>({kind:'denied',principalId:'SYN-ACTOR',brand:'CO',roles:['admin'],evidenceRef:'x'})]){const d=deps();mutate(d);const v=await S.readCentralSales(q,d);assert.equal(v.kind,'forbidden');assert.equal(d.calls.length,0);}
});
test('role/grant/SQL fields supplied by browser have no authority',async()=>{
 const d=deps();d.grantFor=async()=>null;const v=await S.readCentralSales({...q,role:'admin',allowedBrands:['CO'],userId:'SYN-ACTOR',sql:'DROP TABLE x'},d);assert.deepEqual(v.reasons,['ERP_GRANT_UNVERIFIED']);assert.equal(d.calls.length,0);
});
for(const input of [{},null,{...q,brand:'all'},{...q,brand:"CO' OR 1=1"},{...q,from:'20260230'},{...q,from:'2026-02-30'},{...q,to:'2026-09-30'},{...q,to:'2026-11-01'},{...q,brand:['CO']}])test(`invalid scope does not authenticate/query: ${JSON.stringify(input)}`,async()=>{
 const d=deps();d.currentActor=async()=>{throw Error('should not run');};const v=await S.readCentralSales(input,d);assert.equal(v.kind,'request');assert.equal(d.calls.length,0);
});
test('valid ERP grant without transport remains unconnected, not successful zero',async()=>{const d=deps();d.executor=null;const v=await S.readCentralSales(q,d);assert.equal(v.kind,'unconnected');assert.equal(v.value,null);assert.deepEqual(v.reasons,['TRANSPORT_UNREGISTERED']);});
test('query failure, empty, partial and row limit are distinct',async()=>{
 const a=deps();a.executor.execute=async()=>{throw Error('PRIVATE_SENTINEL');};const v=await S.readCentralSales(q,a);assert.deepEqual(v.reasons,['READ_FAILED']);assert.doesNotMatch(JSON.stringify(v),/PRIVATE_SENTINEL/);
 const b=await S.readCentralSales(q,deps({complete:true,rows:[]}));assert.equal(b.kind,'empty');assert.equal(b.value,null);assert.equal(b.groupsObserved,0);
 const c=await S.readCentralSales(q,deps({complete:false,rows:[]}));assert.deepEqual(c.reasons,['PARTIAL_READ']);assert.equal(c.groupsObserved,null);
 const e=await S.readCentralSales(q,deps({complete:true,rows:Array(201).fill({})}));assert.deepEqual(e.reasons,['LIMIT_REACHED']);assert.equal(e.groupsObserved,null);
});
for(const change of [r=>r.BRANDCD='CK',r=>r.SALEDT='20260230',r=>r.SALEDT='20260930',r=>r.COLORCD='BLACK',r=>r.SIZECD='M',r=>r.YEARCD='26',r=>delete r.SALES_VAT_EX])test('invalid source row never projects values',async()=>{
 const row={BRANDCD:'CO',STYLECD:'SYN-STYLE',SALEDT:'20261001',SALES_VAT_EX:0};change(row);const v=await S.readCentralSales(q,deps({complete:true,rows:[row]}));assert.deepEqual(v.reasons,['SOURCE_INVALID']);assert.equal(v.value,null);assert.deepEqual(v.rows,[]);
});
test('FLOAT serialized to string or NULL does not discharge precision/definition hold',async()=>{for(const amount of ['123.45','0',0,null]){const v=await S.readCentralSales(q,deps({complete:true,rows:[{BRANDCD:'CO',STYLECD:'SYN-S',SALEDT:'20261001',SALES_VAT_EX:amount,raw:'PRIVATE_SENTINEL'}]}));assert.deepEqual(v.reasons,['EIS_APPROXIMATE_DISPLAY']);assert.equal(v.rows[0].amount.exactValue,null);assert.doesNotMatch(JSON.stringify(v),/PRIVATE_SENTINEL/);}});
test('deadline aborts executor and returns safe timeout state',async()=>{
 const d=deps();d.deadlineMs=5;let signal;d.executor.execute=async query=>{signal=query.signal;return new Promise(()=>{});};const v=await S.readCentralSales(q,d);assert.deepEqual(v.reasons,['READ_TIMEOUT']);assert.equal(signal.aborted,true);
});
test('request snapshot independent of actor/grant callback mutations',async()=>{
 const input={...q},d=deps();d.grantFor=async(a,s)=>{input.brand='CK';s.brand='LK';return {kind:'allowed',principalId:a.userId,brand:'CO',roles:['admin'],evidenceRef:'synthetic-only'};};const v=await S.readCentralSales(input,d);assert.equal(v.scope.brand,'CO');assert.equal(d.calls[0].binds[0],'CO');
});
test('runtime reuses existing own-user auth, does not install worker transport or use secrets',async()=>{
 const runtime=fs.readFileSync('src/lib/erp/central-sales-runtime.ts','utf8');assert.match(runtime,/auth\.getUser\(\)/);assert.match(runtime,/select\('role'\)\.eq\('id',user\.id\)/);assert.match(runtime,/grantFor:async\(\)=>null,executor:null/);assert.doesNotMatch(runtime,/process\.env|PRIVATE_KEY|execFile|spawn\(|https:/);
 let authCalls=0;const R=load('src/lib/erp/central-sales-runtime.ts',{'@/lib/supabase/server':{supabaseServer:async()=>({auth:{getUser:async()=>{authCalls++;return {data:{user:{id:'SYN-ACTOR'}},error:null};}},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{role:'admin'},error:null})})})})})}});
 const v=await R.readCurrentCentralSales(q);assert.equal(authCalls,1);assert.deepEqual(v.reasons,['ERP_GRANT_UNVERIFIED']);
});

for(const [label,user,role,params,expected]of [
 ['initial request',null,null,{},'unauthenticated'],
 ['current session admin without supplied ERP dependencies',{id:'PRIVATE_ACTOR_SENTINEL'},'admin',q,'unconnected'],
 ['current session absent',null,null,q,'unauthenticated'],
])test(`actual async review page GET integration: ${label}`,async()=>{
 let authCalls=0;const css={__esModule:true,default:new Proxy({},{get:(_,n)=>'erp-'+n})};
 const page=load('src/app/(app)/erp-insights-review/page.tsx',{'./erp-insights.module.css':css,'@/lib/supabase/server':{supabaseServer:async()=>({auth:{getUser:async()=>{authCalls++;return {data:{user},error:null};}},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{role},error:null})})})})})}}).default;
 const tree=await page({searchParams:Promise.resolve(params)}),h=SSR.renderToStaticMarkup(tree);assert.match(h,new RegExp(`data-central-state="${expected}"`));assert.match(h,/method="get"/);assert.doesNotMatch(h,/PRIVATE_ACTOR_SENTINEL|SYN-GRANT|SELECT BRANDCD/);assert.equal(authCalls,1);
});

test('authorized input cannot replace fixed source SQL, host or actor identity',async()=>{
 const d=deps();const v=await S.readCentralSales({...q,sql:'DELETE FROM private',host:'ATTACKER_SENTINEL',userId:'OTHER',role:'viewer'},d);assert.equal(d.calls[0].sql,M.CENTRAL_SQL);assert.deepEqual(d.calls[0].binds,['CO','20261001','20261010']);assert.doesNotMatch(JSON.stringify(v),/ATTACKER_SENTINEL|DELETE FROM|OTHER/);
});
