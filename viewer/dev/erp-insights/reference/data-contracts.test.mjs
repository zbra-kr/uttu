import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateContract,compareContracts,validateRows,sumSales,validateCrosswalk,joinProduct,compareMarketScope,requireProductGrain,SEASONS} from './data-contracts.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('./data-contract-fixture.json',import.meta.url),'utf8'));
const copy=v=>structuredClone(v);
const {contract:c,rows,mappings,erpScope,marketScope,categoryCrosswalk}=fixture;
const patch=p=>({...copy(c),...p});
test('matching fully explicit synthetic contracts compatible; unverified source-only contract unknown',()=>{
 assert.equal(compareContracts(c,copy(c)).status,'compatible');
 assert.equal(validateContract(patch({confirmation:null})).status,'unknown');
 assert.equal(validateContract(patch({confirmation:'verified-contract'})).status,'unknown');
});
test('central and detail VAT contracts never automatically reconciled',()=>{
 const detail=patch({source:'SW_SALEINFO',amountField:'SALEAMT',vatOperation:'source_expression_divide_1.1',excludedShops:null});
 const result=compareContracts(c,detail);assert.equal(result.status,'incompatible');assert.ok(result.unknown.some(x=>x.includes('rounding')));
 assert.equal(compareContracts(detail,copy(detail)).status,'unknown');assert.equal(sumSales(rows,detail).total,null);
});
test('double VAT division and wrong amount field contradict central evidence',()=>{
 for(const p of [{vatOperation:'source_expression_divide_1.1'},{amountField:'SALEAMT'}])assert.equal(validateContract(patch(p)).status,'incompatible');
 assert.equal(sumSales(rows,c).total,'1500'); // Already-net fixture; no /1.1 applied.
});
test('units sign rounding channel and definition mismatches block combination',()=>{
 for(const p of [{unit:'KRW_million'},{signPolicy:'absolute'},{roundingPolicy:'per_line_round'},{currency:'USD'},{channelScope:'musinsa-only'},{businessDefinitionVersion:'v2'}])assert.equal(compareContracts(c,patch(p)).status,'incompatible');
 for(const f of ['signPolicy','roundingPolicy','channelScope','businessDefinitionVersion'])assert.equal(validateContract(patch({[f]:null})).status,'unknown');
});
test('inclusive periods must match exactly; invalid/missing calendar date unknown',()=>{
 assert.equal(compareContracts(c,patch({period:{start:'2026-10-05',end:'2026-10-10'}})).status,'incompatible');
 for(const period of [null,{start:'2026-02-30',end:'2026-10-10'},{start:'2026-10-11',end:'2026-10-10'}])assert.equal(compareContracts(c,patch({period})).status,'unknown');
});
test('mixed row periods rejected rather than silently filtered; endpoints inclusive',()=>{
 for(const SALEDT of ['2026-10-03','2026-10-11'])assert.equal(sumSales([{...rows[0],SALEDT}],c).status,'incompatible');
 for(const SALEDT of ['2026-10-04','2026-10-10'])assert.equal(sumSales([{...rows[0],SALEDT}],c).total,'100');
 assert.equal(sumSales([{...rows[0],SALEDT:'2026-02-30'}],c).total,null);
});
test('season year and exact season list required; standard belongs to both SS and FW',()=>{
 assert.ok(SEASONS.SS.includes('스탠다드')&&SEASONS.FW.includes('스탠다드'));
 assert.equal(compareContracts(c,patch({season:{year:'2025',names:c.season.names}})).status,'incompatible');
 assert.equal(compareContracts(c,patch({season:{year:'2026',names:SEASONS.SS}})).status,'incompatible');
 for(const r of [{...rows[0],YEAR:'2025'},{...rows[0],SEASONNM:'봄'}])assert.equal(sumSales([r],c).status,'incompatible');
 assert.equal(sumSales([{...rows[0],SEASONNM:null}],c).status,'unknown');
});
test('central transfer exclusions are exact; target exclusions cannot replace sales exclusions',()=>{
 assert.equal(validateContract(patch({excludedShops:[]})).status,'incompatible');
 assert.equal(validateContract(patch({excludedShops:[...c.excludedShops,'COF001','COF002','WAF005']})).status,'incompatible');
 assert.equal(validateContract(patch({excludedShops:null})).status,'unknown');
 const transfers=c.excludedShops.map(SHOPCD=>({...rows[0],SHOPCD,amount:'999'}));
 const result=sumSales([...rows,...transfers],c);assert.equal(result.total,'1500');assert.equal(result.excluded.length,3);
});
test('brand/style/date/shop grain protects same style across five brands and multiple shops',()=>{
 assert.equal(validateRows(rows,c).status,'compatible');
 assert.equal(sumSales([...rows,{...rows[0],SHOPCD:'FIXTURE-another-shop'}],c).total,'1600');
 assert.equal(sumSales([...rows,copy(rows[0])],c).status,'incompatible');
 assert.equal(validateContract(patch({grain:['STYLECD','SALEDT','SHOPCD']})).status,'incompatible');
});
test('option and warehouse grains cannot be treated as identical contracts',()=>{
 for(const extra of ['COLORCD','SIZECD','WHCD'])assert.equal(compareContracts(c,patch({grain:[...c.grain,extra]})).status,'incompatible');
 const option=patch({grain:[...c.grain,'SIZECD']});
 assert.equal(sumSales([{...rows[0],SIZECD:'S'},{...rows[0],SIZECD:'M'}],option).total,'200');
 assert.equal(sumSales([{...rows[0],SIZECD:'S'},{...rows[0],SIZECD:'M'}],c).status,'incompatible');
 assert.equal(sumSales(rows,option).status,'unknown');
});
test('exact integer amounts retain real zero and signed fixture returns without floating loss',()=>{
 assert.equal(sumSales([{...rows[0],amount:'0'}],c).total,'0');
 assert.equal(sumSales([{...rows[0],amount:'-100'}],c).total,'-100');
 assert.equal(sumSales([{...rows[0],amount:'900719925474099300000'}],c).total,'900719925474099300000');
 for(const amount of [null,0,NaN,Infinity,'1.1','01','-0',' 1'])assert.equal(sumSales([{...rows[0],amount}],c).total,null);
 assert.equal(sumSales([],c).status,'unknown');
});
test('all five brand identities retained by exact composite crosswalk; names alone never used',()=>{
 assert.equal(validateCrosswalk(mappings).status,'compatible');
 for(const BRANDCD of ['CO','LE','WA','CK','LK']){const result=joinProduct({BRANDCD,STYLECD:'FIXTURE-SAME-STYLE'},mappings);assert.equal(result.product.brand,BRANDCD);assert.equal(result.product.productId,`FIXTURE-product-${BRANDCD}`);}
 assert.equal(joinProduct({STYLECD:'FIXTURE-SAME-STYLE',name:'same name'},mappings).product,null);
 assert.equal(joinProduct({BRANDCD:'CO',STYLECD:'fixture-same-style'},mappings).product,null);
});
test('kids parent collapse, repeated ERP key, UTTU id or Musinsa number blocked',()=>{
 for(const p of [{uttuBrand:'CO'},{productId:mappings[0].productId},{musinsaNo:mappings[0].musinsaNo},{BRANDCD:'CO'}]){const bad=copy(mappings);Object.assign(bad[3],p);assert.equal(validateCrosswalk(bad).status,'incompatible');assert.equal(joinProduct(rows[0],bad).product,null);}
});
test('crosswalk verification version and unknown keys fail closed',()=>{
 for(const p of [{verified:false},{mappingVersion:null},{verificationEvidence:null},{STYLECD:' FIXTURE-SAME-STYLE'}]){const bad=copy(mappings);Object.assign(bad[0],p);assert.equal(validateCrosswalk(bad).status,'unknown');}
 assert.equal(joinProduct({BRANDCD:'CO',STYLECD:'missing'},mappings).status,'unknown');
});
test('market same date category and full scope compatible only with explicit verified crosswalk',()=>{
 assert.equal(compareMarketScope(erpScope,marketScope,categoryCrosswalk).status,'compatible');
 for(const f of ['date','category','store','gender','age','item'])assert.equal(compareMarketScope(erpScope,{...marketScope,[f]:'different'},categoryCrosswalk).status,f==='date'?'unknown':'incompatible');
 assert.equal(compareMarketScope(erpScope,{...marketScope,date:'2026-10-09'},categoryCrosswalk).status,'incompatible');
});
test('market mixed periods unknown dates incomplete receipts and missing category mapping block',()=>{
 for(const p of [{period:null},{date:null},{complete:false},{category:null}])assert.equal(compareMarketScope(erpScope,{...marketScope,...p},categoryCrosswalk).status,'unknown');
 assert.equal(compareMarketScope(erpScope,{...marketScope,period:{start:'2026-10-05',end:'2026-10-10'}},categoryCrosswalk).status,'incompatible');
 for(const p of [{verified:false},{version:null},{evidence:null}])assert.equal(compareMarketScope(erpScope,marketScope,{...categoryCrosswalk,...p}).status,'unknown');
 assert.equal(compareMarketScope(erpScope,marketScope,{...categoryCrosswalk,item:'different'}).status,'incompatible');
});

