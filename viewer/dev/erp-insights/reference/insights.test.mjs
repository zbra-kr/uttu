import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as rules from './insights.mjs';
import {adaptScreenInput} from './screen-input-adapter.mjs';
const {growth,pairedRank,reviewRate,evidence,signal,aggregate,validDate,signalBasis}=rules;
const row={mappingVerified:true,sameScope:true,erpSource:'fixture-erp',marketSource:'fixture-market',erpComplete:true,marketComplete:true,reviewComplete:true,reviewWindow:{start:'2026-10-04',end:'2026-10-10'},reviewUpdatedDate:'2026-10-10',peerComplete:true,peerWindow:{start:'2026-10-04',end:'2026-10-10'},peerUpdatedDate:'2026-10-10',peerCount:20,asOf:'2026-10-10',erpDate:'2026-10-10',marketDate:'2026-10-10',erpUpdatedDate:'2026-10-10',marketUpdatedDate:'2026-10-10',erpWindow:{start:'2026-10-04',end:'2026-10-10'},marketWindow:{start:'2026-10-04',end:'2026-10-10'},erpPreviousWindow:{start:'2026-09-27',end:'2026-10-03'},marketPreviousWindow:{start:'2026-09-27',end:'2026-10-03'},rankDate:'2026-10-10',previousRankDate:'2026-10-03',rank:10,previousRank:30,sale:12,wow:-5,sellThrough:20,carryover:true,inventory:12,online:0,lowReviews:2,reviews:10,erpDiscount:40,peerDiscount:20,profitChange:-5};
const suspended=r=>assert.match(evidence(r),/판단 보류/);
test('valid source-period pair permits bounded ranking comparison',()=>{assert.equal(pairedRank(row),20);assert.equal(pairedRank({...row,mappingVerified:false}),null);assert.equal(pairedRank({...row,previousRank:null}),null);assert.equal(pairedRank({...row,sameScope:false}),null)});
test('canonical calendar dates required',()=>{for(const value of [undefined,null,'','invalid','2026-02-30','2026-2-01',NaN,Infinity]) {assert.equal(validDate(value),false);suspended({...row,erpDate:value,marketDate:value});}assert.equal(validDate('2024-02-29'),true)});
test('windows must exist, match, have valid calendar dates, equal lengths and no overlap',()=>{for(const patch of [{erpWindow:null},{marketWindow:{start:'2026-10-05',end:'2026-10-10'}},{erpPreviousWindow:{start:'2026-10-04',end:'2026-10-10'},marketPreviousWindow:{start:'2026-10-04',end:'2026-10-10'}},{erpPreviousWindow:{start:'2026-09-28',end:'2026-10-03'},marketPreviousWindow:{start:'2026-09-28',end:'2026-10-03'}},{rankDate:'2026-10-09'},{previousRankDate:null}])suspended({...row,...patch})});
test('truthy strings are not verified flags or complete receipts',()=>{for(const key of ['mappingVerified','sameScope','erpComplete','marketComplete'])suspended({...row,[key]:'true'});suspended({...row,erpSource:''})});
test('stale or missing updated dates and unmatched observation dates suspend',()=>{for(const patch of [{erpDate:'2026-10-09'},{erpUpdatedDate:null},{marketUpdatedDate:'2026-10-09'},{asOf:'2026-10-11'}])suspended({...row,...patch})});
test('unknown sales rate and peer discount never coerce to zero',()=>{for(const value of [undefined,null,NaN,Infinity,-Infinity,'','0',false]){assert.match(signal({...row,sellThrough:value},'planning'),/판단 보류/);assert.match(signal({...row,peerDiscount:value},'margin'),/판단 보류/);assert.match(signal({...row,sale:value},'sales'),/판단 보류/)}});
test('domain-invalid rates or stock suspend',()=>{assert.match(signal({...row,sellThrough:-1},'planning'),/판단 보류/);assert.match(signal({...row,peerDiscount:101},'margin'),/판단 보류/);assert.match(signal({...row,online:-1},'carryover'),/판단 보류/)});
test('real zero remains valid distinct from unknown',()=>{assert.match(signal({...row,sellThrough:0},'planning'),/낮은 판매율/);assert.match(signal({...row,peerDiscount:0},'margin'),/동시 관측/);assert.equal(aggregate([{sale:0,erpComplete:true}],'sale').value,0);assert.equal(aggregate([{sale:null,erpComplete:true}],'sale').value,null)});
test('all missing, partial, empty and failed receipt do not return a total or mean',()=>{const invalid=[null,undefined,NaN,Infinity,-Infinity,'',false];const all=aggregate(invalid.map(sale=>({sale,erpComplete:true})),'sale');assert.equal(all.value,null);assert.equal(all.state,'missing');assert.equal(all.missingN,invalid.length);for(const mean of [false,true]){const partial=aggregate([{sale:10,erpComplete:true},{sale:null,erpComplete:true}],'sale',{mean});assert.equal(partial.value,null);assert.equal(partial.state,'partial');assert.equal(partial.validN,1)}assert.equal(aggregate([],'sale').state,'empty');assert.equal(aggregate([{sale:10,erpComplete:false}],'sale').value,null)});
test('valid means use complete valid samples and overflow is unknown',()=>{assert.equal(aggregate([{sale:0,erpComplete:true},{sale:10,erpComplete:true}],'sale',{mean:true}).value,5);assert.equal(aggregate([{sale:Number.MAX_VALUE,erpComplete:true},{sale:Number.MAX_VALUE,erpComplete:true}],'sale').value,null)});
test('review denominator and complete receipt required',()=>{assert.equal(reviewRate(0,0),null);assert.equal(reviewRate(4,3),null);assert.equal(reviewRate(0,10),0);assert.match(signal({...row,reviewComplete:false},'quality'),/판단 보류/);assert.match(signal({...row,reviews:0,lowReviews:0},'quality'),/판단 보류/)});
test('growth validates finite typed values and missing denominator',()=>{for(const value of [0,null,undefined,NaN,Infinity,''])assert.equal(growth(5,value),null);assert.equal(growth(0,10),-100);assert.equal(growth(12,10),20)});
test('signal basis exposes samples missing metrics freshness and response state',()=>{const b=signalBasis({...row,sale:null,erpUpdatedDate:null});assert.match(b,/표본 10/);assert.match(b,/누락 1/);assert.match(b,/최신성 미확인/)});
test('five views return descriptive checks for valid fixture',()=>{for(const view of ['planning','sales','margin','carryover','quality'])assert.ok(!signal(row,view).includes('판단 보류'))});
function rendered(change,normalize=true){const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');const code=html.split('<script type="module">')[1].split('</script>')[0].replace(/import .*?from '\.\/[^']+';/g,'');const elements=new Map();const document={getElementById(id){if(!elements.has(id))elements.set(id,{value:'all',innerHTML:'',textContent:''});return elements.get(id)},querySelectorAll(){return []}};const ctx=vm.createContext({document,Intl,adaptScreenInput,...rules});vm.runInContext(code,ctx);vm.runInContext((normalize?"rows.forEach(r=>{r.mappingVerified=true;r.sameScope=true;r.erpDate=r.erpUpdatedDate=r.asOf;r.rank=10;r.previousRank=30});":"")+change+';render()',ctx);return elements;}
test('actual UI render all-null sales shows unavailable instead of zero',()=>{const dom=rendered("rows.forEach(r=>r.sale=null)");assert.match(dom.get('cards').innerHTML,/<strong>미확인<\/strong>/);assert.match(dom.get('coverage').textContent,/매출 유효 0\/5 · 매출 누락 5 · 상태 missing/)});
test('actual UI partial sales with zero remains partial unavailable',()=>{const dom=rendered("rows[0].sale=0;rows[1].sale=null");assert.match(dom.get('cards').innerHTML,/<strong>미확인<\/strong>/);assert.match(dom.get('coverage').textContent,/매출 유효 4\/5 · 매출 누락 1 · 상태 partial/)});
test('actual UI complete zero sales shows real zero',()=>{const dom=rendered("rows.forEach(r=>r.sale=0)");assert.match(dom.get('cards').innerHTML,/<strong>0<\/strong>/);assert.match(dom.get('coverage').textContent,/매출 유효 5\/5 · 매출 누락 0 · 상태 complete/)});

