const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const SSR=require('react-dom/server'),load=require('./helpers/load-source.cjs');
const D=load('src/lib/erp/existing-binding-diagnostics.ts');
const {privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const id='12345678-1234-1234-1234-123456789abc';
const pem=privateKey.export({type:'pkcs8',format:'pem'}).toString();
const env=()=>({UTTU_ERP_REQUESTER_ID:id,SNOWFLAKE_REST_ORIGIN:'https://syn-host.snowflakecomputing.com',SNOWFLAKE_ACCOUNT:'SYN_ACCOUNT',SNOWFLAKE_USER:'SYN_USER',SNOWFLAKE_DATABASE:'SYN_DB',SNOWFLAKE_SCHEMA:'SYN_SCHEMA',SNOWFLAKE_WAREHOUSE:'SYN_WH',SNOWFLAKE_ROLE:'SYN_ROLE',SNOWFLAKE_PRIVATE_KEY:pem});
const code=(checks,field)=>checks.find(c=>c.field===field)?.code;
test('valid synthetic inputs return only fixed fields and PASS, without private values or identifiers',()=>{
 const checks=D.diagnoseExistingBindingEnvironment(env());assert.equal(checks.length,9);assert.ok(checks.every(c=>c.code==='PASS'));
 const text=JSON.stringify(checks);for(const marker of [id,'SYN_ACCOUNT','SYN_USER','SYN_DB','syn-host','BEGIN PRIVATE','SHA256:'])assert.ok(!text.includes(marker));
 assert.ok(checks.every(c=>Object.keys(c).sort().join(',')==='code,field'));
});
test('every required field absence has a fixed MISSING code',()=>{
 for(const field of Object.keys(env()))assert.equal(code(D.diagnoseExistingBindingEnvironment({...env(),[field]:undefined}),field),'MISSING');
});
test('field format failures identify only fixed names and never supplied invalid text',()=>{
 for(const [field,value] of [['UTTU_ERP_REQUESTER_ID','SYN_INVALID_ID'],['SNOWFLAKE_ACCOUNT','account.snowflakecomputing.com'],['SNOWFLAKE_USER','SYN_USER@example.invalid'],['SNOWFLAKE_DATABASE','SYN.BAD'],['SNOWFLAKE_SCHEMA','SYN BAD'],['SNOWFLAKE_WAREHOUSE','SYN/BAD'],['SNOWFLAKE_ROLE','SYN-ROLE'],['SNOWFLAKE_REST_ORIGIN','https://syn-host.snowflakecomputing.com/']]){
  const checks=D.diagnoseExistingBindingEnvironment({...env(),[field]:value});assert.equal(code(checks,field),'FORMAT_INVALID');assert.ok(!JSON.stringify(checks).includes(value));
 }
});
test('encrypted PEM distinguishes missing password, failed decrypt/import, and successful import without password output',()=>{
 const e={...env(),SNOWFLAKE_PRIVATE_KEY:privateKey.export({type:'pkcs8',format:'pem',cipher:'aes-256-cbc',passphrase:'SYN_PASS_ONLY'}).toString().replaceAll('\n','\\n')};
 assert.equal(code(D.diagnoseExistingBindingEnvironment(e),'SNOWFLAKE_PRIVATE_KEY_PASSPHRASE'),'PASSPHRASE_REQUIRED');
 const wrong=D.diagnoseExistingBindingEnvironment({...e,SNOWFLAKE_PRIVATE_KEY_PASSPHRASE:'SYN_WRONG_PASSWORD'});assert.equal(code(wrong,'SNOWFLAKE_PRIVATE_KEY'),'KEY_DECRYPTION_OR_IMPORT_FAILED');assert.ok(!JSON.stringify(wrong).includes('SYN_WRONG_PASSWORD'));
 const good=D.diagnoseExistingBindingEnvironment({...e,SNOWFLAKE_PRIVATE_KEY_PASSPHRASE:'SYN_PASS_ONLY'});assert.ok(good.every(c=>c.code==='PASS'));assert.ok(!JSON.stringify(good).includes('SYN_PASS_ONLY'));
});
test('malformed PEM and unsupported key size/type return safe import/shape codes',()=>{
 assert.equal(code(D.diagnoseExistingBindingEnvironment({...env(),SNOWFLAKE_PRIVATE_KEY:'SYN_PRIVATE_CONTENT'}),'SNOWFLAKE_PRIVATE_KEY'),'KEY_IMPORT_FAILED');
 for(const key of [crypto.generateKeyPairSync('rsa',{modulusLength:1024}).privateKey,crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey])assert.equal(code(D.diagnoseExistingBindingEnvironment({...env(),SNOWFLAKE_PRIVATE_KEY:key.export({type:'pkcs8',format:'pem'}).toString()}),'SNOWFLAKE_PRIVATE_KEY'),'KEY_TYPE_OR_SIZE_INVALID');
});
test('crypto errors are never inspected or serialized; original factory rejection stays a fixed code',()=>{
 let touched=0;const hostile=Object.defineProperty({},'message',{get(){touched++;throw Error('SYN_SECRET_ERROR');}});
 const bad=load('src/lib/erp/existing-binding-diagnostics.ts',{'node:crypto':{createPrivateKey:()=>{throw hostile;}}});
 assert.equal(code(bad.diagnoseExistingBindingEnvironment(env()),'SNOWFLAKE_PRIVATE_KEY'),'KEY_IMPORT_FAILED');assert.equal(touched,0);
 const rejected=load('src/lib/erp/existing-binding-diagnostics.ts',{'./existing-node-binding':{bindingFromExistingEnvironment:()=>null}});
 assert.equal(code(rejected.diagnoseExistingBindingEnvironment(env()),'SERVER_BINDING'),'BINDING_REJECTED');
});
async function runtime(role,userId,requester=id,scope={brand:'CO',from:'2026-10-12',to:'2026-10-12'}){
 const previous=process.env.UTTU_ERP_REQUESTER_ID;process.env.UTTU_ERP_REQUESTER_ID=requester;let diagnostics=0;
 try{
  const r=load('src/lib/erp/central-sales-runtime.ts',{
   '@/lib/supabase/server':{supabaseServer:async()=>({auth:{getUser:async()=>({data:{user:userId?{id:userId}:null},error:null})},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{role},error:null})})})})})},
   './central-sales-composition':{configuredCentralRequesterBinding:()=>null},
   './existing-binding-diagnostics':{diagnoseExistingBindingEnvironment:()=>{diagnostics++;return [{field:'SNOWFLAKE_PRIVATE_KEY',code:'KEY_IMPORT_FAILED'}];}},
  });return {state:await r.readConfiguredCurrentCentralSales(scope),diagnostics};
 }finally{if(previous===undefined)delete process.env.UTTU_ERP_REQUESTER_ID;else process.env.UTTU_ERP_REQUESTER_ID=previous;}
}
test('only matching existing own admin obtains fixed configuration diagnostics after auth',async()=>{
 const own=await runtime('admin',id);assert.equal(own.diagnostics,1);assert.equal(own.state.kind,'unconnected');assert.deepEqual(own.state.configurationDiagnostics,[{field:'SNOWFLAKE_PRIVATE_KEY',code:'KEY_IMPORT_FAILED'}]);
 for(const [role,user,requester] of [['viewer',id,id],['admin','87654321-1234-1234-1234-123456789abc',id],['admin',id,'SYN_INVALID_ID'],['admin',null,id],[null,id,id]]){const r=await runtime(role,user,requester);assert.equal(r.diagnostics,0);assert.equal(r.state.configurationDiagnostics,undefined);}
 const invalid=await runtime('admin',id,id,{});assert.equal(invalid.diagnostics,0);assert.equal(invalid.state.kind,'request');
});
test('actual SSR panel displays only codes and generic original status; no diagnostic UI for ordinary states',async()=>{
 const Panel=load('src/components/erp-insights/CentralSalesReadPanel.tsx').default;
 const own=await runtime('admin',id);const html=SSR.renderToStaticMarkup(Panel({state:own.state}));assert.match(html,/본인 관리자 서버 구성 진단/);assert.match(html,/KEY_IMPORT_FAILED/);assert.ok(!html.includes(id));assert.doesNotMatch(html,/BEGIN PRIVATE|SHA256:|SYN_SECRET/);
 const viewer=await runtime('viewer',id);assert.doesNotMatch(SSR.renderToStaticMarkup(Panel({state:viewer.state})),/본인 관리자 서버 구성 진단/);
});
test('existing valid binding path never invokes configuration diagnostics or changes the requester read',async()=>{
 let reads=0;const binding={expectedRequesterId:id,rest:{}};
 const r=load('src/lib/erp/central-sales-runtime.ts',{
  '@/lib/supabase/server':{supabaseServer:async()=>({auth:{getUser:async()=>({data:{user:{id}},error:null})},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{role:'admin'},error:null})})})})})},
  './central-sales-composition':{configuredCentralRequesterBinding:()=>binding},
  './existing-binding-diagnostics':{diagnoseExistingBindingEnvironment:()=>{throw Error('Unexpected diagnostic');}},
  './requester-sales-rest':{readAuthenticatedRequesterRestSales:async(scope,actual)=>{reads++;assert.equal(actual,binding);return {kind:'observed',scope};}},
 });
 const state=await r.readConfiguredCurrentCentralSales({brand:'CO',from:'2026-10-12',to:'2026-10-12'});assert.equal(state.kind,'observed');assert.equal(reads,1);assert.equal(state.configurationDiagnostics,undefined);
});
