const test = require('node:test'), assert = require('node:assert/strict');
const load = require('./helpers/load-source.cjs');
const { NextRequest } = require('next/server');
const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '33333333-3333-4333-8333-333333333333';
Object.assign(process.env, {NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture', SUPABASE_SERVICE_ROLE_KEY:'fixture', MCP_ASK_DAILY_TOKEN_LIMIT:'100000'});
function barrier(n=2) { let count=0, resolve; const wait=new Promise(r=>resolve=r); return async()=>{ if(++count===n) resolve(); await wait; }; }
function dbFixture(table='ai_usage_daily', initial={input_tokens:99000,output_tokens:0,session_count:4,message_count:8}, opts={}) {
 let row=initial?{...initial}:null, settlementReads=0, admissionReads=0;
 const calls=[], admission=barrier(), settlement=barrier();
 const date=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 if(row)row={...row,usage_date:date,...(table==='ai_usage_daily'?{user_id:userId}:{})};
 const db={from(name){return {op:'read',filters:[],columns:'',payload:null,
  select(columns){this.columns=columns;return this;},abortSignal(signal){this.signal=signal;return this;},eq(k,v){this.filters.push([k,v]);return this;},gte(){return this;},order(){return this;},maybeSingle(){return this;},
  insert(v){this.op='insert';this.payload=v;return this;},update(v){this.op='update';this.payload=v;return this;},upsert(v){this.op='upsert';this.payload=v;return this;},
  then(yes,no){return Promise.resolve().then(async()=>{
   calls.push({table:name,op:this.op,filters:[...this.filters],payload:this.payload,signal:this.signal});
   if(name==='ai_sessions')return {data:{user_id:userId},error:null};
   if(name==='ai_user_quotas')return {data:{monthly_token_limit:500000,daily_token_limit:100000,is_blocked:false},error:null};
   if(name==='ai_messages')return {data:[],error:null};
   if(name!==table)return {data:null,error:null};
   if(this.op==='read'){
    if(opts.advanceRead)opts.advanceRead();
    if(opts.hangRead)return await opts.readWait;
    if(opts.readThrows)throw Error('fixture read failure');
    if(opts.readError)return {data:null,error:{code:'42501',message:'fixture sensitive database error'}};
    const snap=row?{...row}:null;
    if(opts.readBarrier)await opts.readBarrier();
    if(this.columns.includes('session_count')||this.columns.includes('call_count')){ if(opts.concurrent && ++settlementReads<=2) await settlement(); }
    else if(this.filters.some(([k])=>k==='usage_date')){ if(opts.concurrent && ++admissionReads<=2) await admission(); }
    return {data:this.filters.some(([k])=>k==='usage_date')?snap:[snap].filter(Boolean),error:null};
   }
   if(this.op==='upsert'){row={...this.payload};return {data:null,error:null};}
   if(this.op==='update' || this.op==='insert'){
    if(opts.hangWrite)return await opts.writeWait;
    if(opts.writeError)return {data:null,error:{code:'42501',message:'fixture sensitive database error'}};
    if(this.op==='update' && (opts.forceConflict || !row || this.filters.some(([k,v])=>row[k]!==v)))return {data:[],error:null};
    if(this.op==='insert' && row)return {data:null,error:{code:'23505'}};
    row={...(this.op==='update'?row:{}),...this.payload};
    if(opts.commitThenHang)return await opts.writeWait;
    if(opts.throwAfterCommit)throw Error('fixture committed then transport failure');
    if(opts.receiptNull)return {data:null,error:null};
    if(opts.receiptWrong)return {data:[{...row,input_tokens:0}],error:null};
    return {data:[{...row}],error:null};
   }
   return {data:null,error:null};
  }).then(yes,no);}
 };}};
 return {db,calls,row:()=>row};
}
function chatFixture(db){let calls=0;const usages=[800,900];
 class Anthropic {messages={stream(){const input=usages[calls++];return {on(){},async finalMessage(){return {content:[],usage:{input_tokens:input,output_tokens:0},stop_reason:'end_turn'};}};}};}
 const mocks={'@anthropic-ai/sdk':Anthropic,openai:class{},'@google/generative-ai':{GoogleGenerativeAI:class{}},'@supabase/supabase-js':{createClient:()=>db},'@supabase/ssr':{createServerClient:()=>({auth:{getUser:async()=>({data:{user:{id:userId}},error:null})}})},'next/headers':{cookies:async()=>({get:()=>undefined})},'@/lib/ai/pipeline':{AI_QUERY_BLOCKED_TABLES:[],execQueryDb(){throw Error('unexpected tool');}}};
 const api=load('src/app/api/ai/chat/route.ts',mocks);
 const request=(signal)=>new NextRequest('https://fixture.invalid/api/ai/chat',{method:'POST',signal,body:JSON.stringify({sessionId,messages:[{role:'user',text:'prior'},{role:'ai',text:'prior answer'},{role:'user',text:'next'}],context:[],route:'/'})});
 return {api,request,providerCalls:()=>calls};
}
// All three body providers and the existing Anthropic title request are mocked.
function titleChatFixture(provider='anthropic', opts={}) {
 const f=dbFixture('ai_usage_daily',{input_tokens:0,output_tokens:0,session_count:0,message_count:0});
 const from=f.db.from.bind(f.db);
 f.db.from=name=>{
  const q=from(name),originalThen=q.then;
  q.then=function(yes,no){return originalThen.call(this,r=>name==='ai_allowed_models'
   ?{data:{provider,model_id:`fixture-${provider}`},error:null}:r,no).then(yes,no);};
  return q;
 };
 const requests={body:[],title:[]};
 const usage={input_tokens:1000,output_tokens:100};
 class Anthropic {messages={
  stream(request){
   requests.body.push(request);const call=requests.body.length;
   if(opts.streamFailure==='before_text')throw Error('fixture stream failure');
   return {on(event,fn){assert.equal(event,'text');if(call===1)fn('fixture answer');},async finalMessage(){
    if(opts.streamFailure==='before_usage'||(opts.streamFailure==='after_usage'&&call===2))throw Error('fixture stream failure');
    if(opts.streamFailure==='after_usage')return {usage,stop_reason:'tool_use',content:[{type:'tool_use',id:'fixture-tool',name:'navigate',input:{path:'/reviews',reason:'fixture'}}]};
    return {usage,stop_reason:'end_turn',content:[]};
   }};
  },
  async create(request){
   requests.title.push(request);assert.equal(request.model,'claude-haiku-4-5-20251001');assert.equal(request.max_tokens,30);
   if(opts.titleFails)throw Error('fixture title failure');
   return {content:opts.titleContent??[{type:'text',text:opts.titleText??'  fixture title  '}],
    ...(Object.hasOwn(opts,'titleUsage')?{usage:opts.titleUsage}:{usage:{input_tokens:40,output_tokens:8}})};
  }
 };}
 class OpenAI {chat={completions:{async create(request){requests.body.push(request);return {
  usage:{prompt_tokens:1000,completion_tokens:100},choices:[{message:{content:'fixture answer'}}],
 };}}};}
 class GoogleGenerativeAI {getGenerativeModel(){return {startChat(){return {async sendMessage(request){requests.body.push(request);return {response:{
  usageMetadata:{promptTokenCount:1000,candidatesTokenCount:100},functionCalls:()=>[],text:()=> 'fixture answer',
 }};}};}};}}
 const mocks={'@anthropic-ai/sdk':Anthropic,openai:OpenAI,'@google/generative-ai':{GoogleGenerativeAI},
  '@supabase/supabase-js':{createClient:()=>f.db},
  '@supabase/ssr':{createServerClient:()=>({auth:{getUser:async()=>({data:{user:{id:userId}},error:null})}})},
  'next/headers':{cookies:async()=>({get:()=>undefined})},
  '@/lib/ai/pipeline':{AI_QUERY_BLOCKED_TABLES:[],execQueryDb(){throw Error('unexpected tool');}},
 };
 const api=load('src/app/api/ai/chat/route.ts',mocks);
 const messages=opts.followup?[{role:'user',text:'prior'},{role:'ai',text:'prior answer'},{role:'user',text:'next'}]:[{role:'user',text:'first'}];
 return {...f,requests,assistantSeq:messages.length+1,async run(){
  const request=new NextRequest('https://fixture.invalid/api/ai/chat',{method:'POST',body:JSON.stringify({sessionId,messages,context:[],route:'/'})});
  const response=await api.POST(request);assert.equal(response.status,200);return response.text();
 }};
}
function assertSingleTitleSettlement(s,input=1040,output=108) {
 assert.deepEqual({input:s.row().input_tokens,output:s.row().output_tokens,sessions:s.row().session_count,messages:s.row().message_count},
  {input,output,sessions:1,messages:2});
 const writes=s.calls.filter(c=>c.table==='ai_usage_daily'&&c.op!=='read');assert.equal(writes.length,1);assert.equal(writes[0].op,'update');
 assert.equal(s.calls.filter(c=>c.table==='ai_messages'&&c.op==='insert').length,2);
 const assistant=s.calls.find(c=>c.table==='ai_messages'&&c.payload?.role==='assistant');
 assert.equal(assistant.payload.content,'fixture answer');
 // Existing message/session token fields continue to describe the body response.
 assert.equal(assistant.payload.input_tokens,1000);assert.equal(assistant.payload.output_tokens,100);
 const session=s.calls.filter(c=>c.table==='ai_sessions'&&c.op==='update');assert.equal(session.length,1);
 assert.equal(session[0].payload.message_count,s.assistantSeq);assert.equal(session[0].payload.input_tokens,1000);assert.equal(session[0].payload.output_tokens,100);
}
Object.assign(process.env,{OPENAI_API_KEY:'fixture-openai',GEMINI_API_KEY:'fixture-gemini',ANTHROPIC_API_KEY:'fixture-anthropic'});
for(const provider of ['anthropic','openai','google'])test(`${provider} first turn adds confirmed title usage in one daily settlement`,async()=>{
 const s=titleChatFixture(provider),body=await s.run();assert.match(body,/"type":"delta","text":"fixture answer"/);assert.match(body,/"type":"done"/);
 assertSingleTitleSettlement(s);assert.equal(s.requests.body.length,1);assert.equal(s.requests.title.length,1);
 assert.equal(s.calls.find(c=>c.table==='ai_sessions'&&c.op==='update').payload.title,'fixture title');
});
for(const titleOpts of [{titleText:''},{titleText:'   '},{titleContent:[]}])test(`empty title still counts confirmed usage ${JSON.stringify(titleOpts)}`,async()=>{
 const s=titleChatFixture('anthropic',titleOpts);assert.match(await s.run(),/"type":"done"/);assertSingleTitleSettlement(s);
 assert.equal(s.requests.title.length,1);assert.equal(Object.hasOwn(s.calls.find(c=>c.table==='ai_sessions'&&c.op==='update').payload,'title'),false);
});
for(const [label,opts,input,output] of [
 ['title failure',{titleFails:true},1000,100],
 ['usage missing',{titleUsage:undefined},1000,100],
 ['usage null',{titleUsage:null},1000,100],
 ['empty usage',{titleUsage:{}},1000,100],
 ['zero usage',{titleUsage:{input_tokens:0,output_tokens:0}},1000,100],
 ['input only',{titleUsage:{input_tokens:40}},1040,100],
 ['output only',{titleUsage:{output_tokens:8}},1000,108],
])test(`${label} keeps body answer and known accounting`,async()=>{
 const s=titleChatFixture('anthropic',opts);assert.match(await s.run(),/"type":"delta","text":"fixture answer"/);assertSingleTitleSettlement(s,input,output);assert.equal(s.requests.title.length,1);
});
for(const bad of [-1,0.5,NaN,Infinity,-Infinity,'40',null,{},Number.MAX_SAFE_INTEGER+1,2_147_483_648,2_147_483_647]){
 for(const axis of ['input_tokens','output_tokens'])test(`invalid/unrepresentable title ${axis} ${String(bad)} preserves body and other confirmed axis`,async()=>{
  const s=titleChatFixture('anthropic',{titleUsage:{input_tokens:40,output_tokens:8,[axis]:bad}});assert.match(await s.run(),/"type":"done"/);
  assertSingleTitleSettlement(s,axis==='input_tokens'?1000:1040,axis==='output_tokens'?100:108);
 });
}
for(const provider of ['anthropic','openai','google'])test(`${provider} followup never requests or charges a title`,async()=>{
 const s=titleChatFixture(provider,{followup:true});assert.match(await s.run(),/"type":"done"/);assertSingleTitleSettlement(s,1000,100);
 assert.equal(s.requests.title.length,0);assert.equal(s.requests.body.length,1);
});
for(const titleFails of [false,true])test(`stream fails after confirmed body usage; title failure=${titleFails}`,async()=>{
 const s=titleChatFixture('anthropic',{streamFailure:'after_usage',titleFails}),body=await s.run();
 assert.match(body,/"type":"delta","text":"fixture answer"/);assert.match(body,/"type":"error","message":"fixture stream failure"/);assert.match(body,/"type":"done"/);
 assertSingleTitleSettlement(s,titleFails?1000:1040,titleFails?100:108);assert.equal(s.requests.body.length,2);assert.equal(s.requests.title.length,1);
});
test('partial stream without confirmed body usage preserves partial answer and counts only confirmed title usage',async()=>{
 const s=titleChatFixture('anthropic',{streamFailure:'before_usage'}),body=await s.run();assert.match(body,/fixture answer/);assert.match(body,/fixture stream failure/);assert.match(body,/"type":"done"/);
 assert.equal(s.row().input_tokens,40);assert.equal(s.row().output_tokens,8);assert.equal(s.row().session_count,1);assert.equal(s.row().message_count,2);
 assert.equal(s.calls.filter(c=>c.table==='ai_usage_daily'&&c.op==='update').length,1);assert.equal(s.requests.title.length,1);
 const assistant=s.calls.find(c=>c.table==='ai_messages'&&c.payload?.role==='assistant');assert.equal(assistant.payload.content,'fixture answer');assert.equal(assistant.payload.input_tokens,0);
});
test('stream failure before any text neither requests a title nor invents usage',async()=>{
 const s=titleChatFixture('anthropic',{streamFailure:'before_text'}),body=await s.run();assert.match(body,/fixture stream failure/);assert.match(body,/"type":"done"/);
 assert.equal(s.requests.title.length,0);assert.equal(s.calls.filter(c=>c.table==='ai_usage_daily'&&c.op!=='read').length,0);
 assert.equal(s.calls.find(c=>c.table==='ai_messages'&&c.payload?.role==='assistant').payload.content,'');
});
test('actual chat settles both concurrent completions while admission remains soft',async()=>{
 const f=dbFixture('ai_usage_daily',undefined,{concurrent:true}), s=chatFixture(f.db);
 const bodies=await Promise.all([s.api.POST(s.request()).then(r=>r.text()),s.api.POST(s.request()).then(r=>r.text())]);
 assert.equal(s.providerCalls(),2);assert.ok(bodies.every(x=>x.includes('"type":"done"')));
 assert.equal(f.row().input_tokens,100700);
 assert.equal(f.row().session_count,6);assert.equal(f.row().message_count,12);
 assert.equal(f.calls.filter(c=>c.op==='upsert').length,0);
 assert.equal(f.calls.filter(c=>c.table==='ai_usage_daily'&&c.op==='update').length,3);
 for(const c of f.calls.filter(c=>c.table==='ai_usage_daily'&&c.op==='update')){assert.ok(c.filters.some(([k,v])=>k==='user_id'&&v===userId));assert.equal(c.filters.length,6);}
});
function mcpFixture(db,opts={}){let calls=0;const usages=[800,900];const tools={};
 const mocks={'@supabase/supabase-js':{createClient:()=>db},'mcp-handler':{createMcpHandler(register){register({registerTool(name,options,fn){tools[name]=fn;}});return tools;}},'@/lib/ai/pipeline':{runInferenceLoop:async()=>{if(opts.providerWait)await opts.providerWait;return {text:'fixture answer',inputTokens:usages[calls++],outputTokens:0};},execQueryDb(){throw Error('unexpected query');}}};
 const {createUttuMcpHandler}=load('src/lib/mcp/handler.ts',mocks);createUttuMcpHandler('/fixture');return {ask:tools.ask_uttu,providerCalls:()=>calls};
}
test('actual MCP awaits both concurrent settlements without lost increment',async()=>{
 const f=dbFixture('mcp_usage_daily',{input_tokens:99000,output_tokens:0,call_count:4},{concurrent:true}),s=mcpFixture(f.db);
 await Promise.all([s.ask({question:'fixture question'}),s.ask({question:'fixture question'})]);
 assert.equal(s.providerCalls(),2);assert.equal(f.calls.filter(c=>c.op==='upsert').length,0);
 assert.equal(f.row().input_tokens,100700);assert.equal(f.row().call_count,6);
 assert.equal(f.calls.filter(c=>c.op==='update').length,3);
});
const helper=()=>load('src/lib/ai/usage-accounting.ts');
const date=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
for(const table of ['ai_usage_daily','mcp_usage_daily']) {
 test(`${table} concurrent missing-row insert race preserves both increments`,async()=>{
  const f=dbFixture(table,null,{concurrent:true}),api=helper();
  const call=t=>table==='ai_usage_daily'?api.accumulateAiUsage(f.db,userId,date(),t,7):api.accumulateMcpDailyUsage(f.db,date(),t,7);
  const results=await Promise.all([call(800),call(900)]);
  assert.ok(results.every(r=>r.status==='recorded'));assert.equal(f.row().input_tokens,1700);assert.equal(f.row().output_tokens,14);
  assert.equal(f.row()[table==='ai_usage_daily'?'session_count':'call_count'],2);
  assert.equal(f.calls.filter(c=>c.op==='insert').length,2);assert.equal(f.calls.filter(c=>c.op==='update').length,1);
 });
}
for(const [label,opts,status,reason,writes] of [
 ['read error',{readError:true},'unrecorded','read_failed',0],
 ['read throws',{readThrows:true},'unrecorded','read_failed',0],
 ['write error',{writeError:true},'unknown','write_failed',1],
 ['write committed then transport throws',{throwAfterCommit:true},'unknown','write_failed',1],
 ['missing receipt after commit',{receiptNull:true},'unknown','ambiguous_receipt',1],
 ['unexpected receipt after commit',{receiptWrong:true},'unknown','ambiguous_receipt',1],
 ['persistent zero-row contention',{forceConflict:true},'unrecorded','contention',5],
])test(`CAS ${label}: bounded and no ambiguous-write retry`,async()=>{
 const f=dbFixture('ai_usage_daily',undefined,opts),result=await helper().accumulateAiUsage(f.db,userId,date(),800,2);
 assert.deepEqual(result,{status,reason});assert.equal(f.calls.filter(c=>c.op==='update').length,writes);
 if(opts.throwAfterCommit||opts.receiptNull||opts.receiptWrong)assert.equal(f.row().input_tokens,99800);
});
for(const input of [-1,0.5,NaN,Infinity,'800',2_147_483_648])test(`invalid delta ${String(input)} never writes`,async()=>{
 const f=dbFixture();assert.equal((await helper().accumulateAiUsage(f.db,userId,date(),input,0)).reason,'invalid');assert.equal(f.calls.length,0);
});
test('INTEGER overflow or malformed baseline never overwrites',async()=>{
 for(const row of [{input_tokens:2_147_483_647,output_tokens:0,session_count:1,message_count:2},{input_tokens:null,output_tokens:0,session_count:1,message_count:2}]){
 const f=dbFixture('ai_usage_daily',row);assert.equal((await helper().accumulateAiUsage(f.db,userId,date(),800,0)).reason,'invalid');assert.equal(f.calls.filter(c=>c.op!=='read').length,0);
 }
});
test('same request helper call does not retry a successful write',async()=>{
 const f=dbFixture();assert.equal((await helper().accumulateAiUsage(f.db,userId,date(),800,900)).status,'recorded');
 assert.equal(f.row().input_tokens,99800);assert.equal(f.row().output_tokens,900);assert.equal(f.calls.filter(c=>c.op==='update').length,1);
});
test('account/date keys are fixed on every read and conditional write',async()=>{
 const f=dbFixture();await helper().accumulateAiUsage(f.db,userId,date(),800,0);
 for(const c of f.calls){assert.ok(c.filters.some(([k,v])=>k==='user_id'&&v===userId));assert.ok(c.filters.some(([k,v])=>k==='usage_date'&&v===date()));}
});
test('callers keep completed answers but emit sanitized uncertainty instead of silent settlement success',async()=>{
 const old=console.warn, warnings=[];console.warn=m=>warnings.push(m);
 try{
  const f=dbFixture('ai_usage_daily',undefined,{writeError:true}),s=chatFixture(f.db);
  assert.match(await(await s.api.POST(s.request())).text(),/"type":"done"/);
  const g=dbFixture('mcp_usage_daily',{input_tokens:99000,output_tokens:0,call_count:4},{writeError:true}),m=mcpFixture(g.db);
  assert.match((await m.ask({question:'fixture'})).content[0].text,/fixture answer/);
 }finally{console.warn=old;}
 assert.equal(warnings.length,2);assert.ok(warnings.every(x=>x.includes('status=unknown reason=write_failed')));
 assert.ok(warnings.every(x=>!x.includes(userId)&&!x.includes('sensitive')));
});
for(const opts of [{throwAfterCommit:true},{receiptNull:true},{writeError:true}])test(`missing-row insert failure is not blindly retried ${JSON.stringify(opts)}`,async()=>{
 const f=dbFixture('mcp_usage_daily',null,opts),r=await helper().accumulateMcpDailyUsage(f.db,date(),800,900);
 assert.equal(r.status,'unknown');assert.equal(f.calls.filter(c=>c.op==='insert').length,1);assert.equal(f.calls.filter(c=>c.op==='update').length,0);
 if(!opts.writeError)assert.equal(f.row().input_tokens,800);
});
test('existing counter CAS compares all counters, including non-token increments',async()=>{
 const f=dbFixture();await helper().accumulateAiUsage(f.db,userId,date(),800,0);
 const write=f.calls.find(c=>c.op==='update');
 for(const [key,value] of Object.entries({input_tokens:99000,output_tokens:0,session_count:4,message_count:8}))assert.ok(write.filters.some(([k,v])=>k===key&&v===value));
});
test('signup defaults source remains 500000 monthly and 100000 daily',()=>{
 const fs=require('node:fs'),path=require('node:path');
 assert.match(fs.readFileSync(path.join(__dirname,'../../supabase/migrations/01503_ai_quota_signup_defaults.sql'),'utf8'),/values \(new\.id, 500000, 100000, false\)/);
});
function sdkFixture(opts={}){
 const {createClient}=require('@supabase/supabase-js');const seen=[],wait=barrier();let reads=0;
 let row={user_id:userId,usage_date:date(),input_tokens:99000,output_tokens:0,session_count:4,message_count:8};
 const fetch=async(url,init)=>{
  const parsed=new URL(url);seen.push({method:init.method,url:parsed,signal:init.signal});
  if(init.method==='GET'){
   if(opts.neverRead)return await opts.wait;
   const snap={...row};if(opts.concurrent && ++reads<=2)await wait();
   return new Response(JSON.stringify([snap]),{status:200,headers:{'Content-Type':'application/json'}});
  }
  assert.equal(init.method,'PATCH');
  if(opts.neverWrite)return await opts.wait;
  const payload=JSON.parse(init.body),matches=[...parsed.searchParams].filter(([k])=>k!=='select').every(([k,v])=>v===`eq.${row[k]}`);
  if(!matches)return new Response('[]',{status:200,headers:{'Content-Type':'application/json'}});
  row={...row,...payload};
  if(opts.throwAfterCommit)throw Error('synthetic transport failed after commit');
  return new Response(JSON.stringify([row]),{status:200,headers:{'Content-Type':'application/json'}});
 };
 const client=createClient('https://fixture.invalid','fixture-key',{global:{fetch},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 return {client,seen,row:()=>row};
}
test('actual locked Supabase SDK sends all CAS filters and returns both synthetic increments',async()=>{
 const f=sdkFixture({concurrent:true}),api=helper();
 const results=await Promise.all([api.accumulateAiUsage(f.client,userId,date(),800,0),api.accumulateAiUsage(f.client,userId,date(),900,0)]);
 assert.ok(results.every(r=>r.status==='recorded'));assert.equal(f.row().input_tokens,100700);assert.equal(f.row().session_count,6);
 const writes=f.seen.filter(c=>c.method==='PATCH');assert.equal(writes.length,3);
 for(const w of writes){for(const column of ['user_id','usage_date','input_tokens','output_tokens','session_count','message_count'])assert.ok(w.url.searchParams.get(column).startsWith('eq.'));}
});
test('actual locked SDK does not retry a PATCH transport failure after synthetic commit',async()=>{
 const f=sdkFixture({throwAfterCommit:true}),r=await helper().accumulateAiUsage(f.client,userId,date(),800,0);
 assert.deepEqual(r,{status:'unknown',reason:'write_failed'});assert.equal(f.row().input_tokens,99800);assert.equal(f.seen.filter(c=>c.method==='PATCH').length,1);
});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=()=>new Promise(setImmediate);
function fakeClock(t){t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});}
for(const phase of ['read','write'])test(`settlement ${phase} hang returns by deadline and aborts, no replay`,async t=>{
 fakeClock(t);const pending=deferred(),opts=phase==='read'?{hangRead:true,readWait:pending.promise}:{hangWrite:true,writeWait:pending.promise};
 const f=dbFixture('ai_usage_daily',undefined,opts);let ended=false;
 const run=helper().accumulateAiUsage(f.db,userId,date(),800,0).then(r=>{ended=true;return r;});
 await flush();assert.equal(ended,false);t.mock.timers.tick(1999);await flush();assert.equal(ended,false);
 t.mock.timers.tick(1);const result=await run;assert.deepEqual(result,{status:phase==='read'?'unrecorded':'unknown',reason:'deadline'});
 assert.ok(f.calls.every(c=>c.signal.aborted));assert.equal(f.calls.filter(c=>c.op==='update').length,phase==='read'?0:1);
 pending.resolve({data:[{input_tokens:99800,output_tokens:0,session_count:5,message_count:10}],error:null});await flush();
 assert.equal(f.calls.filter(c=>c.op==='update').length,phase==='read'?0:1);
});
test('expired deadline and pre-cancelled signal dispatch no database calls',async t=>{
 fakeClock(t);const controller=new AbortController();controller.abort();
 for(const options of [{deadlineAt:Date.now()},{signal:controller.signal}]){
  const f=dbFixture(),result=await helper().accumulateAiUsage(f.db,userId,date(),800,0,options);
  assert.equal(result.status,'unrecorded');assert.equal(result.reason,options.signal?'cancelled':'deadline');assert.equal(f.calls.length,0);
 }
});
for(const phase of ['read','write'])test(`external cancellation during ${phase} stops without replay`,async t=>{
 fakeClock(t);const pending=deferred(),controller=new AbortController();
 const opts=phase==='read'?{hangRead:true,readWait:pending.promise}:{commitThenHang:true,writeWait:pending.promise};
 const f=dbFixture('ai_usage_daily',undefined,opts),run=helper().accumulateAiUsage(f.db,userId,date(),800,0,{signal:controller.signal});
 await flush();controller.abort();const result=await run;
 assert.deepEqual(result,{status:phase==='read'?'unrecorded':'unknown',reason:'cancelled'});
 assert.ok(f.calls.every(c=>c.signal.aborted));const before=f.calls.length;
 pending.reject(Error('late transport rejection'));await flush();assert.equal(f.calls.length,before);
});
test('late write acknowledgement after timeout cannot become recorded or replay the increment',async t=>{
 fakeClock(t);const pending=deferred(),f=dbFixture('ai_usage_daily',undefined,{commitThenHang:true,writeWait:pending.promise});
 const run=helper().accumulateAiUsage(f.db,userId,date(),800,0);await flush();assert.equal(f.row().input_tokens,99800);
 t.mock.timers.tick(2000);assert.deepEqual(await run,{status:'unknown',reason:'deadline'});
 pending.resolve({data:[{...f.row()}],error:null});await flush();
 assert.equal(f.calls.filter(c=>c.op==='update').length,1);assert.equal(f.row().input_tokens,99800);
});
test('acknowledgement before deadline records once and removes timer/listener',async t=>{
 fakeClock(t);const pending=deferred(),controller=new AbortController(),f=dbFixture('ai_usage_daily',undefined,{commitThenHang:true,writeWait:pending.promise});
 const run=helper().accumulateAiUsage(f.db,userId,date(),800,0,{signal:controller.signal});await flush();
 t.mock.timers.tick(1999);pending.resolve({data:[{...f.row()}],error:null});assert.equal((await run).status,'recorded');
 controller.abort();t.mock.timers.tick(10000);await flush();assert.equal(f.calls.filter(c=>c.op==='update').length,1);
 assert.ok(f.calls.every(c=>!c.signal.aborted));
});
test('chat releases completed stream after bounded hung settlement read',async t=>{
 fakeClock(t);const pending=deferred(),f=dbFixture('ai_usage_daily',undefined,{hangRead:true,readWait:pending.promise}),s=chatFixture(f.db);
 // Admission reads also hang here; allow them, then hang only the settlement tuple.
 f.db.from=((original)=>function(table){const query=original.call(this,table),then=query.then;query.then=function(a,b){
  if(table==='ai_usage_daily' && !this.columns.includes('session_count')){const row={...f.row()};return Promise.resolve({data:this.filters.some(([k])=>k==='usage_date')?row:[row],error:null}).then(a,b);}
  return then.call(this,a,b);
 };return query;})(f.db.from);
 const old=console.warn,warnings=[];console.warn=m=>warnings.push(m);
 try{const body=s.api.POST(s.request()).then(r=>r.text());await flush();t.mock.timers.tick(2000);
 assert.match(await body,/"type":"done"/);assert.equal(s.providerCalls(),1);assert.deepEqual(warnings,['ai_usage_settlement status=unrecorded reason=deadline']);
 }finally{console.warn=old;}
});
test('MCP settlement uses remaining original 25-second budget, preserves completed answer',async t=>{
 fakeClock(t);const provider=deferred(),pending=deferred(),f=dbFixture('mcp_usage_daily',{input_tokens:99000,output_tokens:0,call_count:4},{hangWrite:true,writeWait:pending.promise}),s=mcpFixture(f.db,{providerWait:provider.promise});
 const old=console.warn,warnings=[];console.warn=m=>warnings.push(m);
 try{let ended=false;const answer=s.ask({question:'fixture'}).then(x=>{ended=true;return x;});await flush();
 t.mock.timers.tick(24000);provider.resolve();await flush();t.mock.timers.tick(999);await flush();assert.equal(ended,false);
 t.mock.timers.tick(1);assert.match((await answer).content[0].text,/fixture answer/);
 assert.deepEqual(warnings,['mcp_usage_settlement status=unknown reason=deadline']);assert.equal(s.providerCalls(),1);
 assert.equal(f.calls.filter(c=>c.op==='update').length,1);assert.ok(f.calls.find(c=>c.op==='update').signal.aborted);
 }finally{console.warn=old;}
});
for(const phase of ['read','write'])test(`actual locked SDK ${phase} hang gets an aborted transport signal and bounded caller`,async t=>{
 fakeClock(t);const pending=deferred(),opts={wait:pending.promise,[phase==='read'?'neverRead':'neverWrite']:true},f=sdkFixture(opts);
 const run=helper().accumulateAiUsage(f.client,userId,date(),800,0);await flush();t.mock.timers.tick(2000);
 assert.deepEqual(await run,{status:phase==='read'?'unrecorded':'unknown',reason:'deadline'});
 assert.ok(f.seen.every(call=>call.signal?.aborted));assert.equal(f.seen.filter(c=>c.method==='PATCH').length,phase==='read'?0:1);
 pending.reject(Error('late synthetic fetch rejection'));await flush();assert.equal(f.seen.filter(c=>c.method==='PATCH').length,phase==='read'?0:1);
});
for(const phase of ['read','write'])test(`actual MCP completed answer survives ${phase} settlement hung beyond virtual300001ms`,async t=>{
 fakeClock(t);const pending=deferred(),opts=phase==='read'?{hangRead:true,readWait:pending.promise}:{hangWrite:true,writeWait:pending.promise};
 const f=dbFixture('mcp_usage_daily',{input_tokens:99000,output_tokens:0,call_count:4},opts);
 if(phase==='read')f.db.from=((original)=>function(table){const q=original.call(this,table),then=q.then;q.then=function(a,b){
  if(!this.columns.includes('call_count'))return Promise.resolve({data:{...f.row()},error:null}).then(a,b);
  return then.call(this,a,b);
 };return q;})(f.db.from);
 const s=mcpFixture(f.db),old=console.warn,warnings=[];console.warn=m=>warnings.push(m);
 try{const answer=s.ask({question:'fixture'});await flush();assert.equal(s.providerCalls(),1);t.mock.timers.tick(300001);
 assert.match((await answer).content[0].text,/fixture answer/);
 assert.deepEqual(warnings,[`mcp_usage_settlement status=${phase==='read'?'unrecorded':'unknown'} reason=deadline`]);
 assert.equal(f.calls.filter(c=>c.op==='update').length,phase==='read'?0:1);
 }finally{console.warn=old;}
});
function shrinkingBarrier(n){let target=n,arrived=0,current=deferred();return async()=>{
 const old=current;if(++arrived===target){arrived=0;target--;current=deferred();old.resolve();}await old.promise;
};}
test('six lockstep requests record five and honestly report one contention residual',async()=>{
 const f=dbFixture('ai_usage_daily',undefined,{readBarrier:shrinkingBarrier(6)}),api=helper(),deltas=[1,2,3,4,5,6];
 const results=await Promise.all(deltas.map(n=>api.accumulateAiUsage(f.db,userId,date(),n,0)));
 assert.equal(results.filter(r=>r.status==='recorded').length,5);
 assert.deepEqual(results.filter(r=>r.status!=='recorded'),[{status:'unrecorded',reason:'contention'}]);
 assert.equal(f.row().input_tokens,99000+deltas.reduce((sum,n,i)=>sum+(results[i].status==='recorded'?n:0),0));
 assert.equal(f.row().session_count,9);assert.equal(f.calls.filter(c=>c.op==='update').length,20);
});
test('overall deadline spans retries rather than restarting for each attempt',async t=>{
 fakeClock(t);const f=dbFixture('ai_usage_daily',undefined,{forceConflict:true,advanceRead:()=>t.mock.timers.tick(750)});
 assert.deepEqual(await helper().accumulateAiUsage(f.db,userId,date(),800,0),{status:'unrecorded',reason:'deadline'});
 assert.equal(f.calls.filter(c=>c.op==='read').length,3);assert.equal(f.calls.filter(c=>c.op==='update').length,2);
 assert.equal(f.row().input_tokens,99000);
});
