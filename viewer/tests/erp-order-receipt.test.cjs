const withSyntheticJoinAudit=require('./helpers/synthetic-join-audit.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const load=require('./helpers/load-source.cjs'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const N=load('src/lib/erp/order-receipt.ts'),S=load('src/lib/erp/order-receipt-server.ts'),Panel=load('src/components/erp-insights/OrderReceiptReadPanel.tsx').default;
const q={brand:'CO',from:'2026-10-01',to:'2026-10-10',year:'2026',season:'FW'};
function fixture(request=q){const c={BRANDCD:request.brand,STYLECD:'S1',COLORCD:'BLACK',SIZECD:'M',YEARCD:request.year,SEASONNM:'스탠다드'};
 const data={orders:[{...c,CHASU:'01',PONO:'글로벌',ORDQTY:'100'},{...c,CHASU:'02',PONO:null,ORDQTY:'50'},{...c,CHASU:'03',PONO:'대만',ORDQTY:'20'},{...c,CHASU:'02',COLORCD:'RED',SIZECD:'L',PONO:'',ORDQTY:'10'}],receipts:[{...c,INQTY:'30'}]};
 return ['orders','receipts'].map(name=>({name,...N.SUPPLY_CONTRACT[name],definition:'ipj-initial-qr-v1',complete:true,pagesExpected:1,pagesReceived:1,asOf:request.to,verificationReceipt:'TEST_ONLY',request:structuredClone(request),window:{from:request.from,to:request.to},rows:data[name]}));}
const read=(b,request=q)=>S.readOrderReceipt(request,{readPartition:async n=>withSyntheticJoinAudit(b.find(p=>p.name===n),request)},{authorize:async()=>true,verify:async()=>true});
const html=s=>renderToStaticMarkup(React.createElement(Panel,{state:s}));
test('multi-lot option orders and partial receipts follow server -> actual panel without receipt rate',async()=>{
 const s=await read(fixture());assert.equal(s.kind,'ready');assert.equal(s.summary.totalOrder,'180');assert.equal(s.summary.initialOrder,'100');assert.equal(s.summary.qrOrder,'60');assert.equal(s.summary.excludedQROrder,'20');assert.equal(s.summary.totalReceipt,'30');assert.equal(s.summary.receiptRate,null);assert.equal(s.summary.orders.length,4);assert.equal(s.summary.receipts.length,1);assert.match(html(s),/차수별 입고 연결키/);assert.doesNotMatch(html(s),/%/);assert.equal(s.executable,false);
});
test('initial is not subject to QR PONO exclusions; null and blank PONO are QR',async()=>{
 for(const pono of [...N.QR_EXCLUDED_PONO,null,'']){const b=fixture();b[0].rows=[{...b[0].rows[0],PONO:pono}];assert.equal((await read(b)).summary.initialOrder,'100');}
 for(const pono of [null,'']){const b=fixture();b[0].rows=[{...b[0].rows[1],PONO:pono}];assert.equal((await read(b)).summary.qrOrder,'50');}
 for(const pono of N.QR_EXCLUDED_PONO){const b=fixture();b[0].rows=[{...b[0].rows[1],PONO:pono}];const v=await read(b);assert.equal(v.summary.qrOrder,'0');assert.equal(v.summary.excludedQROrder,'50');}
});
test('five brands and standard SS/FW remain separate',async()=>{for(const brand of ['CO','LE','WA','CK','LK'])for(const season of ['SS','FW']){const r={...q,brand,season};const v=await read(fixture(r),r);assert.equal(v.kind,'ready');assert.equal(v.summary.orders[0].brand,brand);}});
test('confirmed order zero never yields invented 0/100 percent receipt rate',async()=>{
 const b=fixture();b[0].rows.forEach(r=>r.ORDQTY='0');const v=await read(b);assert.equal(v.kind,'ready');assert.equal(v.summary.totalOrder,'0');assert.equal(v.summary.totalReceipt,'30');assert.equal(v.summary.receiptRate,null);assert.deepEqual(v.reasons,['RATE_UNVERIFIED']);
});
test('exact BigInt quantity totals retain precision',async()=>{const b=fixture();b[0].rows=[{...b[0].rows[0],ORDQTY:'9007199254740993'},{...b[0].rows[1],ORDQTY:'2'}];const v=await read(b);assert.equal(v.summary.totalOrder,'9007199254740995');});
const failures={
 nullOrder:b=>b[0].rows[0].ORDQTY=null,nullReceipt:b=>b[1].rows[0].INQTY=null,numberOrder:b=>b[0].rows[0].ORDQTY=100,negativeOrder:b=>b[0].rows[0].ORDQTY='-1',
 missingPono:b=>delete b[0].rows[0].PONO,missingLot:b=>delete b[0].rows[0].CHASU,missingColor:b=>delete b[0].rows[0].COLORCD,missingSize:b=>delete b[1].rows[0].SIZECD,
 duplicateOrder:b=>b[0].rows.push({...b[0].rows[0]}),duplicateReceipt:b=>b[1].rows.push({...b[1].rows[0]}),differentReceiptGrain:b=>b[1].rows[0].CHASU='01',
 missingPartition:b=>b.pop(),partialPages:b=>b[1].pagesReceived=0,incomplete:b=>b[0].complete=false,wrongOrderGrain:b=>b[0].grain='BRANDCD|STYLECD',
 wrongReceiptPeriod:b=>b[1].window.from='2026-09-01',differentRequest:b=>b[0].request.to='2026-10-09',wrongSource:b=>b[1].source='SW_WHINV',
 wrongSnapshot:b=>b[0].asOf='2026-10-09',wrongBasis:b=>b[0].basis='sale-window',wrongBrand:b=>b[1].rows[0].BRANDCD='CK',wrongSeason:b=>b[0].rows[0].SEASONNM='봄',
 wrongYear:b=>b[1].rows[0].YEARCD='2025',emptyReceipt:b=>b[1].rows=[],emptyOrder:b=>b[0].rows=[],
 mixedNullEmpty:b=>{b[0].rows[0].ORDQTY=null;b[1].rows=[];},mixedNullPartial:b=>{b[0].rows[0].ORDQTY=null;b[1].complete=false;},
 mixedEmptyPartial:b=>{b[0].rows=[];b[1].complete=false;}
};
for(const [name,alter]of Object.entries(failures))test(`supply fails closed: ${name}`,async()=>{const b=fixture();alter(b);const s=await read(b);assert.notEqual(s.kind,'ready');assert.equal(s.summary,null);assert.equal(s.executable,false);assert.doesNotMatch(html(s),/TEST_ONLY|NaN|Infinity/);if(name==='mixedNullEmpty')assert.deepEqual(s.reasons,['EMPTY','INVALID_ROW']);if(name==='mixedNullPartial')assert.deepEqual(s.reasons,['INCOMPLETE','INVALID_ROW']);});
test('zero plus empty receipts is EMPTY, not 0 receipts',async()=>{const b=fixture();b[0].rows.forEach(r=>r.ORDQTY='0');b[1].rows=[];const s=await read(b);assert.equal(s.kind,'empty');assert.equal(s.summary,null);assert.deepEqual(s.reasons,['EMPTY']);});
test('different option receipts and different style never join orders to compute a ratio',async()=>{const b=fixture();b[1].rows[0].STYLECD='OTHER';b[1].rows[0].SIZECD='XL';const s=await read(b);assert.equal(s.kind,'ready');assert.equal(s.summary.receiptRate,null);assert.equal(s.summary.receipts[0].style,'OTHER');});
test('default source remains unconnected; authorization precedes reads; errors are redacted',async()=>{
 assert.equal((await S.readConfiguredOrderReceipt()).kind,'unconnected');let calls=0;const p={readPartition:async()=>{calls++;throw Error('PRIVATE_SENTINEL');}};
 let v=await S.readOrderReceipt(q,p,{authorize:async()=>false,verify:async()=>true});assert.equal(calls,0);assert.deepEqual(v.reasons,['ACCESS']);
 v=await S.readOrderReceipt(q,p,{authorize:async()=>true,verify:async()=>true});assert.deepEqual(v.reasons,['READ_FAILED']);assert.doesNotMatch(html(v)+JSON.stringify(v),/PRIVATE_SENTINEL/);
});
test('independent trusted verifier cannot be replaced by partition receipts',async()=>{const b=fixture();const s=await S.readOrderReceipt(q,{readPartition:async n=>withSyntheticJoinAudit(b.find(p=>p.name===n),q)},{authorize:async()=>true,verify:async()=>false});assert.equal(s.summary,null);assert.deepEqual(s.reasons,['CONTRACT']);});
test('private raw fields and receipt identifiers are not projected',async()=>{const b=fixture();b.forEach(p=>p.rows.forEach(r=>r.raw='PRIVATE_SENTINEL'));const s=await read(b);assert.doesNotMatch(JSON.stringify(s)+html(s),/PRIVATE_SENTINEL|TEST_ONLY/);});
