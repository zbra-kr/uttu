const test=require('node:test'),assert=require('node:assert/strict');
const load=require('./helpers/load-source.cjs');
Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture',ANTHROPIC_API_KEY:'fixture',MCP_ASK_DAILY_TOKEN_LIMIT:'100000'});
test.beforeEach(t=>t.mock.method(global,'fetch',()=>assert.fail('Live fetch is forbidden')));
const tool=(input=1000,output=100)=>({usage:{input_tokens:input,output_tokens:output},stop_reason:'tool_use',content:[{type:'text',text:'fixture partial'},{type:'tool_use',id:'fixture-tool',name:'query_db',input:{sql:'SELECT 1'}}]});
const done=(usage={input_tokens:1000,output_tokens:100})=>({usage,stop_reason:'end_turn',content:[{type:'text',text:'fixture answer'}]});
function scenario(responses,opts={}){
 const requests=[],dbCalls=[],tools={};let index=0,successfulWrites=0;
 let row={usage_date:new Date(Date.now()+9*3600000).toISOString().slice(0,10),input_tokens:0,output_tokens:0,call_count:0};
 const db={async rpc(name){assert.equal(name,'exec_ai_query');return {data:[{fixture:1}],error:null};},from(table){assert.equal(table,'mcp_usage_daily');return {
  op:'read',filters:[],columns:'',select(v){this.columns=v;return this;},eq(k,v){this.filters.push([k,v]);return this;},maybeSingle(){return this;},abortSignal(signal){this.signal=signal;return this;},
  update(v){this.op='update';this.value=v;return this;},insert(v){this.op='insert';this.value=v;return this;},
  then(yes,no){return Promise.resolve().then(async()=>{
   dbCalls.push({op:this.op,filters:[...this.filters],value:this.value,signal:this.signal});
   if(this.op==='read')return {data:{...row},error:null};
   if(opts.hangWrite)return await new Promise(()=>{});
   if(opts.ambiguousWrite){row={...row,...this.value};successfulWrites++;throw Error('fixture transport after commit');}
   if(opts.conflictOnce&&!dbCalls.slice(0,-1).some(c=>c.op==='update'))return {data:[],error:null};
   assert.ok(this.filters.every(([k,v])=>row[k]===v));row={...row,...this.value};successfulWrites++;return {data:[{...row}],error:null};
  }).then(yes,no);}
 };}};
 class Anthropic {messages={async create(request,options){requests.push({request,options});assert.ok(index<responses.length,'No new inference/retry');const next=responses[index++];if(typeof next==='function')return next(options);if(next instanceof Error)throw next;return next;}};}
 const mocks={'@anthropic-ai/sdk':Anthropic,'@/lib/ai-schema':{DB_SCHEMA:'fixture schema'},'@supabase/supabase-js':{createClient:()=>db},'mcp-handler':{createMcpHandler(register){register({registerTool(name,_,fn){tools[name]=fn;}});return tools;}}};
 const {createUttuMcpHandler}=load('src/lib/mcp/handler.ts',mocks);createUttuMcpHandler('/fixture');
 return {ask:()=>tools.ask_uttu({question:'fixture question'}),pipeline:load('src/lib/ai/pipeline.ts',mocks),db,requests,dbCalls,row:()=>row,successfulWrites:()=>successfulWrites};
}
function assertUsage(s,input,output){assert.equal(s.row().input_tokens,input);assert.equal(s.row().output_tokens,output);assert.equal(s.row().call_count,1);assert.equal(s.successfulWrites(),1);assert.equal(s.dbCalls.filter(c=>c.op==='insert').length,0);}

const generic='분석 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
const sentinel='PRIVATE_FIXTURE token=private-fixture https://fixture.invalid/?key=private-fixture SELECT secret_fixture';
for(const [label,error,expected] of [
 ['raw provider Error',Error(sentinel),generic],
 ['throwing message getter',Object.defineProperty(Error('fixture'),'message',{get(){throw Error(sentinel);}}),generic],
 ['throwing name getter',Object.defineProperty(Error('fixture'),'name',{get(){throw Error(sentinel);}}),generic],
 ['provider cancellation',Object.assign(Error(sentinel),{name:'AbortError'}),'분석이 취소되었습니다. 필요하면 다시 요청해 주세요.'],
 ['workspace limit',Error('workspace API usage limits '+sentinel),null],
])test(`integrated confirmed usage and safe error: ${label}`,async t=>{
 const logs=[];for(const method of ['warn','error','log'])t.mock.method(console,method,(...args)=>logs.push(args));
 const s=scenario([tool(),tool(40,8),error]),response=await s.ask();
 if(expected)assert.deepEqual(response,{content:[{type:'text',text:expected}]});else assert.match(response.content[0].text,/월별 API 한도/);
 assert.ok(!JSON.stringify([response,logs]).includes('private-fixture'));assert.deepEqual(logs,[]);
 assertUsage(s,1040,108);assert.equal(s.requests.length,3);assert.equal(s.dbCalls.filter(c=>c.op==='update').length,1);
});
test('integrated safe error and confirmed usage retain CAS retry without inference retry',async()=>{
 const s=scenario([tool(),Error(sentinel)],{conflictOnce:true});assert.equal((await s.ask()).content[0].text,generic);assertUsage(s,1000,100);assert.equal(s.requests.length,2);assert.equal(s.dbCalls.filter(c=>c.op==='update').length,2);
});
test('integrated ambiguous commit preserves safe response and never replays settlement',async t=>{
 const logs=[];t.mock.method(console,'warn',m=>logs.push(m));const s=scenario([tool(),Error(sentinel)],{ambiguousWrite:true});
 assert.equal((await s.ask()).content[0].text,generic);assertUsage(s,1000,100);assert.deepEqual(logs,['mcp_usage_settlement status=unknown reason=write_failed']);assert.equal(s.dbCalls.filter(c=>c.op==='update').length,1);
});
test('integrated 25s timeout plus 2s hung settlement stays bounded with safe text',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});const logs=[];t.mock.method(console,'warn',m=>logs.push(m));
 const s=scenario([tool(),opts=>new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>reject(Error(sentinel)),{once:true}))],{hangWrite:true});
 let resolved=false;const run=s.ask().then(r=>{resolved=true;return r;});await new Promise(setImmediate);t.mock.timers.tick(25000);await new Promise(setImmediate);
 assert.equal(resolved,false);t.mock.timers.tick(1999);await new Promise(setImmediate);assert.equal(resolved,false);t.mock.timers.tick(1);
 assert.deepEqual(await run,{content:[{type:'text',text:'분석 시간 초과(25초)입니다. 질문을 더 구체적으로 바꾸거나 나누어 시도해 주세요.'}]});
 assert.equal(s.requests.length,2);assert.equal(s.dbCalls.filter(c=>c.op==='update').length,1);assert.equal(s.row().call_count,0);assert.ok(s.dbCalls.find(c=>c.op==='update').signal.aborted);assert.deepEqual(logs,['mcp_usage_settlement status=unknown reason=deadline']);
});
test('integrated incomplete pair excludes known axis, keeps confirmed usage and safe failure',async t=>{
 const logs=[];t.mock.method(console,'warn',m=>logs.push(m));const s=scenario([tool(),{...tool(40,8),usage:{input_tokens:40}},Error(sentinel)]);
 assert.equal((await s.ask()).content[0].text,generic);assertUsage(s,1040,100);assert.equal(s.requests.length,3);assert.deepEqual(logs,['mcp_inference_usage status=incomplete reason=missing_or_invalid_usage']);
});
