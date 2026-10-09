const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), Renderer = require('react-test-renderer');
const load = require('./helpers/load-source.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const inert = new Proxy({}, {get: () => () => null});
function fixture(strictEffects = false) {
 const pendingEffects=[];
 const wrappedReact={...React,useEffect(fn,deps){if(strictEffects && String(fn).includes("fetchRows")){React.useEffect(()=>{const entry={fn,cleanup:null};pendingEffects.push(entry);return ()=>entry.cleanup?.()},deps)}else React.useEffect(fn,deps)}};
 const calls = {product: [], brand: []}, auth = new Set(), pushed = [];
 const fetch = panel => opts => new Promise((resolve, reject) => calls[panel].push({opts, resolve, reject}));
 const channel = {on(){return this}, subscribe(){return this}};
 const client = {auth:{onAuthStateChange(fn){auth.add(fn);return {data:{subscription:{unsubscribe(){auth.delete(fn)}}}}}},channel:()=>channel,removeChannel(){}};
 const queries = {fetchLatestRanking:fetch('product'), fetchTopBrandRanking:fetch('brand'),fetchCollectionStats:async()=>[],fetchOwnBrandBreakdown:async()=>[],fetchAnomalySignals:async()=>[],fetchReviewStats:async()=>null,fetchActivePromotions:async()=>[],fetchActiveJobs:async()=>({state:'available',jobs:[]})};
 const Page = load('src/app/(app)/page.tsx', {'react':wrappedReact,'@/lib/queries':queries,'@/hooks/useViewport':{useIsMobile:()=>false},'./MobileHomeView':inert,'@/components/ui/icons':inert,'@/lib/supabase/client':{supabaseBrowser:()=>client},'next/navigation':{useRouter:()=>({push:href=>pushed.push(href)})},'next/link':{__esModule:true,default:p=>React.createElement('a',p)}}).default;
 return {Page,calls,auth,pushed,pendingEffects};
}
const act = fn => React.act(fn);
const text = root => JSON.stringify(root.toJSON());
const panel = (root,index) => root.root.findAllByType('section')[index];
const row = label => ({product_name:label,brand_name:label,musinsa_no:'123',musinsa_brand_slug:'fixture-slug',rank_position:1,snapshot_date:'2026-10-09'});
async function mount(f){let root;await act(async()=>{root=Renderer.create(React.createElement(f.Page))});return root;}
async function click(root,index,label){await act(async()=>panel(root,index).findAllByType('button').find(x=>x.props.children===label).props.onClick());}
async function settle(call, label){await act(async()=>call.resolve(label ? [row(label)] : []));}

for(const [name,index] of [['product',0],['brand',1]]) {
 test(`${name}: independent pre-request render and original A late success after A-B-A`,async()=>{
 const f=fixture(true),root=await mount(f);
 try {
 await act(async()=>{for(const e of f.pendingEffects.splice(0))e.cleanup=e.fn()});
 const first=f.calls[name][0]; await settle(first,'old-A');
 await click(root,index,'남성');assert.ok(!text(root).includes('old-A'));assert.equal(f.calls[name].length,1);
 await act(async()=>{for(const e of f.pendingEffects.splice(0))e.cleanup=e.fn()});
 const b=f.calls[name][1]; await click(root,index,'전체');assert.equal(f.calls[name].length,2);
 await act(async()=>{for(const e of f.pendingEffects.splice(0))e.cleanup=e.fn()});
 await settle(f.calls[name][2],'fresh-A');await act(async()=>b.reject(Error('obsolete')));
 assert.match(text(root),/fresh-A/);assert.ok(!text(root).includes('조회 실패'));
 }finally{await act(async()=>root.unmount())}
 });
 test(`${name}: initial unresolved A cannot win returned A; StrictMode and auth same tick`,async()=>{
 const f=fixture(); let root;
 await act(async()=>{root=Renderer.create(React.createElement(React.StrictMode,null,React.createElement(f.Page)))});
 try {
 const initial=[...f.calls[name]]; assert.ok(initial.length>=2);assert.ok(initial[0].opts.signal.aborted);
 await click(root,index,'남성');await click(root,index,'전체');await settle(f.calls[name].at(-1),'current-A');
 for(const [i,c] of initial.entries())await settle(c,'obsolete-A-'+i);
 assert.match(text(root),/current-A/);assert.ok(!text(root).includes('obsolete-A'));
 const before=f.calls[name].at(-1);await act(async()=>{for(const fn of f.auth)fn('TOKEN_REFRESHED',{user:{id:'same'}});before.reject(Error('old'))});
 assert.ok(!text(root).includes('current-A'));assert.ok(!text(root).includes('조회 실패'));
 }finally{await act(async()=>root.unmount())}assert.equal(f.auth.size,0);
 });
}
