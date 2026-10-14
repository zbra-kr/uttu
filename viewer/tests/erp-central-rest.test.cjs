const test=require('node:test'),assert=require('node:assert/strict');
const load=require('./helpers/load-source.cjs');
const R=load('src/lib/erp/central-sales-rest.ts'),C=load('src/lib/erp/requester-sales-rest.ts'),S=load('src/lib/erp/central-sales-read.ts');
const scope={brand:'CO',from:'2026-10-01',to:'2026-10-10'};
const q=()=>({sql:S.CENTRAL_SQL,binds:['CO','20261001','20261010'],statementTimeoutSeconds:10,maxRows:201,maxEstimatedScanBytes:16777216,signal:new AbortController().signal});
const config=()=>({origin:'https://synthetic-account.snowflakecomputing.com',database:'BCAVE',schema:'SEWON',warehouse:'SYN_WH',role:'SYN_ROLE',getToken:async()=> 'SYN.jwt.signature'});
const metadata=(n,parts=[n])=>({numRows:n,format:'jsonv2',rowType:['BRANDCD','STYLECD','SALEDT','SALES_VAT_EX'].map((name,i)=>({name,type:i===3?'real':'text'})),partitionInfo:parts.map(rowCount=>({rowCount}))});
const result=(rows=[['CO','SYN-STYLE','20261001','123.45']])=>({code:'090001',sqlState:'00000',statementHandle:'syn-data',resultSetMetaData:metadata(rows.length),data:rows});
const explain=(bytes=1000)=>({code:'090001',sqlState:'00000',statementHandle:'syn-plan',resultSetMetaData:{numRows:1,format:'jsonv2',partitionInfo:[{rowCount:1}]},data:[[JSON.stringify({GlobalStats:{bytesAssigned:bytes,partitionsAssigned:1}})]]});
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function mock(sequence){const calls=[];return {calls,http:async(url,init)=>{calls.push({url,init});const value=sequence.shift();if(value instanceof Error)throw value;return value;}};}
test('REST preflight and fixed query use TEXT binds, JWT supplier and 10s timeout, no Python',async()=>{
 const m=mock([response(explain()),response(result())]);const v=await R.createCentralRestExecutor(config(),m.http).execute(q());
 assert.equal(v.rows[0].SALES_VAT_EX,'123.45');assert.equal(v.complete,true);assert.equal(m.calls.length,2);
 for(const c of m.calls){assert.equal(c.url,config().origin+'/api/v2/statements');assert.equal(c.init.redirect,'error');assert.equal(c.init.cache,'no-store');assert.equal(c.init.headers.Authorization,'Bearer SYN.jwt.signature');assert.equal(c.init.headers['X-Snowflake-Authorization-Token-Type'],'KEYPAIR_JWT');const b=JSON.parse(c.init.body);assert.equal(b.timeout,10);assert.deepEqual(b.bindings,{'1':{type:'TEXT',value:'CO'},'2':{type:'TEXT',value:'20261001'},'3':{type:'TEXT',value:'20261010'}});assert.doesNotMatch(b.statement,/%s/);assert.equal(b.role,'SYN_ROLE');}
 assert.equal(JSON.parse(m.calls[0].init.body).statement,'EXPLAIN USING JSON '+R.CENTRAL_REST_SQL);
 assert.equal(JSON.parse(m.calls[1].init.body).statement,R.CENTRAL_REST_SQL);
});
test('scan budget excess prevents sales query and errors are sanitized',async()=>{
 const m=mock([response(explain(16777217)),response({})]);await assert.rejects(R.createCentralRestExecutor(config(),m.http).execute(q()),/CENTRAL_REST_FAILED/);assert.equal(m.calls.filter(x=>JSON.parse(x.init.body||'{}').statement===R.CENTRAL_REST_SQL).length,0);
});
test('partition completion validates count and never follows server URLs',async()=>{
 const first=result();first.resultSetMetaData=metadata(2,[1,1]);first.statementStatusUrl='https://evil.invalid/secret';
 const part=result([['CO','SYN-SECOND','20261002',null]]);
 const m=mock([response(explain()),response(first),response(part)]);
 const v=await R.createCentralRestExecutor(config(),m.http).execute(q());assert.equal(v.rows.length,2);assert.equal(v.rows[1].SALES_VAT_EX,null);
 assert.equal(m.calls[2].url,config().origin+'/api/v2/statements/syn-data?partition=1');
});
test('partition failure never returns partial aggregates; known handle gets cancel POST',async()=>{
 const first=result();first.resultSetMetaData=metadata(2,[1,1]);
 const m=mock([response(explain()),response(first),response({message:'secret-error'},500),response({})]);
 await assert.rejects(R.createCentralRestExecutor(config(),m.http).execute(q()),e=>e.message==='CENTRAL_REST_FAILED');assert.equal(m.calls.at(-1).url,config().origin+'/api/v2/statements/syn-data/cancel');
});
test('202 is bounded and cancelled without resubmitting or following status URL',async()=>{
 const m=mock([response({code:'333334',statementHandle:'syn-pending',statementStatusUrl:'https://evil.invalid'},202),response({})]);
 await assert.rejects(R.createCentralRestExecutor(config(),m.http).execute(q()));assert.equal(m.calls.length,2);assert.equal(m.calls[1].url,config().origin+'/api/v2/statements/syn-pending/cancel');
});
test('HTTP 401, unsafe redirects, bad metadata and large responses fail closed',async()=>{
 for(const bad of [response({message:'secret'},401),response({},302),response({...result(),resultSetMetaData:metadata(2)}),response(result([['LE','SYN','20261001','1']])),response(result([['CO','SYN','20261032','1']])),response(result([['CO','SYN','20261001','NaN']])),new Response('x'.repeat(262145))]){
 const m=mock([response(explain()),bad,response({})]);await assert.rejects(R.createCentralRestExecutor(config(),m.http).execute(q()),e=>e.message==='CENTRAL_REST_FAILED');}
});
test('abort before auth or during HTTP is propagated and late HTTP cannot revive result',async()=>{
 const a=new AbortController();a.abort();let tokens=0,calls=0;const cfg={...config(),getToken:async()=>{tokens++;return 'SYN';}};
 await assert.rejects(R.createCentralRestExecutor(cfg,async()=>{calls++;}).execute({...q(),signal:a.signal}));assert.equal(tokens,0);assert.equal(calls,0);
 const b=new AbortController();let received,resolve,started;const ready=new Promise(r=>started=r);
 const p=R.createCentralRestExecutor(config(),async(u,i)=>{received=i.signal;started();return new Promise(r=>resolve=r);}).execute({...q(),signal:b.signal});
 await ready;b.abort();await assert.rejects(p,/CENTRAL_REST_CANCELLED/);assert.equal(received.aborted,true);resolve(response(explain()));
});
test('10s deadline also bounds an unresponsive auth supplier',async()=>{
 const old=global.setTimeout;global.setTimeout=(fn,ms)=>{assert.equal(ms,10000);queueMicrotask(fn);return old(()=>{},1);};
 try {await assert.rejects(R.createCentralRestExecutor({...config(),getToken:async()=>new Promise(()=>{})},async()=>{throw new Error('unexpected HTTP');}).execute(q()),/CENTRAL_READ_TIMEOUT/);}finally{global.setTimeout=old;}
});
test('trusted origin and input validation precede auth or HTTP',async()=>{
 for(const origin of ['http://synthetic-account.snowflakecomputing.com','https://evil.invalid','https://synthetic-account.snowflakecomputing.com/path','https://user@synthetic-account.snowflakecomputing.com'])assert.throws(()=>R.createCentralRestExecutor({...config(),origin}));
 let calls=0;const e=R.createCentralRestExecutor({...config(),getToken:async()=>{calls++;return 'SYN';}},async()=>{calls++;});
 for(const bad of [{sql:'SELECT 1'},{maxRows:999},{binds:['CO','20261032','20261010']},{binds:['CO','20261001','20261110']}])await assert.rejects(e.execute({...q(),...bad}));assert.equal(calls,0);
});
test('requester caller accepts existing viewer, rechecks session and keeps numeric DTO held',async()=>{
 const m=mock([response(explain()),response(result())]);let auth=0;
 const v=await C.readAuthenticatedRequesterRestSales(scope,{expectedRequesterId:'SYN',rest:config()},async()=>{auth++;return {userId:'SYN',role:'viewer'};},m.http);
 assert.equal(auth,2);assert.equal(m.calls.length,2);assert.deepEqual(v.reasons,['EIS_APPROXIMATE_DISPLAY']);assert.equal(v.value,null);assert.equal(v.rows[0].amount.exactValue,null);assert.equal(v.rows[0].amount.sourceValue,'123.45');
 let checks=0;const no=mock([]);const denied=await C.readAuthenticatedRequesterRestSales(scope,{expectedRequesterId:'SYN',rest:config()},async()=>({userId:++checks===1?'SYN':'OTHER',role:'viewer'}),no.http);assert.equal(no.calls.length,0);assert.deepEqual(denied.reasons,['LOCAL_REQUESTER_MISMATCH']);
});
test('requester absence or missing REST config does not obtain token or make HTTP calls',async()=>{
 const m=mock([]);let tokens=0;const rest={...config(),getToken:async()=>{tokens++;return 'SYN';}};
 let v=await C.readAuthenticatedRequesterRestSales(scope,{expectedRequesterId:'SYN',rest},async()=>null,m.http);assert.deepEqual(v.reasons,['LOCAL_REQUESTER_REQUIRED']);
 v=await C.readAuthenticatedRequesterRestSales(scope,{expectedRequesterId:'SYN',rest:null},async()=>({userId:'SYN',role:'viewer'}),m.http);assert.deepEqual(v.reasons,['TRANSPORT_UNREGISTERED']);assert.equal(tokens,0);assert.equal(m.calls.length,0);
});
test('Snowflake HTTP408 preserves READ_TIMEOUT at requester caller',async()=>{
 const m=mock([response(explain()),response({message:'private-timeout-detail'},408)]);
 const state=await C.readAuthenticatedRequesterRestSales(scope,{expectedRequesterId:'SYN',rest:config()},async()=>({userId:'SYN',role:'viewer'}),m.http);
 assert.deepEqual(state.reasons,['READ_TIMEOUT']);assert.equal(state.value,null);assert.doesNotMatch(JSON.stringify(state),/private/);
});