test('object field order does not create period mismatch; numeric season year not inferred',()=>{
 assert.equal(compareContracts(c,patch({period:{end:c.period.end,start:c.period.start}})).status,'compatible');
 assert.equal(validateContract(patch({season:{year:2026,names:c.season.names}})).status,'unknown');
});
test('crosswalk versions and ranking snapshot period endpoints cannot be mixed',()=>{
 const bad=copy(mappings);bad[1].mappingVersion='FIXTURE-v2';assert.equal(validateCrosswalk(bad).status,'incompatible');
 const erp={...erpScope,date:'2026-10-09'},market={...marketScope,date:'2026-10-09'};
 assert.equal(compareMarketScope(erp,market,categoryCrosswalk).status,'incompatible');
});
test('UTTU coarse own-sales cache cannot synthesize style facts or reuse EIS grain',()=>{
 // Saved UTTU evidence establishes no style/product identity, not live column metadata.
 assert.equal(requireProductGrain(['BRANDCD','SALEDT','CHANNEL_FIXTURE']).status,'incompatible');
 assert.equal(requireProductGrain(null).status,'unknown');
 assert.equal(requireProductGrain(c.grain).status,'compatible');
 const coarse=patch({source:'UTTU_own_sales_daily',grain:['BRANDCD','SALEDT','CHANNEL_FIXTURE'],amountField:null});
 const checked=compareContracts(c,coarse);assert.equal(checked.status,'incompatible');assert.ok(checked.unknown.length>0);
 assert.equal(sumSales(rows,coarse).total,null);
});
test('failed row output is empty for period brand and missing amount counterexamples',()=>{
 for(const change of [{SALEDT:'2026-10-11'},{BRANDCD:'UNKNOWN'},{amount:null}]){
  const input=[{...rows[0],...change}];
  for(const result of [validateRows(input,c),sumSales(input,c)]){
   assert.notEqual(result.status,'compatible');assert.equal(result.executable,false);assert.equal(result.partialSuccess,false);
   assert.deepEqual(result.included,[]);assert.deepEqual(result.excluded,[]);
   assert.equal(result.diagnostics.withheldInputs.length,1);assert.deepEqual(result.diagnostics.withheldInputs[0].input,input[0]);
   const downstream=sumSales(result.included,c);assert.equal(downstream.executable,false);assert.equal(downstream.total,null);
  }
 }
});
test('mixed batch is atomic: valid rows and excluded transfers also withheld on any failure',()=>{
 const input=[copy(rows[0]),{...rows[1],amount:null},{...rows[2],SHOPCD:'B6055'}],before=copy(input);
 const result=sumSales(input,c);assert.equal(result.total,null);assert.equal(result.partialSuccess,false);
 assert.deepEqual(result.included,[]);assert.deepEqual(result.excluded,[]);assert.equal(result.diagnostics.withheldInputs.length,3);
 assert.deepEqual(input,before);assert.match(result.diagnostics.withheldInputs[0].reason,/diagnostics only/);
});
test('contract missing receipt duplicate grain and unsupported calculator clear all outputs',()=>{
 const cases=[{input:rows,contract:patch({complete:false})},{input:rows,contract:patch({period:null})},{input:[rows[0],rows[0]],contract:c},{input:rows,contract:patch({unit:'KRW_decimal'})}];
 for(const {input,contract} of cases){const result=sumSales(input,contract);assert.equal(result.executable,false);assert.equal(result.partialSuccess,false);assert.equal(result.total,null);assert.deepEqual(result.included,[]);assert.deepEqual(result.excluded,[]);assert.equal(result.diagnostics.withheldInputs.length,input.length);}
});
test('successful output explicitly executable with no partial success or diagnostic withheld input',()=>{
 const result=sumSales([...rows,{...rows[0],SHOPCD:'B6055'}],c);
 assert.equal(result.executable,true);assert.equal(result.partialSuccess,false);assert.equal(result.total,'1500');
 assert.equal(result.included.length,5);assert.equal(result.excluded.length,1);assert.deepEqual(result.diagnostics.withheldInputs,[]);
 assert.equal(sumSales(result.included,c).total,'1500');
});
