const test=require('node:test'),assert=require('node:assert/strict');
const load=require('./helpers/load-source.cjs');
Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture',ANTHROPIC_API_KEY:'fixture',MCP_ASK_DAILY_TOKEN_LIMIT:'100000'});
test.beforeEach(t=>t.mock.method(global,'fetch',()=>assert.fail('Live fetch is forbidden')));
const tool=(input=1000,output=100)=>({usage:{input_tokens:input,output_tokens:output},stop_reason:'tool_use',content:[{type:'text',text:'fixture partial'},{type:'tool_use',id:'fixture-tool',name:'query_db',input:{sql:'SELECT 1'}}]});
const done=(usage={input_tokens:1000,output_tokens:100})=>({usage,stop_reason:'end_turn',content:[{type:'text',text:'fixture answer'}]});
function scenario(responses,opts={}){
 const requests=[],dbCalls=[],tools={};let index=0,successfulWrites=0;
 let row={usage_date:new Date(Date.now()+9*3600000).toISOString().slice(0,10),input_tokens:10,output_tokens:20,call_count:2};
 const db={async rpc(name){assert.equal(name,'exec_ai_query');return {data:[{fixture:1}],error:null};},from(table){assert.equal(table,'mcp_usage_daily');return {
  op:'read',filters:[],columns:'',select(v){this.columns=v;return this;},eq(k,v){this.filters.push([k,v]);return this;},maybeSingle(){return this;},abortSignal(signal){this.signal=signal;return this;},
  update(v){this.op='update';this.value=v;return this;},insert(v){this.op='insert';this.value=v;return this;},
  then(yes,no){return Promise.resolve().then(async()=>{
   dbCalls.push({op:this.op,filters:[...this.filters],value:this.value,signal:this.signal});
   if(this.op==='read')return {data:{...row},error:null};
   if(opts.hangWrite)return await new Promise(()=>{});
   if(opts.ambiguousWrite){row={...row,...this.value};successfulWrites++;throw Error('fixture transport after commit');}
   if(opts.conflictOnce&&!dbCalls.slice(0,-1).some(c=>c.op==='update'))return {data:[],error:null};
   if(opts.concurrentConditional&&!this.filters.every(([k,v])=>row[k]===v))return {data:[],error:null};
   assert.ok(this.filters.every(([k,v])=>row[k]===v));row={...row,...this.value};successfulWrites++;return {data:[{...row}],error:null};
  }).then(yes,no);}
 };}};
 class Anthropic {messages={async create(request,options){requests.push({request,options});assert.ok(index<responses.length,'No new inference/retry');const next=responses[index++];if(typeof next==='function')return next(options);if(next instanceof Error)throw next;return next;}};}
 const mocks={'@anthropic-ai/sdk':Anthropic,'@/lib/ai-schema':{DB_SCHEMA:'fixture schema'},'@supabase/supabase-js':{createClient:()=>db},'mcp-handler':{createMcpHandler(register){register({registerTool(name,_,fn){tools[name]=fn;}});return tools;}}};
 if(opts.adapter)mocks['@/lib/ai/pipeline']={runInferenceLoop:opts.adapter,execQueryDb(){assert.fail('unexpected direct query');}};
 const {createUttuMcpHandler}=load('src/lib/mcp/handler.ts',mocks);createUttuMcpHandler('/fixture');
 return {ask:()=>tools.ask_uttu({question:'fixture question'}),pipeline:load('src/lib/ai/pipeline.ts',mocks),db,requests,dbCalls,row:()=>row,successfulWrites:()=>successfulWrites};
}
function assertUsage(s,input,output){assert.equal(s.row().input_tokens,input);assert.equal(s.row().output_tokens,output);assert.equal(s.row().call_count,3);assert.equal(s.successfulWrites(),1);assert.equal(s.dbCalls.filter(c=>c.op==='insert').length,0);}

const generic='분석 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
for(const [label,usage,input,output] of [
 ['input only',{input_tokens:40},50,20],['output only',{output_tokens:8},10,28],
 ['invalid output keeps input',{input_tokens:40,output_tokens:-1},50,20],['invalid input keeps output',{input_tokens:NaN,output_tokens:8},10,28],
])test(`confirmed axes preserve existing unknown-axis total: ${label}`,async t=>{
 t.mock.method(console,'warn',()=>{});const s=scenario([done(usage)]);assert.equal((await s.ask()).content[0].text,'fixture answer');assertUsage(s,input,output);
 const write=s.dbCalls.find(c=>c.op==='update');assert.equal(Object.hasOwn(write.value,label.startsWith('output')||label.startsWith('invalid input')?'input_tokens':'output_tokens'),false);
});
test('confirmed complete step then input-only step and failure settle once',async t=>{
 t.mock.method(console,'warn',()=>{});const partial=tool(40,8);delete partial.usage.output_tokens;const s=scenario([tool(),partial,Error('fixture failure')]);assert.equal((await s.ask()).content[0].text,generic);assertUsage(s,1050,120);assert.equal(s.requests.length,3);
});
test('pipeline keeps unknown axis null and known input independently',async()=>{
 const s=scenario([done({input_tokens:40})]),events=[],result=await s.pipeline.runInferenceLoop({question:'fixture',supabase:s.db,onUsage:u=>events.push(u)});
 assert.equal(result.inputTokens,40);assert.equal(result.outputTokens,null);assert.equal(events[0].inputTokens,40);assert.equal(events[0].outputTokens,null);
});

