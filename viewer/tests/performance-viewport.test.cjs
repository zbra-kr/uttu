const { readSource } = require('./performance-source.cjs');
// Real React 19 mounts of complete route modules; only UI-only dependencies and service boundaries are stubbed.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const React=require('react');
const Renderer=require('react-test-renderer');
const SSR=require('react-dom/server');
const ts=require('typescript');
const {act}=React;
assert.equal(React.version,'19.2.8');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
assert.equal(require('react-dom/package.json').version,React.version);
assert.equal(require('react-test-renderer/package.json').version,React.version);
class FixedDate extends Date { constructor(...args){super(...(args.length?args:['2026-10-03T12:00:00.000Z']))} static now(){return Date.parse('2026-10-03T12:00:00.000Z')} }
function createFixture(variant, mobile, route='ranking', search='', tab='dash'){
 const effects=[],helpers=[],requests=[],listeners=new Set(),storage=new Map([['ranking_filters',JSON.stringify({period:'90d'})],['rv_tab',JSON.stringify(tab)]]);
 // Determine the actual storage key from baseline rather than assume one.
 const rankingSource=readSource('source/ranking-page.tsx');
 const key=rankingSource.match(/const FILTER_KEY = ['"]([^'"]+)['"]/)[1];storage.set(key,JSON.stringify({period:'90d'}));
 const media={matches:mobile,addEventListener(name,fn){listeners.add(fn)},removeEventListener(name,fn){listeners.delete(fn)}};
 const localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
 const browser={matchMedia:()=>{effects.push('resolve-viewport');return media},addEventListener(){},removeEventListener(){},dispatchEvent(){}};
 const sb={from(table){const call={table,ops:[]};const query=new Proxy({}, {get(_,name){if(name==='then')return(resolve,reject)=>{
  requests.push(call);let data=[];const select=call.ops.find(x=>x[0]==='select')?.[1];
  if(table==='ranking_snapshots'&&select==='snapshot_date')data=[{snapshot_date:'2026-10-03'}];
  if(table==='brands')data=[{id:'brand-1',name:'Fixture'}];
  return Promise.resolve({data,error:null,count:data.length}).then(resolve,reject);
 };return(...args)=>{call.ops.push([name,...args]);return query}}});return query}};
 sb.auth={getUser:async()=>({data:{user:{id:'fixture-user',email:'fixture@example.invalid'}}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}}};
 const cache={};const noop=()=>null;
 const inert=new Proxy({__esModule:true,default:noop},{get:(t,k)=>k in t?t[k]:noop});
 const modules={
  'react':React,'react/jsx-runtime':require('react/jsx-runtime'),
  'next/navigation':{useRouter:()=>({push(){},replace(){}}),useSearchParams:()=>new URLSearchParams(search)},
  'next/link':{__esModule:true,default:({children,...props})=>React.createElement('a',props,children)},
  './supabase/client':{supabaseBrowser:()=>sb},'./collection-status':{},
  '@/lib/supabase/client':{supabaseBrowser:()=>sb},
  '@/lib/rating-format':{formatFiveStarRating:()=>'',isLowFiveStarRating:()=>false},
  '@/lib/queries-me':{fetchNoteCountForEntity:async()=>0,logView:()=>{}},
  '@/components/me/NoteDrawer':{__esModule:true,default:noop,useSourceNoteDrawer:()=>({noteDrawerOpen:false,setNoteDrawerOpen(){}})},
 };
 const paths={'@/hooks/useReviewDashboardPanels':'current/useReviewDashboardPanels.ts','@/hooks/useReviewStats':'current/useReviewStats.ts','./format':'source/format.ts','@/lib/format':'source/format.ts','@/hooks/useViewport':'source/useViewport.ts','@/hooks/useResolvedViewport':'viewport-candidate/useResolvedViewport.ts','@/lib/notes/ranking-context':'source/ranking-context.ts','@/lib/queries':'source/queries.ts','./MobileRankingView':'source/ranking-mobile.tsx','./MobileReviewsView':'source/reviews-mobile.tsx'};
 function load(path){if(cache[path])return cache[path];const exports={};cache[path]=exports;const source=readSource(variant==='source'?path:path.replace(/^source\//,'current/'));const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInNewContext(js,{exports,require(id){if(id in modules)return modules[id];if(id in paths){const result=load(paths[id]);if(id==='@/lib/queries')return new Proxy(result,{get(t,k){if(typeof t[k]!=='function')return t[k];return(...args)=>{helpers.push({name:k,args});effects.push('fetch:'+k);return t[k](...args)}}});return result;}if(id.startsWith('@/components/')||id==='@/lib/excel-export')return inert;throw new Error('Unstubbed module '+id)},console,window:browser,document:{addEventListener(){},removeEventListener(){}},localStorage,URLSearchParams,process:{env:{}},Intl,Date:FixedDate,Set,Map,setTimeout,clearTimeout,CustomEvent:function(){},IntersectionObserver:class{observe(){}disconnect(){}},AbortController},{filename:path});return exports;}
 const page=load(`${variant}/${route}-page.tsx`).default;
 return{page,helpers,requests,effects,listeners,storage,media,change(value){media.matches=value;for(const fn of [...listeners])fn({matches:value})},setSearch(value){search=value},rankingRequests:()=>requests.filter(r=>r.table==='ranking_snapshots').length};
}
async function flush(){for(let i=0;i<8;i++)await Promise.resolve();}
async function mount(f,strict=false){let root;await act(async()=>{root=Renderer.create(React.createElement(strict?React.StrictMode:React.Fragment,null,React.createElement(f.page)));await flush()});return root;}
async function unmount(root){await act(async()=>{root.unmount();await flush()});}
(async()=>{
 const results=[];
 for(const mobile of [false,true])for(const route of ['ranking','reviews']){
  const f=createFixture('viewport-candidate',mobile,route);const html=SSR.renderToString(React.createElement(f.page));assert.match(html,/role="status"/);assert.equal(f.helpers.length,0);assert.equal(f.listeners.size,0);if(route==='reviews')assert.match(html,/href="\/reviews\/weekly"/);
  // React 19 commits asynchronously. Observe the pending host tree at the first
  // Profiler commit, before passive viewport resolution starts any data reads.
  let initial;const commits=[];
  await act(async()=>{initial=Renderer.create(React.createElement(React.Profiler,{id:'viewport',onRender(){commits.push({tree:initial.toJSON(),helperCount:f.helpers.length})}},React.createElement(f.page)));await flush()});
  assert.equal(commits[0].helperCount,0);assert.match(JSON.stringify(commits[0].tree),/status/);
  assert.equal(f.listeners.size,1);if(mobile){assert.equal(f.helpers.filter(h=>h.name==='fetchBrandOptions').length,0);assert.equal(f.helpers.filter(h=>h.name==='fetchReviewStats').length,0)}
  assert.ok(f.effects.indexOf('resolve-viewport')<f.effects.findIndex(x=>x.startsWith('fetch:')));
  if(route==='ranking')assert.equal(f.rankingRequests(),mobile?3:91);
  if(route==='reviews')assert.equal(initial.root.findAll(x=>x.type==='a' && x.props.href==='/reviews/weekly').length,1);
  results.push({case:`SSR/initial/resolved ${route} ${mobile?'mobile':'desktop'}`,helperCalls:f.helpers.map(h=>h.name),rankingQueryDispatches:f.rankingRequests()});await unmount(initial);assert.equal(f.listeners.size,0);
 }
 for(const route of ['ranking','reviews']){
  const f=createFixture('viewport-candidate',true,route);let root;
  await act(async()=>{root=Renderer.create(React.createElement(f.page));root.unmount();await flush()});
  assert.equal(f.helpers.length,0);assert.equal(f.listeners.size,0);results.push({case:`unmount before first effect ${route}`,helperCalls:0,listenerLeaks:0});
 }
 for(const variant of ['source','viewport-candidate']){
  const f=createFixture(variant,true);const root=await mount(f);assert.equal(f.rankingRequests(),variant==='source'?94:3);results.push({case:`real mobile ranking ${variant}`,rankingQueryDispatches:f.rankingRequests(),helperCalls:f.helpers.map(h=>h.name)});await unmount(root);
 }
 for(const tab of ['dash','browse','product-browse','anomaly'])for(const variant of ['source','viewport-candidate']){
  const f=createFixture(variant,true,'reviews','',tab);const root=await mount(f);if(variant==='viewport-candidate')assert.deepEqual(f.helpers.map(h=>h.name),['fetchOwnBrands','fetchReviews']);else assert.ok(f.helpers.length>2);results.push({case:`mobile reviews ${variant} persisted ${tab}`,helperCalls:f.helpers.map(h=>h.name),queryDispatches:f.requests.length});await unmount(root);
 }
 for(const search of ['context=invalid','note=abc','notes=open','age=AGE_BAND_ALL','category=001','gender=M','period=90d','period=7d&category=001&gender=M&age=AGE_BAND_ALL']){
  const f=createFixture('viewport-candidate',true,'ranking',search);const root=await mount(f);assert.equal(root.root.findAll(x=>x.type.name==='MobileRankingView').length,0);const desktop=root.root.find(x=>x.type.name==='RankingDesktopView');assert.equal(desktop.props.compact,true);assert.ok(f.helpers.some(h=>h.name==='fetchBrandOptions'));results.push({case:'mobile source link '+search,compactDesktop:true});await unmount(root);
 }
 for(const route of ['ranking','reviews']){
  const f=createFixture('viewport-candidate',true,route);let root=await mount(f,true);assert.equal(f.listeners.size,1);await act(async()=>{f.change(false);await flush()});assert.equal(f.listeners.size,1);await act(async()=>{f.change(true);await flush()});assert.equal(f.listeners.size,1);await unmount(root);assert.equal(f.listeners.size,0);const count=f.helpers.length;f.change(false);await flush();assert.equal(f.helpers.length,count);root=await mount(f,true);assert.equal(f.listeners.size,1);await unmount(root);assert.equal(f.listeners.size,0);results.push({case:`StrictMode + resize + explicit cleanup/remount ${route}`,listenerLeaks:0});
 }
 const f=createFixture('viewport-candidate',true,'ranking','notes=open&period=7d&category=001&gender=M&age=AGE_BAND_ALL');const root=await mount(f);const before=f.helpers.filter(h=>h.name==='fetchLatestRanking').length;f.setSearch('period=7d&category=001&gender=M&age=AGE_BAND_ALL');await act(async()=>{root.update(React.createElement(React.Fragment,null,React.createElement(f.page)));await flush()});assert.equal(f.helpers.filter(h=>h.name==='fetchLatestRanking').length,before);await unmount(root);results.push({case:'remove notes parameter preserves filter subtree',extraRankingHelpers:0});
 console.log(JSON.stringify({react:React.version,reactDom:require('react-dom/package.json').version,renderer:require('react-test-renderer/package.json').version,classification:'Real React19 complete route mounts and real query functions with inert UI/service mocks; no browser/network/latency measurement. Test renderer StrictMode does not prove ReactDOM development StrictEffects replay; explicit remount also tested.',passed:results.length,results},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
