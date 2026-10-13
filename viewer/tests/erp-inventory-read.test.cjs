const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),React=require('react'),SSR=require('react-dom/server');
const load=require('./helpers/load-source.cjs'),M=load('src/lib/erp/inventory-read.ts'),SQL=load('src/lib/erp/inventory-sql.ts'),R=load('src/lib/erp/inventory-rest.ts'),S=load('src/lib/erp/inventory-server.ts');
const scope={brand:'CO',styles:['CO-SYN']},input={brand:'CO',styles:'CO-SYN'};
function row(source,patch={}){return {STYLECD:'CO-SYN',MAPPED_BRAND:'CO',MASTER_ROWS:'1',BRAND_COUNT:'1',MAPPING:'MATCHED',SOURCE_PRESENT:'1',STYLE_SOURCE_ROWS:'1',LOCATIONCD:source==='shop'?'SYN-SHOP':'SYN-WH',COLORCD:'BLACK',SIZECD:'M',DUPLICATE_GRAIN:'1',...Object.fromEntries(M.INVENTORY_COLUMNS[source].map(c=>[c,'0'])),...patch};}
const raw=(source,rows)=>({complete:true,rows,types:Object.fromEntries(M.INVENTORY_COLUMNS[source].map(c=>[c,source==='shop'?'real':'fixed']))});
const config=()=>({origin:'https://synthetic-account.snowflakecomputing.com',database:'BCAVE',schema:'SEWON',warehouse:'SYN_WH',role:'SYN_ROLE',getToken:async()=> 'SYN.jwt'});
const plan=(bytes=1000)=>({code:'090001',sqlState:'00000',statementHandle:'syn-plan',resultSetMetaData:{numRows:1,format:'jsonv2',partitionInfo:[{rowCount:1}]},data:[[JSON.stringify({GlobalStats:{bytesAssigned:bytes,partitionsAssigned:1}})]]});
function response(source,rows){const cols=[...M.INVENTORY_BASE_COLUMNS,...M.INVENTORY_COLUMNS[source]];return {code:'090001',sqlState:'00000',statementHandle:'syn-'+source,resultSetMetaData:{format:'jsonv2',numRows:rows.length,partitionInfo:[{rowCount:rows.length}],rowType:cols.map(name=>({name,type:M.INVENTORY_COLUMNS[source].includes(name)?source==='shop'?'real':'fixed':['MASTER_ROWS','BRAND_COUNT','SOURCE_PRESENT','STYLE_SOURCE_ROWS','DUPLICATE_GRAIN'].includes(name)?'fixed':'text'}))},data:rows.map(r=>cols.map(c=>r[c]))};}
function http(sequence){const calls=[];return {calls,fetch:async(url,init)=>{calls.push({url,body:init.body?JSON.parse(init.body):null,signal:init.signal});const next=sequence.shift();if(next instanceof Error)throw next;return new Response(JSON.stringify(next?.body??next),{status:next?.status??200});}};}
test('fixed SQL preserves unmapped requests, aggregates master before left join, masks other-brand data and separates quantity types',()=>{
 for(const sql of Object.values(SQL.INVENTORY_SQL)){assert.equal((sql.match(/\?/g)||[]).length,11);assert.match(sql,/SELECT DISTINCT COLUMN1/);assert.match(sql,/COUNT\(DISTINCT BRANDCD\)/);assert.match(sql,/GROUP BY STYLECD/);assert.match(sql,/LEFT JOIN M/);assert.match(sql,/LEFT JOIN BCAVE/);assert.match(sql,/ELSE NULL END AS/);assert.match(sql,/DUPLICATE_GRAIN/);assert.doesNotMatch(sql,/SUM\(|UNION|CURRENT_TIMESTAMP|inventoryAsOf/);}
 assert.match(SQL.INVENTORY_SQL.shop,/SW_SHOPINV/);assert.match(SQL.INVENTORY_SQL.warehouse,/SW_WHINV/);
});
test('request grammar limits10 unique explicit style ids without prefix-derived brand or date assumption',()=>{
 assert.deepEqual(M.parseInventoryScope({brand:'CO',styles:'LK-SYN'}).scope,{brand:'CO',styles:['LK-SYN']});
 for(const p of [{brand:'all',styles:'A'},{brand:'CO',styles:'A,A'},{brand:'CO',styles:['A']},{brand:'CO',styles:'x;DELETE'},{brand:'CO',styles:Array.from({length:11},(_,i)=>'S'+i).join(',')}])assert.equal(M.parseInventoryScope(p).reason,'INVALID_REQUEST');
});
test('raw zero/negative/NULL/large NUMBER string preserved; no quantities summed and no snapshot date manufactured',()=>{
 const shop=M.normalizeInventory('shop',scope,raw('shop',[row('shop',{INVQTY:'-1.5',AVAILQTY:null})]));assert.equal(shop.rows[0].quantities[0].text,'-1.5');assert.equal(shop.rows[0].quantities[0].reason,'NEGATIVE');assert.equal(shop.rows[0].quantities[1].reason,'NULL');
 const wh=M.normalizeInventory('warehouse',scope,raw('warehouse',[row('warehouse',{AVAILQTY:'9007199254740993'})]));assert.equal(wh.rows[0].quantities[0].sourceValue,'9007199254740993');assert.equal(wh.rows[0].quantities[0].text,'9007199254740993');assert.equal(wh.rows[0].quantities[0].exactValue,null);assert.equal(wh.rows[0].quantities[1].text,'0');
 for(const s of [shop,wh]){assert.equal(s.asOf,null);assert.equal(s.totals,null);}
 for(const text of ['NaN','1e309','1e-999'])assert.equal(M.normalizeInventory('shop',scope,raw('shop',[row('shop',{INVQTY:text})])).rows[0].quantities[0].reason,'INVALID');
});
test('prefix or a claimed MATCHED flag cannot bypass request-specific master cardinality/brand proof',()=>{
 for(const patch of [{MAPPED_BRAND:'LE'},{MASTER_ROWS:'2'},{BRAND_COUNT:'0'}]){const s=M.normalizeInventory('shop',scope,raw('shop',[row('shop',patch)]));assert.equal(s.reason,'SOURCE_INVALID');assert.deepEqual(s.rows,[]);}
});
for(const [mapping,master,brands]of [['MISSING','0','0'],['DUPLICATE','2','1'],['CONFLICT','2','2'],['UNKNOWN','1','0'],['OUT_OF_SCOPE','1','1']])test('unattributed '+mapping+' remains in audit without quantity/location disclosure',()=>{
 const r=row('shop',{MAPPING:mapping,MASTER_ROWS:master,BRAND_COUNT:brands,MAPPED_BRAND:null,LOCATIONCD:null,COLORCD:null,SIZECD:null,INVQTY:null,AVAILQTY:null});const s=M.normalizeInventory('shop',scope,raw('shop',[r]));assert.equal(s.kind,'withheld');assert.equal(s.audit[0].mapping,mapping);assert.equal(s.audit[0].sourceRows,1);assert.deepEqual(s.rows,[]);assert.equal(s.totals,null);
 assert.equal(M.normalizeInventory('shop',scope,raw('shop',[{...r,INVQTY:0}])).reason,'SOURCE_INVALID');
});
test('duplicate projected grain is preserved and flagged without inflating totals or deduping unknown extra grain',()=>{
 const r=row('shop',{STYLE_SOURCE_ROWS:'2',DUPLICATE_GRAIN:'2',INVQTY:'10'});const s=M.normalizeInventory('shop',scope,raw('shop',[r,{...r}]));assert.equal(s.rows.length,2);assert.equal(s.duplicateRows,2);assert.equal(s.totals,null);assert.equal(s.audit[0].sourceRows,2);
 assert.equal(M.normalizeInventory('shop',scope,raw('shop',[{...r,DUPLICATE_GRAIN:'1'},r])).reason,'SOURCE_INVALID');
});
test('absent records create no quantity-zero; missing required styles, types, fields, partial and limit fail closed',()=>{
 const r=row('warehouse',{SOURCE_PRESENT:'0',STYLE_SOURCE_ROWS:'0',DUPLICATE_GRAIN:'0',LOCATIONCD:null,COLORCD:null,SIZECD:null,AVAILQTY:null,ONLINEQTY:null,OFFLINEQTY:null});const s=M.normalizeInventory('warehouse',scope,raw('warehouse',[r]));assert.equal(s.kind,'empty');assert.deepEqual(s.rows,[]);assert.equal(s.totals,null);
 assert.equal(M.normalizeInventory('shop',scope,raw('shop',[])).reason,'SOURCE_INVALID');
 const missing=row('shop');delete missing.AVAILQTY;assert.equal(M.normalizeInventory('shop',scope,raw('shop',[missing])).reason,'SOURCE_INVALID');
 assert.equal(M.normalizeInventory('shop',scope,{...raw('shop',[row('shop')]),complete:false}).reason,'LIMIT_REACHED');
 assert.equal(M.normalizeInventory('shop',scope,raw('shop',Array(201).fill(row('shop')))).reason,'LIMIT_REACHED');
 assert.equal(M.normalizeInventory('shop',scope,{...raw('shop',[row('shop')]),types:{INVQTY:'fixed',AVAILQTY:'fixed'}}).reason,'SOURCE_INVALID');
});
test('REST actual preflight + separate fixed source selects use only11 binds; result metadata validated',async()=>{
 const m=http([plan(),response('shop',[row('shop')]),plan(),response('warehouse',[row('warehouse')])]);let tokens=0;const provider=R.createInventoryRestProvider({...config(),getToken:async()=>{tokens++;return 'SYN';}},m.fetch);
 const results=await provider.read(scope,new AbortController().signal);assert.equal(results.shop.kind,'observed');assert.equal(results.warehouse.kind,'observed');assert.equal(tokens,1);assert.equal(m.calls.length,4);
 for(const call of m.calls){assert.equal(call.body.timeout,10);assert.equal(Object.keys(call.body.bindings).length,11);assert.equal(call.body.bindings['1'].value,'CO');assert.equal(call.body.bindings['2'].value,'CO-SYN');assert.equal(call.body.bindings['11'].value,'CO-SYN');}
 assert.equal(m.calls[1].body.statement,SQL.INVENTORY_SQL.shop);assert.equal(m.calls[3].body.statement,SQL.INVENTORY_SQL.warehouse);
});
test('REST scan excess prevents corresponding select; failure of one source is not zero and other source can remain independent',async()=>{
 const m=http([plan(16777217),{},plan(),response('warehouse',[row('warehouse')])]);const s=await R.createInventoryRestProvider(config(),m.fetch).read(scope,new AbortController().signal);assert.equal(s.shop.reason,'READ_FAILED');assert.equal(s.warehouse.kind,'observed');assert.equal(m.calls.filter(c=>c.body?.statement===SQL.INVENTORY_SQL.shop).length,0);
});
test('partial partition failure and 408 keep safe failure/timeout, with no raw error text',async()=>{
 const first=response('shop',[row('shop')]);first.resultSetMetaData.numRows=2;first.resultSetMetaData.partitionInfo=[{rowCount:1},{rowCount:1}];
 const m=http([plan(),first,{status:500,body:{message:'SECRET'}},{},plan(),response('warehouse',[row('warehouse')])]);let s=await R.createInventoryRestProvider(config(),m.fetch).read(scope,new AbortController().signal);assert.equal(s.shop.reason,'READ_FAILED');assert.match(m.calls[3].url,/\/cancel$/);assert.doesNotMatch(JSON.stringify(s),/SECRET/);
 const t=http([{status:408,body:{message:'SECRET_TIMEOUT'}}]);s=await R.createInventoryRestProvider(config(),t.fetch).read(scope,new AbortController().signal);assert.equal(s.shop.reason,'READ_TIMEOUT');assert.equal(s.warehouse.reason,'READ_TIMEOUT');assert.equal(t.calls.length,1);
 assert.equal(s.shop.duplicateRows,null);assert.equal(s.warehouse.duplicateRows,null);
});
test('injected signer and HTTP obey abort; default configuration untouched',async()=>{
 const c=new AbortController();let signSignal,start;const ready=new Promise(r=>start=r);const p=R.createInventoryRestProvider({...config(),getToken:async s=>{signSignal=s;start();return new Promise(()=>{});}},async()=>{throw Error('Unexpected');}).read(scope,c.signal);await ready;c.abort();const r=await p;assert.equal(signSignal.aborted,true);assert.equal(r.shop.reason,'READ_TIMEOUT');assert.equal(load('src/lib/erp/central-sales-composition.ts').configuredCentralRequesterBinding(),null);
});
test('own10s source deadline remains timeout even when signer never resolves',async()=>{
 const old=global.setTimeout;global.setTimeout=(fn,ms)=>{assert.equal(ms,10000);queueMicrotask(fn);return old(()=>{},1);};let signal;
 try{const r=await R.createInventoryRestProvider({...config(),getToken:async s=>{signal=s;return new Promise(()=>{});}},async()=>{throw Error('Unexpected');}).read(scope,new AbortController().signal);assert.equal(r.shop.reason,'READ_TIMEOUT');assert.equal(r.warehouse.reason,'READ_TIMEOUT');assert.equal(signal.aborted,true);}finally{global.setTimeout=old;}
});
test('same existing viewer pin/60s/one-use rules; another admin, changed styles and changed session cannot read',async()=>{
 let calls=0;const d={currentActor:async()=>({userId:'SYN',role:'viewer'}),provider:{read:async()=>{calls++;return {shop:M.normalizeInventory('shop',scope,raw('shop',[row('shop')])),warehouse:M.normalizeInventory('warehouse',scope,raw('warehouse',[row('warehouse')]))};}},now:()=>1000};
 const ctx=await S.prepareInventoryReview(scope,'SYN',d);let state=await S.readRequesterInventory(scope,ctx,d);assert.equal(state.kind,'observed');assert.equal(calls,1);assert.equal((await S.readRequesterInventory(scope,ctx,d)).reason,'CONTEXT_EXPIRED');
 const wrong={...d,currentActor:async()=>({userId:'OTHER',role:'admin'})};assert.equal(await S.prepareInventoryReview(scope,'SYN',wrong),null);
 const changed=await S.prepareInventoryReview(scope,'SYN',d);assert.equal((await S.readRequesterInventory({brand:'CO',styles:['LK-SYN']},changed,d)).reason,'REQUESTER_MISMATCH');
 const swap=await S.prepareInventoryReview(scope,'SYN',d);assert.equal((await S.readRequesterInventory(scope,swap,wrong)).reason,'REQUESTER_MISMATCH');
 const expired=await S.prepareInventoryReview(scope,'SYN',d);assert.equal((await S.readRequesterInventory(scope,expired,{...d,now:()=>61000})).reason,'CONTEXT_EXPIRED');assert.equal(calls,1);
});
test('existing inventory panel receives raw scope DTO; latest page calls configured reader with only brand/styles',async()=>{
 const d={currentActor:async()=>({userId:'SYN',role:'viewer'}),provider:{read:async()=>({shop:M.normalizeInventory('shop',scope,raw('shop',[row('shop',{INVQTY:'-2',AVAILQTY:null})])),warehouse:M.normalizeInventory('warehouse',scope,raw('warehouse',[row('warehouse')]))})}};const ctx=await S.prepareInventoryReview(scope,'SYN',d);const inventory=await S.readRequesterInventory(scope,ctx,d);
 const Panel=load('src/components/erp-insights/SalesInventoryReadPanel.tsx').default;const html=SSR.renderToStaticMarkup(React.createElement(Panel,{state:{kind:'unconnected',observations:[],reasons:['UNCONNECTED'],executable:false},inventory}));assert.match(html,/data-inventory-state="observed"/);assert.match(html,/기준시각 미확인/);assert.match(html,/-2/);assert.match(html,/원천 NULL/);assert.match(html,/합계 보류/);assert.doesNotMatch(html,/SYN.jwt|SYN_ROLE/);
 const page=fs.readFileSync('src/app/(app)/erp-insights-review/page.tsx','utf8');assert.match(page,/await readConfiguredInventory\(\{brand:params.brand,styles:params.inventoryStyles\}\)/);assert.match(page,/inventory=\{inventory\}/);assert.doesNotMatch(page,/params\.(expectedRequesterId|userId|role|inventoryAsOf)/);
});
test('actual configured page path reuses own getUser/profile, trusted binding and fixed REST provider into existing panel',async()=>{
 const m=http([plan(),response('shop',[row('shop')]),plan(),response('warehouse',[row('warehouse')])]);let auth=0;
 const mocks={'./erp-insights.module.css':{__esModule:true,default:new Proxy({},{get:(_,key)=>'erp-'+key})},
  '@/lib/supabase/server':{supabaseServer:async()=>({auth:{getUser:async()=>{auth++;return {data:{user:{id:'SYN_USER'}},error:null};}},from:table=>{assert.equal(table,'profiles');return {select:fields=>{assert.equal(fields,'role');return {eq:(key,id)=>{assert.equal(key,'id');assert.equal(id,'SYN_USER');return {single:async()=>({data:{role:'viewer'},error:null})};}};}};}})},
  './central-sales-composition':{configuredCentralRequesterBinding:()=>({expectedRequesterId:'SYN_USER',rest:config()})},
  './inventory-rest':{...R,createInventoryRestProvider:b=>R.createInventoryRestProvider(b,m.fetch)},
 };
 const Page=load('src/app/(app)/erp-insights-review/page.tsx',mocks).default;
 const html=SSR.renderToStaticMarkup(await Page({searchParams:Promise.resolve({brand:'CO',inventoryStyles:'CO-SYN',userId:'OTHER',role:'admin',inventoryAsOf:'2026-10-10'})}));
 assert.equal(auth,3);assert.equal(m.calls.length,4);assert.match(html,/data-inventory-state="observed"/);assert.match(html,/SYN-SHOP/);assert.match(html,/SYN-WH/);assert.match(html,/기준시각 미확인/);assert.doesNotMatch(html,/SYN_USER|SYN.jwt|OTHER/);
});
test('actual configured page reports missing provider without querying and ignores requested identity',async()=>{
 let auth=0;const mocks={'./erp-insights.module.css':{__esModule:true,default:new Proxy({},{get:(_,key)=>'erp-'+key})},'@/lib/supabase/server':{supabaseServer:async()=>({auth:{getUser:async()=>{auth++;return {data:{user:{id:'SYN_USER'}},error:null};}},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{role:'viewer'},error:null})})})})})}};
 const Page=load('src/app/(app)/erp-insights-review/page.tsx',mocks).default;const html=SSR.renderToStaticMarkup(await Page({searchParams:Promise.resolve({brand:'CO',inventoryStyles:'CO-SYN',expectedRequesterId:'SYN_USER'})}));assert.equal(auth,1);assert.match(html,/data-inventory-state="unconnected"/);assert.doesNotMatch(html,/data-inventory-source=/);
});
