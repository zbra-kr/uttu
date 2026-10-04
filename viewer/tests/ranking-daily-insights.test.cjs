const test=require('node:test'),assert=require('node:assert/strict');
const load=require('./helpers/load-source.cjs');
const api=load('src/lib/ranking-daily-insights.ts');
const D='2026-10-04',P='2026-10-03',request={categoryCode:'000',genderFilter:'A',ageFilter:'AGE_BAND_ALL'};
const scope=patch=>({version:1,kind:'ranking',period:'today',fromDate:'',toDate:'',selectedCategory:'000',gender:'A',age:'AGE_BAND_ALL',price:[0,50],companies:[],brands:[],ownOnly:false,moverOnly:false,sort:'rank',sortDir:'asc',page:1,...patch});
const row=(product,rank,day=D,patch={})=>({store_code:'musinsa',snapshot_date:day,category_code:'000',gender_filter:'A',age_filter:'AGE_BAND_ALL',musinsa_no:String(product),rank_position:rank,product_name:'상품 '+product,brand_name:'브랜드',final_price:10000,discount_rate:10,products:{is_own:true,brands:{companies:{corp_name:'회사'}}},...patch});
const data=(current,previous,patch={})=>({request,date:D,previousDate:P,current,previous,...patch});
const plain=value=>JSON.parse(JSON.stringify(value));

