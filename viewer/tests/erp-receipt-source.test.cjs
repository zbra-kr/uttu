const test=require('node:test'),assert=require('node:assert/strict'),load=require('./helpers/load-source.cjs'),SSR=require('react-dom/server');
const N=load('src/lib/erp/receipt-source-read.ts'),R=load('src/lib/erp/receipt-source-rest.ts'),S=load('src/lib/erp/receipt-source-server.ts');
const q={brand:'CO',styles:['CO-SYN'],from:'2026-10-12',to:'2026-10-13'},ids=['12345678-1234-1234-1234-123456789abc','87654321-1234-1234-1234-123456789abc'];
const row=()=>({STYLECD:'CO-SYN',MASTER_ROWS:1,BRAND_COUNT:1,MAPPING:'MATCHED',SOURCE_PRESENT:1,CHASU:'01',COLORCD:'BK',SIZECD:'M',WHCD:'W1',INQTY:'-1.5',WHINDT:'20261013'});
const raw=rows=>({complete:true,rows,types:{INQTY:'real'}});
const config=()=>({origin:'https://synthetic-host.snowflakecomputing.com',database:'BCAVE',schema:'SEWON',warehouse:'SYN_WH',role:'SYN_ROLE',getToken:async()=> 'SYN_TOKEN'});
const response=(body,status=200)=>new Response(JSON.stringify(body),{status});
const plan=()=>({code:'090001',sqlState:'00000',statementHandle:'syn-plan',resultSetMetaData:{numRows:1,format:'jsonv2',partitionInfo:[{rowCount:1}]},data:[[JSON.stringify({GlobalStats:{bytesAssigned:1,partitionsAssigned:1}})]]});
const data=()=>({code:'090001',sqlState:'00000',statementHandle:'syn-data',resultSetMetaData:{numRows:1,format:'jsonv2',partitionInfo:[{rowCount:1}],rowType:N.RECEIPT_COLUMNS.map(name=>({name,type:name==='INQTY'?'real':'text'}))},data:[N.RECEIPT_COLUMNS.map(c=>row()[c])]});
function http(sequence){const calls=[];return {calls,fetch:async(url,init)=>{calls.push({url,init});return sequence.shift();}};}
test('raw contract preserves receipt warehouse/lot/options/date and negative/FLOAT/NULL without allocation or totals',()=>{
 const state=N.normalizeReceiptSource(q,raw([row(),{...row(),INQTY:null,WHCD:null}]));assert.equal(state.kind,'observed');assert.equal(state.rows[0].warehouse,'W1');assert.equal(state.rows[0].lot,'01');assert.equal(state.rows[0].date,'2026-10-13');assert.equal(state.rows[0].quantityText,'-1.5');assert.equal(state.rows[1].quantityText,null);assert.equal(state.rows[0].exactValue,null);for(const key of ['allocation','rate','inventoryAsOf'])assert.equal(state[key],null);
 const Panel=load('src/components/erp-insights/ReceiptSourceReadPanel.tsx').default;const html=SSR.renderToStaticMarkup(Panel({state}));assert.match(html,/WHINDT/);assert.match(html,/원천 NULL/);assert.doesNotMatch(html,/SYN_TOKEN|<tfoot/);
});
test('empty/mapping/missing scope/date/partial/type failures never become observed zero receipt',()=>{
 assert.equal(N.normalizeReceiptSource(q,raw([{...row(),SOURCE_PRESENT:0,CHASU:null,COLORCD:null,SIZECD:null,WHCD:null,INQTY:null,WHINDT:null}])).kind,'empty');
 for(const payload of [{}, {...raw([row()]),complete:false},{...raw([row()]),types:{INQTY:'fixed'}},raw([{...row(),MAPPING:'AMBIGUOUS'}]),raw([{...row(),WHINDT:'20261014'}]),raw([{...row(),WHINDT:'20260230'}]),raw([])]){const state=N.normalizeReceiptSource(q,payload);assert.notEqual(state.kind,'observed');assert.equal(state.rows.length,0);assert.equal(state.rate,null);}
});
test('actual REST provider executes bounded EXPLAIN/fixed13-bind receipt SELECT and validates receipt DTO',async()=>{
 const m=http([response(plan()),response(data())]);const state=await R.createReceiptSourceProvider(config(),m.fetch).read(q,new AbortController().signal);assert.equal(state.kind,'observed');assert.equal(m.calls.length,2);const body=JSON.parse(m.calls[1].init.body);assert.match(body.statement,/SW_WHININFO/);assert.match(body.statement,/s.WHCD/);assert.equal(body.timeout,10);assert.equal(Object.keys(body.bindings).length,13);assert.equal(body.bindings['12'].value,'20261012');assert.equal(body.bindings['13'].value,'20261013');
});
test('both trusted requesters read receipts, unlisted/changed identity or role cannot read or receive late rows',async()=>{
 for(const id of ids){const m=http([response(plan()),response(data())]);const state=await S.readReceiptSourceWithBinding({...q,styles:q.styles.join(',')},{expectedRequesterId:ids[0],expectedRequesterIds:ids,rest:config()},async()=>({userId:id,role:'admin'}),m.fetch);assert.equal(state.kind,'observed');}
 for(const sequence of [[{userId:'OTHER',role:'admin'}],[{userId:ids[1],role:'admin'},{userId:ids[0],role:'admin'}],[{userId:ids[1],role:'admin'},{userId:ids[1],role:'admin'},{userId:ids[1],role:'viewer'}]]){let auth=0;const m=http([response(plan()),response(data())]);const state=await S.readReceiptSourceWithBinding({...q,styles:'CO-SYN'},{expectedRequesterId:ids[0],expectedRequesterIds:ids,rest:config()},async()=>sequence[Math.min(auth++,sequence.length-1)],m.fetch);assert.equal(state.kind,'withheld');assert.equal(state.rows.length,0);}
});
test('failed source and cancellation do not return partial rows or leak raw messages',async()=>{
 const m=http([response(plan()),response({message:'SYN_PRIVATE_ERROR'},500),response({})]);const state=await R.createReceiptSourceProvider(config(),m.fetch).read(q,new AbortController().signal);assert.equal(state.kind,'error');assert.equal(state.rows.length,0);assert.doesNotMatch(JSON.stringify(state),/SYN_PRIVATE_ERROR|SYN_TOKEN/);
 let started,resolve;const ready=new Promise(r=>started=r),controller=new AbortController();const pending=R.createReceiptSourceProvider(config(),async()=>{started();return new Promise(r=>resolve=r);}).read(q,controller.signal);await ready;controller.abort();const cancelled=await pending;assert.equal(cancelled.kind,'error');assert.equal(cancelled.rows.length,0);resolve(response(plan()));
});

