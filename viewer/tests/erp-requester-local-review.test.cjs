const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const load=require('./helpers/load-source.cjs'),R=load('src/lib/erp/requester-local-review.ts');
const q={brand:'CO',from:'2026-10-01',to:'2026-10-10'};
function deps(){const calls=[];return {calls,now:()=>1000,currentActor:async()=>({userId:'SYN-REQUESTER',role:'viewer'}),executor:{execute:async x=>{calls.push(x);return {complete:true,rows:[{BRANDCD:'CO',STYLECD:'SYN-STYLE',SALEDT:'20261001',SALES_VAT_EX:123.45}]};}}};}
test('verified self-review needs no invented global entitlement; exact FLOAT money still withheld',async()=>{
 const d=deps(),c=await R.prepareRequesterReview(q,'SYN-REQUESTER',d);assert.ok(c);const v=await R.readRequesterLocalSales(q,c,d);assert.equal(d.calls.length,1);assert.deepEqual(d.calls[0].binds,['CO','20261001','20261010']);assert.deepEqual(v.reasons,['EIS_APPROXIMATE_DISPLAY']);assert.equal(v.value,null);assert.equal(v.rows[0].amount.exactValue,null);assert.equal(v.rows[0].styleId,'SYN-STYLE');assert.doesNotMatch(JSON.stringify(c)+JSON.stringify(v),/SYN-REQUESTER/);
});
test('another admin cannot obtain requester context or borrow one',async()=>{
 const a=deps();a.currentActor=async()=>({userId:'OTHER-ADMIN',role:'admin'});assert.equal(await R.prepareRequesterReview(q,'SYN-REQUESTER',a),null);assert.equal(a.calls.length,0);
 const b=deps(),c=await R.prepareRequesterReview(q,'SYN-REQUESTER',b);b.currentActor=a.currentActor;const v=await R.readRequesterLocalSales(q,c,b);assert.deepEqual(v.reasons,['LOCAL_REQUESTER_MISMATCH']);assert.equal(b.calls.length,0);
});
test('no independently pinned requester, no fallback from admin/email/browser claims',async()=>{
 const d=deps();for(const id of [null,undefined,'',{},'OTHER'])assert.equal(await R.prepareRequesterReview({...q,requesterUserId:'SYN-REQUESTER',role:'admin'},id,d),null);const v=await R.readRequesterLocalSales(q,null,d);assert.deepEqual(v.reasons,['LOCAL_REQUESTER_REQUIRED']);assert.equal(d.calls.length,0);
});
test('one-shot context cannot be forged or serialized then reused',async()=>{
 const d=deps(),c=await R.prepareRequesterReview(q,'SYN-REQUESTER',d);let v=await R.readRequesterLocalSales(q,JSON.parse(JSON.stringify(c)),d);assert.deepEqual(v.reasons,['LOCAL_REQUESTER_REQUIRED']);
 await R.readRequesterLocalSales(q,c,d);v=await R.readRequesterLocalSales(q,c,d);assert.deepEqual(v.reasons,['LOCAL_REVIEW_EXPIRED']);assert.equal(d.calls.length,1);
});
test('scope pin prevents changing brand/date; mismatch consumes context',async()=>{
 const d=deps(),c=await R.prepareRequesterReview(q,'SYN-REQUESTER',d);let v=await R.readRequesterLocalSales({...q,brand:'CK'},c,d);assert.deepEqual(v.reasons,['LOCAL_REQUESTER_MISMATCH']);v=await R.readRequesterLocalSales(q,c,d);assert.deepEqual(v.reasons,['LOCAL_REVIEW_EXPIRED']);assert.equal(d.calls.length,0);
});
test('expiry and changed current role prevent actual query',async()=>{
 const a=deps(),c=await R.prepareRequesterReview(q,'SYN-REQUESTER',a);a.now=()=>61000;assert.deepEqual((await R.readRequesterLocalSales(q,c,a)).reasons,['LOCAL_REVIEW_EXPIRED']);
 const b=deps(),e=await R.prepareRequesterReview(q,'SYN-REQUESTER',b);b.currentActor=async()=>({userId:'SYN-REQUESTER',role:'admin'});assert.deepEqual((await R.readRequesterLocalSales(q,e,b)).reasons,['LOCAL_REQUESTER_MISMATCH']);assert.equal(b.calls.length,0);
});
test('self-review is not a registered web path or persistent grant',()=>{
 const runtime=fs.readFileSync('src/lib/erp/central-sales-runtime.ts','utf8');assert.match(runtime,/grantFor:async\(\)=>null,executor:null/);const route=fs.readFileSync('src/app/(app)/erp-insights-review/page.tsx','utf8');assert.doesNotMatch(route,/requester-local-review|prepareRequesterReview|readRequesterLocalSales/);const s=fs.readFileSync('src/lib/erp/requester-local-review.ts','utf8');assert.doesNotMatch(s,/process\.env|PRIVATE_KEY|fetch\(|spawn\(/);
});
test('confirmed self context without executor reports exact transport gap',async()=>{const d=deps();d.executor=null;const c=await R.prepareRequesterReview(q,'SYN-REQUESTER',d);const v=await R.readRequesterLocalSales(q,c,d);assert.deepEqual(v.reasons,['TRANSPORT_UNREGISTERED']);});

test('context expiry during current-session recheck prevents query',async()=>{
 const d=deps(),c=await R.prepareRequesterReview(q,'SYN-REQUESTER',d);let clock=1000;d.now=()=>clock;d.currentActor=async()=>{clock=61000;return {userId:'SYN-REQUESTER',role:'viewer'};};const v=await R.readRequesterLocalSales(q,c,d);assert.deepEqual(v.reasons,['LOCAL_REVIEW_EXPIRED']);assert.equal(d.calls.length,0);
});