test('REST adapter deadline through requester caller preserves READ_TIMEOUT',async()=>{
 const old=global.setTimeout,timers=[];let start,signal;const ready=new Promise(resolve=>start=resolve);
 global.setTimeout=(fn,ms)=>{assert.equal(ms,10000);timers.push(fn);return old(()=>{},1);};
 try {const rest={...config(),getToken:async s=>{signal=s;start();return new Promise(()=>{});}};
 const promise=C.readAuthenticatedRequesterRestSales(scope,{expectedRequesterId:'SYN',rest},async()=>({userId:'SYN',role:'viewer'}),async()=>{throw new Error('unexpected');});
 await ready;assert.equal(timers.length,2);timers[0]();const state=await promise;assert.deepEqual(state.reasons,['READ_TIMEOUT']);assert.equal(signal.aborted,true);assert.equal(state.value,null);
 }finally{global.setTimeout=old;}
});

function limitFixture(count,parts=[count]){
 const rows=Array.from({length:count},(_,i)=>['CO',`SYN-${i}`,'20261001','1']);
 const first=result(rows.slice(0,parts[0]));first.resultSetMetaData=metadata(count,parts);
 let offset=parts[0];const sequence=[response(explain()),response(first)];
 for(const size of parts.slice(1)){sequence.push(response(result(rows.slice(offset,offset+size))));offset+=size;}
 return mock(sequence);
}
test('cap diagnosis: fully received 201 groups across partitions yields LIMIT_REACHED, never PARTIAL_READ or displayed totals',async()=>{
 const m=limitFixture(201,[100,101]);
 const state=await C.readAuthenticatedRequesterRestSales(scope,{expectedRequesterId:'SYN',rest:config()},async()=>({userId:'SYN',role:'viewer'}),m.http);
 assert.equal(m.calls.length,3);assert.deepEqual(state.reasons,['LIMIT_REACHED']);assert.equal(state.kind,'withheld');assert.deepEqual(state.rows,[]);assert.equal(state.total,null);assert.equal(state.value,null);
});
test('cap diagnosis: complete 200-group boundary retains existing observed approximate display',async()=>{
 const m=limitFixture(200);const state=await C.readAuthenticatedRequesterRestSales(scope,{expectedRequesterId:'SYN',rest:config()},async()=>({userId:'SYN',role:'viewer'}),m.http);
 assert.equal(m.calls.length,2);assert.deepEqual(state.reasons,['EIS_APPROXIMATE_DISPLAY']);assert.equal(state.rows.length,200);assert.equal(state.total.exactValue,null);
});
test('cap diagnosis: missing partition rows still fail closed with no cap or successful amount claim',async()=>{
 const rows=Array.from({length:201},(_,i)=>['CO',`SYN-${i}`,'20261001','1']);const first=result(rows.slice(0,100));first.resultSetMetaData=metadata(201,[100,101]);
 const m=mock([response(explain()),response(first),response(result(rows.slice(100,200))),response({})]);
 const state=await C.readAuthenticatedRequesterRestSales(scope,{expectedRequesterId:'SYN',rest:config()},async()=>({userId:'SYN',role:'viewer'}),m.http);
 assert.deepEqual(state.reasons,['READ_FAILED']);assert.deepEqual(state.rows,[]);assert.equal(state.value,null);assert.match(m.calls.at(-1).url,/\/cancel$/);
});

