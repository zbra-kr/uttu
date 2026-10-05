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
                    if (['brand_ranking_snapshots','recommend_modules','recommend_items','promotions','promotion_items'].includes(table)) {
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

const promoHeader=()=>({id:'event',snapshot_date:'2026-10-05',promotion_type:'general'});
const promoItem=()=>({id:'promo-item',promotion_id:'event',snapshot_date:'2026-10-05',musinsa_no:'123',musinsa_brand_name:'Brand',discount_rate:20});
const sourceTables=['promotions','promotion_items','recommend_modules','recommend_items'];
function response(table){return {data:table==='promotions'?[promoHeader()]:table==='promotion_items'?[promoItem()]:table==='recommend_modules'?[moduleRow('2026-10-05')]:[itemRow('2026-10-05')],error:null};}
async function mount(f){let current;const hook=load('src/hooks/useDailyReport.ts',f.mocks).useDailyReport;function Probe(){current=hook();return null;}let root;await React.act(async()=>{root=Renderer.create(React.createElement(Probe))});return {root,get current(){return current}};}
test('combined hook owns one identity subscription, all four actual readers, 15 reads and original channel order',async()=>{
 const f=fixture(),v=await mount(f);try{assert.equal(f.authCalls,1);assert.equal(f.calls.length,15);for(const table of sourceTables)assert.equal(pendingFor(f,table).length,1);await React.act(async()=>{for(const table of sourceTables)pendingFor(f,table)[0].resolve(response(table))});assert.equal(v.current.data.ownBrands[0].hasRecommend,true);assert.equal(v.current.data.ownBrands[0].hasSale,true);assert.equal(v.current.data.ownBrands[0].hasPromo,false);assert.deepEqual(v.current.data.channelConversions.map(x=>x.channel),['추천판','세일판','콘텐츠판']);assert.equal(v.current.data.kpi.recommendItemCount,1);assert.equal(v.current.data.kpi.saleItemCount,1);
 }finally{await React.act(async()=>v.root.unmount())}
});
test('mixed cross-source errors and retries preserve successful independent evidence and add exactly one query',async()=>{
 for(const failed of sourceTables){const f=fixture(),v=await mount(f);try{await React.act(async()=>{for(const table of sourceTables)pendingFor(f,table)[0].resolve(table===failed?{data:null,error:{message:'offline'}}:response(table))});const current=v.current;assert.equal(current[failed==='promotions'?'headers':failed==='promotion_items'?'items':failed==='recommend_modules'?'recommendModulesSource':'recommendItemsSource'].state,'error');assert.equal(current.data.ownBrands[0][failed.startsWith('recommend')?'hasRecommend':'hasSale'],null);assert.equal(current.data.ownBrands[0][failed.startsWith('recommend')?'hasSale':'hasRecommend'],true);const name=failed==='promotions'?'retryHeaders':failed==='promotion_items'?'retryItems':failed==='recommend_modules'?'retryRecommendModules':'retryRecommendItems';await React.act(async()=>current[name]());assert.equal(f.calls.length,16);await React.act(async()=>current[name]());assert.equal(f.calls.length,16);for(const table of sourceTables.filter(t=>t!==failed))assert.equal(pendingFor(f,table).length,1);await React.act(async()=>pendingFor(f,failed)[1].resolve(response(failed)));assert.equal(v.current.data.ownBrands[0].hasRecommend,true);assert.equal(v.current.data.ownBrands[0].hasSale,true);
 }finally{await React.act(async()=>v.root.unmount())}}
});
test('shared identity epoch aborts all four prior readers and rejects cross-source late successes or errors',async()=>{
 const f=fixture(),v=await mount(f);try{await React.act(async()=>f.auth('B'));assert.equal(f.calls.length,30);for(const table of sourceTables)assert.equal(pendingFor(f,table)[0].call.signal.aborted,true);await React.act(async()=>{for(const table of sourceTables){pendingFor(f,table)[1].resolve(response(table));pendingFor(f,table)[0].resolve({data:null,error:{message:'stale failure'}})}});for(const key of ['headers','items','recommendModulesSource','recommendItemsSource'])assert.equal(v.current[key].state,'ready');assert.equal(v.current.data.ownBrands[0].hasRecommend,true);assert.equal(v.current.data.ownBrands[0].hasSale,true);await React.act(async()=>f.auth('B'));assert.equal(f.calls.length,30);await React.act(async()=>f.auth(null));for(const key of ['headers','items','recommendModulesSource','recommendItemsSource'])assert.equal(v.current[key].state,'signedout');assert.equal(v.current.data,null);
 }finally{await React.act(async()=>v.root.unmount())}
});
test('combined caps cannot manufacture negative exposure or either ranking conversion',async()=>{
 const f=fixture(),v=await mount(f);try{await React.act(async()=>{pendingFor(f,'promotions')[0].resolve({data:Array.from({length:50},(_,n)=>({...promoHeader(),id:'p'+n})),error:null});pendingFor(f,'promotion_items')[0].resolve({data:Array.from({length:2000},(_,n)=>({...promoItem(),id:'pi'+n,promotion_id:'p'+n%50,musinsa_brand_name:'Different Label'})),error:null});pendingFor(f,'recommend_modules')[0].resolve({data:Array.from({length:50},(_,n)=>moduleRow('2026-10-05','m'+n,20,n)),error:null});pendingFor(f,'recommend_items')[0].resolve({data:Array.from({length:1000},(_,n)=>itemRow('2026-10-05','m'+n%50,'Different Label','ri'+n,n)),error:null})});assert.equal(v.current.data.ownBrands[0].hasRecommend,null);assert.equal(v.current.data.ownBrands[0].hasSale,null);assert.equal(v.current.data.kpi.recommendItemCount,1000);assert.equal(v.current.data.kpi.saleItemCount,2000);assert.deepEqual(v.current.data.channelConversions.map(x=>x.channel),['콘텐츠판']);assert.equal(v.current.recommend.coherent,false);assert.equal(v.current.promotion.coherent,false);
 }finally{await React.act(async()=>v.root.unmount())}
});
