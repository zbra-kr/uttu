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
for(const error of ['fixture provider failure','workspace API usage limits'])test(`MCP records confirmed prior response after later failure: ${error}`,async()=>{
 const s=scenario([tool(),Error(error)]),answer=await s.ask();assertUsage(s,1000,100);assert.equal(s.requests.length,2);assert.equal(s.dbCalls.filter(c=>c.op==='update').length,1);
 assert.match(answer.content[0].text,error.includes('workspace')?/월별 API 한도/:/분석 중 오류가 발생했습니다/);
});
test('MCP aggregates two confirmed responses once before third call fails',async()=>{
 const s=scenario([tool(),tool(40,8),Error('fixture failure')]);await s.ask();assertUsage(s,1040,108);assert.equal(s.requests.length,3);assert.equal(s.dbCalls.filter(c=>c.op==='update').length,1);
});
test('confirmed usage survives response parsing failure',async()=>{
 const s=scenario([{usage:{input_tokens:40,output_tokens:8},content:null}]);assert.match((await s.ask()).content[0].text,/분석 중 오류가 발생했습니다/);assertUsage(s,40,8);assert.equal(s.requests.length,1);
});
test('no returned provider usage on first-call failure means no settlement',async()=>{
 const s=scenario([Error('fixture first failure')]);assert.match((await s.ask()).content[0].text,/분석 중 오류가 발생했습니다/);assert.equal(s.dbCalls.filter(c=>c.op!=='read').length,0);assert.equal(s.row().call_count,0);
});
test('successful MCP response settles exactly once without observer/result double count',async()=>{
 const s=scenario([tool(),done({input_tokens:40,output_tokens:8})]);assert.equal((await s.ask()).content[0].text,'fixture answer');assertUsage(s,1040,108);assert.equal(s.requests.length,2);assert.equal(s.dbCalls.filter(c=>c.op==='update').length,1);
});
for(const badUsage of [undefined,null,{}, {input_tokens:40}, {output_tokens:8},{input_tokens:'40',output_tokens:8},{input_tokens:-1,output_tokens:8},{input_tokens:0.5,output_tokens:8},{input_tokens:NaN,output_tokens:8},{input_tokens:Infinity,output_tokens:8}])test(`unknown/invalid pair is not invented or written ${JSON.stringify(badUsage)}`,async t=>{
 const warnings=[];t.mock.method(console,'warn',m=>warnings.push(m));const response=done();
 if(badUsage===undefined)delete response.usage;else response.usage=badUsage;
 const s=scenario([response]);
 assert.equal((await s.ask()).content[0].text,'fixture answer');const known=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:0;const input=known(badUsage?.input_tokens),output=known(badUsage?.output_tokens);if(input||output)assertUsage(s,input,output);else{assert.equal(s.dbCalls.filter(c=>c.op!=='read').length,0);assert.equal(s.row().call_count,0);}assert.ok(warnings.some(m=>m==='mcp_inference_usage status=incomplete reason=missing_or_invalid_usage'));
});
test('unknown later response does not poison or inflate earlier confirmed usage',async t=>{
 t.mock.method(console,'warn',()=>{});const s=scenario([tool(),done({input_tokens:40})]);assert.equal((await s.ask()).content[0].text,'fixture answer');assertUsage(s,1040,100);
});
test('pipeline exposes unknown token axes as null instead of zero',async()=>{
 const observed=[],s=scenario([done({input_tokens:40})]),r=await s.pipeline.runInferenceLoop({question:'fixture',supabase:s.db,onUsage:u=>observed.push(u)});
 assert.deepEqual(observed,[{inputTokens:40,outputTokens:null,responseKey:'turn:0'}]);assert.equal(r.inputTokens,40);assert.equal(r.outputTokens,null);
});
test('confirmed zero pair is known but does not add a call count',async()=>{
 const observed=[],s=scenario([done({input_tokens:0,output_tokens:0})]),r=await s.pipeline.runInferenceLoop({question:'fixture',supabase:s.db,onUsage:u=>observed.push(u)});
 assert.deepEqual(observed,[{inputTokens:0,outputTokens:0,responseKey:'turn:0'}]);assert.equal(r.inputTokens,0);assert.equal(r.outputTokens,0);
 const handler=scenario([done({input_tokens:0,output_tokens:0})]);await handler.ask();assert.equal(handler.dbCalls.filter(c=>c.op!=='read').length,0);assert.equal(handler.row().call_count,0);
});
test('CAS zero-row retry keeps one logical partial-response settlement',async()=>{
 const s=scenario([tool(),Error('fixture failure')],{conflictOnce:true});await s.ask();assertUsage(s,1000,100);assert.equal(s.dbCalls.filter(c=>c.op==='update').length,2);assert.equal(s.requests.length,2);
});
test('existing max-turn partial result still settles once without a fourth provider call',async()=>{
 const s=scenario([tool(),tool(40,8),tool(5,1)]);assert.equal((await s.ask()).content[0].text,'fixture partial');assertUsage(s,1045,109);assert.equal(s.requests.length,3);assert.equal(s.dbCalls.filter(c=>c.op==='update').length,1);
});
test('ambiguous accounting write is never replayed after a provider failure',async t=>{
 const warnings=[];t.mock.method(console,'warn',m=>warnings.push(m));const s=scenario([tool(),Error('fixture failure')],{ambiguousWrite:true});await s.ask();assertUsage(s,1000,100);assert.equal(s.dbCalls.filter(c=>c.op==='update').length,1);assert.deepEqual(warnings,['mcp_usage_settlement status=unknown reason=write_failed']);
});
test('timeout after confirmed response settles within a separate bounded accounting budget',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});let signal;
 const s=scenario([tool(),options=>new Promise((_,reject)=>{signal=options.signal;signal.addEventListener('abort',()=>reject(Error('fixture aborted')),{once:true});})]);
 const result=s.ask();await new Promise(setImmediate);t.mock.timers.tick(25000);const answer=await result;assert.match(answer.content[0].text,/분석 시간 초과/);assert.ok(signal.aborted);assertUsage(s,1000,100);assert.equal(s.dbCalls.filter(c=>c.op==='update').length,1);
});
test('failed inference with a hung settlement remains bounded and does not replay',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});const warnings=[];t.mock.method(console,'warn',m=>warnings.push(m));const s=scenario([tool(),Error('fixture failure')],{hangWrite:true});
 const result=s.ask();await new Promise(setImmediate);t.mock.timers.tick(2000);assert.match((await result).content[0].text,/분석 중 오류가 발생했습니다/);assert.equal(s.dbCalls.filter(c=>c.op==='update').length,1);assert.ok(s.dbCalls.find(c=>c.op==='update').signal.aborted);assert.deepEqual(warnings,['mcp_usage_settlement status=unknown reason=deadline']);
});
