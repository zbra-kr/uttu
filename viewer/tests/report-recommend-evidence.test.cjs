const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), Renderer = require('react-test-renderer'), load = require('./helpers/load-source.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const row = (date, rank = 1, name = 'Brand') => ({ snapshot_date: date, rank_position: rank, brand_name: name, brands: { is_own: true } });
function fixture() {
    const calls = [], pending = [], listeners = new Set();
    let authLate = null, coreLate = null, coreError = false, ownNames = ['Brand'], authCalls = 0;
    const client = { auth: { getUser: () => { authCalls++; return authLate?.promise ?? Promise.resolve({ data: { user: { id: 'A' } } }); }, onAuthStateChange: fn => { listeners.add(fn); return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } }; } }, from(table) {
            const call = { table, filters: [], ops: [], limit: null };
            calls.push(call);
            const q = { select(fields, opts) { call.fields = fields; call.opts = opts; call.ops.push(['select', fields, opts]); return q; }, eq(...args) { call.filters.push(args); call.ops.push(['eq', ...args]); return q; }, gte(...args) { call.ops.push(['gte', ...args]); return q; }, lte(...args) { call.ops.push(['lte', ...args]); return q; }, in(...args) { call.ops.push(['in', ...args]); return q; }, order(...args) { call.ops.push(['order', ...args]); return q; }, limit(n) { call.limit = n; call.ops.push(['limit', n]); return q; }, abortSignal(signal) { call.signal = signal; call.ops.push(['abortSignal', signal]); return q; }, then(yes, no) {
                    if (['brand_ranking_snapshots','recommend_modules','recommend_items'].includes(table)) {
                        const d = deferred();
                        pending.push({ ...d, call });
                        return d.promise.then(yes, no);
                    }
                    let data = [];
                    if (table === 'brands')
                        data = ownNames.map((name,i) => ({ id: 'brand'+i, name }));
                    if (table === 'ranking_snapshots' && call.fields === 'snapshot_date') {
                        if (coreLate) return coreLate.promise.then(yes, no);
                        if (coreError)
                            return Promise.resolve({ data: null, error: { message: 'offline' } }).then(yes, no);
                        data = [{ snapshot_date: '2026-10-05' }];
                    }
                    ;
                    return Promise.resolve({ data, error: null, count: 0 }).then(yes, no);
                } };
            return q;
        } };
    const mocks = { '@/lib/supabase/client': { supabaseBrowser: () => client }, './supabase/client': { supabaseBrowser: () => client }, 'next/link': { __esModule: true, default: ({ children, ...p }) => React.createElement('a', p, children) }, '@/hooks/useResolvedViewport': { useResolvedViewport: () => 'desktop' } };
    return { client, calls, pending, mocks, get authCalls() { return authCalls; }, setOwnNames(names) { ownNames = names; }, auth(id) { listeners.forEach(fn => fn('SIGNED_IN', id ? { user: { id } } : null)); }, late() { authLate = deferred(); return authLate; }, holdCore() { coreLate = deferred(); return coreLate; }, failCore() { coreError = true; } };
}
const moduleRow = (date='2026-10-03',id='module',count=1,position=0) => ({id,snapshot_date:date,gender_filter:'A',title:'Recommendation '+id,module_type:'CAROUSEL_TWOROW_DYNAMIC_TAB',position,items_count:count});
const itemRow = (date='2026-10-03',module='module',brand='Brand',id='item',position=0) => ({id,module_id:module,musinsa_no:'123',snapshot_date:date,gender_filter:'A',brand_name:brand,position});
const ready=data=>({state:'ready',data}),error={state:'error',data:null};
const pendingFor=(f,table)=>f.pending.filter(p=>p.call.table===table);
const lib=f=>load('src/lib/report-recommend-evidence.ts',f.mocks);
async function read(f,table,rows){const m=lib(f),signal=new AbortController().signal,p=(table==='recommend_modules'?m.fetchReportRecommendModules:m.fetchReportRecommendItems)(signal);await Promise.resolve();pendingFor(f,table).at(-1).resolve({data:rows,error:null});return {value:await p,signal,call:f.calls.at(-1)};}
test('actual recommendation readers record every query operation, fixed A scope, available dates, deterministic ordering and original bounds',async()=>{
 const f=fixture();for(const [table,rows,limit,fields,orders] of [
 ['recommend_modules',[moduleRow()],50,'id, title, module_type, position, items_count, snapshot_date, gender_filter',[['order','snapshot_date',{ascending:false}],['order','position',{ascending:true}],['order','id',{ascending:true}]]],
 ['recommend_items',[itemRow()],1000,'id, module_id, musinsa_no, brand_name, position, snapshot_date, gender_filter',[['order','snapshot_date',{ascending:false}],['order','module_id',{ascending:true}],['order','position',{ascending:true}],['order','id',{ascending:true}]]]]){
 const {value,signal,call}=await read(f,table,rows);assert.equal(value.date,'2026-10-03');assert.deepEqual(call.ops,[['select',fields,undefined],['eq','gender_filter','A'],...orders,['limit',limit],['abortSignal',signal]]);
 }assert.equal(f.calls.length,2);
});
test('query errors and null or malformed data are errors, successful empty is empty without invented date or non-exposure',async()=>{
 for(const table of ['recommend_modules','recommend_items'])for(const response of [{data:null,error:null},{data:[],error:{message:'offline'}},{data:[{id:'x'}],error:null},{data:[table==='recommend_modules'?moduleRow('2026-02-30'):itemRow('2026-02-30')],error:null},{data:[],error:null}]){
 const f=fixture(),m=lib(f),p=(table==='recommend_modules'?m.fetchReportRecommendModules:m.fetchReportRecommendItems)(new AbortController().signal);await Promise.resolve();pendingFor(f,table)[0].resolve(response);
 if(!response.error&&Array.isArray(response.data)&&!response.data.length){const value=await p;assert.equal(value.date,null);assert.equal(value.atLimit,false)}else await assert.rejects(p);
 }const f=fixture(),m=lib(f),emptyModules=(await read(f,'recommend_modules',[])).value,emptyItems=(await read(f,'recommend_items',[])).value,v=m.deriveRecommendEvidence(ready(emptyModules),ready(emptyItems));assert.equal(v.itemCount,0);assert.equal(v.brandCount,0);assert.equal(v.coherent,false);
});
test('wrong gender, missing identifiers and invalid item positions cannot mix contexts or masquerade as absent exposure',async()=>{
 for(const table of ['recommend_modules','recommend_items'])for(const changed of [{gender_filter:'F'},{snapshot_date:undefined},{id:''},{position:-1},{position:null}]){
 const f=fixture(),m=lib(f),p=(table==='recommend_modules'?m.fetchReportRecommendModules:m.fetchReportRecommendItems)(new AbortController().signal);await Promise.resolve();pendingFor(f,table)[0].resolve({data:[{...(table==='recommend_modules'?moduleRow():itemRow()),...changed}],error:null});await assert.rejects(p);
 }
});
test('module failure retains item observations but unknown linked exposure; item failure retains modules with unavailable item counts',async()=>{
 const f=fixture(),m=lib(f),modules=(await read(f,'recommend_modules',[moduleRow()])).value,items=(await read(f,'recommend_items',[itemRow()])).value;
 const a=m.deriveRecommendEvidence(error,ready(items));assert.equal(a.itemCount,1);assert.equal(a.brandCount,1);assert.equal(a.unknownJoin,1);assert.equal(a.coherent,false);assert.equal(a.topBrands[0].brandName,'Brand');assert.equal(a.joinedBrands.size,0);
 const b=m.deriveRecommendEvidence(ready(modules),error);assert.equal(b.itemCount,null);assert.equal(b.brandCount,null);assert.equal(b.modules[0].title,'Recommendation module');assert.equal(b.unaccountedModules,1);assert.equal(b.coherent,false);
});
test('exact module ID/date/gender joins reject missing, ambiguous, mismatched and partial module/item evidence',async()=>{
 const cases=[[],[moduleRow('2026-10-04')],[moduleRow('2026-10-03','different')],[moduleRow(),moduleRow()],[moduleRow('2026-10-03','module',2)],[moduleRow('2026-10-03','module',null)],[moduleRow()]];
 for(const rows of cases){const f=fixture(),m=lib(f),modules=(await read(f,'recommend_modules',rows)).value,items=(await read(f,'recommend_items',[itemRow()])).value,v=m.deriveRecommendEvidence(ready(modules),ready(items));assert.equal(v.coherent,rows.length===1&&rows[0].id==='module'&&rows[0].snapshot_date==='2026-10-03'&&rows[0].items_count===1);assert.equal(v.itemCount,1)}
 const f=fixture(),m=lib(f),modules=(await read(f,'recommend_modules',[moduleRow()])).value,empty=(await read(f,'recommend_items',[])).value,v=m.deriveRecommendEvidence(ready(modules),ready(empty));assert.equal(v.unaccountedModules,1);assert.equal(v.coherent,false);assert.equal(v.itemDate,null);
});
test('independent dates use latest returned rows, not ranking date; older returned module still joins only the same dated item',async()=>{
 const f=fixture(),m=lib(f),modules=(await read(f,'recommend_modules',[moduleRow('2026-10-04','new'),moduleRow('2026-10-03','old')])).value,items=(await read(f,'recommend_items',[itemRow('2026-10-03','old'),itemRow('2026-10-01','older','Old Brand','old-item')])).value;
 const v=m.deriveRecommendEvidence(ready(modules),ready(items));assert.equal(v.moduleDate,'2026-10-04');assert.equal(v.itemDate,'2026-10-03');assert.equal(v.modules[0].title,'Recommendation new');assert.equal(v.itemCount,1);assert.equal(items.sampledRows,2);assert.ok(v.joinedBrands.has('Brand'));assert.equal(v.coherent,false);assert.equal(f.calls.length,2);
});
test('caps and missing brand/count metadata preserve unknown absence; raw item counts remain occurrences across modules',async()=>{
 const f=fixture(),m=lib(f),modules=(await read(f,'recommend_modules',Array.from({length:50},(_,n)=>moduleRow('2026-10-03','m'+n,20,n)))).value,items=(await read(f,'recommend_items',Array.from({length:1000},(_,n)=>itemRow('2026-10-03','m'+n%50,n%2?'Brand':null,'i'+n,n)))).value;
 const v=m.deriveRecommendEvidence(ready(modules),ready(items));assert.equal(modules.atLimit,true);assert.equal(items.atLimit,true);assert.equal(v.coherent,false);assert.equal(v.itemCount,1000);assert.equal(v.brandCount,null);assert.equal(v.knownBrandCount,1);assert.equal(v.unknownBrand,500);assert.equal(v.topBrands[0].count,500);
 const f2=fixture(),m2=lib(f2),ms=(await read(f2,'recommend_modules',[moduleRow('2026-10-03','one'),moduleRow('2026-10-03','two',1,1)])).value,is=(await read(f2,'recommend_items',[itemRow('2026-10-03','one','Brand','one'),itemRow('2026-10-03','two','Brand','two')])).value;assert.equal(m2.deriveRecommendEvidence(ready(ms),ready(is)).itemCount,2);
});
test('current business matching and other sources are preserved; unavailable prerequisites never become false or channel zero',async()=>{
 const f=fixture(),m=lib(f),modules=(await read(f,'recommend_modules',[moduleRow()])).value,items=(await read(f,'recommend_items',[itemRow('2026-10-03','module','Brand Extra')])).value;
 const base={kpi:{latestDate:'2026-10-05',saleItemCount:8,contentCount:9},ownBrands:[{brandName:'Brand'},{brandName:'Missing'}],competitors:[{brandName:'Brand'},{brandName:'Brand Extra'}],channelConversions:[{channel:'세일판',rate:42},{channel:'콘텐츠판',rate:12}],rankingRows:[{brandName:'Brand Extra'}],financeMarker:'unchanged'};
 const v=m.deriveRecommendEvidence(ready(modules),ready(items)),out=m.applyRecommendEvidence(base,v);assert.equal(out.ownBrands[0].hasRecommend,true);assert.equal(out.ownBrands[1].hasRecommend,false);assert.equal(out.competitors[0].hasRecommend,false);assert.equal(out.competitors[1].hasRecommend,true);assert.deepEqual(out.channelConversions,base.channelConversions);assert.equal(out.kpi.saleItemCount,8);assert.equal(out.kpi.contentCount,9);assert.equal(out.financeMarker,'unchanged');
 const same=m.applyRecommendEvidence({...base,kpi:{...base.kpi,latestDate:'2026-10-03'}},v);assert.equal(same.channelConversions[0].channel,'추천판');assert.equal(same.channelConversions[0].rate,100);
 const unknown=m.applyRecommendEvidence(base,m.deriveRecommendEvidence(error,ready(items)));assert.equal(unknown.ownBrands[0].hasRecommend,null);assert.equal(unknown.ownBrands[1].hasRecommend,null);assert.deepEqual(unknown.channelConversions,base.channelConversions);
});
test('full desktop/mobile actual source failures preserve independent success, unknown controls and the original 15-read budget',async()=>{
 for(const mobile of [false,true])for(const failed of ['recommend_modules','recommend_items']){
 const f=fixture();f.mocks['@/hooks/useResolvedViewport']={useResolvedViewport:()=>mobile?'mobile':'desktop'};const Page=load('src/app/(app)/report/page.tsx',f.mocks).default;let root;
 try{await React.act(async()=>{root=Renderer.create(React.createElement(Page))});assert.equal(f.calls.length,15);await React.act(async()=>{pendingFor(f,'recommend_modules')[0].resolve({data:failed==='recommend_modules'?null:[moduleRow()],error:failed==='recommend_modules'?{message:'offline'}:null});pendingFor(f,'recommend_items')[0].resolve({data:failed==='recommend_items'?null:[itemRow()],error:failed==='recommend_items'?{message:'offline'}:null})});
 if(mobile)await React.act(async()=>root.root.findAllByType('button').find(b=>String(b.props.children?.[0]?.props?.children??'').startsWith('2. 추천판'))?.props.onClick());
 const text=JSON.stringify(root.toJSON());assert.match(text,/조회 실패/);assert.match(text,/확인 못함/);assert.doesNotMatch(text,/오늘 추천판 데이터가 없습니다/);
 if(failed==='recommend_modules'){assert.match(text,/독립 조회 추천 아이템 브랜드/);assert.match(text,/Brand/)}else assert.match(text,/Recommendation module/);
 }finally{await React.act(async()=>root?.unmount())}}
});
test('module/item retry remains stable, adds one read, prevents duplicate clicks and leaves the other source intact',async()=>{
 for(const table of ['recommend_modules','recommend_items']){const f=fixture(),Page=load('src/app/(app)/report/page.tsx',f.mocks).default;let root;
 try{await React.act(async()=>{root=Renderer.create(React.createElement(Page))});await React.act(async()=>pendingFor(f,table)[0].resolve({data:null,error:{message:'offline'}}));const label=table==='recommend_modules'?'추천 모듈 다시 조회':'추천 아이템 다시 조회',button=root.root.findByProps({'aria-label':label});await React.act(async()=>button.props.onClick());assert.equal(f.calls.length,16);assert.equal(button.props['aria-disabled'],true);await React.act(async()=>button.props.onClick());assert.equal(f.calls.length,16);
 const other=table==='recommend_modules'?'recommend_items':'recommend_modules';assert.equal(pendingFor(f,other).length,1);await React.act(async()=>pendingFor(f,table)[1].resolve({data:table==='recommend_modules'?[moduleRow()]:[itemRow()],error:null}));assert.equal(root.root.findByProps({'aria-label':label}),button);assert.equal(button.props['aria-disabled'],false);
 }finally{await React.act(async()=>root?.unmount())}}
});
test('stable source controls survive deferred core ready/empty/error transitions for both sources and both viewports',async()=>{
 for(const mobile of [false,true])for(const outcome of ['ready','empty','error'])for(const table of ['recommend_modules','recommend_items']){
 const f=fixture(),core=f.holdCore();f.mocks['@/hooks/useResolvedViewport']={useResolvedViewport:()=>mobile?'mobile':'desktop'};const Page=load('src/app/(app)/report/page.tsx',f.mocks).default,label=table==='recommend_modules'?'추천 모듈 다시 조회':'추천 아이템 다시 조회';let root;
 try{await React.act(async()=>{root=Renderer.create(React.createElement(Page))});await React.act(async()=>pendingFor(f,table)[0].resolve({data:null,error:{message:'offline'}}));const button=root.root.findByProps({'aria-label':label});await React.act(async()=>button.props.onClick());await React.act(async()=>core.resolve({data:outcome==='ready'?[{snapshot_date:'2026-10-05'}]:outcome==='empty'?[]:null,error:outcome==='error'?{message:'offline'}:null}));assert.equal(root.root.findByProps({'aria-label':label}),button);await React.act(async()=>pendingFor(f,table)[1].resolve({data:table==='recommend_modules'?[moduleRow()]:[itemRow()],error:null}));assert.equal(root.root.findByProps({'aria-label':label}),button);
 }finally{await React.act(async()=>root?.unmount())}}
});
test('both sources survive core failure and retain successful dated observations',async()=>{
 const f=fixture();f.failCore();const Page=load('src/app/(app)/report/page.tsx',f.mocks).default;let root;try{await React.act(async()=>{root=Renderer.create(React.createElement(Page))});await React.act(async()=>{pendingFor(f,'recommend_modules')[0].resolve({data:[moduleRow()],error:null});pendingFor(f,'recommend_items')[0].resolve({data:[itemRow()],error:null})});const text=JSON.stringify(root.toJSON());assert.match(text,/리포트를 확인하지 못/);assert.match(text,/Recommendation module/);assert.match(text,/독립 조회 추천 아이템 브랜드/);assert.match(text,/2026-10-03/);
 }finally{await React.act(async()=>root?.unmount())}
});
test('account changes abort both sources, reject late data/error, ignore repeated identity and clear on sign-out',async()=>{
 const f=fixture(),late=f.late(),Page=load('src/app/(app)/report/page.tsx',f.mocks).default;let root;try{await React.act(async()=>{root=Renderer.create(React.createElement(Page))});await React.act(async()=>f.auth('A'));await React.act(async()=>f.auth('B'));for(const table of ['recommend_modules','recommend_items'])assert.equal(pendingFor(f,table)[0].call.signal.aborted,true);
 await React.act(async()=>{pendingFor(f,'recommend_modules')[1].resolve({data:[moduleRow()],error:null});pendingFor(f,'recommend_items')[1].resolve({data:[itemRow()],error:null});pendingFor(f,'recommend_modules')[0].resolve({data:[moduleRow('2026-09-01')],error:null});pendingFor(f,'recommend_items')[0].resolve({data:null,error:{message:'old failure'}})});const text=JSON.stringify(root.toJSON());assert.doesNotMatch(text,/2026-09-01|조회 실패/);assert.match(text,/2026-10-03/);const count=f.calls.length;await React.act(async()=>f.auth('B'));assert.equal(f.calls.length,count);await React.act(async()=>{f.auth(null);late.resolve({data:{user:{id:'A'}},error:null})});assert.doesNotMatch(JSON.stringify(root.toJSON()),/2026-10-03/);assert.match(JSON.stringify(root.toJSON()),/로그인이 필요/);
 }finally{await React.act(async()=>root?.unmount())}
});
test('source control retries SDK identity failure, pending duplicate is ignored, auth event wins late lookup and unmount aborts all sources',async()=>{
 const f=fixture(),first=f.late(),Page=load('src/app/(app)/report/page.tsx',f.mocks).default;let root;try{await React.act(async()=>{root=Renderer.create(React.createElement(Page));first.resolve({data:{user:null},error:{message:'offline'}})});assert.equal(f.calls.length,0);const second=f.late(),button=root.root.findByProps({'aria-label':'추천 아이템 다시 조회'});await React.act(async()=>button.props.onClick());await React.act(async()=>button.props.onClick());assert.equal(f.authCalls,2);await React.act(async()=>{f.auth('B');second.resolve({data:{user:{id:'stale-A'}},error:null})});assert.equal(f.calls.length,15);await React.act(async()=>root.unmount());for(const table of ['recommend_modules','recommend_items'])assert.equal(pendingFor(f,table)[0].call.signal.aborted,true);await React.act(async()=>{pendingFor(f,'recommend_modules')[0].resolve({data:[moduleRow()],error:null});pendingFor(f,'recommend_items')[0].resolve({data:[itemRow()],error:null})});assert.equal(root.toJSON(),null);
 }finally{await React.act(async()=>root?.unmount())}
});
test('viewport context remount aborts old readers and late prior-context rows cannot replace the new report',async()=>{
 const f=fixture();let viewport='desktop';f.mocks['@/hooks/useResolvedViewport']={useResolvedViewport:()=>viewport};const Page=load('src/app/(app)/report/page.tsx',f.mocks).default;let root;try{await React.act(async()=>{root=Renderer.create(React.createElement(Page))});await React.act(async()=>{viewport='mobile';root.update(React.createElement(Page,{tick:1}))});for(const table of ['recommend_modules','recommend_items'])assert.equal(pendingFor(f,table)[0].call.signal.aborted,true);await React.act(async()=>{pendingFor(f,'recommend_modules')[1].resolve({data:[moduleRow()],error:null});pendingFor(f,'recommend_items')[1].resolve({data:[itemRow()],error:null});pendingFor(f,'recommend_modules')[0].resolve({data:[moduleRow('2026-09-01')],error:null});pendingFor(f,'recommend_items')[0].resolve({data:[itemRow('2026-09-01')],error:null})});assert.doesNotMatch(JSON.stringify(root.toJSON()),/2026-09-01/);assert.match(JSON.stringify(root.toJSON()),/2026-10-03/);assert.equal(f.calls.length,30);
 }finally{await React.act(async()=>root?.unmount())}
});
