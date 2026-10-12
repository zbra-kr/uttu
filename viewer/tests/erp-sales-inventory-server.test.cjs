const withSyntheticJoinAudit=require('./helpers/synthetic-join-audit.cjs');
const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), {renderToStaticMarkup} = require('react-dom/server');
const load = require('./helpers/load-source.cjs');
const server = load('src/lib/erp/sales-inventory-server.ts');
const normalize = load('src/lib/erp/sales-inventory-normalize.ts');
const Panel = load('src/components/erp-insights/SalesInventoryReadPanel.tsx').default;
const request = {brand:'CO',from:'2026-10-04',to:'2026-10-10',year:'2026',season:'FW',inventoryAsOf:'2026-10-10',market:{store:'musinsa',category:'001',gender:'A',age:'AGE_BAND_ALL'}};
function fixture(q=structuredClone(request)) {
 const common={BRANDCD:q.brand,STYLECD:'STYLE-1',COLORCD:'BLACK',SIZECD:'M',YEARCD:'2026',SEASONNM:'스탠다드'};
 const data={
  sales:[{...common,SALEDT:'20261004',SHOPCD:'COF001',SALEAMT_VAT_EX:'123.45',SALEQTY:'2'},{...common,SALEDT:'20261010',SHOPCD:'S1',SALEAMT_VAT_EX:'-10.50',SALEQTY:'-1'},{...common,SALEDT:'20261010',SHOPCD:'B6055',SALEAMT_VAT_EX:'500',SALEQTY:'4'}],
  shopInventory:[{...common,SHOPCD:'S1',INVQTY:'20',AVAILQTY:'12'}],
  warehouseInventory:[{...common,WHCD:'W1',AVAILQTY:'30',ONLINEQTY:'0',OFFLINEQTY:'20'}],
  mapping:[{BRANDCD:q.brand,STYLECD:'STYLE-1',productId:'p1',musinsaNo:'123',isOwn:true,category:q.market.category,crosswalkVersion:'synthetic-v1',verificationReceipt:'synthetic-only'}],
  market:[q.from,q.to].map((day,i)=>({BRANDCD:q.brand,STYLECD:'STYLE-1',product_id:'p1',musinsa_no:'123',snapshot_date:day,store_code:q.market.store,category_code:q.market.category,gender_filter:q.market.gender,age_filter:q.market.age,rank_position:i?4:10}))
 };
 return normalize.PARTITIONS.map(name=>({name,...normalize.CONTRACTS[name],complete:true,pagesExpected:1,pagesReceived:1,fetchedAt:'2026-10-10T23:00:00Z',asOf:q.to,request:structuredClone(q),rows:data[name]}));
}
function dependencies(batch) {return {provider:{readPartition:async (name,request)=>withSyntheticJoinAudit(batch.find(p=>p.name===name),request)},access:{authorize:async()=>true,verify:async()=>true}};}
async function read(batch,q=request){const {provider,access}=dependencies(batch);return server.readSalesInventory(q,provider,access);}
test('actual configured server path stays unconnected with no fixtures or queries',async()=>{
 const value=await server.readConfiguredSalesInventory();assert.equal(value.kind,'unconnected');assert.deepEqual(value.observations,[]);
});
test('server input -> normalization -> actual React panel: VAT decimals, signed returns, grain and rank',async()=>{
 const value=await read(fixture());assert.equal(value.kind,'ready');assert.equal(value.executable,false);
 const row=value.observations[0];assert.deepEqual(row.sales.map(x=>x.vatExcludedKRW),['123.45','-10.50']);
 assert.equal(row.sales[0].shop,'COF001');assert.equal(row.warehouses[0].online,'0');assert.equal(row.shops[0].inventory,'20');
 assert.equal(row.orders,null);assert.equal(row.receipts,null);
 const html=renderToStaticMarkup(React.createElement(Panel,{state:value}));assert.match(html,/123\.45/);assert.match(html,/-10\.50/);assert.match(html,/10 → 4/);assert.match(html,/매장 재고/);assert.match(html,/창고 재고/);assert.match(html,/발주: 미확인/);assert.doesNotMatch(html,/500|synthetic-only/);
});
test('CO LE WA CK LK remain separate; SS and FW both accept standard',async()=>{
 for(const brand of ['CO','LE','WA','CK','LK'])for(const season of ['SS','FW']){const q={...request,brand,season};const v=await read(fixture(q),q);assert.equal(v.kind,'ready');assert.equal(v.observations[0].brand,brand);}
});
test('authorize before any provider reads, null authorization denies; errors redacted',async()=>{
 let calls=0;const provider={readPartition:async()=>{calls++;throw Error('PRIVATE_SENTINEL');}};
 for(const access of [null,{authorize:async()=>false,verify:async()=>true},{authorize:async()=>{throw Error('PRIVATE_SENTINEL');},verify:async()=>true}]){
  const v=await server.readSalesInventory(request,provider,access);assert.notEqual(v.kind,'ready');assert.doesNotMatch(JSON.stringify(v),/PRIVATE_SENTINEL/);
 }assert.equal(calls,0);
});
test('provider failures discard successful partitions and never publish partial rows or zero',async()=>{
 const d=dependencies(fixture());const original=d.provider.readPartition;d.provider.readPartition=async(n,q)=>{if(n==='warehouseInventory')throw Error('PRIVATE_SENTINEL');return original(n,q);};
 const v=await server.readSalesInventory(request,d.provider,d.access);assert.equal(v.kind,'error');assert.deepEqual(v.observations,[]);assert.equal(v.executable,false);assert.doesNotMatch(renderToStaticMarkup(React.createElement(Panel,{state:v})),/PRIVATE_SENTINEL/);
});
test('provider metadata cannot bypass independent trusted contract check',async()=>{
 const d=dependencies(fixture());d.access.verify=async()=>false;const v=await server.readSalesInventory(request,d.provider,d.access);assert.equal(v.kind,'withheld');assert.deepEqual(v.reasons,['CONTRACT']);
});
test('request captured before await, source/authorization mutations cannot change display scope',async()=>{
 const q=structuredClone(request), d=dependencies(fixture());d.access.authorize=async copy=>{q.brand='CK';copy.brand='LK';return true;};
 const v=await server.readSalesInventory(q,d.provider,d.access);assert.equal(v.kind,'ready');assert.equal(v.observations[0].brand,'CO');
});
const mutations={
 missingPartition:b=>b.pop(), duplicatePartition:b=>b[4]=structuredClone(b[0]), partialPage:b=>b[0].pagesReceived=0,
 missingPages:b=>delete b[0].pagesExpected, missingComplete:b=>delete b[0].complete,
 wrongSource:b=>b[0].source='SW_SALEINFO', wrongFieldContract:b=>b[0].definition='divide-by-1.1', wrongGrain:b=>b[0].grain='BRANDCD',
 wrongDateScope:b=>b[0].request.from='2026-10-03', wrongMarketScope:b=>b[4].request.market.age='kids', staleAsOf:b=>b[1].asOf='2026-10-09',
 invalidTimestamp:b=>b[0].fetchedAt='2026-02-30T00:00:00Z', missingTimestamp:b=>delete b[0].fetchedAt,
 nullAmount:b=>b[0].rows[0].SALEAMT_VAT_EX=null, numericAmount:b=>b[0].rows[0].SALEAMT_VAT_EX=123.45, missingQuantity:b=>delete b[0].rows[0].SALEQTY,
 invalidSaleDate:b=>b[0].rows[0].SALEDT='20260230', outsidePeriod:b=>b[0].rows[0].SALEDT='20261003', wrongBrand:b=>b[0].rows[0].BRANDCD='CK',
 wrongSeason:b=>b[0].rows[0].SEASONNM='봄', wrongSeasonYear:b=>b[0].rows[0].YEARCD='2025', missingOption:b=>delete b[0].rows[0].COLORCD,
 missingWarehouse:b=>delete b[2].rows[0].WHCD, nullStock:b=>b[1].rows[0].INVQTY=null, duplicateLedger:b=>b[0].rows.push({...b[0].rows[0]}),
 duplicateMapping:b=>b[3].rows.push({...b[3].rows[0]}), unverifiedMapping:b=>delete b[3].rows[0].verificationReceipt,
 unmappedProduct:b=>b[4].rows[0].product_id='p2', mixedMarket:b=>b[4].rows[0].category_code='002', missingRank:b=>b[4].rows.pop(), nullRank:b=>b[4].rows[0].rank_position=null,
 emptyInventory:b=>b[2].rows=[], emptyMarket:b=>b[4].rows=[], missingPerProductInventory:b=>b[2].rows[0].STYLECD='OTHER',
 privateRawField:b=>{b[0].rows[0].SALEAMT_VAT_EX=null;b[0].rows[0].private='PRIVATE_SENTINEL';}
};
for(const [name,mutate]of Object.entries(mutations))test(`fail closed: ${name}`,async()=>{
 const batch=fixture();mutate(batch);const value=await read(batch);assert.notEqual(value.kind,'ready');assert.deepEqual(value.observations,[]);assert.equal(value.executable,false);assert.doesNotMatch(JSON.stringify(value),/PRIVATE_SENTINEL/);
});
test('invalid all-brand or incomplete market request does not query',async()=>{
 let calls=0;const d=dependencies(fixture());d.provider.readPartition=async()=>{calls++;};
 for(const q of [null,{}, {...request,brand:'all'},{...request,inventoryAsOf:'2026-10-09'},{...request,market:{...request.market,age:''}}]){const v=await server.readSalesInventory(q,d.provider,d.access);assert.equal(v.kind,'withheld');}assert.equal(calls,0);
});

