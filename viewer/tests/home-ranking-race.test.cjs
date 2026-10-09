const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), Renderer = require('react-test-renderer');
const load = require('./helpers/load-source.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const inert = new Proxy({}, {get: () => () => null});
function fixture() {
 const calls = {product: [], brand: []}, auth = new Set(), pushed = [];
 const fetch = panel => opts => new Promise((resolve, reject) => calls[panel].push({opts, resolve, reject}));
 const channel = {on(){return this}, subscribe(){return this}};
 const client = {auth:{onAuthStateChange(fn){auth.add(fn);return {data:{subscription:{unsubscribe(){auth.delete(fn)}}}}}},channel:()=>channel,removeChannel(){}};
 const queries = {fetchLatestRanking:fetch('product'), fetchTopBrandRanking:fetch('brand'),fetchCollectionStats:async()=>[],fetchOwnBrandBreakdown:async()=>[],fetchAnomalySignals:async()=>[],fetchReviewStats:async()=>null,fetchActivePromotions:async()=>[],fetchActiveJobs:async()=>({state:'available',jobs:[]})};
 const Page = load('src/app/(app)/page.tsx', {'@/lib/queries':queries,'@/hooks/useViewport':{useIsMobile:()=>false},'./MobileHomeView':inert,'@/components/ui/icons':inert,'@/lib/supabase/client':{supabaseBrowser:()=>client},'next/navigation':{useRouter:()=>({push:href=>pushed.push(href)})},'next/link':{__esModule:true,default:p=>React.createElement('a',p)}}).default;
 return {Page,calls,auth,pushed};
}
const act = fn => React.act(fn);
const text = root => JSON.stringify(root.toJSON());
const panel = (root,index) => root.root.findAllByType('section')[index];
const row = label => ({product_name:label,brand_name:label,musinsa_no:'123',musinsa_brand_slug:'fixture-slug',rank_position:1,snapshot_date:'2026-10-09'});
async function mount(f){let root;await act(async()=>{root=Renderer.create(React.createElement(f.Page))});return root;}
async function click(root,index,label){await act(async()=>panel(root,index).findAllByType('button').find(x=>x.props.children===label).props.onClick());}
async function settle(call, label){await act(async()=>call.resolve(label ? [row(label)] : []));}
for(const [name,index] of [['product',0],['brand',1]]) {
 test(`${name}: actual Home hides old rows and rejects late success/error through A→B→A and fast toggles`, async()=>{
  const f=fixture(),root=await mount(f);
  try {
   await settle(f.calls[name][0],'old-A');await click(root,index,'남성');assert.ok(!text(root).includes('old-A'));assert.match(text(root),/로딩 중/);
   const m=f.calls[name][1];await click(root,index,'전체');const a=f.calls[name][2];assert.ok(m.opts.signal.aborted);
   await settle(a,'new-A');await settle(m,'late-M');assert.ok(!text(root).includes('late-M'));
   await click(root,index,'남성');const m2=f.calls[name][3];await click(root,index,'여성');const female=f.calls[name][4];await settle(female,'new-F');
   await act(async()=>m2.reject(Error('late error')));assert.match(text(root),/new-F/);assert.ok(!text(root).includes('조회 실패'));
   assert.equal(f.calls[name==='product'?'brand':'product'].length,1);
  } finally {await act(async()=>root.unmount())}
 });
 test(`${name}: failure, repeated retries and successful zero rows are distinct`,async()=>{
  const f=fixture(),root=await mount(f);
  try {await act(async()=>f.calls[name][0].reject(Error('failed')));assert.match(text(root),/조회 실패/);
   await click(root,index,'다시 시도');assert.match(text(root),/로딩 중/);
   await act(async()=>f.calls[name][1].reject(Error('failed again')));await click(root,index,'다시 시도');await settle(f.calls[name][2]);
   assert.equal(panel(root,index).findAllByType('button').some(x=>x.props.children==='다시 시도'),false);assert.match(text(root),/랭킹 데이터 없음/);
  }finally{await act(async()=>root.unmount())}
 });
}
test('auth invalidates both panels immediately; ignored abort responses and unmounted work cannot restore prior account',async()=>{
 const f=fixture(),root=await mount(f);const old=[f.calls.product[0],f.calls.brand[0]];let closed=false;
 try {
 await act(async()=>{for(const fn of f.auth)fn('SIGNED_IN',{user:{id:'new-account'}});old[0].resolve([row('old-account')]);old[1].reject(Error('old account error'))});
 assert.ok(!text(root).includes('old-account'));assert.ok(!text(root).includes('조회 실패'));assert.ok(old.every(x=>x.opts.signal.aborted));
 await settle(f.calls.product.at(-1),'new-account');await settle(f.calls.brand.at(-1),'new-brand');assert.match(text(root),/new-account/);
 await act(async()=>{for(const fn of f.auth)fn('SIGNED_OUT',null)});assert.ok(!text(root).includes('new-account'));
 const pending=[f.calls.product.at(-1),f.calls.brand.at(-1)];await act(async()=>root.unmount());closed=true;assert.ok(pending.every(x=>x.opts.signal.aborted));assert.equal(f.auth.size,0);await act(async()=>{pending[0].resolve([row('unmounted')]);pending[1].reject(Error('unmounted'))});
 } finally { if(!closed) await act(async()=>root.unmount()); }
});
test('existing navigation retains its actual scope: overall links and identity-specific row links',async()=>{
 const f=fixture(),root=await mount(f);try{await click(root,0,'남성');await click(root,1,'여성');await settle(f.calls.product.at(-1),'male');await settle(f.calls.brand.at(-1),'female');
 assert.equal(f.calls.product.at(-1).opts.genderFilter,'M');assert.equal(f.calls.brand.at(-1).opts.genderFilter,'F');
 assert.equal(panel(root,0).findByType('a').props.href,'/ranking');assert.equal(panel(root,1).findByType('a').props.href,'/brand-ranking');
 await act(async()=>{panel(root,0).findAll(x=>x.props.className?.startsWith('row hover'))[0].props.onClick();panel(root,1).findAll(x=>x.props.className?.startsWith('row hover'))[0].props.onClick()});assert.deepEqual(f.pushed,['/product?no=123','/brand?slug=fixture-slug']);
 }finally{await act(async()=>root.unmount())}
});
