const test=require('node:test'),assert=require('node:assert/strict');
const load=require('./helpers/load-source.cjs'),audit=require('./helpers/synthetic-join-audit.cjs');
const N=load('src/lib/erp/sales-inventory-normalize.ts'),S=load('src/lib/erp/sales-inventory-server.ts'),Supply=load('src/lib/erp/order-receipt.ts'),J=load('src/lib/erp/join-coverage.ts');
const React=require('react'),SSR=require('react-dom/server'),Panel=load('src/components/erp-insights/SalesInventoryReadPanel.tsx').default;
const q={brand:'CO',from:'2026-10-01',to:'2026-10-10',year:'2026',season:'FW',inventoryAsOf:'2026-10-10',market:{store:'musinsa',category:'001',gender:'A',age:'AGE_BAND_ALL'}};
function fixture(){const c={BRANDCD:'CO',STYLECD:'SYN-S1',COLORCD:'BLACK',SIZECD:'M',YEARCD:'2026',SEASONNM:'스탠다드'};
 const rows={sales:[{...c,SALEDT:'20261001',SHOPCD:'SYN-SHOP',SALEAMT_VAT_EX:'0',SALEQTY:'0'}],shopInventory:[{...c,SHOPCD:'SYN-SHOP',INVQTY:'0',AVAILQTY:'0'}],warehouseInventory:[{...c,WHCD:'SYN-WH',AVAILQTY:'0',ONLINEQTY:'0',OFFLINEQTY:'0'}],mapping:[{BRANDCD:'CO',STYLECD:c.STYLECD,productId:'SYN-P',musinsaNo:'SYN-M',isOwn:true,category:'001',crosswalkVersion:'synthetic-only',verificationReceipt:'synthetic-only'}],market:[q.from,q.to].map(d=>({BRANDCD:'CO',STYLECD:c.STYLECD,product_id:'SYN-P',musinsa_no:'SYN-M',snapshot_date:d,store_code:'musinsa',category_code:'001',gender_filter:'A',age_filter:'AGE_BAND_ALL',rank_position:10}))};
 return N.PARTITIONS.map(name=>audit({name,...N.CONTRACTS[name],complete:true,pagesExpected:1,pagesReceived:1,asOf:q.to,fetchedAt:'2026-10-10T23:00:00Z',request:structuredClone(q),rows:rows[name]},q));}
