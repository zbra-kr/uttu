// Seven-candidate integration: actual factory/SDK, synthetic transport only.
const test=require('node:test'),assert=require('node:assert/strict'),load=require('./helpers/load-source.cjs');
process.env.NEXT_PUBLIC_SUPABASE_URL='https://offline-integration.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='public-integration-placeholder';
const http=(data,count,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json',...(count===undefined?{}:{'content-range':count===0?'*/0':`0-${data.length-1}/${count}`})}});
async function fixture(options,run){
 const previous=global.fetch,calls=[];
 global.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url??String(input)),method=init.method??'GET',headers=new Headers(init.headers),table=url.pathname.split('/').pop();
  assert.equal(url.origin,'https://offline-integration.invalid','no live traffic');
  assert.equal(headers.get('X-UTTU-Matching-Guard'),null,'marker stripped');assert.equal(headers.get('apikey'),'public-integration-placeholder');
  calls.push({table,method,prefer:headers.get('prefer'),authorization:headers.get('authorization'),select:url.searchParams.get('select'),gender:url.searchParams.get('gender_filter'),signal:init.signal});
  if(url.pathname==='/auth/v1/user')return http({id:'synthetic-user',app_metadata:{},user_metadata:{},aud:'authenticated',created_at:'2026-10-09T00:00:00Z'});
  if(method==='HEAD')return new Response(null,{status:200,headers:{'content-range':'0-9/10'}});
  assert.equal(method,'GET','no mutation allowed in this fixture');
  if(table==='products')return http([],undefined,404);
  if(table===options.errorTable)return http({message:'synthetic denied',code:'42501'},undefined,403);
  if(options.homeMode && ['ranking_snapshots','brand_ranking_snapshots'].includes(table)){
   const select=url.searchParams.get('select')??'';
   if(select==='snapshot_date'){
    if(options.holdHome){options.entered();return new Promise((_resolve,reject)=>{const fail=()=>reject(new DOMException('synthetic abort','AbortError'));if(init.signal?.aborted)fail();else init.signal.addEventListener('abort',fail,{once:true})});}
    if(options.homeLookupFail)return http({message:'synthetic lookup denied'},undefined,403);
    return http(options.homeEmpty?[]:[{snapshot_date:url.searchParams.get('snapshot_date')?.startsWith('lt.')?'2026-10-07':'2026-10-08'}]);
   }
   if(select.includes('musinsa_no'))return http(url.searchParams.get('snapshot_date')==='eq.2026-10-08'?[{musinsa_no:'123',product_name:'Synthetic product',rank_position:7,snapshot_date:'2026-10-08',products:{is_own:true}}]:[]);
   if(select.includes('brand_image_url'))return http([{musinsa_brand_slug:'competitor',brand_name:'Synthetic competitor',rank_position:1,snapshot_date:'2026-10-08'}]);
   if(select==='musinsa_brand_slug,rank_position')return http([{musinsa_brand_slug:'competitor',rank_position:2}]);
   if(select.startsWith('brand_name,'))return http([]);
  }
  if(table==='ranking_snapshots')return http([{brand_slug:'covernat',snapshot_date:'2026-10-07',rank_position:10},{brand_slug:'covernat',snapshot_date:'2026-10-08',rank_position:7}],options.noCount?undefined:2);
  if(table==='brands')return http([{slug:'covernat',name:'Synthetic brand'}]);
  if(table==='anomalies')return http(options.overflow?Array.from({length:300},()=>({severity:'low',detection_date:'2026-10-08'})):[{severity:'high',detection_date:'2026-10-08'}],options.overflow?301:1);
  if(table==='brand_ranking_snapshots')return http([{musinsa_brand_slug:'competitor',brand_name:'Synthetic competitor',rank_position:1,snapshot_date:'2026-10-08'}],1);
  throw Error('unexpected synthetic route');
 };
 try{return await run({calls,kpi:load('src/lib/queries-kpi.ts'),queries:load('src/lib/queries.ts'),factory:load('src/lib/supabase/client.ts')});}
 finally{global.fetch=previous;}
}
test('KPI exact counts survive actual shared matching transport with four reads',async()=>fixture({},async h=>{
 const v=await h.kpi.fetchBriefingKpiData('2026-10-09');assert.equal(v.source_date,'2026-10-08');
 for(const key of ['rank_status','anomaly_status','competitor_status'])assert.equal(v[key],'complete');
 assert.equal(v.own_brands[0].best_rank_yesterday,7);assert.equal(v.own_brands[0].rank_delta,3);
 assert.equal(h.calls.length,4);assert.equal(h.calls.filter(c=>c.prefer?.includes('count=exact')).length,3);
}));
test('shared transport retains KPI overflow and missing-count uncertainty',async()=>fixture({overflow:true,noCount:true},async h=>{
 const v=await h.kpi.fetchBriefingKpiData('2026-10-09');assert.equal(v.rank_status,'truncated');assert.equal(v.anomaly_status,'truncated');
 assert.equal(v.anomalies.high,0);assert.equal(v.competitor_status,'complete');assert.equal(h.calls.length,4);
}));
test('KPI permission error preserves independent healthy sections through actual factory',async()=>fixture({errorTable:'anomalies'},async h=>{
 const v=await h.kpi.fetchBriefingKpiData('2026-10-09');assert.equal(v.anomaly_status,'unavailable');assert.equal(v.rank_status,'complete');assert.equal(v.competitor_status,'complete');
}));
test('matching marked404 blocks mutations without poisoning subsequent KPI reads',async()=>fixture({},async h=>{
 await assert.rejects(h.queries.runAutoMatch('synthetic-product'));assert.equal(h.calls.length,1);
 const v=await h.kpi.fetchBriefingKpiData('2026-10-09');assert.equal(v.rank_status,'complete');assert.equal(v.anomaly_status,'complete');
 assert.equal(h.calls.length,5);assert.ok(h.calls.every(c=>c.method==='GET'));
}));
test('unmarked HEAD exact count10 survives shared factory',async()=>fixture({},async h=>{
 const v=await h.factory.supabaseBrowser().from('products').select('id',{count:'exact',head:true});
 assert.equal(v.error,null);assert.equal(v.count,10);assert.equal(v.data,null);assert.equal(h.calls[0].method,'HEAD');
}));
test('auth user/JWT/header survives shared factory before KPI read',async()=>fixture({},async h=>{
 const a=await h.factory.supabaseBrowser().auth.getUser('synthetic-user-token');assert.equal(a.error,null);assert.equal(a.data.user.id,'synthetic-user');
 assert.equal(h.calls[0].authorization,'Bearer synthetic-user-token');const v=await h.kpi.fetchBriefingKpiData('2026-10-09');assert.equal(v.rank_status,'complete');assert.equal(h.calls.length,5);
}));

