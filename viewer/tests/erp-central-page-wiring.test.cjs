const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const load=require('./helpers/load-source.cjs'),React=require('react'),SSR=require('react-dom/server');
const Rest=load('src/lib/erp/central-sales-rest.ts');
const scope={brand:'CO',from:'2026-10-01',to:'2026-10-10'};
const plan={code:'090001',sqlState:'00000',statementHandle:'syn-plan',resultSetMetaData:{numRows:1,format:'jsonv2',partitionInfo:[{rowCount:1}]},data:[[JSON.stringify({GlobalStats:{bytesAssigned:1000,partitionsAssigned:1}})]]};
const data={code:'090001',sqlState:'00000',statementHandle:'syn-data',resultSetMetaData:{numRows:1,format:'jsonv2',rowType:['BRANDCD','STYLECD','SALEDT','SALES_VAT_EX'].map((name,i)=>({name,type:i===3?'real':'text'})),partitionInfo:[{rowCount:1}]},data:[['CO','SYN-STYLE','20261001','1250000']]};
function setup({binding=false,actors=['PINNED_USER'],role='viewer',authError=false,profileError=false,responses=[plan,data]}={}){
 const events=[],queries=[];let auth=0,compositions=0,tokens=0;
 const rest={origin:'https://synthetic-account.snowflakecomputing.com',database:'BCAVE',schema:'SEWON',warehouse:'SYN_WH',role:'SYN_ROLE',getToken:async()=>{tokens++;events.push('token');return 'PRIVATE_SYN_JWT';}};
 const supplied=binding===true?{expectedRequesterId:'PINNED_USER',rest}:binding||null;
 const mocks={'./erp-insights.module.css':{__esModule:true,default:new Proxy({},{get:(_,n)=>'erp-'+n})},
  '@/lib/supabase/server':{supabaseServer:async()=>({auth:{getUser:async()=>{events.push('auth');const id=actors[Math.min(auth++,actors.length-1)];return {data:{user:id?{id}:null},error:authError?new Error('PRIVATE_AUTH'):null};}},from:table=>{assert.equal(table,'profiles');return {select:fields=>{assert.equal(fields,'role');return {eq:(key,id)=>{assert.equal(key,'id');assert.equal(id,actors[Math.min(auth-1,actors.length-1)]);return {single:async()=>({data:{role},error:profileError?new Error('PRIVATE_PROFILE'):null})};}};}};}})},
  './central-sales-composition':{configuredCentralRequesterBinding:()=>{compositions++;events.push('composition');return supplied;}},
  './central-sales-rest':{...Rest,createCentralRestExecutor:cfg=>Rest.createCentralRestExecutor(cfg,async(url,init)=>{events.push('http');queries.push({url,body:init.body?JSON.parse(init.body):null});const body=responses.shift();return new Response(JSON.stringify(body?.body??body),{status:body?.status??(body?.failure?500:200)});})},
 };
 const page=load('src/app/(app)/erp-insights-review/page.tsx',mocks).default;
 return {events,queries,rest,mocks,counts:()=>({auth,compositions,tokens}),render:async(params=scope)=>SSR.renderToStaticMarkup(await page({searchParams:Promise.resolve(params)}))};
}
test('actual page with no supplied server dependencies authenticates viewer and shows explicit unconnected',async()=>{
 const s=setup();const html=await s.render();assert.match(html,/data-central-state="unconnected"/);assert.match(html,/서버 의존성 미연결/);assert.deepEqual(s.counts(),{auth:1,compositions:1,tokens:0});assert.equal(s.queries.length,0);
});
test('actual page uses getUser -> trusted composition -> pinned context -> REST -> DTO -> panel',async()=>{
 const s=setup({binding:true});const html=await s.render({...scope,userId:'ATTACKER',expectedRequesterId:'ATTACKER',role:'admin',host:'ATTACKER',token:'ATTACKER'});
 assert.match(html,/data-central-state="observed"/);assert.match(html,/SYN-STYLE/);assert.match(html,/≈ 1.3/);assert.match(html,/FLOAT 근사값/);assert.doesNotMatch(html,/ATTACKER|PINNED_USER|PRIVATE_SYN_JWT|SELECT BRANDCD/);
 assert.deepEqual(s.events,['auth','composition','auth','auth','token','http','http']);assert.deepEqual(s.counts(),{auth:3,compositions:1,tokens:1});assert.equal(s.queries.length,2);
 assert.equal(s.queries[0].body.statement,'EXPLAIN USING JSON '+Rest.CENTRAL_REST_SQL);assert.equal(s.queries[1].body.statement,Rest.CENTRAL_REST_SQL);assert.equal(s.queries[1].body.bindings['1'].value,'CO');
});
test('unauthenticated, unknown role and failed getUser/profile never resolve provider or query',async()=>{
 for(const [options,state] of [[{actors:[null]},'unauthenticated'],[{role:null},'forbidden'],[{authError:true},'error'],[{profileError:true},'error']]){const s=setup({...options,binding:true});const html=await s.render();assert.match(html,new RegExp(`data-central-state="${state}"`));assert.equal(s.counts().compositions,0);assert.equal(s.counts().tokens,0);assert.equal(s.queries.length,0);assert.doesNotMatch(html,/PRIVATE_AUTH|PRIVATE_PROFILE/);}
});
test('URL requester id and admin assumption cannot replace trusted requester pin',async()=>{
 const s=setup({binding:true,actors:['OTHER'],role:'admin'});const html=await s.render({...scope,expectedRequesterId:'OTHER',userId:'PINNED_USER'});assert.match(html,/data-central-state="withheld"/);assert.match(html,/요청자 본인/);assert.equal(s.counts().tokens,0);assert.equal(s.queries.length,0);
});
test('session change during context issuance or consumption prevents signer/HTTP',async()=>{
 for(const actors of [['PINNED_USER','OTHER'],['PINNED_USER','PINNED_USER','OTHER']]){const s=setup({binding:true,actors});const html=await s.render();assert.doesNotMatch(html,/data-central-state="observed"|SYN-STYLE/);assert.equal(s.counts().tokens,0);assert.equal(s.queries.length,0);}
});
test('invalid/array input never authenticates or resolves server dependencies',async()=>{
 for(const params of [{...scope,brand:['CO']},{...scope,from:'bad'},{...scope,to:'2026-11-10'}]){const s=setup({binding:true});const html=await s.render(params);assert.match(html,/data-central-state="request"/);assert.deepEqual(s.counts(),{auth:0,compositions:0,tokens:0});}
});
test('configured requester with missing REST settings still reports unconnected',async()=>{
 const s=setup({binding:{expectedRequesterId:'PINNED_USER',rest:null}});const html=await s.render();assert.match(html,/data-central-state="unconnected"/);assert.match(html,/미설정/);assert.equal(s.counts().tokens,0);assert.equal(s.queries.length,0);
});
test('configured REST failure shows safe failed state without amount rows',async()=>{
 const s=setup({binding:true,responses:[{failure:true,message:'PRIVATE_SNOWFLAKE_ERROR'}]});const html=await s.render();assert.match(html,/data-central-state="error"/);assert.match(html,/중앙 매출 조회 실패/);assert.doesNotMatch(html,/PRIVATE_SNOWFLAKE_ERROR|SYN-STYLE|≈ 1.3/);
});
test('actual page preserves REST timeout reason and withholds amount rows',async()=>{
 const s=setup({binding:true,responses:[plan,{status:408,body:{message:'PRIVATE_TIMEOUT'}}]});const html=await s.render();assert.match(html,/data-central-state="error"/);assert.match(html,/제한 시간 초과/);assert.doesNotMatch(html,/PRIVATE_TIMEOUT|SYN-STYLE|≈ 1.3/);
});
test('checked-in composition remains null; page has actual Node runtime call and no request identity wiring',()=>{
 const binding=load('src/lib/erp/existing-node-binding.ts');assert.equal(binding.bindingFromExistingEnvironment({}),null);
 const source=fs.readFileSync('src/lib/erp/central-sales-composition.ts','utf8');assert.match(source,/bindingFromExistingEnvironment\(process\.env\)/);assert.doesNotMatch(source,/PRIVATE_KEY|fetch\(|getUser\(/);
 const page=fs.readFileSync('src/app/(app)/erp-insights-review/page.tsx','utf8');assert.match(page,/runtime='nodejs'/);assert.match(page,/await readConfiguredCurrentCentralSales/);assert.doesNotMatch(page,/params\.(userId|expectedRequesterId|role|token|host)/);
});