test('absent-source placeholders require six exactly NULL fields; contradictions with any field or missing field withhold whole response',()=>{
 const placeholder={...row(),SOURCE_PRESENT:0,CHASU:null,COLORCD:null,SIZECD:null,WHCD:null,INQTY:null,WHINDT:null};
 for(const flag of [0,'0']){const empty=N.normalizeReceiptSource(q,raw([{...placeholder,SOURCE_PRESENT:flag}]));assert.equal(empty.kind,'empty');assert.equal(empty.complete,true);assert.equal(empty.rows.length,0);}
 for(const field of ['CHASU','COLORCD','SIZECD','WHCD','INQTY','WHINDT'])for(const value of [row()[field],undefined,0,'']){const state=N.normalizeReceiptSource(q,raw([row(),{...placeholder,[field]:value}]));assert.equal(state.kind,'withheld');assert.equal(state.reason,'SOURCE_INVALID');assert.equal(state.complete,false);assert.equal(state.rows.length,0);}
});
test('present-source four-row mapping remains unchanged after absent-source validation fix',()=>{
 const rows=Array.from({length:4},(_,i)=>({...row(),SIZECD:['S','M','L','XL'][i]}));const state=N.normalizeReceiptSource(q,raw(rows));assert.equal(state.kind,'observed');assert.equal(state.rows.length,4);assert.equal(state.complete,true);
 for(let i=0;i<4;i++){assert.equal(state.rows[i].style,rows[i].STYLECD);assert.equal(state.rows[i].lot,rows[i].CHASU);assert.equal(state.rows[i].color,rows[i].COLORCD);assert.equal(state.rows[i].size,rows[i].SIZECD);assert.equal(state.rows[i].warehouse,rows[i].WHCD);assert.equal(state.rows[i].date,'2026-10-13');assert.equal(state.rows[i].quantityText,rows[i].INQTY);}
});