for(const axis of ['input_tokens','output_tokens'])for(const bad of [-1,0.5,NaN,Infinity,-Infinity,'40',Number.MAX_SAFE_INTEGER+1,2_147_483_648])test(`invalid ${axis} independently preserves opposite axis: ${String(bad)}`,async t=>{
 t.mock.method(console,'warn',()=>{});const usage={input_tokens:40,output_tokens:8,[axis]:bad},s=scenario([done(usage)]);await s.ask();assertUsage(s,axis==='input_tokens'?10:50,axis==='output_tokens'?20:28);
});
for(const usage of [undefined,null,{}, {input_tokens:0}, {output_tokens:0}, {input_tokens:0,output_tokens:0}])test(`unknown or confirmed zero usage never fabricates a positive delta: ${JSON.stringify(usage)}`,async t=>{
 t.mock.method(console,'warn',()=>{});const response=done(usage);if(usage===undefined)delete response.usage;const s=scenario([response]);await s.ask();assert.equal(s.row().input_tokens,10);assert.equal(s.row().output_tokens,20);assert.equal(s.row().call_count,2);assert.equal(s.successfulWrites(),0);
});
for(const axis of ['input_tokens','output_tokens'])test(`one confirmed ${axis} survives later provider failure`,async t=>{
 t.mock.method(console,'warn',()=>{});const first=tool();first.usage=axis==='input_tokens'?{input_tokens:40}:{output_tokens:8};const s=scenario([first,Error('fixture provider failure')]);assert.equal((await s.ask()).content[0].text,generic);assertUsage(s,axis==='input_tokens'?50:10,axis==='output_tokens'?28:20);
});
for(const axis of ['input_tokens','output_tokens'])test(`one confirmed ${axis} survives 25s timeout and retains safe text`,async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});t.mock.method(console,'warn',()=>{});const first=tool();first.usage=axis==='input_tokens'?{input_tokens:40}:{output_tokens:8};
 const s=scenario([first,opts=>new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>reject(Error('private fixture')),{once:true}))]);const run=s.ask();await new Promise(setImmediate);t.mock.timers.tick(25000);assert.match((await run).content[0].text,/분석 시간 초과/);assertUsage(s,axis==='input_tokens'?50:10,axis==='output_tokens'?28:20);assert.equal(s.requests.length,2);
});
test('partial-axis hung failure settlement retains the independent 2s bound without retry',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});const logs=[];t.mock.method(console,'warn',m=>logs.push(m));const first=tool();first.usage={input_tokens:40};const s=scenario([first,Error('private fixture')],{hangWrite:true});let finished=false;const run=s.ask().then(r=>{finished=true;return r;});await new Promise(setImmediate);t.mock.timers.tick(1999);await new Promise(setImmediate);assert.equal(finished,false);t.mock.timers.tick(1);assert.equal((await run).content[0].text,generic);assert.equal(s.dbCalls.filter(c=>c.op==='update').length,1);assert.equal(s.row().call_count,2);assert.equal(s.successfulWrites(),0);assert.ok(logs.includes('mcp_usage_settlement status=unknown reason=deadline'));
});
for(const outcome of ['success','failure'])test(`duplicate keyed callbacks settle each confirmed axis once: ${outcome}`,async()=>{
 const s=scenario([],{adapter:async opts=>{for(let i=0;i<3;i++)opts.onUsage({responseKey:'response:fixture-1',inputTokens:40,outputTokens:8});if(outcome==='failure')throw Error('private fixture');return {text:'fixture answer',inputTokens:120,outputTokens:24};}});assert.equal((await s.ask()).content[0].text,outcome==='failure'?generic:'fixture answer');assertUsage(s,50,28);assert.equal(s.dbCalls.filter(c=>c.op==='update').length,1);
});
test('duplicate key can fill previously unknown axis but never re-add a confirmed axis',async t=>{
 t.mock.method(console,'warn',()=>{});const s=scenario([],{adapter:async opts=>{opts.onUsage({responseKey:'response:fixture-1',inputTokens:40,outputTokens:null});opts.onUsage({responseKey:'response:fixture-1',inputTokens:999,outputTokens:8});opts.onUsage({responseKey:'response:fixture-1',inputTokens:40,outputTokens:8});return {text:'fixture answer',inputTokens:999,outputTokens:8};}});await s.ask();assertUsage(s,50,28);
});
test('legacy unkeyed same-object duplicate is deduplicated without inferring distinct response identity',async()=>{
 const s=scenario([],{adapter:async opts=>{const event={inputTokens:40,outputTokens:8};opts.onUsage(event);opts.onUsage(event);return {text:'fixture answer',inputTokens:80,outputTokens:16};}});await s.ask();assertUsage(s,50,28);
});
test('pipeline and handler count reused provider id separately across turns',async()=>{
 const first={...tool(40,8),id:'fixture-msg'},last={...done({input_tokens:40,output_tokens:8}),id:'fixture-msg'};const s=scenario([first,last]);await s.ask();assertUsage(s,90,36);assert.equal(s.requests.length,2);
 const p=scenario([first,last]),r=await p.pipeline.runInferenceLoop({question:'fixture',supabase:p.db});assert.equal(r.inputTokens,80);assert.equal(r.outputTokens,16);
});
test('equal usage values from distinct provider ids are counted independently',async()=>{
 const s=scenario([{...tool(40,8),id:'fixture-msg1'},{...done({input_tokens:40,output_tokens:8}),id:'fixture-msg2'}]);await s.ask();assertUsage(s,90,36);
});
test('aggregate overflow excludes only unrepresentable new axis and preserves earlier confirmed lower bound',async t=>{
 t.mock.method(console,'warn',()=>{});const s=scenario([tool(2_147_483_600,8),done({input_tokens:100,output_tokens:2})]);await s.ask();assertUsage(s,2_147_483_610,30);
});
test('confirmed ledger distinguishes missing and confirmed zero without unsafe numbers',()=>{
 const {ConfirmedUsageLedger}=load('src/lib/ai/confirmed-usage.ts',{}),ledger=new ConfirmedUsageLedger();ledger.observe({responseKey:'fixture',inputTokens:0,outputTokens:null});assert.equal(ledger.inputTokens,0);assert.equal(ledger.outputTokens,null);assert.equal(ledger.incomplete,true);
});
test('partial-axis helper INSERT omits unknown axis instead of claiming observed zero',async()=>{
 const {accumulateMcpDailyUsage}=load('src/lib/ai/usage-accounting.ts',{});let payload,selected;
 const db={from(){return {select(cols){selected=cols;return this;},eq(){return this;},abortSignal(){return this;},maybeSingle:async()=>({data:null,error:null}),insert(value){payload=value;return this;},then(resolve){return Promise.resolve({data:[{...payload}],error:null}).then(resolve);}};}};
 assert.deepEqual(await accumulateMcpDailyUsage(db,'2026-01-01',40,null),{status:'recorded',reason:'acknowledged'});assert.equal(Object.hasOwn(payload,'output_tokens'),false);assert.equal(payload.input_tokens,40);assert.equal(payload.call_count,1);assert.equal(selected,'input_tokens,call_count');
});

