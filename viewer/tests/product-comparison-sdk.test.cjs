const test=require('node:test'),assert=require('node:assert/strict'),load=require('./helpers/load-source.cjs');
function fixture(failTable=null){
 const calls=[]; let writes=0;
 const client={from(table){const call={table,filters:{},orders:[]};calls.push(call);let q; q=new Proxy({}, {get(_,key){
  if(key==='then')return (resolve,reject)=>{if(failTable===table)return resolve({data:null,error:{message:'synthetic SDK error'},count:null,status:400});const no=call.filters.musinsa_no??123;let data;
   if(table==='products')data={id:no===123?'own':'comp',musinsa_no:no,is_own:no===123,name:'PRODUCT-'+no,category_code:'001',brands:{name:'BRAND'}};
   else if(table==='ranking_snapshots')data=[{snapshot_date:'2026-10-10',final_price:no===123?12000:10000,rank_position:1}];
   else if(table==='product_matches')data=[{id:'match',own_product_id:'own',competitor_product_id:'comp',status:'confirmed',created_at:'2026-10-10',score:100,products:{musinsa_no:456,name:'COMP',brands:{name:'BRAND'}}}];
   else if(table==='reviews')data=[{id:'review',product_id:'own',rating:2,review_text:'SOURCE REVIEW',review_date:'2026-10-10'}];
   else return reject(Error('Unexpected table '+table));resolve({data,error:null,status:200,count:table==='reviews'?(call.filters.rating===2?1:10):null});};
  return (...args)=>{if(['insert','update','delete','upsert','rpc'].includes(key)){writes++;throw Error('Writes forbidden');}if(key==='eq'||key==='lte')call.filters[args[0]]=args[1];if(key==='gte')call['from-'+args[0]]=args[1];if(key==='order')call.orders.push(args);if(key==='range')call.range=args;if(key==='select')call.select=args;if(key==='abortSignal')call.signal=args[0];return q;};
 }});return q;},rpc(){writes++;throw Error('RPC forbidden');}};
 const queries=load('src/lib/queries.ts',{'./supabase/client':{supabaseBrowser:()=>client}});
 return {...load('src/lib/product-comparison.ts',{'./queries':queries}),calls,get writes(){return writes;}};
}
test('actual query helpers preserve product keys, count/range/order and read-only flow',async()=>{const f=fixture(),r=await f.loadProductComparison('123','2026-10-10',7);assert.equal(r.matchError,false);assert.equal(r.reviewError,false);assert.equal(r.reviews.total,10);assert.equal(r.reviews.lowTotal,1);assert.equal(f.comparisonPriceGap(r.own,r.competitors[0].detail).gap,2000);assert.equal(f.writes,0);assert.equal(f.calls.length,7);const reviews=f.calls.filter(c=>c.table==='reviews');assert.deepEqual(reviews.map(c=>c.range),[[0,0],[0,2]]);for(const c of reviews){assert.equal(c.filters.product_id,'own');assert.equal(c['from-review_date'],'2026-10-04');assert.equal(c.filters.review_date,'2026-10-10');assert.equal(c.select[1].count,'exact');assert.deepEqual(c.orders.map(o=>o[0]),['review_date','id']);}});
for(const table of ['reviews','product_matches'])test('actual SDK errors remain unavailable: '+table,async()=>{const f=fixture(table),r=await f.loadProductComparison('123','2026-10-10',7);assert.equal(table==='reviews'?r.reviewError:r.matchError,true);assert.equal(f.writes,0);assert.equal(table==='reviews'?r.matchError:r.reviewError,false);});
test('missing product after SDK failure stops all dependent queries',async()=>{const f=fixture('products');await assert.rejects(f.loadProductComparison('123','2026-10-10',7));assert.deepEqual(f.calls.map(c=>c.table),['products','ranking_snapshots']);assert.equal(f.writes,0);});