test('review and peer cohorts require matching windows, sample receipt and freshness',()=>{for(const patch of [{reviewWindow:null},{reviewUpdatedDate:null}])assert.match(signal({...row,...patch},'quality'),/판단 보류/);for(const patch of [{peerComplete:false},{peerCount:0},{peerUpdatedDate:null},{peerWindow:null}])assert.match(signal({...row,...patch},'margin'),/판단 보류/);assert.equal(growth(Number.MAX_VALUE,0.00001),null)});

function cardValues(dom){return [...dom.get('cards').innerHTML.matchAll(/<strong>(.*?)<\/strong>/g)].map(m=>m[1]);}
function one(view,patch){return rendered(`current='${view}';$('brand').value='CO';Object.assign(rows[0],${patch})`);}
test('margin actual summary and row suspend together for unknown peer metrics',()=>{
  for(const value of ['null','undefined','NaN','Infinity','-Infinity','101','-1']){
    const dom=one('margin',`{peerDiscount:${value}}`),values=cardValues(dom);
    assert.equal(values[2],'미확인');assert.equal(values[4],'미확인');
    assert.match(dom.get('body').innerHTML,/판단 보류/);assert.match(dom.get('coverage').textContent,/점검 집계 유효 0\/1/);
  }
});
test('margin actual summary and row share sample receipt period and freshness guards',()=>{
  for(const patch of ['{peerComplete:false}','{peerCount:0}','{peerCount:null}','{peerWindow:null}',"{peerWindow:{start:'2026-10-05',end:'2026-10-10'}}",'{peerUpdatedDate:null}',"{peerUpdatedDate:'2026-10-09'}"]){
    const dom=one('margin',patch),values=cardValues(dom);
    assert.equal(values[2],'미확인');assert.equal(values[4],'미확인');assert.match(dom.get('body').innerHTML,/판단 보류/);
  }
});
test('complete margin zero peer mean remains real zero and valid candidate count',()=>{
  const values=cardValues(one('margin','{peerDiscount:0}'));assert.equal(values[2],'0%');assert.equal(values[4],'1');
  assert.equal(cardValues(one('margin','{erpDiscount:0,peerDiscount:0,profitChange:0}'))[4],'0');
});
test('all five actual summaries suspend under view-specific missing evidence',()=>{
  const cases=[['planning','{sellThrough:null}',1],['sales','{wow:null}',1],['margin','{peerComplete:false}',2],['carryover','{online:null}',2],['quality','{reviewComplete:false}',1],['quality','{reviews:0,lowReviews:0}',3]];
  for(const [view,patch,index] of cases){const dom=one(view,patch);assert.equal(cardValues(dom)[index],'미확인',view);assert.match(dom.get('body').innerHTML,/판단 보류/,view);assert.match(dom.get('coverage').textContent,/점검 집계 유효 0\/1/,view);}
});
test('all five summaries share generic period receipt freshness and rank checks',()=>{
  for(const view of ['planning','sales','margin','carryover','quality'])for(const patch of ['{marketWindow:null}','{marketComplete:false}','{rank:null}',"{marketUpdatedDate:'2026-10-09'}"]){
    const dom=one(view,patch);assert.equal(cardValues(dom)[0],'미확인',view+patch);assert.match(dom.get('body').innerHTML,/판단 보류/);
  }
});
test('partial view cohort withholds count and average rather than counting only known rows',()=>{
  const dom=rendered("current='margin';$('item').value='후드티';rows[1].peerComplete=false;rows[3].peerDiscount=null");
  assert.equal(cardValues(dom)[2],'미확인');assert.equal(cardValues(dom)[4],'미확인');assert.match(dom.get('coverage').textContent,/점검 집계 유효 1\/2 · 상태 partial/);
});
test('carryover quality review count respects review-specific guard in addition to inventory guard',()=>{
  const dom=one('carryover','{reviewComplete:false}');assert.equal(cardValues(dom)[5],'미확인');assert.notEqual(cardValues(dom)[2],'미확인');
});
test('pure aggregate and count agree with assessment eligibility for all views',()=>{
  for(const view of ['planning','sales','margin','carryover','quality']){
    assert.equal(rules.signalCount([row],view).value,1);assert.equal(rules.viewAggregate([row],'sale',view).value,12);
    assert.equal(rules.signalCount([row,{...row,marketWindow:null}],view).value,null);
    assert.equal(rules.viewAggregate([row,{...row,marketWindow:null}],'sale',view).state,'partial');
  }
});

test('unmodified mixed fixture exposes partial summaries and view-specific eligible coverage',()=>{
  for(const view of ['planning','sales','margin','carryover','quality']){
    const dom=rendered(`current='${view}'`,false);
    if(view==='carryover')assert.match(dom.get('coverage').textContent,/점검 집계 유효 2\/2 · 상태 complete/);
    else {assert.equal(cardValues(dom)[0],'미확인',view);assert.match(dom.get('coverage').textContent,/상태 partial/);}
  }
});
test('empty cohort does not produce a candidate zero or numeric average',()=>{
  for(const view of ['planning','sales','margin','carryover','quality']){
    const dom=rendered(`current='${view}';$('brand').value='no-match'`);assert.equal(cardValues(dom)[0],'미확인');assert.match(dom.get('coverage').textContent,/점검 집계 유효 0\/0 · 상태 empty/);
  }
});