test('concurrent independent-axis CAS settlements preserve both totals and one counter per logical call',async()=>{
 const {accumulateMcpDailyUsage}=load('src/lib/ai/usage-accounting.ts',{}),s=scenario([],{concurrentConditional:true});
 const results=await Promise.all([accumulateMcpDailyUsage(s.db,s.row().usage_date,40,null),accumulateMcpDailyUsage(s.db,s.row().usage_date,null,8)]);
 assert.ok(results.every(r=>r.status==='recorded'));assert.equal(s.row().input_tokens,50);assert.equal(s.row().output_tokens,28);assert.equal(s.row().call_count,4);assert.equal(s.successfulWrites(),2);
 for(const c of s.dbCalls.filter(c=>c.op==='update'))assert.notEqual(Object.hasOwn(c.value,'input_tokens'),Object.hasOwn(c.value,'output_tokens'));
});
test('daily INTEGER overflow fails without any write rather than estimating or replaying',async()=>{
 const {accumulateMcpDailyUsage}=load('src/lib/ai/usage-accounting.ts',{}),s=scenario([]);const result=await accumulateMcpDailyUsage(s.db,s.row().usage_date,2_147_483_647,null);
 assert.deepEqual(result,{status:'unrecorded',reason:'invalid'});assert.equal(s.successfulWrites(),0);assert.equal(s.row().call_count,2);assert.equal(s.dbCalls.filter(c=>c.op==='update').length,0);
});

test('cross-turn reused id preserves separately confirmed 1000/100 and 40/8 usage',async t=>{
 const logs=[];t.mock.method(console,'warn',m=>logs.push(m));const s=scenario([{...tool(1000,100),id:'fixture-reused-id'},{...done({input_tokens:40,output_tokens:8}),id:'fixture-reused-id'}]);
 assert.equal((await s.ask()).content[0].text,'fixture answer');assertUsage(s,1050,128);assert.equal(s.requests.length,2);assert.equal(s.dbCalls.filter(c=>c.op==='update').length,1);assert.deepEqual(logs,[]);
});

test('pipeline observer keys are turn-scoped when provider ids are reused',async()=>{
 const s=scenario([{...tool(40,8),id:'fixture-reused-id'},{...done({input_tokens:5,output_tokens:1}),id:'fixture-reused-id'}]),events=[];
 const result=await s.pipeline.runInferenceLoop({question:'fixture',supabase:s.db,onUsage:u=>events.push(u)});
 assert.deepEqual(events.map(u=>u.responseKey),['turn:0:response:fixture-reused-id','turn:1:response:fixture-reused-id']);assert.equal(result.inputTokens,45);assert.equal(result.outputTokens,9);
});