test('only positive same-store/segment/product daily observations rise; unknowns are not NEW or zero',()=>{
 const r=api.compareDailyRanking(data([row(1,1,D,{product_name:null,final_price:null,discount_rate:null}),row(2,2),row(3,3),row(4,4)],
  [row(1,10,P),row(2,2,P),row(3,1,P)]));
 assert.equal(r.status,'partial');assert.equal(r.matched,3);assert.equal(r.missingPrevious,1);assert.equal(r.risers.length,1);
 assert.equal(r.risers[0].current.name,'상품 #1');assert.equal(r.risers[0].current.price,null);assert.equal(r.risers[0].discountPoints,null);
 assert.equal(r.risers[0].rise,9);assert.equal(r.unknownMetrics,1);
});
test('discount changes are percentage points, retaining both observed prices and rates',()=>{
 const r=api.compareDailyRanking(data([row(1,1,D,{final_price:7000,discount_rate:32.25})],[row(1,5,P,{final_price:8000,discount_rate:30})]));
 assert.equal(r.risers[0].discountPoints,2.25);assert.equal(r.risers[0].previous.price,8000);assert.equal(r.risers[0].current.price,7000);
 for(const value of [undefined,null,NaN,Infinity,-1,'0']){const q=api.compareDailyRanking(data([row(1,1,D,{final_price:value,discount_rate:value})],[row(1,2,P)]));assert.equal(q.risers[0].current.price,null);assert.equal(q.risers[0].current.discount,null);}
});
test('same-rank and same-product ambiguities are excluded from both days and counted',()=>{
 const r=api.compareDailyRanking(data([row(1,1),row(2,1),row(3,2),row(3,3),row(4,4),row(5,5)],
  [row(1,10,P),row(2,11,P),row(3,12,P),row(4,20,P),row(6,20,P),row(5,30,P)]));
 assert.equal(r.status,'partial');assert.equal(r.ambiguousRows,6);assert.equal(r.ambiguousPairs,1);assert.equal(r.missingPrevious,0);
 assert.deepEqual(r.risers.map(x=>x.current.product),['5']);
});
test('scope/date contamination, invalid ranks and invalid products cannot form pairs',()=>{
 for(const patch of [{store_code:'beauty'},{snapshot_date:'2026-10-02'},{category_code:'001'},{gender_filter:'M'},{age_filter:'AGE_BAND_20'},{rank_position:null},{rank_position:0},{rank_position:301},{musinsa_no:'invalid'}]){
  const r=api.compareDailyRanking(data([row(1,1,D,patch)],[row(1,10,P)]));assert.equal(r.risers.length,0);assert.equal(r.status,'partial');assert.equal(r.invalidRows,1);
 }
 const wrongDate=api.compareDailyRanking(data([row(1,1)],[row(1,10,P)],{previousDate:'2026-10-02'}));assert.equal(wrongDate.risers.length,0);assert.equal(wrongDate.status,'partial');
 assert.equal(api.compareDailyRanking(data([row(1,1)],[row(1,10,P)]),scope({selectedCategory:'001'})).risers.length,0);
 assert.equal(api.compareDailyRanking(data([row(1,1)],[row(1,10,P)],{request:{...request,date:'2026-10-03'}})).risers.length,0);
});
test('missing whole day, empty rises and sentinel caps remain distinct; older dates are not substituted',()=>{
 assert.equal(api.compareDailyRanking(data([],[])).status,'missing-current');
 assert.equal(api.compareDailyRanking(data([row(1,1)],[])).status,'missing-previous');
 const noRise=api.compareDailyRanking(data([row(1,10)],[row(1,1,P)]));assert.equal(noRise.status,'ready');assert.equal(noRise.risers.length,0);
 const capped=api.compareDailyRanking(data(Array.from({length:api.DAILY_READ_LIMIT},()=>row(1,1)),[row(1,20,P)]));assert.equal(capped.status,'capped');assert.equal(capped.risers.length,0);
});
test('top five deterministic rises are selected after current-day display filters',()=>{
 const current=Array.from({length:9},(_,i)=>row(i+1,i+1,D,{brand_name:i<5?'other':'selected'})),previous=Array.from({length:9},(_,i)=>row(i+1,i+21,P));
 const a=api.compareDailyRanking(data(current,previous));const b=api.compareDailyRanking(data([...current].reverse(),[...previous].reverse()));
 assert.deepEqual(plain(a.risers),plain(b.risers));assert.deepEqual(a.risers.map(x=>x.current.product),['1','2','3','4','5']);
 assert.deepEqual(api.compareDailyRanking(data(current,previous),scope({brands:['selected']})).risers.map(x=>x.current.product),['6','7','8','9']);
 const unknown=api.compareDailyRanking(data([row(1,1,D,{final_price:null,products:null})],[row(1,10,P)]),scope({ownOnly:true}));assert.equal(unknown.unknownFilterRows,1);assert.equal(unknown.risers.length,0);
 assert.equal(api.compareDailyRanking(data([row(1,1,D,{final_price:null})],[row(1,10,P)]),scope({price:[1,50]})).unknownFilterRows,1);
});
test('calendar boundaries and pinned replay identify the exact comparison date and segment',()=>{
 for(const [date,prev] of [['2024-03-01','2024-02-29'],['2026-01-01','2025-12-31'],['2026-11-01','2026-10-31']])assert.equal(api.previousCalendarDate(date),prev);
 for(const date of ['2026-02-30','bad','2026-13-01'])assert.throws(()=>api.previousCalendarDate(date));
 assert.equal(api.dailyRequest(scope({period:'7d'})),null);
 assert.equal(api.dailyRequest(scope({period:'custom',fromDate:'2026-10-01',toDate:D})),null);
 assert.equal(api.dailyRequest(scope({period:'custom',fromDate:D,toDate:D})).date,D);
 const context=load('src/lib/notes/ranking-context.ts');const pinned=api.pinDailyContext(scope({selectedCategory:'001',gender:'M',brands:['브랜드'],ownOnly:true}),D);
 const restored=context.rankingContextFromSearchParams(context.rankingContextToSearchParams(pinned));assert.deepEqual(plain(restored),plain(pinned));
 assert.equal(api.dailyRequest(restored).date,D);assert.equal(api.dailyRequest(restored).categoryCode,'001');assert.equal(restored.gender,'M');
});

