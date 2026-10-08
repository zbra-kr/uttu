const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const load = require('./helpers/load-source.cjs');
const valid = counts => ({data:[Object.fromEntries(['rating_5','rating_4','rating_3','rating_2','rating_1','image_count'].map((k,i)=>[k,counts[i]]))],error:null});
function fixture(response) {
  const calls=[];
  function query(value,call) { return new Proxy({}, {get(_,key) {
    if(key==='then') return (yes,no)=>Promise.resolve(value).then(yes,no);
    return (...args)=>{call.operations.push([key,...args]);return query(value,call);};
  }}); }
  const client={rpc(name,args){const call={rpc:name,args,operations:[]};calls.push(call);return query(response,call);},
    from(table){const call={table,operations:[]};calls.push(call);return query({count:2,error:null},call);}};
  return {calls,api:load('src/lib/queries.ts',{'./format':{kstDaysAgo:d=>`fixture-date-${d}`},'./supabase/client':{supabaseBrowser:()=>client}})};
}
test('one dated RPC retains cutoff and AbortSignal, genuine zero stays zero',async()=>{
 const f=fixture(valid([0,0,0,0,0,0])),signal=new AbortController().signal;
 assert.deepEqual(await f.api.fetchReviewStats(7,signal),{total:0,avgRating:0,lowCount:0,ratingDist:[0,0,0,0,0],imageCount:0});
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].rpc,'get_review_stats_v1');
 assert.deepEqual(f.calls[0].args,{p_from_date:'fixture-date-7'});assert.equal(f.calls[0].operations[0][1],signal);
});
test('all-time sentinel omits only cutoff, preserving counts and average rounding',async()=>{
 const f=fixture(valid([5,4,3,2,1,3]));assert.deepEqual(await f.api.fetchReviewStats(999),{total:15,avgRating:3.67,lowCount:3,ratingDist:[5,4,3,2,1],imageCount:3});
 assert.deepEqual(f.calls[0].args,{p_from_date:null});assert.deepEqual(f.calls[0].operations,[]);
});
test('default cutoff remains thirty days',async()=>{const f=fixture(valid([1,0,0,0,0,1]));await f.api.fetchReviewStats();assert.equal(f.calls[0].args.p_from_date,'fixture-date-30');});
test('RPC error and malformed result cardinality fail closed',async()=>{
 for(const response of [{data:null,error:{message:'offline'}},{...valid([0,0,0,0,0,0]),error:{}},{data:null},{data:{}},{data:[]},{data:[null]},{data:[{}]},{data:[{},{}]}]) await assert.rejects(fixture(response).api.fetchReviewStats(),/unavailable/);
});
test('invalid count at every position and unsafe total fail closed',async()=>{
 for(const count of [null,undefined,-1,0.5,NaN,Infinity,'3',Number.MAX_SAFE_INTEGER+1]) for(let i=0;i<6;i++) {const counts=[5,4,3,2,1,3];counts[i]=count;await assert.rejects(fixture(valid(counts)).api.fetchReviewStats(),/unavailable/);}
 await assert.rejects(fixture(valid([Number.MAX_SAFE_INTEGER,1,0,0,0,0])).api.fetchReviewStats(),/unavailable/);
});
test('transport rejection propagates and canceled late success cannot become metrics',async()=>{
 const error=Error('transport unavailable');await assert.rejects(fixture(Promise.reject(error)).api.fetchReviewStats(),e=>e===error);
 let resolve;const pending=new Promise(yes=>{resolve=yes;}),controller=new AbortController(),f=fixture(pending);
 const result=assert.rejects(f.api.fetchReviewStats(7,controller.signal),/unavailable/);controller.abort();resolve(valid([5,4,3,2,1,3]));await result;
});
test('shell remains unavailable when RPC fails, preserving other counts',async()=>{
 const stats=await fixture({data:null,error:{message:'missing routine'}}).api.fetchShellStats();
 assert.equal(stats.reviewTotal,null);assert.equal(stats.reviewAvgRating,null);assert.equal(stats.reviewLowCount,null);assert.equal(stats.anomalyCount,2);
});
test('SQL contract specifies exact global counts, inclusive cutoff, invoker and authenticated routine',()=>{
 const sql=fs.readFileSync(path.join(__dirname,'../../supabase/migrations/01413_get_review_stats_v1.sql'),'utf8');
 assert.equal((sql.match(/count\(\*\) FILTER/g)||[]).length,6);
 for(const star of [5,4,3,2,1]) assert.ok(sql.includes(`WHERE rating = ${star}`));
 assert.match(sql,/WHERE has_image = true/);assert.match(sql,/FROM public\.reviews\s+WHERE p_from_date IS NULL OR review_date >= p_from_date/);
 assert.match(sql,/SECURITY INVOKER/);assert.match(sql,/SET search_path = ''/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.get_review_stats_v1\(date\) FROM PUBLIC, anon/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.get_review_stats_v1\(date\) TO authenticated/);
 assert.doesNotMatch(sql,/SECURITY DEFINER|CREATE INDEX|JOIN|LIMIT|ALTER TABLE|CREATE POLICY|GRANT.*ON TABLE/i);
});
