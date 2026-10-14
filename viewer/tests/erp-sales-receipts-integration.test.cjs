const test=require('node:test'),assert=require('node:assert/strict'),SSR=require('react-dom/server'),load=require('./helpers/load-source.cjs');
const R=load('src/lib/erp/requester-sales-rest.ts'),N=load('src/lib/erp/receipt-source-read.ts'),P=load('src/lib/erp/receipt-source-plan.ts');
const q={brand:'CO',from:'2026-10-13',to:'2026-10-13',aggregate:'daily',receiptStyles:'CO-SYN'};
const scope={brand:'CO',styles:['CO-SYN'],from:q.from,to:q.to};
const rawRow=()=>({STYLECD:'CO-SYN',MASTER_ROWS:1,BRAND_COUNT:1,MAPPING:'MATCHED',SOURCE_PRESENT:1,CHASU:'01',COLORCD:'BK',SIZECD:'M',WHCD:'W1',INQTY:'-1',WHINDT:'20261013'});
async function sales(partial){
 const plan={code:'090001',sqlState:'00000',statementHandle:'syn-plan',resultSetMetaData:{numRows:1,format:'jsonv2',partitionInfo:[{rowCount:1}]},data:[[JSON.stringify({GlobalStats:{bytesAssigned:1,partitionsAssigned:1}})]]};
 const data={code:'090001',sqlState:'00000',statementHandle:'syn-data',resultSetMetaData:{numRows:1,format:'jsonv2',partitionInfo:[{rowCount:1}],rowType:['BRANDCD','SALEDT','SALES_VAT_EX','SOURCE_ROWS','AMOUNT_ROWS'].map((name,i)=>({name,type:i<2?'text':i===2?'real':'fixed'}))},data:[['CO','20261013','9007199254740993.125','3',partial?'2':'3']]};const responses=[plan,data];
 return R.readAuthenticatedRequesterRestSales(q,{expectedRequesterId:'SYN',rest:{origin:'https://synthetic-host.snowflakecomputing.com',database:'BCAVE',schema:'SEWON',warehouse:'SYN_WH',role:'SYN_ROLE',getToken:async()=> 'SYN_TOKEN'}},async()=>({userId:'SYN',role:'viewer'}),async()=>new Response(JSON.stringify(responses.shift()),{status:200}));
}
async function page(central,receipts,params=q){
 const calls=[];
 const Page=load('src/app/(app)/erp-insights-review/page.tsx',{
  '@/components/erp-insights/ErpInsightsWorkspace':{__esModule:true,default:()=>null},
  '@/lib/erp/central-sales-runtime':{readConfiguredCurrentCentralSales:async p=>{calls.push({sales:p});return central;}},
  '@/lib/erp/receipt-source-server':{readConfiguredReceiptSource:async p=>{calls.push({receipts:p});return receipts;}},
 }).default;
 return {html:SSR.renderToStaticMarkup(await Page({searchParams:Promise.resolve(params)})),calls};
}
test('combined page preserves original sales digits/NULL total withholding together with raw receipt rows',async()=>{
 const central=await sales(true);assert.equal(central.dailySummary.total.millionsText,null);assert.equal(central.dailySummary.rows[0].audit.nullAmountRows,'1');
 const receipts=N.normalizeReceiptSource(scope,{complete:true,types:{INQTY:'real'},rows:[rawRow()]});const rendered=await page(central,receipts);
 assert.match(rendered.html,/9007199254740993\.125/);assert.match(rendered.html,/금액 NULL인 원천 행 포함/);assert.match(rendered.html,/입고 원천 행/);assert.match(rendered.html,/W1/);assert.match(rendered.html,/-1/);assert.doesNotMatch(rendered.html,/SYN_TOKEN/);
 assert.deepEqual(rendered.calls,[{sales:{brand:q.brand,from:q.from,to:q.to,aggregate:'daily'}},{receipts:{brand:q.brand,styles:'CO-SYN',from:q.from,to:q.to}}]);
 assert.match(rendered.html,/type="hidden" name="receiptStyles" value="CO-SYN"/);assert.match(rendered.html,/type="hidden" name="aggregate" value="daily"/);
});
test('contradictory absent receipt remains withheld while audited sales is still available; legacy styles alias carries no identity grant',async()=>{
 const receipts=N.normalizeReceiptSource(scope,{complete:true,types:{INQTY:'real'},rows:[{...rawRow(),SOURCE_PRESENT:0}]});assert.equal(receipts.kind,'withheld');const central=await sales(false),rendered=await page(central,receipts,{...q,receiptStyles:undefined,inventoryStyles:'CO-SYN',userId:'PRIVATE_ID',role:'admin',token:'PRIVATE_TOKEN'});
 assert.match(rendered.html,/data-receipt-source-state="withheld"/);assert.match(rendered.html,/9007199254740993\.125/);assert.doesNotMatch(rendered.html,/PRIVATE_ID|PRIVATE_TOKEN|<td>W1/);assert.equal(rendered.calls[1].receipts.styles,'CO-SYN');
});
test('receipt-only scope dependency preserves reviewed SQL and rejects unsafe scope without inventory/ranking code',()=>{
 const plan=P.planReceiptSource({brand:'CO',styles:'CO-SYN',from:q.from,to:q.to});assert.equal(plan.receipts.binds.length,13);assert.match(plan.receipts.sql,/s.WHCD,s.INQTY,s.WHINDT/);assert.match(plan.receipts.sql,/m.MASTER_ROWS=1 AND m.BRAND_COUNT=1/);
 for(const styles of ['',undefined,['CO-SYN'],'CO-SYN,CO-SYN',"CO-SYN';DROP TABLE x"]){assert.equal(P.planReceiptSource({brand:'CO',styles,from:q.from,to:q.to}),null);}
});
test('receipt input carries validated daily mode/date/style state and detail mode adds no daily hidden field',async()=>{
 const central=await sales(false),receipts=N.normalizeReceiptSource(scope,{complete:true,types:{INQTY:'real'},rows:[rawRow()]});const daily=await page(central,receipts),forms=[...daily.html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map(m=>m[1]);assert.equal(forms.length,2);
 assert.match(forms[0],/type="hidden" name="receiptStyles" value="CO-SYN"/);assert.match(forms[1],/type="hidden" name="aggregate" value="daily"/);assert.match(forms[1],/name="from" value="2026-10-13"/);assert.match(forms[1],/name="to" value="2026-10-13"/);assert.match(forms[1],/name="receiptStyles" value="CO-SYN"/);
 const C=load('src/lib/erp/central-sales-read.ts');const detailState=C.centralState('unconnected',{brand:'CO',from:q.from,to:q.to},'TRANSPORT_UNREGISTERED');const detail=await page(detailState,receipts,{...q,aggregate:undefined});const receiptForm=[...detail.html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)][1][1];assert.doesNotMatch(receiptForm,/name="aggregate"/);assert.match(receiptForm,/name="from" value="2026-10-13"/);
});