test('explicit insight evidence pins only its own valid base observations, including absent optional enrichment',()=>{
 const current=[row(1,1,D,{products:null})],previous=[row(1,10,P,{products:null})];
 const evidence=api.dailyEvidenceContext(data(current,previous),scope());assert.equal(evidence.resolvedFromDate,D);assert.equal(evidence.resolvedToDate,D);
 assert.equal(api.dailyEvidenceContext(data(current,[]),scope()).resolvedToDate,D);
 for(const value of [data([],previous),data([row(1,1,D,{store_code:'beauty'})],previous),data([row(1,1),row(1,2)],previous),data(current,previous,{previousDate:'2026-10-02'}),data(Array.from({length:api.DAILY_READ_LIMIT},()=>row(1,1)),previous)])assert.equal(api.dailyEvidenceContext(value,scope()),null);
 assert.equal(api.dailyEvidenceContext(data(current,previous),scope({selectedCategory:'001'})),null);
 assert.equal(api.dailyEvidenceContext(data(current,previous),scope({resolvedFromDate:P,resolvedToDate:P})),null);
});

function readerFixture(response){const calls=[];const client={from(table){const call={table,ops:[]};const query=new Proxy({}, {get(_,method){if(method==='then')return(resolve,reject)=>{calls.push(call);return Promise.resolve(response(call)).then(resolve,reject)};return(...args)=>{call.ops.push([method,...args]);return query}}});return query}};return{calls,read:load('src/lib/queries-ranking-daily.ts',{'./supabase/client':{supabaseBrowser:()=>client}}).fetchRankingDaily};}
test('reader executes at most three strict bounded requests, or two for a pinned date',async()=>{
 for(const pinned of [false,true]){
  const f=readerFixture(c=>c.ops.find(x=>x[0]==='select')[1]==='snapshot_date,store_code'?{data:[{snapshot_date:D,store_code:'musinsa'}],error:null}:{data:[],error:null});
  await f.read({...request,...(pinned?{date:D}:{})});assert.equal(f.calls.length,pinned?2:3);
  for(const c of f.calls){assert.equal(c.table,'ranking_snapshots');for(const [field,value] of [['store_code','musinsa'],['category_code','000'],['gender_filter','A'],['age_filter','AGE_BAND_ALL']])assert.ok(c.ops.some(x=>x[0]==='eq'&&x[1]===field&&x[2]===value));assert.ok(c.ops.some(x=>x[0]==='limit'));assert.ok(!c.ops.find(x=>x[0]==='select')[1].includes('!inner'));}
  const dayReads=f.calls.filter(c=>c.ops.some(x=>x[0]==='eq'&&x[1]==='snapshot_date'));
  assert.deepEqual(dayReads.map(c=>c.ops.find(x=>x[0]==='eq'&&x[1]==='snapshot_date')[2]).sort(),[P,D].sort());
  for(const c of dayReads){assert.ok(c.ops.some(x=>x[0]==='lte'&&x[1]==='rank_position'&&x[2]===api.DAILY_RANK_LIMIT));assert.ok(c.ops.some(x=>x[0]==='limit'&&x[1]===api.DAILY_READ_LIMIT));assert.ok(c.ops.find(x=>x[0]==='select')[1].includes('store_code'));}
 }
});
test('latest lookup errors, absent data and aborts cannot trigger fallback fanout',async()=>{
 const err=readerFixture(()=>({data:null,error:new Error('fixture error')}));await assert.rejects(err.read(request));assert.equal(err.calls.length,1);
 const empty=readerFixture(()=>({data:[],error:null}));assert.equal((await empty.read(request)).date,null);assert.equal(empty.calls.length,1);
 const wrong=readerFixture(()=>({data:[{snapshot_date:D,store_code:'beauty'}],error:null}));await assert.rejects(wrong.read(request));assert.equal(wrong.calls.length,1);
 let release;const wait=readerFixture(()=>new Promise(resolve=>release=resolve));const controller=new AbortController(),promise=wait.read(request,controller.signal);await Promise.resolve();controller.abort();release({data:[{snapshot_date:D,store_code:'musinsa'}],error:null});await assert.rejects(promise,{name:'AbortError'});assert.equal(wait.calls.length,1);
 const before=readerFixture(()=>({data:[],error:null})),aborted=new AbortController();aborted.abort();await assert.rejects(before.read(request,aborted.signal),{name:'AbortError'});assert.equal(before.calls.length,0);
});

module.exports={scope,row,data,request,D,P};
