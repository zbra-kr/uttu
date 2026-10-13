const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),load=require('./helpers/load-source.cjs');
const A=load('src/lib/erp/requester-allowlist.ts'),B=load('src/lib/erp/existing-node-binding.ts'),D=load('src/lib/erp/existing-binding-diagnostics.ts');
const ids=['12345678-1234-1234-1234-123456789abc','87654321-1234-1234-1234-123456789abc'],other='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',scope={brand:'CO',from:'2026-10-12',to:'2026-10-12'};
const key=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString();
const env=()=>({UTTU_ERP_REQUESTER_ID:ids[0],SNOWFLAKE_REST_ORIGIN:'https://syn-host.snowflakecomputing.com',SNOWFLAKE_ACCOUNT:'SYN_ACCOUNT',SNOWFLAKE_USER:'SYN_USER',SNOWFLAKE_DATABASE:'SYN_DB',SNOWFLAKE_SCHEMA:'SYN_SCHEMA',SNOWFLAKE_WAREHOUSE:'SYN_WH',SNOWFLAKE_ROLE:'SYN_ROLE',SNOWFLAKE_PRIVATE_KEY:key});
test('legacy single and new one/two UUID lists preserve canonical IDs and freeze lists',()=>{
 assert.deepEqual(A.requesterIdsFromEnvironment(env()),[ids[0]]);assert.equal(B.bindingFromExistingEnvironment(env()).expectedRequesterIds,undefined);
 for(const list of [[ids[0].toUpperCase()],ids]){const e={...env(),UTTU_ERP_REQUESTER_IDS:JSON.stringify(list)},actual=A.requesterIdsFromEnvironment(e);assert.deepEqual(actual,list.map(id=>id.toLowerCase()));assert.ok(Object.isFrozen(actual));assert.deepEqual(B.bindingFromExistingEnvironment(e).expectedRequesterIds,actual);}
});
test('empty, duplicate, malformed or oversized plural settings never fall back to valid singular',()=>{
 for(const value of ['', '[]','null','{}',JSON.stringify(ids[0]),JSON.stringify([ids[0],ids[0].toUpperCase()]),JSON.stringify([ids[0],'']),JSON.stringify([ids[0],'bad']),JSON.stringify([...ids,other]),JSON.stringify([ids[0],42]),JSON.stringify([' '+ids[0]]),ids.join(',')]){const e={...env(),UTTU_ERP_REQUESTER_IDS:value};assert.equal(A.requesterIdsFromEnvironment(e),null);assert.equal(B.bindingFromExistingEnvironment(e),null);}
 for(const value of ['',ids.join(','),'bad',undefined])assert.equal(A.requesterIdsFromEnvironment({UTTU_ERP_REQUESTER_ID:value}),null);
});
test('plural is authoritative and cannot additionally authorize old singular',()=>{const e={...env(),UTTU_ERP_REQUESTER_ID:other,UTTU_ERP_REQUESTER_IDS:JSON.stringify(ids)};assert.deepEqual(A.requesterIdsFromEnvironment(e),ids);assert.equal(B.bindingFromExistingEnvironment(e).expectedRequesterId,ids[0]);});
const actor=(userId,role='viewer')=>({userId,role});
async function read(actors,{binding,query=scope,failure=false}={}){
 let auth=0,transport=0,signing=0,http=0;const Rest=load('src/lib/erp/central-sales-rest.ts');
 const C=load('src/lib/erp/requester-sales-rest.ts',{'./central-sales-rest':{...Rest,createCentralRestExecutor:(rest,fetcher)=>{transport++;return Rest.createCentralRestExecutor(rest,fetcher);}}});
 const supplied=binding??{expectedRequesterId:ids[0],expectedRequesterIds:ids,rest:{origin:'https://syn-host.snowflakecomputing.com',database:'SYN_DB',schema:'SYN_SCHEMA',warehouse:'SYN_WH',role:'SYN_ROLE',getToken:async()=>{signing++;return 'SYN_TOKEN';}}};
 const state=await C.readAuthenticatedRequesterRestSales(query,supplied,async()=>{const a=actors[Math.min(auth++,actors.length-1)];if(a instanceof Error)throw a;return a;},async()=>{
  http++;if(failure)return new Response(JSON.stringify({message:'SYN_PRIVATE_ERROR'}),{status:500});
  const data=http===1?{code:'090001',sqlState:'00000',statementHandle:'syn-plan',resultSetMetaData:{numRows:1,format:'jsonv2',partitionInfo:[{rowCount:1}]},data:[[JSON.stringify({GlobalStats:{bytesAssigned:1000,partitionsAssigned:1}})]]}:{code:'090001',sqlState:'00000',statementHandle:'syn-data',resultSetMetaData:{numRows:1,format:'jsonv2',rowType:['BRANDCD','STYLECD','SALEDT','SALES_VAT_EX'].map((name,i)=>({name,type:i===3?'real':'text'})),partitionInfo:[{rowCount:1}]},data:[['CO','SYN_STYLE','20261012','1']]};
  return new Response(JSON.stringify(data),{status:200});
 });return {state,auth,transport,signing,http};
}
test('both allowed UUIDs reach real REST code and DTO with existing viewer/admin roles',async()=>{for(const id of ids)for(const role of ['viewer','admin']){const r=await read([actor(id,role)]);assert.equal(r.state.kind,'observed');assert.equal(r.auth,3);assert.equal(r.transport,1);assert.equal(r.signing,1);assert.equal(r.http,2);assert.doesNotMatch(JSON.stringify(r.state),new RegExp(ids.join('|')+'|SYN_TOKEN'));}});
test('unlisted users, unknown roles and URL identity spoof cannot touch signer or transport',async()=>{
 for(const who of [actor(other),actor(other,'admin'),null,actor(ids[0],null),actor(ids[0],'owner')]){const r=await read([who],{query:{...scope,userId:ids[0],expectedRequesterId:other,expectedRequesterIds:[other],role:'admin'}});assert.equal(r.state.kind,'withheld');assert.equal(r.transport,0);assert.equal(r.signing,0);assert.equal(r.http,0);}
 const invalid=await read([actor(ids[0])],{query:{}});assert.equal(invalid.state.kind,'request');assert.equal(invalid.auth,0);
});
test('allowed-user switch and role changes during pin issuance/consumption fail before signing or HTTP',async()=>{for(const sequence of [[actor(ids[0]),actor(ids[0],'admin')],[actor(ids[0]),actor(ids[1])],[actor(ids[1]),actor(ids[1]),actor(ids[0])],[actor(ids[0]),actor(ids[0]),actor(ids[0],'admin')],[actor(ids[1]),null],[new Error('SYN_AUTH_SECRET')]]){const r=await read(sequence);assert.notEqual(r.state.kind,'observed');assert.equal(r.signing,0);assert.equal(r.http,0);assert.doesNotMatch(JSON.stringify(r.state),/SYN_AUTH_SECRET/);}});
test('invalid binding arrays fail closed, singular keeps original auth path, REST failure propagates safely',async()=>{
 for(const list of [[],[ids[0],ids[0]],[ids[0],'bad'],null]){const r=await read([actor(ids[0])],{binding:{expectedRequesterId:ids[0],expectedRequesterIds:list,rest:null}});assert.equal(r.state.kind,'withheld');assert.equal(r.auth,0);assert.equal(r.transport,0);}
 const legacy=await read([actor(ids[0])],{binding:{expectedRequesterId:ids[0],rest:null}});assert.equal(legacy.state.kind,'unconnected');assert.equal(legacy.auth,2);
 const failed=await read([actor(ids[1])],{failure:true});assert.equal(failed.state.kind,'error');assert.equal(failed.http,1);assert.doesNotMatch(JSON.stringify(failed.state),/SYN_PRIVATE_ERROR|SYN_TOKEN|SYN_STYLE/);
});
// Give the environment-owning helper a lexical synthetic process. No inherited
// process.env value is saved, read, overwritten or restored by these tests.
function configuredDiagnostics(syntheticEnv,ambientProcess={env:{}}){
 const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),vm=require('node:vm');
 const source=fs.readFileSync(path.resolve(__dirname,'../src/lib/erp/existing-binding-diagnostics.ts'),'utf8');
 const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}});
 const mod={exports:{}};
 const dependencies={'server-only':{},'node:crypto':crypto,'./existing-node-binding':B,'./requester-allowlist':A};
 const compile=vm.runInNewContext('(function(process,require,module,exports){'+outputText+'\n})',{process:ambientProcess,URL});
 compile({env:syntheticEnv},name=>{assert.ok(Object.hasOwn(dependencies,name));return dependencies[name];},mod,mod.exports);
 return mod.exports.configuredBindingDiagnosticsForActor;
}
test('only allowed own admins see fixed diagnostics, viewers and invalid list receive no details',()=>{
 const synthetic={...env(),UTTU_ERP_REQUESTER_ID:other,UTTU_ERP_REQUESTER_IDS:JSON.stringify(ids)};
 const configured=configuredDiagnostics(synthetic);
 for(const id of ids){const details=configured(actor(id,'admin'));assert.ok(details);assert.ok(details.every(c=>c.code==='PASS'));assert.equal(details.find(c=>c.field==='UTTU_ERP_REQUESTER_IDS').code,'PASS');assert.doesNotMatch(JSON.stringify(details),new RegExp(ids.join('|')));assert.equal(configured(actor(id)),undefined);}
 assert.equal(configured(actor(other,'admin')),undefined);
 synthetic.UTTU_ERP_REQUESTER_IDS='[]';assert.equal(configured(actor(ids[0],'admin')),undefined);
 assert.ok(D.diagnoseExistingBindingEnvironment({...env(),UTTU_ERP_REQUESTER_IDS:JSON.stringify(ids)}).every(c=>c.code==='PASS'));
});
test('ambient synthetic private key and passphrase are never accessed by configured diagnostic tests',()=>{
 let ambientReads=0;
 const ambientEnv={UTTU_ERP_REQUESTER_ID:ids[0],UTTU_ERP_REQUESTER_IDS:JSON.stringify(ids)};
 for(const [name,value] of [['SNOWFLAKE_PRIVATE_KEY','SYN_AMBIENT_PRIVATE_KEY'],['SNOWFLAKE_PRIVATE_KEY_PASSPHRASE','SYN_AMBIENT_PASSPHRASE']])Object.defineProperty(ambientEnv,name,{get(){ambientReads++;return value;}});
 const configured=configuredDiagnostics({...env(),UTTU_ERP_REQUESTER_IDS:JSON.stringify(ids)},{env:ambientEnv});
 for(const id of ids){const checks=configured(actor(id,'admin'));assert.ok(checks.every(c=>c.code==='PASS'));assert.doesNotMatch(JSON.stringify(checks),/SYN_AMBIENT/);}
 assert.equal(ambientReads,0);
});