for (const [label,mutate,codes] of [
 ['NULL plus empty warehouse',b=>{b[0].rows[0].SALEAMT_VAT_EX=null;b[2].rows=[];},['EMPTY','INVALID_ROW']],
 ['NULL plus empty mapping',b=>{b[0].rows[0].SALEAMT_VAT_EX=null;b[3].rows=[];},['EMPTY','INVALID_ROW']],
 ['mapping mismatch plus empty warehouse',b=>{b[3].rows[0].category='002';b[2].rows=[];},['EMPTY','MAPPING']],
 ['NULL plus empty warehouse plus partial response',b=>{b[0].rows[0].SALEAMT_VAT_EX=null;b[2].rows=[];b[1].pagesReceived=0;},['EMPTY','INCOMPLETE','INVALID_ROW']],
 ['zero plus empty warehouse',b=>{b[0].rows[0].SALEAMT_VAT_EX='0';b[2].rows=[];},['EMPTY']],
 ['zero plus empty warehouse plus partial response',b=>{b[0].rows[0].SALEAMT_VAT_EX='0';b[2].rows=[];b[1].complete=false;},['EMPTY','INCOMPLETE']],
 ['NULL plus missing partition',b=>{b[0].rows[0].SALEAMT_VAT_EX=null;b.pop();},['INCOMPLETE','INVALID_ROW']],
 ['NULL plus raw private field plus empty warehouse',b=>{b[0].rows[0].SALEAMT_VAT_EX=null;b[0].rows[0].private='PRIVATE_SENTINEL';b[2].rows=[];},['EMPTY','INVALID_ROW']],
 ['zero plus empty warehouse plus scope mismatch',b=>{b[0].rows[0].SALEAMT_VAT_EX='0';b[2].rows=[];b[4].request.market.age='kids';},['CONTRACT','EMPTY']],
 ['all partitions empty',b=>{for(const p of b)p.rows=[];},['EMPTY']],
]) test(`combined safe reasons: ${label}`,async()=>{
 const b=fixture();mutate(b);const v=await read(b);assert.deepEqual(v.reasons,codes);assert.equal(v.kind,codes.length===1&&codes[0]==='EMPTY'?'empty':'withheld');assert.deepEqual(v.observations,[]);assert.equal(v.executable,false);
 const html=renderToStaticMarkup(React.createElement(Panel,{state:v}));assert.doesNotMatch(JSON.stringify(v)+html,/PRIVATE_SENTINEL|synthetic-only/);for(const code of codes)assert.match(html,new RegExp(load('src/lib/erp/sales-inventory-types.ts').READ_REASONS[code]));
});
test('confirmed zero only is ready and never inherits EMPTY or INVALID_ROW',async()=>{
 const b=fixture();for(const row of b[0].rows){row.SALEAMT_VAT_EX='0';row.SALEQTY='0';}for(const row of b[1].rows){row.INVQTY='0';row.AVAILQTY='0';}for(const row of b[2].rows){row.AVAILQTY='0';row.ONLINEQTY='0';row.OFFLINEQTY='0';}
 const v=await read(b);assert.equal(v.kind,'ready');assert.deepEqual(v.reasons,[]);assert.equal(v.observations[0].sales[0].vatExcludedKRW,'0');assert.equal(v.observations[0].warehouses[0].available,'0');
});
