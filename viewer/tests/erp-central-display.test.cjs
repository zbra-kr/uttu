const test=require('node:test'),assert=require('node:assert/strict');
const load=require('./helpers/load-source.cjs'),React=require('react'),SSR=require('react-dom/server');
const D=load('src/lib/erp/central-sales-display.ts'),S=load('src/lib/erp/central-sales-server.ts'),Panel=load('src/components/erp-insights/CentralSalesReadPanel.tsx').default;
const scope={brand:'CO',from:'2026-10-01',to:'2026-10-10'};
const rows=values=>values.map((value,i)=>({BRANDCD:'CO',STYLECD:'SYN-'+i,SALEDT:'20261001',SALES_VAT_EX:value}));
function deps(values){return {currentActor:async()=>({userId:'PRIVATE_ACTOR',role:'viewer'}),grantFor:async()=>({kind:'allowed',principalId:'PRIVATE_ACTOR',brand:'CO',roles:['viewer'],evidenceRef:'PRIVATE_GRANT'}),executor:{execute:async()=>({complete:true,rows:rows(values)})}};}
test('EIS one-decimal millions preserves zero/negative and does not divide VAT twice',()=>{
 for(const [value,text] of [[0,'0.0'],[1250000,'1.3'],[-1250000,'-1.3'],[1100000,'1.1'],[-1,'-0.0']])assert.equal(D.formatEisMillions(value),text);
});
test('number and numeric string representations stay distinct and exact money stays null',()=>{
 for(const raw of [0,'0',123.45,'123.45',-1250000,'-1250000']){const v=D.centralAmountDisplay(raw);assert.equal(v.sourceValue,raw);assert.equal(v.sourceType,'FLOAT');assert.equal(v.transportType,typeof raw==='string'?'numeric-string':'number');assert.equal(v.approximateValue,Number(raw));assert.equal(v.reason,'FLOAT_DISPLAY_ONLY');assert.equal(v.exactValue,null);}
});
test('NULL, missing and invalid values never become zero',()=>{
 assert.equal(D.centralAmountDisplay(null).reason,'NULL_AGGREGATE');
 for(const raw of [undefined,'',' ','NaN','Infinity',true,{},'PRIVATE_SENTINEL']){const v=D.centralAmountDisplay(raw);assert.equal(v.reason,'INVALID_AMOUNT');assert.equal(v.approximateValue,null);assert.equal(v.millionsText,null);assert.doesNotMatch(JSON.stringify(v),/PRIVATE_SENTINEL/);}
});
test('conversion overflow and underflow hold values; large finite FLOAT remains explicitly approximate',()=>{
 for(const raw of [Infinity,NaN,'1e309'])assert.equal(D.centralAmountDisplay(raw).reason,'NUMBER_OVERFLOW');
 assert.equal(D.centralAmountDisplay('1e-999').reason,'NUMBER_UNDERFLOW');
 const huge=D.centralAmountDisplay('9007199254740993');assert.equal(huge.sourceValue,'9007199254740993');assert.equal(huge.approximateValue,9007199254740992);assert.equal(huge.exactValue,null);assert.equal(huge.reason,'FLOAT_DISPLAY_ONLY');
 assert.equal(D.centralAmountDisplay(1e308).reason,'FLOAT_DISPLAY_ONLY');
});
test('total sums unrounded values before formatting; does not sum rounded cells',async()=>{
 const v=await S.readCentralSales(scope,deps([60000,60000]));assert.deepEqual(v.rows.map(r=>r.amount.millionsText),['0.1','0.1']);assert.equal(v.total.approximateValue,120000);assert.equal(v.total.millionsText,'0.1');assert.equal(v.total.exactValue,null);
});
test('mixed positive/negative retain raw sign; aggregate zero is observed, empty is unknown',async()=>{
 const v=await S.readCentralSales(scope,deps([1250000,-1250000,0]));assert.equal(v.rows[1].amount.approximateValue,-1250000);assert.equal(v.total.approximateValue,0);assert.equal(v.total.millionsText,'0.0');
 const empty=await S.readCentralSales(scope,deps([]));assert.equal(empty.kind,'empty');assert.equal(empty.total,null);assert.equal(empty.value,null);
});
test('NULL group holds total without dropping complete row or masking missing as zero',async()=>{
 const v=await S.readCentralSales(scope,deps([1000000,null]));assert.equal(v.kind,'observed');assert.equal(v.rows.length,2);assert.equal(v.rows[1].amount.reason,'NULL_AGGREGATE');assert.equal(v.rows[1].amount.approximateValue,null);assert.equal(v.total.reason,'TOTAL_INCOMPLETE');assert.equal(v.total.approximateValue,null);assert.equal(v.total.millionsText,null);
});
test('finite row values whose sum overflows hold total',async()=>{
 const v=await S.readCentralSales(scope,deps([1e308,1e308]));assert.equal(v.rows[0].amount.reason,'FLOAT_DISPLAY_ONLY');assert.equal(v.total.reason,'NUMBER_OVERFLOW');assert.equal(v.total.approximateValue,null);
});
test('compensated addition keeps represented small term but does not recover source FLOAT precision',async()=>{
 const v=await S.readCentralSales(scope,deps([1e16,1,-1e16]));assert.equal(v.total.approximateValue,1);assert.equal(v.total.exactValue,null);assert.equal(v.value,null);assert.equal(v.total.reason,'FLOAT_DISPLAY_ONLY');
 const html=SSR.renderToStaticMarkup(React.createElement(Panel,{state:v}));assert.match(html,/정밀도 한계/);assert.match(html,/정확한 회계 금액 아님/);
});
test('P2 million-unit cancellation keeps represented total across input permutations and distinguishes genuine zero',async()=>{
 const permutations=[[1e22,1000000,-1e22],[1e22,-1e22,1000000],[1000000,1e22,-1e22],[-1e22,1000000,1e22],[-1e22,1e22,1000000],[1000000,-1e22,1e22]];
 for(const values of permutations){
  const representedExact=values.reduce((sum,value)=>sum+BigInt(value),0n);assert.equal(representedExact,1000000n);
  const state=await S.readCentralSales(scope,deps(values));assert.equal(state.total.approximateValue,1000000);assert.equal(state.total.millionsText,'1.0');assert.equal(state.total.exactValue,null);assert.equal(state.value,null);assert.deepEqual(state.rows.map(r=>r.amount.sourceValue),values);
 }
 const zero=await S.readCentralSales(scope,deps([1e22,-1e22]));assert.equal(zero.total.approximateValue,0);assert.equal(zero.total.millionsText,'0.0');
});
test('panel labels unit/precision, escapes product text and shows specific hold reasons',async()=>{
 const d=deps([0,-1250000,null]);const original=d.executor.execute;d.executor.execute=async()=>{const v=await original();v.rows[0].STYLECD='<script>SYN</script>';v.rows[0].raw='PRIVATE_SOURCE';return v;};
 const v=await S.readCentralSales(scope,d);const html=SSR.renderToStaticMarkup(React.createElement(Panel,{state:v}));assert.match(html,/부가세 제외/);assert.match(html,/백만원/);assert.match(html,/≈ 0.0/);assert.match(html,/≈ -1.3/);assert.match(html,/원천 집계 NULL/);assert.match(html,/금액 보류 행이 있어 합계 보류/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|PRIVATE_ACTOR|PRIVATE_GRANT|PRIVATE_SOURCE/);
});
test('partial, oversized, duplicate, wrong scope and unauthenticated results never show rows or total',async()=>{
 for(const result of [{complete:false,rows:rows([1])},{complete:true,rows:Array(201).fill(rows([1])[0])},{complete:true,rows:[rows([1])[0],rows([1])[0]]},{complete:true,rows:[{...rows([1])[0],BRANDCD:'LE'}]}]){const d=deps([]);d.executor.execute=async()=>result;const v=await S.readCentralSales(scope,d);assert.deepEqual(v.rows,[]);assert.equal(v.total,null);}
 const d=deps([1]);d.currentActor=async()=>null;const v=await S.readCentralSales(scope,d);assert.deepEqual(v.rows,[]);assert.equal(v.total,null);
});