test('admin response diagnostics: pinned admin sees fixed counts/code only, never rows/SQL/token/response messages',async()=>{
 const m=limitFixture(201,[100,101]);
 const state=await C.readAuthenticatedRequesterRestSales(scope,{expectedRequesterId:'SYN',rest:config()},async()=>({userId:'SYN',role:'admin'}),m.http);
 assert.deepEqual(state.transportDiagnostics,{code:'LIMIT_REACHED',phase:'ROW_VALIDATION',httpStatus:200,numRows:201,receivedRows:201,partitionCount:2,completedPartitions:2,partitionRowCountSum:201,partitionCountsMatch:true,responseComplete:true});
 assert.doesNotMatch(JSON.stringify(state.transportDiagnostics),/SELECT|SYN|Bearer|statementHandle|SALES_VAT_EX|20261001/);
 const SSR=require('react-dom/server'),React=require('react'),Panel=load('src/components/erp-insights/CentralSalesReadPanel.tsx').default;
 const html=SSR.renderToStaticMarkup(React.createElement(Panel,{state}));assert.match(html,/본인 관리자 ERP 응답 진단/);assert.match(html,/LIMIT_REACHED/);assert.match(html,/receivedRows/);
});
test('admin response diagnostics: source partition mismatch records bounded counts without exposing bad response',async()=>{
 const first=result([['CO','SECRET-ROW','20261001','123']]);first.resultSetMetaData=metadata(2,[1,1]);const part=result([]);part.message='SECRET-ERROR';part.token='SECRET-TOKEN';
 const m=mock([response(explain()),response(first),response(part),response({})]);
 const state=await C.readAuthenticatedRequesterRestSales(scope,{expectedRequesterId:'SYN',rest:config()},async()=>({userId:'SYN',role:'admin'}),m.http);
 assert.deepEqual(state.reasons,['READ_FAILED']);assert.equal(state.transportDiagnostics.phase,'PARTITION');assert.equal(state.transportDiagnostics.numRows,2);assert.equal(state.transportDiagnostics.receivedRows,1);assert.equal(state.transportDiagnostics.completedPartitions,1);assert.equal(state.transportDiagnostics.responseComplete,false);assert.doesNotMatch(JSON.stringify(state),/SECRET/);
});
test('admin response diagnostics: viewer and other admin never receive metadata; session/role changes suppress it',async()=>{
 for(const role of ['viewer','admin']){
  const m=limitFixture(201);const id=role==='admin'?'OTHER':'SYN';
  const state=await C.readAuthenticatedRequesterRestSales(scope,{expectedRequesterId:'SYN',rest:config()},async()=>({userId:id,role}),m.http);assert.equal(state.transportDiagnostics,undefined);if(id==='OTHER')assert.equal(m.calls.length,0);
 }
 for(const changed of [{userId:'OTHER',role:'admin'},{userId:'SYN',role:'viewer'},null]){
  let auth=0;const m=limitFixture(201);const state=await C.readAuthenticatedRequesterRestSales(scope,{expectedRequesterId:'SYN',rest:config()},async()=>++auth<=2?{userId:'SYN',role:'admin'}:changed,m.http);assert.equal(state.transportDiagnostics,undefined);assert.deepEqual(state.reasons,['LIMIT_REACHED']);
 }
});
test('admin response diagnostics: HTTP rejection and timeout expose fixed phase/status only',async()=>{
 for(const status of [401,408]){
  const m=mock([response({message:'SECRET-AUTH'},status)]);const state=await C.readAuthenticatedRequesterRestSales(scope,{expectedRequesterId:'SYN',rest:config()},async()=>({userId:'SYN',role:'admin'}),m.http);
  assert.equal(state.transportDiagnostics.httpStatus,status);assert.equal(state.transportDiagnostics.phase,'PREFLIGHT');assert.equal(state.transportDiagnostics.numRows,null);assert.equal(state.transportDiagnostics.code,status===408?'TIMEOUT':'FAILED');assert.doesNotMatch(JSON.stringify(state),/SECRET/);
 }
});
test('existing central scope has no product filter: inventoryStyles/style URL cannot change fixed three-bind query',async()=>{
 const m=limitFixture(1);await C.readAuthenticatedRequesterRestSales({...scope,inventoryStyles:'SYN-0',style:'SYN-0'},{expectedRequesterId:'SYN',rest:config()},async()=>({userId:'SYN',role:'viewer'}),m.http);
 for(const call of m.calls){const body=JSON.parse(call.init.body);assert.equal(Object.keys(body.bindings).length,3);assert.doesNotMatch(body.statement,/STYLECD\s*=\s*\?/);}
});
