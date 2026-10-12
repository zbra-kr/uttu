const test=require('node:test'),assert=require('node:assert/strict');
const {z}=require('zod');const load=require('./helpers/load-source.cjs');
const sentinel='SYNTHETIC_PRIVATE_MARKER token=fixture-token https://fixture.invalid/?key=fixture-query SELECT fixture_private FROM fixture_table';
Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture',MCP_ASK_DAILY_TOKEN_LIMIT:'100000'});
const generic='분석 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
const cancelled='분석이 취소되었습니다. 필요하면 다시 요청해 주세요.';
const timeout='분석 시간 초과(25초)입니다. 질문을 더 구체적으로 바꾸거나 나누어 시도해 주세요.';
test.beforeEach(t=>t.mock.method(global,'fetch',()=>assert.fail('Live fetch is forbidden')));
function fixture(error,options={}){
 const tools={},schemas={},calls=[],settlements=[],logs=[];let providerCalls=0;
 const db={from(table){assert.equal(table,'mcp_usage_daily');return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{input_tokens:0,output_tokens:0},error:null})};}};
 const mocks={'@supabase/supabase-js':{createClient:()=>db},'mcp-handler':{createMcpHandler(register){register({registerTool(name,schema,fn){tools[name]=fn;schemas[name]=schema.inputSchema;}});return tools;}},
  '@/lib/ai/pipeline':{async runInferenceLoop(opts){providerCalls++;calls.push(opts);if(options.waitForAbort)return new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>reject(error),{once:true}));if(options.success)return {text:'fixture answer',inputTokens:1000,outputTokens:100};throw error;},execQueryDb(){assert.fail('Unexpected query');}},
  '@/lib/ai/usage-accounting':{async accumulateMcpDailyUsage(...args){settlements.push(args);return {status:'recorded',reason:'acknowledged'};}},
 };
 const {createUttuMcpHandler}=load('src/lib/mcp/handler.ts',mocks);createUttuMcpHandler('/fixture');
 return {ask:()=>tools.ask_uttu({question:'fixture question'}),schema:schemas.ask_uttu,calls,settlements,providerCalls:()=>providerCalls,logs};
}
function noLeak(value){const text=JSON.stringify(value);for(const marker of ['SYNTHETIC_PRIVATE_MARKER','fixture-token','fixture-query','fixture_private','fixture_table'])assert.ok(!text.includes(marker),`Synthetic marker leaked: ${marker}`);}
for(const [name,error] of [
 ['generic provider Error',Error(sentinel)],
 ['TypeError',new TypeError(sentinel)],
 ['cause/stack-bearing Error',Object.assign(Error(sentinel),{cause:Error(sentinel),stack:sentinel})],
 ['non-Error string',sentinel],['non-Error object',{message:sentinel,code:sentinel,url:sentinel}],['unknown code',Object.assign(Error(sentinel),{code:sentinel})],
 ['Error with non-string message',Object.assign(Error(sentinel),{message:{private:sentinel}})],
 ['Error with missing message',Object.assign(Error(sentinel),{message:undefined})],
])test(`safe generic MCP error response and no new logs: ${name}`,async t=>{
 const logs=[];for(const method of ['warn','error','log'])t.mock.method(console,method,(...args)=>logs.push(args));
 const s=fixture(error),response=await s.ask();assert.deepEqual(response,{content:[{type:'text',text:generic}]});noLeak(response);noLeak(logs);assert.deepEqual(logs,[]);assert.equal(s.providerCalls(),1);assert.equal(s.settlements.length,0);
});
test('workspace quota classification retains fixed existing guidance without raw suffix',async t=>{
 const logs=[];t.mock.method(console,'error',(...args)=>logs.push(args));const s=fixture(Error('workspace API usage limits '+sentinel)),response=await s.ask();
 assert.match(response.content[0].text,/UTTU 분석 AI의 월별 API 한도가 초과되었습니다/);assert.match(response.content[0].text,/query_db/);noLeak(response);noLeak(logs);assert.equal(s.settlements.length,0);
});
test('provider cancellation has a fixed distinct response',async()=>{
 const error=Object.assign(Error(sentinel),{name:'AbortError'}),s=fixture(error),response=await s.ask();assert.deepEqual(response,{content:[{type:'text',text:cancelled}]});noLeak(response);assert.equal(s.settlements.length,0);
});
test('unknown provider error code is not treated as an allowed public message',async()=>{
 const s=fixture(Object.assign(Error(sentinel),{code:'cancelled'}));assert.equal((await s.ask()).content[0].text,generic);
});
for(const error of [Error(sentinel),Object.assign(Error('workspace API usage limits '+sentinel),{name:'AbortError'})])test('controller timeout takes priority and preserves existing text',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});const s=fixture(error,{waitForAbort:true}),run=s.ask();await new Promise(setImmediate);t.mock.timers.tick(25000);const response=await run;assert.deepEqual(response,{content:[{type:'text',text:timeout}]});noLeak(response);assert.equal(s.providerCalls(),1);assert.ok(s.calls[0].signal.aborted);assert.equal(s.settlements.length,0);
});
test('normal MCP answer and existing single settlement contract stay unchanged',async()=>{
 const s=fixture(null,{success:true});assert.deepEqual(await s.ask(),{content:[{type:'text',text:'fixture answer'}]});assert.equal(s.providerCalls(),1);assert.equal(s.settlements.length,1);assert.deepEqual(s.settlements[0].slice(2,4),[1000,100]);
});
for(const question of ['', 'x'.repeat(501), 42])test('existing input schema validation remains separate from inference errors',()=>{
 const s=fixture(Error(sentinel)),result=z.object(s.schema).safeParse({question});assert.equal(result.success,false);assert.ok(result.error.issues.every(i=>i.path[0]==='question'));assert.equal(s.providerCalls(),0);assert.equal(s.settlements.length,0);noLeak(result.error.issues);
});
for(const [label,makeError] of [
 ['message getter throws',()=>Object.defineProperty(Error('fixture'),'message',{get(){throw Error(sentinel);}})],
 ['name getter throws',()=>Object.defineProperty(Error('fixture'),'name',{get(){throw Error(sentinel);}})],
 ['message changes across reads',()=>{let reads=0;return Object.defineProperty(Error('fixture'),'message',{get(){return ++reads===1?sentinel:null;}});}],
 ['Proxy prototype trap throws',()=>new Proxy(Error('fixture'),{getPrototypeOf(){throw Error(sentinel);}})],
])test(`classifier adversarial fallback: ${label}`,async t=>{
 const logs=[];for(const method of ['warn','error','log'])t.mock.method(console,method,(...args)=>logs.push(args));const s=fixture(makeError());
 const response=await s.ask();assert.deepEqual(response,{content:[{type:'text',text:generic}]});noLeak(response);assert.deepEqual(logs,[]);assert.equal(s.settlements.length,0);
});
test('Proxy property trap and revoked Proxy cannot escape the response boundary',async()=>{
 const revoked=Proxy.revocable(Error('fixture'),{});revoked.revoke();
 for(const error of [new Proxy(Error('fixture'),{get(){throw Error(sentinel);}}),revoked.proxy])assert.deepEqual(await fixture(error).ask(),{content:[{type:'text',text:generic}]});
});
test('message and name are read only once; no untrusted coercion happens',async()=>{
 let messages=0,names=0,coercions=0;
 const message={toString(){coercions++;throw Error(sentinel);},[Symbol.toPrimitive](){coercions++;throw Error(sentinel);}};
 const error=Object.defineProperties(Error('fixture'),{message:{get(){messages++;return message;}},name:{get(){names++;return 'Error';}}});
 assert.deepEqual(await fixture(error).ask(),{content:[{type:'text',text:generic}]});assert.equal(messages,1);assert.equal(names,1);assert.equal(coercions,0);
});
test('changing message getter is not read twice',async()=>{
 let reads=0;const error=Object.defineProperty(Error('fixture'),'message',{get(){if(++reads===1)return sentinel;throw Error(sentinel);}});
 assert.deepEqual(await fixture(error).ask(),{content:[{type:'text',text:generic}]});assert.equal(reads,1);
});
test('workspace guidance reads message once and never reads an unnecessary name getter',async()=>{
 let messages=0,names=0;const error=Object.defineProperties(Error('fixture'),{message:{get(){messages++;return 'workspace API usage limits '+sentinel;}},name:{get(){names++;throw Error(sentinel);}}});
 const response=await fixture(error).ask();assert.match(response.content[0].text,/월별 API 한도/);noLeak(response);assert.equal(messages,1);assert.equal(names,0);
});
test('timeout classification does not inspect a hostile Proxy at all',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});let traps=0;const error=new Proxy(Error('fixture'),{getPrototypeOf(){traps++;throw Error(sentinel);},get(){traps++;throw Error(sentinel);}});
 const s=fixture(error,{waitForAbort:true}),run=s.ask();await new Promise(setImmediate);t.mock.timers.tick(25000);assert.deepEqual(await run,{content:[{type:'text',text:timeout}]});assert.equal(traps,0);
});
test('untrusted code and toString getters are never inspected',async()=>{
 let reads=0;const error=Object.defineProperties(Error('fixture'),{code:{get(){reads++;throw Error(sentinel);}},toString:{get(){reads++;throw Error(sentinel);}}});
 assert.deepEqual(await fixture(error).ask(),{content:[{type:'text',text:generic}]});assert.equal(reads,0);
});
