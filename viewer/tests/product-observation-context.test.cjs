const test=require('node:test'),assert=require('node:assert/strict');
const load=require('./helpers/load-source.cjs');
const api=load('src/lib/product-observation-context.ts');
const { rankingContextToSearchParams }=load('src/lib/notes/ranking-context.ts');
const source=rankingContextToSearchParams({version:1,kind:'ranking',period:'today',fromDate:'',toDate:'',selectedCategory:'000',gender:'A',age:'AGE_BAND_ALL',price:[0,50],companies:[],brands:[],ownOnly:false,moverOnly:false,sort:'rank',sortDir:'asc',page:1,resolvedFromDate:'2026-10-05',resolvedToDate:'2026-10-05'});
source.set('notes','open');source.set('note','33333333-3333-4333-8333-333333333333');
const value={product:'6796676',store:'musinsa',date:'2026-10-05',category:'000',gender:'A',age:'AGE_BAND_ALL',back:'/ranking?'+source};
test('explicit observed product URL round-trips exact source note and cohort; plain product URL stays legacy',()=>{
 const href=api.productObservationHref(value),query=new URL(href,'https://local.invalid').searchParams;
 assert.equal(api.parseProductObservation(new URLSearchParams('no=6796676')).kind,'none');
 assert.equal(api.parseProductObservation(query).kind,'valid');
 assert.deepEqual(api.parseProductObservation(query).value,value);
 assert.match(href,/obs=ranking-v1/);assert.match(href,/back=%2Franking%3F/);
});
test('partial, duplicate, unknown and hostile observation contexts are invalid rather than legacy',()=>{
 const good=new URL(api.productObservationHref(value),'https://local.invalid').searchParams;
 for(const mutate of [
  q=>q.delete('obs'),q=>q.delete('store'),q=>q.delete('date'),q=>q.append('date','2026-10-04'),
  q=>q.set('store','other'),q=>q.set('no','9007199254740992'),q=>q.set('no','1e3'),
  q=>q.set('date','2026-02-30'),q=>q.set('category','invalid'),q=>q.set('gender','X'),
  q=>q.set('age','unknown'),q=>q.set('back','https://evil.invalid/'),
  q=>q.set('back','//evil.invalid/ranking?'+source),q=>q.set('back','/ranking?context=ranking-v1&unknown=1'),
  q=>q.set('date','2026-10-04'),q=>q.set('category','001'),
  q=>q.set('extra','1'),
 ]){const q=new URLSearchParams(good);mutate(q);assert.equal(api.parseProductObservation(q).kind,'invalid',q.toString());}
 assert.throws(()=>api.productObservationHref({...value,store:'other'}));
});
