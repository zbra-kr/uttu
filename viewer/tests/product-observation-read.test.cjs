const test=require('node:test'),assert=require('node:assert/strict');
const load=require('./helpers/load-source.cjs');
const context={product:'6796676',store:'musinsa',date:'2026-10-05',category:'000',gender:'A',age:'AGE_BAND_ALL'};
const row={store_code:'musinsa',musinsa_no:6796676,snapshot_date:'2026-10-05',category_code:'000',gender_filter:'A',age_filter:'AGE_BAND_ALL',rank_position:8,product_name:'Observed jacket',brand_name:'Observed brand',final_price:39000,discount_rate:20,products:{is_own:true}};
function run(result){const filters=[];const q={select:(...args)=>{filters.push(['select',...args]);return q;},eq:(...args)=>{filters.push(['eq',...args]);return q;},order:(...args)=>{filters.push(['order',...args]);return q;},limit:n=>{filters.push(['limit',n]);return q;},abortSignal:()=>q,then:(ok,fail)=>Promise.resolve(result).then(ok,fail)};const api=load('src/lib/queries-product-observation.ts',{'./supabase/client':{supabaseBrowser:()=>({from:name=>{filters.push(['from',name]);return q;}})}});return {filters,read:api.fetchProductObservation(context)};}
test('one bounded exact product/day/cohort read returns only the observed row',async()=>{
 const {filters,read}=run({data:[row],error:null}),result=await read;
 assert.equal(result.status,'ready');assert.equal(result.row.rank,8);assert.equal(result.row.own,true);
 assert.deepEqual(filters.filter(x=>x[0]==='eq'),[['eq','store_code','musinsa'],['eq','musinsa_no',6796676],['eq','snapshot_date','2026-10-05'],['eq','category_code','000'],['eq','gender_filter','A'],['eq','age_filter','AGE_BAND_ALL']]);
 assert.deepEqual(filters.find(x=>x[0]==='limit'),['limit',3]);
 assert.equal(filters.filter(x=>x[0]==='from').length,1);
});
test('missing, duplicate, capped, error and unknown ownership stay separate',async()=>{
 for(const [response,status] of [[{data:[],error:null},'missing'],[{data:[row,row],error:null},'ambiguous'],[{data:[row,row,row],error:null},'capped'],[{data:null,error:{message:'offline'}},'error'],[{data:[{...row,gender_filter:'F'}],error:null},'error']]){
  assert.equal((await run(response).read).status,status);
 }
 const unknown=await run({data:[{...row,products:null,final_price:null,discount_rate:null}],error:null}).read;
 assert.equal(unknown.status,'ready');assert.equal(unknown.row.own,null);assert.equal(unknown.row.price,null);assert.equal(unknown.row.discount,null);
 const joined=await run({data:[{...row,products:[{is_own:true}]}],error:null}).read;
 assert.equal(joined.status,'ready');assert.equal(joined.row.own,true);
 assert.equal((await run({data:[{...row,products:[{is_own:true},{is_own:false}]}],error:null}).read).status,'error');
});
