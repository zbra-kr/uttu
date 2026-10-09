const test=require('node:test');
const assert=require('node:assert/strict');
const {createClient}=require('@supabase/supabase-js');
const load=require('./helpers/load-source.cjs');
process.env.NEXT_PUBLIC_SUPABASE_URL='https://offline-matching.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='public-placeholder-key';
const own={brand_id:'own-brand',category_code:'001',category_d2_code:'001004',category_path:'상의 > 티셔츠 > 긴팔'};
const initial=[{competitor_product_id:'old',status:'auto',score:70},{competitor_product_id:'protected',status:'confirmed',score:null},{competitor_product_id:'excluded',status:'excluded',score:65}];
const http=(data,status=200,range)=>new Response(status===204?null:JSON.stringify(data),{status,headers:{'content-type':'application/json',...(range?{'content-range':range}:{})}});
const range=(offset,length,total)=>total===0?'*/0':`${offset}-${offset+length-1}/${total}`;
async function fixture(options,run) {
  const originalFetch=global.fetch;
  let rows=structuredClone(options.rows??initial);
  const before=structuredClone(rows),calls=[];
  global.fetch=async(input,init={})=>{
    const url=new URL(typeof input==='string'?input:input.url??String(input));
    assert.equal(url.origin,'https://offline-matching.invalid','no live traffic');
    const method=init.method??'GET',table=url.pathname.split('/').pop(),offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??500);
    const mutation=method!=='GET';
    let stage,data,total;
    if(mutation){stage=method==='POST'?'insert':url.searchParams.get('status')==='eq.excluded'?'reset':'delete';data=null;}
    else if(table==='competitor_brands'){stage=offset?'pool-page':'pool';const all=options.pool??[{brand_id:'pool-brand'}];total=all.length;data=all.slice(offset,offset+limit);}
    else if(table==='product_matches'){stage=offset?'existing-page':'existing';total=rows.length;data=rows.slice(offset,offset+limit);}
    else if(url.searchParams.get('select')!=='id'){stage='own';data=own;}
    else{stage=url.searchParams.get('brand_id')?.startsWith('in.')?'A':'B';const all=options.candidates?.[stage]??(stage==='A'?[{id:'fresh'},{id:'protected'}]:[]);total=all.length;data=all.slice(offset,offset+limit);}
    assert.equal(new Headers(init.headers).get('X-UTTU-Matching-Guard'),null,'local guard marker must not reach HTTP');
    const call={stage,method,mutation,offset,limit,prefer:new Headers(init.headers).get('Prefer'),retry:new Headers(init.headers).get('X-Retry-Count')};calls.push(call);
    if(stage===options.failStage){
      if(options.failure==='404-array')return http([],404);
      if(options.failure==='404-empty')return new Response('',{status:404});
      if(options.failure==='500')return http({message:'synthetic failure'},500);
      if(options.failure==='transport')throw new TypeError('synthetic network failure');
      if(options.failure==='missing-range')return http(data);
      if(options.failure==='bad-range')return http(data,200,`0-${data.length-1}/*`);
      if(options.failure==='wrong-start')return http(data,200,range(offset+1,data.length,total));
      if(options.failure==='short-page'){data=data.slice(0,250);return http(data,206,range(offset,data.length,total));}
      if(options.failure==='short-body')return http(data.slice(0,-1),200,range(offset,data.length,total));
      if(options.failure==='changed-count')return http(data,206,range(offset,data.length,total+1));
    }
    if(mutation){
      if(stage==='insert'){
        const inserts=JSON.parse(init.body);
        if(inserts.some(r=>rows.some(e=>e.competitor_product_id===r.competitor_product_id)))return http({code:'23505',message:'synthetic duplicate'},409);
        rows.push(...inserts);
      }else rows=rows.filter(r=>r.status!==url.searchParams.get('status').slice(3));
      return http(null,204);
    }
    return stage==='own'?http(data):http(data,offset||total>limit?206:200,range(offset,data.length,total));
  };
  try{
    // Production factory and guard, real locked SSR/Supabase/PostgREST SDKs, only fetch is synthetic.
    const queries=load('src/lib/queries.ts');
    return await run({queries,calls,before,rows:()=>rows});
  }finally{global.fetch=originalFetch;}
}
test('locked SDK really normalizes 404 array and empty bodies (unprotected control)',async()=>{
  assert.equal(require('@supabase/supabase-js/package.json').version,'2.106.0');
  for(const empty of [false,true]){
    const client=createClient('https://offline-matching.invalid','public-placeholder-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async()=>empty?new Response('',{status:404}):http([],404)}});
    const result=await (empty?client.from('product_matches').delete():client.from('products').select('id')).retry(false);
    assert.equal(result.error,null);assert.equal(result.status,empty?204:200);assert.deepEqual(result.data,empty?null:[]);
  }
});
for(const fn of ['runAutoMatch','resetAndAutoMatch']) {
  for(const stage of ['own','pool','A','B','existing'])for(const failure of ['404-array','404-empty','500','transport']) {
    test(`HTTP ${fn} ${stage} ${failure}: no mutation and no tier fallback/retry`,async()=>fixture({failStage:stage,failure},async h=>{
      await assert.rejects(h.queries[fn]('own-product'));
      assert.deepEqual(h.rows(),h.before);assert.ok(!h.calls.some(c=>c.mutation));assert.equal(h.calls.filter(c=>c.stage===stage).length,1);
      if(stage==='A'||stage==='B')assert.equal(h.calls.filter(c=>['A','B'].includes(c.stage)).length,2);
      assert.ok(h.calls.every(c=>c.retry===null));
    }));
  }
  for(const stage of ['pool','A','B','existing'])for(const failure of ['missing-range','bad-range','wrong-start','short-body']) {
    test(`HTTP ${fn} ${stage} ${failure}: unverified completeness blocks all mutations`,async()=>fixture({failStage:stage,failure,candidates:{A:[{id:'fresh'}],B:[{id:'fresh-b'}]}},async h=>{
      await assert.rejects(h.queries[fn]('own-product'));assert.ok(!h.calls.some(c=>c.mutation));assert.deepEqual(h.rows(),h.before);
    }));
  }
  for(const stage of ['existing','pool']) {
    test(`HTTP ${fn}: only 250 of 1001 ${stage} rows blocks deletion`,async()=>{
      const rows=Array.from({length:1001},(_,i)=>({competitor_product_id:`p-${i}`,status:i===0?'auto':'confirmed'}));
      const pool=Array.from({length:1001},(_,i)=>({brand_id:`pool-${i}`}));
      return fixture({rows,pool,failStage:stage,failure:'short-page',candidates:{A:[{id:'p-1000'}],B:[]}},async h=>{
        await assert.rejects(h.queries[fn]('own-product'));assert.ok(!h.calls.some(c=>c.mutation));assert.deepEqual(h.rows(),h.before);
      });
    });
  }
  test(`HTTP ${fn}: a changed total in later existing page blocks all mutations`,async()=>{
    const rows=Array.from({length:501},(_,i)=>({competitor_product_id:`p-${i}`,status:'confirmed'}));
    return fixture({rows,failStage:'existing-page',failure:'changed-count'},async h=>{
      await assert.rejects(h.queries[fn]('own-product'));assert.ok(!h.calls.some(c=>c.mutation));assert.deepEqual(h.rows(),h.before);
    });
  });
  for(const stage of fn==='runAutoMatch'?['delete','insert']:['reset','delete','insert'])for(const failure of ['404-array','404-empty','500','transport']) {
    test(`HTTP ${fn} mutation ${stage} ${failure}: errors stop without retry`,async()=>fixture({failStage:stage,failure},async h=>{
      await assert.rejects(h.queries[fn]('own-product'));assert.equal(h.calls.at(-1).stage,stage);assert.equal(h.calls.filter(c=>c.stage===stage).length,1);assert.ok(h.calls.every(c=>c.retry===null));
    }));
  }
}
test('HTTP normal pages >1000 preserve protected rows and bounded A/B results',async()=>{
  const rows=Array.from({length:1001},(_,i)=>({competitor_product_id:`p-${i}`,status:'confirmed',score:null}));rows.push({competitor_product_id:'old',status:'auto',score:70});
  return fixture({rows,candidates:{A:[{id:'p-1000'},{id:'old'}],B:[]}},async h=>{
    assert.equal(await h.queries.runAutoMatch('own-product'),1);assert.deepEqual(h.rows().filter(r=>r.status==='confirmed'),rows.slice(0,1001));
    assert.equal(h.rows().find(r=>r.competitor_product_id==='old').score,100);assert.equal(h.calls.filter(c=>c.stage.startsWith('existing')).length,3);
    assert.ok(h.calls.filter(c=>['pool','A','B','existing','existing-page'].includes(c.stage)).every(c=>c.prefer.includes('count=exact')));
  });
});
test('HTTP candidate total may exceed bounded limit without changing existing priority',async()=>fixture({candidates:{A:Array.from({length:501},(_,i)=>({id:`fresh-${i}`})),B:[]}},async h=>{
  assert.equal(await h.queries.runAutoMatch('own-product'),500);assert.equal(h.calls.find(c=>c.stage==='A').limit,500);
}));
for(const stage of ['pool','existing']) {
  test(`HTTP ${stage} total above 10000 safety bound makes zero mutations`,async()=>{
    const rows=Array.from({length:10001},(_,i)=>({competitor_product_id:`protected-${i}`,status:'confirmed'}));
    const pool=Array.from({length:10001},(_,i)=>({brand_id:`pool-${i}`}));
    return fixture({rows:stage==='existing'?rows:initial,pool:stage==='pool'?pool:undefined},async h=>{
      await assert.rejects(h.queries.runAutoMatch('own-product'));assert.ok(!h.calls.some(c=>c.mutation));assert.deepEqual(h.rows(),h.before);
    });
  });
}
test('raw transport guard leaves Auth HTTP status handling to the Auth SDK',async()=>{
  const original=global.fetch;
  global.fetch=async()=>new Response('',{status:404});
  try{
    const {fetchWithMatchingGuard}=load('src/lib/supabase/matching-transport.ts');
    assert.equal((await fetchWithMatchingGuard('https://offline-matching.invalid/auth/v1/user')).status,404);
  }finally{global.fetch=original;}
});
test('real fetchHomeSummary preserves products HEAD exact count10 and unrelated requests',async()=>{
  const original=global.fetch,calls=[];
  global.fetch=async(input,init={})=>{
    const url=new URL(String(input)),table=url.pathname.split('/').pop(),headers=new Headers(init.headers);
    assert.equal(url.origin,'https://offline-matching.invalid');
    assert.equal(headers.get('X-UTTU-Matching-Guard'),null);
    assert.equal(headers.get('apikey'),'public-placeholder-key');
    assert.equal(headers.get('authorization'),'Bearer public-placeholder-key');
    calls.push([init.method,table,headers.get('Prefer')]);
    if(init.method==='HEAD')return new Response(null,{status:200,headers:{'content-range':`*/${table==='products'?10:4}`}});
    return http([]);
  };
  try{
    const queries=load('src/lib/queries.ts');const result=await queries.fetchHomeSummary();
    assert.equal(result.ownProducts,10);assert.equal(result.totalBrands,4);
    assert.ok(calls.some(c=>c[0]==='HEAD'&&c[1]==='products'&&c[2].includes('count=exact')));
    assert.equal(calls.length,4);
  }finally{global.fetch=original;}
});
for(const [label,request,response,expected] of [
  ['unmarked HEAD products count',init=>({method:'HEAD',headers:{Prefer:'count=exact'}}),()=>new Response(null,{status:200,headers:{'content-range':'*/10'}}),200],
  ['unmarked GET products id exact without limit',()=>({headers:{Prefer:'count=exact'}}),()=>http([{id:'one'},{id:'two'}],200,'0-1/10'),200],
  ['unmarked GET products other projection',()=>({}),()=>http([{id:'one',name:'normal'}]),200],
  ['unmarked REST 404 retains common SDK boundary',()=>({}),()=>http([],404),404],
  ['marked HEAD is not matching GET',()=>({method:'HEAD',headers:{Prefer:'count=exact','X-UTTU-Matching-Guard':'complete-read'}}),()=>new Response(null,{status:200,headers:{'content-range':'*/10'}}),200],
  ['marked Auth response preserves Auth behavior',()=>({headers:{'X-UTTU-Matching-Guard':'read'}}),()=>http({message:'auth failure'},401),401],
]) {
  test(`transport scope: ${label}`,async()=>{
    const original=global.fetch;const sent=[];const raw=response();
    global.fetch=async(input,init)=>{sent.push(init);return raw;};
    try{
      const {fetchWithMatchingGuard}=load('src/lib/supabase/matching-transport.ts');
      const options=request();
      const url=label.includes('Auth')?'https://offline-matching.invalid/auth/v1/user':label.includes('other projection')?'https://offline-matching.invalid/rest/v1/products?select=id,name':'https://offline-matching.invalid/rest/v1/products?select=id';
      const result=await fetchWithMatchingGuard(url,options);
      assert.equal(result,raw,'unrelated HTTP response must be unchanged');assert.equal(result.status,expected);
      assert.equal(new Headers(sent[0]?.headers).get('X-UTTU-Matching-Guard'),null);
      if(!new Headers(options.headers).has('X-UTTU-Matching-Guard'))assert.equal(sent[0],options,'unmarked request options must be unchanged');
    }finally{global.fetch=original;}
  });
}
test('transport scope preserves Request headers, signal, auth and method while stripping only marker',async()=>{
  const original=global.fetch,controller=new AbortController();let sent;
  const request=new Request('https://offline-matching.invalid/rest/v1/product_matches',{method:'DELETE',signal:controller.signal,headers:{Authorization:'Bearer synthetic-token',apikey:'public-placeholder-key','X-UTTU-Matching-Guard':'mutation'}});
  global.fetch=async(input,init)=>{sent={input,init};return new Response('',{status:404});};
  try{
    const {fetchWithMatchingGuard}=load('src/lib/supabase/matching-transport.ts');
    assert.equal((await fetchWithMatchingGuard(request)).status,400);assert.equal(sent.input,request);
    assert.equal(new Headers(sent.init.headers).get('authorization'),'Bearer synthetic-token');
    assert.equal(new Headers(sent.init.headers).get('apikey'),'public-placeholder-key');
    assert.equal(new Headers(sent.init.headers).get('X-UTTU-Matching-Guard'),null);
    assert.equal(sent.input.method,'DELETE');assert.equal(sent.input.signal.aborted,false);
    controller.abort();assert.equal(sent.input.signal.aborted,true);
  }finally{global.fetch=original;}
});
test('unmarked production browser client preserves normal products GET/count SDK behavior',async()=>{
  const original=global.fetch;
  global.fetch=async(input,init)=>{
    assert.equal(new Headers(init.headers).get('X-UTTU-Matching-Guard'),null);
    return http([{id:'one'},{id:'two'}],200,'0-1/10');
  };
  try{
    const {supabaseBrowser}=load('src/lib/supabase/client.ts');
    const result=await supabaseBrowser().from('products').select('id',{count:'exact'}).retry(false);
    assert.equal(result.error,null);assert.equal(result.count,10);assert.equal(result.data.length,2);
  }finally{global.fetch=original;}
});
test('unmarked transport rejection propagates unchanged without wrapper retry',async()=>{
  const original=global.fetch;const failure=new TypeError('synthetic common transport failure');let calls=0;
  global.fetch=async()=>{calls++;throw failure;};
  try{
    const {fetchWithMatchingGuard}=load('src/lib/supabase/matching-transport.ts');
    await assert.rejects(fetchWithMatchingGuard('https://offline-matching.invalid/rest/v1/products?select=name'),e=>e===failure);
    assert.equal(calls,1);
  }finally{global.fetch=original;}
});
