const test=require('node:test'),assert=require('node:assert/strict');
const { readSource }=require('./performance-source.cjs');
const { fixture }=require('./helpers/ranking-projection-fixture.cjs');
const baseline=readSource('source/queries.ts');
const minimal='rank_position,musinsa_no,products!inner(id)';
const range={fromDate:'2026-07-08',toDate:'2026-10-05',categoryCode:'001',genderFilter:'M',ageFilter:'AGE_BAND_25',limit:300};
for(const[name,options,input,count]of [
 ['90 days',{},range,91],['single date',{}, {...range,fromDate:range.toDate},2],['latest',{}, {},3],
 ['missing prior',{emptyDate:'2026-07-07'},range,91],['missing middle',{emptyDate:'2026-09-01'},range,91],
 ['all empty',{emptyAll:true},range,91],['empty latest',{emptyLatest:true},{},1],
 ['nullable brands',{nullBrands:true},range,91],['duplicate products',{duplicateProduct:true},range,91],
])test('Ranking prior projection preserves rows and eligibility: '+name,async()=>{
 const a=fixture(options,baseline),b=fixture(options);
 const before=await a.reader(input),after=await b.reader(input);
 assert.deepEqual(JSON.parse(JSON.stringify(after)),JSON.parse(JSON.stringify(before)));
 for(const f of [a,b])f.calls.sort((x,y)=>(x.select==='snapshot_date'?-1:y.select==='snapshot_date'?1:x.date.localeCompare(y.date)));
 assert.equal(b.calls.length,count);assert.equal(after.some(row=>row.musinsa_no===999999),false);
 const prior=b.calls.find(call=>call.select!== 'snapshot_date');
 if(prior){assert.equal(prior.select,minimal);const old=a.calls[b.calls.indexOf(prior)];
   assert.deepEqual({...prior.params,select:old.select},old.params);
   for(let i=b.calls.indexOf(prior)+1;i<b.calls.length;i++)assert.deepEqual(b.calls[i].params,a.calls[i].params);
   assert.ok(prior.bodyBytes<=old.bodyBytes);
 }
 if(name==='90 days'){assert.equal(after.length,27000);assert.equal(prior.valueFields,900);assert.equal(a.calls[0].valueFields,5400)}
 if(name==='missing middle')assert.equal(after.filter(row=>row.rank_change===null).length,300);
 if(name==='nullable brands')assert.ok(after.every(row=>row.company_name===null));
});
for(const date of ['2026-07-07','2026-09-01','2026-10-05'])test('Ranking prior projection preserves whole-result SDK errors: '+date,async()=>{
 const a=fixture({errorDate:date},baseline),b=fixture({errorDate:date});
 const read=async f=>{try{return{rows:await f.reader(range)}}catch(error){return{error:{message:error.message,code:error.code,details:error.details,hint:error.hint}}}};
 const before=await read(a),after=await read(b);assert.deepEqual(after,before);
 assert.equal(after.error?.message,'fixture SDK error '+date);assert.equal(after.error?.code,'FIXTURE');
 await new Promise(resolve=>setImmediate(resolve));assert.equal(a.calls.length,91);assert.equal(b.calls.length,91);
});
test('Ranking prior projection retains SDK abort signals and lookup behavior',async()=>{
 const b=fixture({defer:true}),ctl=new AbortController();
 const request=b.reader({...range,signal:ctl.signal});const observed=request.then(()=>false,error=>/aborted/i.test(error.message));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(b.calls.length,91);
 assert.ok(b.calls.every(call=>call.signal===ctl.signal));ctl.abort();assert.equal(await observed,true);
 const latest=fixture(),already=new AbortController();already.abort();
 assert.deepEqual(await latest.reader({signal:already.signal}),[]);assert.equal(latest.calls.length,1);
});
