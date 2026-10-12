const withSyntheticJoinAudit=require('./helpers/synthetic-join-audit.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const load=require('./helpers/load-source.cjs'),React=require('react'),SSR=require('react-dom/server');
const B=load('src/lib/erp/observed-schema-boundary.ts'),N=load('src/lib/erp/sales-inventory-normalize.ts'),S=load('src/lib/erp/sales-inventory-server.ts'),Supply=load('src/lib/erp/order-receipt.ts');
const Panel=load('src/components/erp-insights/SalesInventoryReadPanel.tsx').default;
const q={brand:'CO',from:'2026-10-01',to:'2026-10-10',year:'2026',season:'FW',inventoryAsOf:'2026-10-10',market:{store:'musinsa',category:'001',gender:'A',age:'AGE_BAND_ALL'}};
function fixture(brand='CO'){
 const request={...q,brand},c={BRANDCD:brand,STYLECD:'SYN-S1',YEARCD:'2026',SEASONNM:'스탠다드',COLORCD:'BLACK',SIZECD:'M'};
 const rows={sales:[{...c,SHOPCD:'SYN-SHOP',SALEDT:'20261001',SALEAMT_VAT_EX:'123.45',SALEQTY:'2'}],shopInventory:[{...c,SHOPCD:'SYN-SHOP',INVQTY:'4',AVAILQTY:'3'}],warehouseInventory:[{...c,WHCD:'SYN-WH',AVAILQTY:'5',ONLINEQTY:'2',OFFLINEQTY:'3'}],mapping:[{BRANDCD:brand,STYLECD:c.STYLECD,productId:'SYN-P1',musinsaNo:'SYN-123',isOwn:true,category:'001',crosswalkVersion:'synthetic-only',verificationReceipt:'synthetic-only'}],market:[request.from,request.to].map((d,i)=>({BRANDCD:brand,STYLECD:c.STYLECD,product_id:'SYN-P1',musinsa_no:'SYN-123',snapshot_date:d,store_code:'musinsa',category_code:'001',gender_filter:'A',age_filter:'AGE_BAND_ALL',rank_position:i?4:10}))};
 const parts=N.PARTITIONS.map(name=>({name,...N.CONTRACTS[name],complete:true,pagesExpected:1,pagesReceived:1,asOf:request.to,fetchedAt:'2026-10-10T23:00:00Z',request:structuredClone(request),rows:rows[name]}));
 return {request,parts};
}
const read=({parts,request},verify=true)=>S.readSalesInventory(request,{readPartition:async n=>withSyntheticJoinAudit(parts.find(p=>p.name===n),request)},{authorize:async()=>true,verify:async()=>verify});
test('separate verified central projection preserves style-shop-date grain without synthetic options',async()=>{
 const f=fixture();Object.assign(f.parts[0],N.CENTRAL_SALES_CONTRACT);delete f.parts[0].rows[0].COLORCD;delete f.parts[0].rows[0].SIZECD;
 const v=await read(f);assert.equal(v.kind,'ready');assert.equal(v.observations[0].sales[0].color,null);assert.equal(v.observations[0].sales[0].size,null);assert.equal(v.observations[0].sales[0].vatExcludedKRW,'123.45');
 const h=SSR.renderToStaticMarkup(React.createElement(Panel,{state:v}));assert.match(h,/옵션 집계 없음/);assert.match(h,/INSERTDT는 ETL 갱신 시각을 증명하지/);
});
test('central projection rejects fabricated options or duplicate style-shop-date rows',async()=>{
 for(const change of [f=>{},f=>{delete f.parts[0].rows[0].COLORCD;delete f.parts[0].rows[0].SIZECD;f.parts[0].rows.push({...f.parts[0].rows[0]});}]){const f=fixture();Object.assign(f.parts[0],N.CENTRAL_SALES_CONTRACT);change(f);const v=await read(f);assert.equal(v.kind,'withheld');assert.deepEqual(v.observations,[]);}
});
test('canonical synthetic option projection and five brands stay separate',async()=>{for(const brand of ['CO','LE','WA','CK','LK']){const v=await read(fixture(brand));assert.equal(v.kind,'ready');assert.equal(v.observations[0].brand,brand);assert.equal(v.observations[0].sales[0].color,'BLACK');}});
test('actual central view shape has no color/size; raw FLOAT and year26 cannot masquerade as canonical',async()=>{
 const f=fixture();const p=f.parts[0];p.source='VW_SALES_VAT';p.grain='SALEDT|BRANDCD|STYLECD|SHOPCD';delete p.rows[0].COLORCD;delete p.rows[0].SIZECD;p.rows[0].YEARCD='26';p.rows[0].SALEAMT_VAT_EX=123.45;
 const v=await read(f);for(const code of ['CENTRAL_GRAIN_UNVERIFIED','FLOAT_PRECISION_UNVERIFIED','YEAR_CENTURY_UNVERIFIED'])assert.ok(v.reasons.includes(code));assert.deepEqual(v.observations,[]);
});
for(const source of ['SW_WHININFO','SW_SHOPINV','SW_WHINV'])test(`brandless ${source} requires verified master/collision projection`,()=>{
 const p={source,rows:[{STYLECD:'SYN-S1',YEARCD:'26',AVAILQTY:'5'}]};const c=B.observedSchemaIssues(p);assert.ok(c.includes('BRAND_JOIN_UNVERIFIED'));assert.ok(c.includes('YEAR_CENTURY_UNVERIFIED'));if(source!=='SW_WHININFO')assert.ok(c.includes('SNAPSHOT_TIME_UNVERIFIED'));
});
test('stringifying FLOAT does not restore decimal precision or discharge origin gate',async()=>{
 const f=fixture();f.parts[0].columnTypes={SALEAMT_VAT_EX:'FLOAT'};f.parts[0].rows[0].SALEAMT_VAT_EX=String(123.45);const v=await read(f);assert.ok(v.reasons.includes('FLOAT_PRECISION_UNVERIFIED'));assert.deepEqual(v.observations,[]);
});
test('raw numeric zero is not exact canonical zero',async()=>{const f=fixture();f.parts[0].rows[0].SALEAMT_VAT_EX=0;const v=await read(f);assert.ok(v.reasons.includes('FLOAT_PRECISION_UNVERIFIED'));assert.equal(v.kind,'withheld');});
test('year26/00/27 require explicit reviewed mapping; no century inferred',()=>{
 for(const c of ['26','00','27'])assert.equal(B.normalizeSeasonYear(c,null).year,null);
 assert.equal(B.normalizeSeasonYear('26',{'26':'2026'}).year,'2026');assert.equal(B.normalizeSeasonYear('26',{'26':'2027'}).year,null);assert.equal(B.normalizeSeasonYear('26',{'26':'1926'}).year,null);
});
test('8 characters alone do not prove calendar validity',()=>{assert.equal(B.normalizeErpDate('20260230').date,null);assert.equal(B.normalizeErpDate('20240229').date,'2024-02-29');assert.equal(B.normalizeErpDate('20261012').date,'2026-10-12');assert.equal(B.normalizeErpDate('2026-10-12').date,null);});
test('raw receipt negative quantity survives input unchanged and yields specific sign reason, not abs or silent filter',()=>{
 const raw={name:'receipts',source:'SW_WHININFO',rows:[{STYLECD:'SYN-S1',CHASU:'02',YEARCD:'26',WHINDT:'20261008',INQTY:-2,private:'PRIVATE_SENTINEL'}]};const before=JSON.stringify(raw);const c=B.observedSchemaIssues(raw);assert.ok(c.includes('SIGN_RULE_UNVERIFIED'));assert.ok(c.includes('FLOAT_PRECISION_UNVERIFIED'));assert.equal(JSON.stringify(raw),before);assert.doesNotMatch(JSON.stringify(c),/PRIVATE_SENTINEL/);
});
test('signed canonical receipt is withheld with explicit business-rule reason even when other partition empty',()=>{
 const p={name:'receipts',...Supply.SUPPLY_CONTRACT.receipts,definition:'ipj-initial-qr-v1',asOf:q.to,verificationReceipt:'synthetic-only',request:q,window:{from:q.from,to:q.to},complete:true,pagesExpected:1,pagesReceived:1,rows:[{BRANDCD:'CO',STYLECD:'SYN-S1',YEARCD:'2026',SEASONNM:'스탠다드',COLORCD:'BLACK',SIZECD:'M',INQTY:'-2'}]};
 const o={...p,name:'orders',...Supply.SUPPLY_CONTRACT.orders,rows:[]};const v=Supply.normalizeOrderReceipt([o,p].map(x=>withSyntheticJoinAudit(x,q)),q);assert.ok(v.reasons.includes('SIGN_RULE_UNVERIFIED'));assert.ok(v.reasons.includes('EMPTY'));assert.equal(v.summary,null);assert.equal(p.rows[0].INQTY,'-2');
});
test('present raw invalid calendar, no brand and negative FLOAT are all retained as allowlisted reasons',()=>{
 const codes=B.observedSchemaIssues({source:'SW_WHININFO',rows:[{YEARCD:'26',WHINDT:'20260230',INQTY:-2}]});for(const c of ['SOURCE_DATE_INVALID','BRAND_JOIN_UNVERIFIED','YEAR_CENTURY_UNVERIFIED','FLOAT_PRECISION_UNVERIFIED','SIGN_RULE_UNVERIFIED'])assert.ok(codes.includes(c));
});
test('canonical projection labels cannot bypass server-side verifier or output source evidence',async()=>{const f=fixture();f.parts[0].private='PRIVATE_SENTINEL';const v=await read(f,false);assert.equal(v.kind,'withheld');assert.deepEqual(v.observations,[]);assert.doesNotMatch(JSON.stringify(v),/PRIVATE_SENTINEL/);});
test('CI report entry keeps ERP command chained; no runtime credential/network/schema fixture code',()=>{
 const scripts=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../package.json'),'utf8')).scripts;assert.match(scripts['test:erp-insights'],/erp-observed-schema\.test\.cjs/);assert.match(scripts['test:report-evidence'],/&& npm run test:erp-insights$/);
 const s=fs.readFileSync(require('node:path').join(__dirname,'../src/lib/erp/observed-schema-boundary.ts'),'utf8');assert.doesNotMatch(s,/process\.env|fetch\(|PRIVATE_KEY|https:\/\//);
});

for(const type of ['FLOAT nullable','float nullable',' FLOAT NOT NULL ','FLOAT4','FLOAT8','REAL','DOUBLE PRECISION nullable','FLOAT(53) nullable'])test(`origin approximate descriptor holds: ${type}`,async()=>{
 const f=fixture();f.parts[0].rows[0].SALEAMT_VAT_EX='0';f.parts[0].columnTypes={SALEAMT_VAT_EX:type};const v=await read(f);assert.equal(v.kind,'withheld');assert.ok(v.reasons.includes('FLOAT_PRECISION_UNVERIFIED'));assert.deepEqual(v.observations,[]);
});
for(const type of ['NUMBER','NUMBER nullable','DECIMAL(38, 2) NOT NULL','numeric(12,0)','NUMBER(38)','INTEGER','TEXT nullable','TIMESTAMP_TZ(9) nullable'])test(`valid metadata descriptor is not mistaken for FLOAT: ${type}`,async()=>{
 assert.notEqual(B.classifyOriginType(type),'unknown');const f=fixture();f.parts[0].columnTypes={SALEAMT_VAT_EX:type};const v=await read(f);assert.equal(v.kind,'ready');assert.deepEqual(v.reasons,[]);
});
for(const type of ['MYFLOAT','FLOATING','FLOAT nullable EXTRA','NUMBER(39,0)','NUMBER(0)','DECIMAL(5,6)','NUMBER(2,-1)','VARCHAR(0)','TIMESTAMP_TZ(10)','FLOAT(54)',null,0,{},''])test(`unknown metadata descriptor withholds safely: ${JSON.stringify(type)}`,async()=>{
 const f=fixture();f.parts[0].columnTypes={SALEAMT_VAT_EX:type};const v=await read(f);assert.equal(v.kind,'withheld');assert.ok(v.reasons.includes('TYPE_METADATA_UNVERIFIED'));assert.deepEqual(v.observations,[]);if(type==='MYFLOAT'||type==='FLOATING')assert.ok(!v.reasons.includes('FLOAT_PRECISION_UNVERIFIED'));
});
for(const metadata of [null,[],{},'FLOAT',undefined,{'bad-column-name':'NUMBER'}])test(`malformed metadata map cannot bypass hold: ${JSON.stringify(metadata)}`,async()=>{
 const f=fixture();f.parts[0].columnTypes=metadata;const v=await read(f);assert.equal(v.kind,'withheld');assert.ok(v.reasons.includes('TYPE_METADATA_UNVERIFIED'));assert.deepEqual(v.observations,[]);
});
test('unknown and FLOAT metadata reasons survive together without raw descriptor exposure',async()=>{
 const f=fixture();f.parts[0].columnTypes={SALEAMT_VAT_EX:'FLOAT nullable',PRIVATE_SENTINEL:'PRIVATE_SENTINEL'};const v=await read(f);assert.ok(v.reasons.includes('FLOAT_PRECISION_UNVERIFIED'));assert.ok(v.reasons.includes('TYPE_METADATA_UNVERIFIED'));assert.doesNotMatch(JSON.stringify(v)+SSR.renderToStaticMarkup(React.createElement(Panel,{state:v})),/PRIVATE_SENTINEL/);
});
