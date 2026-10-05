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
                    if (['brand_ranking_snapshots','promotions','promotion_items'].includes(table)) {
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
const header = (date='2026-10-03',type='general',id='event') => ({id,snapshot_date:date,promotion_type:type});
const item = (date='2026-10-03',promo='event',brand='Brand',dr=20,id='item') => ({id,promotion_id:promo,musinsa_no:'123',snapshot_date:date,musinsa_brand_name:brand,discount_rate:dr});
const ready=data=>({state:'ready',data}),error={state:'error',data:null};
const pendingFor=(f,table)=>f.pending.filter(p=>p.call.table===table);
const lib=f=>load('src/lib/report-promotion-evidence.ts',f.mocks);
async function read(f,table,rows){const m=lib(f),signal=new AbortController().signal,p=(table==='promotions'?m.fetchReportPromotionHeaders:m.fetchReportPromotionItems)(signal);await Promise.resolve();pendingFor(f,table).at(-1).resolve({data:rows,error:null});return {value:await p,signal,call:f.calls.at(-1)};}
test('both actual readers record every operation: no ranking-date filter, deterministic bounds and signal',async()=>{
 const f=fixture();for(const [table,rows,limit,fields] of [
 ['promotions',[header()],50,'id, promotion_type, snapshot_date'],
 ['promotion_items',[item()],2000,'id, promotion_id, musinsa_no, musinsa_brand_name, discount_rate, snapshot_date']]){
 const {value,signal,call}=await read(f,table,rows);assert.equal(value.date,'2026-10-03');
 assert.deepEqual(call.ops,[['select',fields,undefined],['order','snapshot_date',{ascending:false}],['order','id',{ascending:true}],['limit',limit],['abortSignal',signal]]);
 }assert.equal(f.calls.length,2);
});
test('source errors, null, malformed IDs/dates and genuine empties remain distinct',async()=>{
 for(const table of ['promotions','promotion_items'])for(const data of [null,[{id:'x'}],[],[table==='promotions'?header('2026-02-30'):item('2026-02-30')]]){
 const f=fixture(),m=lib(f),p=(table==='promotions'?m.fetchReportPromotionHeaders:m.fetchReportPromotionItems)(new AbortController().signal);await Promise.resolve();pendingFor(f,table)[0].resolve({data,error:null});
 if(Array.isArray(data)&&!data.length){const v=await p;assert.equal(v.date,null);assert.equal(v.atLimit,false)}else await assert.rejects(p);
 }for(const table of ['promotions','promotion_items']){const f=fixture(),m=lib(f),p=(table==='promotions'?m.fetchReportPromotionHeaders:m.fetchReportPromotionItems)(new AbortController().signal);await Promise.resolve();pendingFor(f,table)[0].resolve({data:[],error:{message:'offline'}});await assert.rejects(p)}
});
test('latest item date is observed independently; headers from another date cannot classify it',async()=>{
 const f=fixture(),m=lib(f),h=(await read(f,'promotions',[header('2026-10-04','daily_sale'),header('2026-10-03','brand_week','other')])).value;
 const i=(await read(f,'promotion_items',[item('2026-10-03'),item('2026-10-01','other')])).value;
 const v=m.derivePromotionEvidence(ready(h),ready(i));assert.equal(i.date,'2026-10-03');assert.equal(i.sampledRows,2);assert.equal(i.rows.length,1);
 assert.equal(v.unknownClassification,1);assert.equal(v.saleBrands.size,0);assert.equal(v.coherent,false);assert.equal(v.saleDist[1].count,1);
});
test('general is only an explicit coherent classification; mismatched IDs/dates, duplicate headers and unknown types stay unknown',async()=>{
 const cases=[[],[header('2026-10-03','general','different')],[header('2026-10-04')],[header(),header()],[header('2026-10-03','new_type')],[header()]];
 for(const rows of cases){const f=fixture(),m=lib(f),h=(await read(f,'promotions',rows)).value,i=(await read(f,'promotion_items',[item()])).value,v=m.derivePromotionEvidence(ready(h),ready(i));
 assert.equal(v.unknownClassification,rows.length===1&&rows[0].promotion_type==='general'&&rows[0].id==='event'&&rows[0].snapshot_date==='2026-10-03'?0:1);
 assert.equal(v.saleBrands.has('Brand'),v.unknownClassification===0)}
});
test('partial header failure retains discounts; partial item failure cannot invent zero counts or missing flags',async()=>{
 const f=fixture(),m=lib(f),h=(await read(f,'promotions',[header()])).value,i=(await read(f,'promotion_items',[item(),item('2026-10-03','event','Brand',null,'two'),item('2026-10-03','event',null,150,'three')])).value;
 const a=m.derivePromotionEvidence(error,ready(i));assert.equal(a.itemCount,3);assert.equal(a.brandCount,null);assert.equal(a.unknownClassification,3);assert.equal(a.unknownDiscount,2);assert.equal(a.unknownBrand,1);assert.equal(a.saleDist[0].count,0);assert.equal(a.saleDist[1].count,1);
 const b=m.derivePromotionEvidence(ready(h),error);assert.equal(b.itemCount,null);assert.equal(b.brandCount,null);assert.deepEqual(b.saleDist,[]);
});
test('caps remain partial and cannot imply a negative observation; business campaign types and other sources retained',async()=>{
 const f=fixture(),m=lib(f),h=(await read(f,'promotions',Array.from({length:50},(_,n)=>header('2026-10-03',n===0?'limited_offer':n===1?'brand_week':n===2?'daily_sale':'general','p'+n)))).value;
 const i=(await read(f,'promotion_items',Array.from({length:2000},(_,n)=>item('2026-10-03','p'+n%50,'B'+n%50,0,'i'+n)))).value,v=m.derivePromotionEvidence(ready(h),ready(i));
 assert.equal(h.atLimit,true);assert.equal(i.atLimit,true);assert.equal(v.coherent,false);assert.ok(v.promoBrands.has('B0')&&v.promoBrands.has('B1'));assert.ok(v.saleBrands.has('B2')&&v.saleBrands.has('B3'));assert.equal(v.saleDist[0].count,2000);
 const data={kpi:{latestDate:'2026-10-03',contentCount:9},ownBrands:[{brandName:'Missing'},{brandName:'B0'},{brandName:'B2'}],competitors:[{brandName:'B2'}],channelConversions:[{channel:'콘텐츠판',rate:42}],rankingRows:[{brandName:'B2'}],saleDist:[],financeMarker:'unchanged'};
 const out=m.applyPromotionEvidence(data,v);assert.equal(out.ownBrands[0].hasSale,null);assert.equal(out.ownBrands[1].hasPromo,true);assert.equal(out.ownBrands[2].hasSale,true);assert.equal(out.competitors[0].hasSale,true);assert.equal(out.kpi.contentCount,9);assert.equal(out.financeMarker,'unchanged');assert.deepEqual(out.channelConversions,data.channelConversions);
});
test('coherent sample absence is scoped; channel comparison requires the same ranking date',async()=>{
 const f=fixture(),m=lib(f),h=(await read(f,'promotions',[header()])).value,i=(await read(f,'promotion_items',[item()])).value,v=m.derivePromotionEvidence(ready(h),ready(i));
 const base={kpi:{latestDate:'2026-10-05'},ownBrands:[{brandName:'Missing'}],competitors:[],channelConversions:[],rankingRows:[{brandName:'Brand'}],saleDist:[]};
 assert.equal(m.applyPromotionEvidence(base,v).ownBrands[0].hasSale,false);assert.equal(m.applyPromotionEvidence(base,v).channelConversions.length,0);
 const out=m.applyPromotionEvidence({...base,kpi:{latestDate:'2026-10-03'}},v);assert.equal(out.channelConversions[0].rate,100);
});
test('full desktop/mobile partial failures preserve core, source retry control and exact 15-read budget',async()=>{
 for(const mobile of [false,true]){const f=fixture();f.mocks['@/hooks/useResolvedViewport']={useResolvedViewport:()=>mobile?'mobile':'desktop'};const Page=load('src/app/(app)/report/page.tsx',f.mocks).default;let root;
 try{await React.act(async()=>{root=Renderer.create(React.createElement(Page))});assert.equal(f.calls.length,15);
 await React.act(async()=>{pendingFor(f,'promotion_items')[0].resolve({data:[item()],error:null});pendingFor(f,'promotions')[0].resolve({data:null,error:{message:'offline'}})});
 assert.match(JSON.stringify(root.toJSON()),/프로모션 헤더 조회 실패/);assert.match(JSON.stringify(root.toJSON()),/유형 미확인/);assert.match(JSON.stringify(root.toJSON()),/확인 못함/);
 const button=root.root.findByProps({'aria-label':'프로모션 헤더 다시 조회'});await React.act(async()=>button.props.onClick());assert.equal(f.calls.length,16);assert.equal(button.props['aria-disabled'],true);await React.act(async()=>button.props.onClick());assert.equal(f.calls.length,16);
 assert.equal(pendingFor(f,'promotion_items').length,1);await React.act(async()=>pendingFor(f,'promotions')[1].resolve({data:[header()],error:null}));assert.equal(root.root.findByProps({'aria-label':'프로모션 헤더 다시 조회'}),button);assert.equal(button.props['aria-disabled'],false);assert.match(JSON.stringify(root.toJSON()),/조회 내 노출/);
 }finally{await React.act(async()=>root?.unmount())}}
});
test('both source retries survive core failure; item-only retry does not repeat headers',async()=>{
 const f=fixture();f.failCore();const Page=load('src/app/(app)/report/page.tsx',f.mocks).default;let root;try{
 await React.act(async()=>{root=Renderer.create(React.createElement(Page));});await React.act(async()=>{pendingFor(f,'promotions')[0].resolve({data:[header()],error:null});pendingFor(f,'promotion_items')[0].resolve({data:null,error:{message:'offline'}})});
 assert.match(JSON.stringify(root.toJSON()),/리포트를 확인하지 못/);const button=root.root.findByProps({'aria-label':'프로모션 아이템 다시 조회'});const count=f.calls.length;await React.act(async()=>button.props.onClick());assert.equal(f.calls.length,count+1);assert.equal(pendingFor(f,'promotions').length,1);await React.act(async()=>pendingFor(f,'promotion_items')[1].resolve({data:[item()],error:null}));assert.match(JSON.stringify(root.toJSON()),/해당 날짜 조회/);
 }finally{await React.act(async()=>root?.unmount())}
});
test('account change aborts both sources and rejects late rows; repeated identity does not refetch; sign-out clears',async()=>{
 const f=fixture(),late=f.late(),Page=load('src/app/(app)/report/page.tsx',f.mocks).default;let root;try{
 await React.act(async()=>{root=Renderer.create(React.createElement(Page))});await React.act(async()=>f.auth('A'));await React.act(async()=>f.auth('B'));
 for(const table of ['promotions','promotion_items'])assert.equal(pendingFor(f,table)[0].call.signal.aborted,true);
 await React.act(async()=>{pendingFor(f,'promotions')[1].resolve({data:[header()],error:null});pendingFor(f,'promotion_items')[1].resolve({data:[item()],error:null});pendingFor(f,'promotions')[0].resolve({data:[header('2026-09-01')],error:null});pendingFor(f,'promotion_items')[0].resolve({data:[item('2026-09-01')],error:null})});
 assert.doesNotMatch(JSON.stringify(root.toJSON()),/2026-09-01/);const count=f.calls.length;await React.act(async()=>f.auth('B'));assert.equal(f.calls.length,count);
 await React.act(async()=>{f.auth(null);late.resolve({data:{user:{id:'A'}},error:null})});assert.doesNotMatch(JSON.stringify(root.toJSON()),/2026-10-03/);assert.match(JSON.stringify(root.toJSON()),/로그인이 필요/);
 }finally{await React.act(async()=>root?.unmount())}
});
test('promotion control recovers identity failure through SDK; auth event wins late lookup and unmount aborts sources',async()=>{
 const f=fixture(),initial=f.late(),Page=load('src/app/(app)/report/page.tsx',f.mocks).default;let root;
 try{await React.act(async()=>{root=Renderer.create(React.createElement(Page));initial.resolve({data:{user:null},error:{message:'offline'}})});
 assert.equal(f.calls.length,0);const next=f.late(),button=root.root.findByProps({'aria-label':'프로모션 아이템 다시 조회'});
 await React.act(async()=>button.props.onClick());await React.act(async()=>button.props.onClick());assert.equal(f.authCalls,2);
 await React.act(async()=>{f.auth('B');next.resolve({data:{user:{id:'stale-A'}},error:null})});assert.equal(f.calls.length,15);
 await React.act(async()=>root.unmount());for(const table of ['promotions','promotion_items'])assert.equal(pendingFor(f,table)[0].call.signal.aborted,true);
 await React.act(async()=>{pendingFor(f,'promotions')[0].resolve({data:[header()],error:null});pendingFor(f,'promotion_items')[0].resolve({data:[item()],error:null})});assert.equal(root.toJSON(),null);
 }finally{await React.act(async()=>root?.unmount())}
});
test('source retry controls retain instance across deferred core ready, empty and error transitions on desktop/mobile',async()=>{
 for(const mobile of [false,true])for(const outcome of ['ready','empty','error'])for(const table of ['promotions','promotion_items']){
 const f=fixture(),core=f.holdCore();f.mocks['@/hooks/useResolvedViewport']={useResolvedViewport:()=>mobile?'mobile':'desktop'};
 const Page=load('src/app/(app)/report/page.tsx',f.mocks).default,label=table==='promotions'?'프로모션 헤더 다시 조회':'프로모션 아이템 다시 조회';let root;
 try{await React.act(async()=>{root=Renderer.create(React.createElement(Page))});
 await React.act(async()=>pendingFor(f,table)[0].resolve({data:null,error:{message:'offline'}}));
 const button=root.root.findByProps({'aria-label':label});await React.act(async()=>button.props.onClick());assert.equal(button.props['aria-disabled'],true);
 await React.act(async()=>core.resolve({data:outcome==='ready'?[{snapshot_date:'2026-10-05'}]:outcome==='empty'?[]:null,error:outcome==='error'?{message:'offline'}:null}));
 assert.equal(root.root.findByProps({'aria-label':label}),button,`${mobile?'mobile':'desktop'} ${outcome} ${table}`);
 await React.act(async()=>pendingFor(f,table)[1].resolve({data:table==='promotions'?[header()]:[item()],error:null}));
 assert.equal(root.root.findByProps({'aria-label':label}),button);assert.equal(button.props['aria-disabled'],false);
 }finally{await React.act(async()=>root?.unmount())}}
});