const read=(parts,fail=false)=>S.readSalesInventory(q,{readPartition:async n=>{if(fail&&n==='warehouseInventory')throw Error('PRIVATE_SENTINEL');return parts.find(p=>p.name===n);}},{authorize:async()=>true,verify:async()=>true});
test('explicit complete source coverage admits zero-valued canonical projection; counts are not business KPIs',async()=>{
 const v=await read(fixture());assert.equal(v.kind,'ready');assert.equal(v.coverage.length,2);assert.equal(v.coverage[1].sourceRows,1);assert.equal(v.observations[0].warehouses[0].available,'0');
});
test('synthetic4342 source/4340 matched/2 unmatched withheld, no successful zero or partial rows',async()=>{
 const parts=fixture(),a=parts[2].joinAudit;Object.assign(a,{sourceRows:4342,matchedSourceRows:4340,unmatchedSourceRows:2});const v=await read(parts);assert.equal(v.kind,'withheld');assert.ok(v.reasons.includes('JOIN_UNMATCHED'));assert.deepEqual(v.observations,[]);assert.equal(v.coverage[1].unmatchedSourceRows,2);assert.match(SSR.renderToStaticMarkup(React.createElement(Panel,{state:v})),/master 미연결 원천 행/);
});
test('canonical inner-join result without pre-join receipt cannot masquerade as complete',async()=>{const b=fixture();delete b[2].joinAudit;const v=await read(b);assert.ok(v.reasons.includes('JOIN_RECEIPT_REQUIRED'));assert.deepEqual(v.observations,[]);});
for(const [label,change,reason]of [
 ['duplicate master',a=>a.duplicateMasterKeys=1,'JOIN_MASTER_DUPLICATE'],
 ['brand conflict',a=>a.conflictingBrandKeys=1,'JOIN_BRAND_CONFLICT'],
 ['null/unknown matched brand',a=>a.unknownBrandRows=1,'JOIN_BRAND_CONFLICT'],
 ['multiplicity hidden by regrouping',a=>a.multiplicityExcessRows=1,'JOIN_MULTIPLICITY'],
 ['partial join query',a=>a.complete=false,'JOIN_PARTIAL'],
 ['source balance mismatch',a=>a.sourceRows=2,'JOIN_RECEIPT_INVALID'],
 ['emitted row mismatch',a=>a.emittedRows=0,'JOIN_RECEIPT_INVALID'],
 ['wrong master',a=>a.masterTable='OTHER','JOIN_RECEIPT_INVALID'],
 ['wrong source',a=>a.sourceTable='SW_SHOPINV','JOIN_RECEIPT_INVALID'],
 ['wrong request scope',a=>a.request.brand='CK','JOIN_RECEIPT_INVALID'],
 ['different join key',a=>a.joinKeys=['STYLECD','BRANDCD'],'JOIN_RECEIPT_INVALID'],
 ['bad count type',a=>a.sourceRows='1','JOIN_RECEIPT_INVALID'],
 ['negative count',a=>a.unmatchedSourceRows=-1,'JOIN_RECEIPT_INVALID'],
 ['unsafe count',a=>a.sourceRows=Number.MAX_SAFE_INTEGER+1,'JOIN_RECEIPT_INVALID'],
])test(`join coverage withholds: ${label}`,async()=>{const b=fixture();change(b[2].joinAudit);const v=await read(b);assert.equal(v.kind,'withheld');assert.ok(v.reasons.includes(reason));assert.deepEqual(v.observations,[]);});
test('validated out-of-scope rows use explicit excluded count; unmatched cannot be treated as known other-brand rows',async()=>{
 const b=fixture();Object.assign(b[2].joinAudit,{sourceRows:5,matchedSourceRows:1,excludedSourceRows:4});const v=await read(b);assert.equal(v.kind,'ready');assert.equal(v.coverage[1].excludedSourceRows,4);
 const c=fixture();Object.assign(c[2].joinAudit,{sourceRows:5,matchedSourceRows:1,unmatchedSourceRows:2,excludedSourceRows:2});const w=await read(c);assert.ok(w.reasons.includes('JOIN_UNMATCHED'));
});
test('empty complete source distinguished from source rows discarded before projection',async()=>{
 const b=fixture();b[2].rows=[];Object.assign(b[2].joinAudit,{sourceRows:0,matchedSourceRows:0,emittedRows:0});const v=await read(b);assert.equal(v.kind,'empty');assert.deepEqual(v.reasons,['EMPTY']);
 const c=fixture();c[2].rows=[];c[2].joinAudit.emittedRows=0;const w=await read(c);assert.ok(w.reasons.includes('JOIN_PARTIAL'));assert.ok(w.reasons.includes('EMPTY'));assert.deepEqual(w.observations,[]);
});
test('query failure is READ_FAILED with no invented zero coverage',async()=>{const v=await read(fixture(),true);assert.equal(v.kind,'error');assert.deepEqual(v.reasons,['READ_FAILED']);assert.equal(v.coverage,undefined);assert.doesNotMatch(JSON.stringify(v),/PRIVATE_SENTINEL/);});
test('multiple error reasons retained; raw identifiers/evidence references not in displayed response',async()=>{
 const b=fixture();Object.assign(b[2].joinAudit,{sourceRows:3,matchedSourceRows:1,unmatchedSourceRows:2,duplicateMasterKeys:1,conflictingBrandKeys:1,multiplicityExcessRows:1,private:'PRIVATE_SENTINEL',evidenceRef:'PRIVATE_SENTINEL'});const v=await read(b);for(const code of ['JOIN_UNMATCHED','JOIN_MASTER_DUPLICATE','JOIN_BRAND_CONFLICT','JOIN_MULTIPLICITY'])assert.ok(v.reasons.includes(code));assert.doesNotMatch(JSON.stringify(v)+SSR.renderToStaticMarkup(React.createElement(Panel,{state:v})),/PRIVATE_SENTINEL|SYN-S1/);
});
test('supply receipts require same independent coverage, preserving unrelated sign/year gates',()=>{
 const request={brand:'CO',from:q.from,to:q.to,year:q.year,season:q.season};const c={BRANDCD:'CO',STYLECD:'SYN-S1',COLORCD:'BLACK',SIZECD:'M',YEARCD:'2026',SEASONNM:'스탠다드'};
 const parts=['orders','receipts'].map(name=>audit({name,...Supply.SUPPLY_CONTRACT[name],definition:'ipj-initial-qr-v1',complete:true,pagesExpected:1,pagesReceived:1,asOf:q.to,request,verificationReceipt:'synthetic-only',window:{from:q.from,to:q.to},rows:[name==='orders'?{...c,CHASU:'01',PONO:null,ORDQTY:'0'}:{...c,INQTY:'0'}]},request));
 assert.equal(Supply.normalizeOrderReceipt(parts,request).kind,'ready');parts[1].joinAudit.unmatchedSourceRows=2;parts[1].joinAudit.sourceRows=3;let v=Supply.normalizeOrderReceipt(parts,request);assert.ok(v.reasons.includes('JOIN_UNMATCHED'));assert.equal(v.summary,null);
 parts[1].rows[0].INQTY='-2';v=Supply.normalizeOrderReceipt(parts,request);assert.ok(v.reasons.includes('SIGN_RULE_UNVERIFIED'));assert.ok(v.reasons.includes('JOIN_UNMATCHED'));assert.equal(v.summary,null);
});
test('join summary never claims global audit pass or includes scope/evidence payload',()=>{const b=fixture();b[2].joinAudit.private='PRIVATE_SENTINEL';const v=J.inspectJoinCoverage(b,q);assert.doesNotMatch(JSON.stringify(v.summaries),/PRIVATE_SENTINEL|SYNTHETIC_ONLY|2026-10/);});