test('Home product/brand real SDK reads retain scope and abort signals through matching transport',async()=>fixture({homeMode:true},async h=>{
 const productController=new AbortController(),brandController=new AbortController();
 const products=await h.queries.fetchLatestRanking({genderFilter:'M',limit:10,signal:productController.signal});
 assert.equal(products[0].musinsa_no,'123');assert.equal(products[0].rank_position,7);
 const productCalls=[...h.calls];assert.equal(productCalls.length,3);assert.ok(productCalls.every(c=>c.gender==='eq.M'&&c.signal));
 const brands=await h.queries.fetchTopBrandRanking({genderFilter:'F',limit:10,signal:brandController.signal});
 assert.equal(brands[0].musinsa_brand_slug,'competitor');const brandCalls=h.calls.slice(3);assert.equal(brandCalls.length,6);assert.equal(brands[0].rank_change,1);
 assert.ok(brandCalls.every(c=>c.gender==='eq.F'&&c.signal));
 productController.abort();brandController.abort();assert.ok(h.calls.every(c=>c.signal.aborted));
 const kpi=await h.kpi.fetchBriefingKpiData('2026-10-09');assert.equal(kpi.rank_status,'complete');assert.equal(kpi.anomaly_status,'complete');
}));
test('Home lookup failures remain errors and do not corrupt independent KPI/auth behavior',async()=>fixture({homeMode:true,homeLookupFail:true},async h=>{
 await assert.rejects(h.queries.fetchLatestRanking({genderFilter:'M',limit:10}));await assert.rejects(h.queries.fetchTopBrandRanking({genderFilter:'F',limit:10}));
 assert.equal(h.calls.length,2);const kpi=await h.kpi.fetchBriefingKpiData('2026-10-09');assert.equal(kpi.rank_status,'complete');
 const auth=await h.factory.supabaseBrowser().auth.getUser('synthetic-user-token');assert.equal(auth.error,null);assert.equal(auth.data.user.id,'synthetic-user');
}));
test('Home successful zero lookup is empty while marked matching404 still blocks mutation',async()=>fixture({homeMode:true,homeEmpty:true},async h=>{
 assert.deepEqual(await h.queries.fetchLatestRanking({genderFilter:'A',limit:10}),[]);assert.deepEqual(await h.queries.fetchTopBrandRanking({genderFilter:'A',limit:10}),[]);
 await assert.rejects(h.queries.runAutoMatch('synthetic-product'));assert.equal(h.calls.length,3);assert.ok(h.calls.every(c=>c.method==='GET'));
}));
test('Home in-flight brand lookup abort reaches real SDK transport without matching retry or poisoning KPI',async()=>{
 let entered;const requested=new Promise(resolve=>{entered=resolve});
 return fixture({homeMode:true,holdHome:true,entered},async h=>{
  const controller=new AbortController();const pending=h.queries.fetchTopBrandRanking({genderFilter:'M',limit:10,signal:controller.signal});
  await requested;controller.abort();await assert.rejects(pending);assert.equal(h.calls.length,1);assert.ok(h.calls[0].signal.aborted);
  const kpi=await h.kpi.fetchBriefingKpiData('2026-10-09');assert.equal(kpi.rank_status,'complete');assert.equal(h.calls.length,5);
 });
});
