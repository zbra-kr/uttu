const test=require('node:test'),assert=require('node:assert/strict'),React=require('react'),Renderer=require('react-test-renderer'),SSR=require('react-dom/server');
const load=require('./helpers/load-source.cjs');globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const scope=patch=>({version:1,kind:'ranking',period:'today',fromDate:'',toDate:'',selectedCategory:'000',gender:'A',age:'AGE_BAND_ALL',price:[0,50],companies:[],brands:[],ownOnly:false,moverOnly:false,sort:'rank',sortDir:'asc',page:1,...patch});
const row=(product,rank,date,req)=>({store_code:'musinsa',snapshot_date:date,category_code:req.categoryCode,gender_filter:req.genderFilter,age_filter:req.ageFilter,musinsa_no:String(product),rank_position:rank,product_name:'fixture product '+product,brand_name:'fixture brand',final_price:10000,discount_rate:12});
const result=(req,patch={})=>({request:req,date:req.date||'2026-10-04',previousDate:'2026-10-03',current:[row(1,1,req.date||'2026-10-04',req)],previous:[row(1,10,'2026-10-03',req)],...patch});
const no=()=>null,inert=new Proxy({__esModule:true,default:no},{get:(t,k)=>t[k]??no});
function fixture(){const calls=[];const mocks={'@/lib/queries':{CATEGORY_MAP:{'000':'전체','001':'상의','002':'아우터'},AGE_MAP:{AGE_BAND_ALL:'전체'}},'@/lib/format':{kstDaysAgo:()=> '2026-10-04'},'next/link':{__esModule:true,default:props=>React.createElement('a',props)},'@/lib/queries-ranking-daily':{fetchRankingDaily:(request,signal)=>new Promise((resolve,reject)=>calls.push({request,signal,resolve,reject}))}};
 const module=load('src/components/ranking/RankingDailyInsights.tsx',mocks);
 function Harness({value,compact=false,drawer=false}){const state=module.useRankingDailyInsights(value);return React.createElement('fixture-load',{state,drawer},React.createElement(module.default,{scope:value,load:state,compact}));}
 return{...module,calls,Harness,mocks};}
async function mount(Component,props){let root;await React.act(async()=>{root=Renderer.create(React.createElement(Component,props));});return root;}
async function update(root,Component,props){await React.act(async()=>root.update(React.createElement(Component,props)));}
async function unmount(root){await React.act(async()=>root.unmount());}
const state=root=>root.root.findByType('fixture-load').props.state;

test('SSR/initial render is deterministic and performs no ranking queries',()=>{
 const f=fixture();const a=SSR.renderToString(React.createElement(f.Harness,{value:scope(),compact:false}));const b=SSR.renderToString(React.createElement(f.Harness,{value:scope(),compact:false}));assert.equal(a,b);assert.match(a,/role="status"/);assert.equal(f.calls.length,0);
});
test('actual hook rejects obsolete success/error, aborts on scope change, and never paints old data as new scope',async()=>{
 for(const late of ['success','error']){const f=fixture(),root=await mount(f.Harness,{value:scope()});assert.equal(f.calls.length,1);assert.equal(state(root).loading,true);
 await update(root,f.Harness,{value:scope({selectedCategory:'001'})});assert.equal(f.calls.length,2);assert.equal(f.calls[0].signal.aborted,true);assert.equal(state(root).data,null);
 await React.act(async()=>{if(late==='success')f.calls[0].resolve(result(f.calls[0].request));else f.calls[0].reject(new Error('obsolete'));});assert.equal(state(root).loading,true);assert.equal(state(root).error,false);
 await React.act(async()=>f.calls[1].resolve(result(f.calls[1].request)));assert.equal(state(root).data.request.categoryCode,'001');assert.equal(root.root.findAllByType('article').length,1);
 await unmount(root);assert.equal(f.calls[1].signal.aborted,true);}
});
test('display filters, drawer state and compact presentation do not refetch a settled core/date scope',async()=>{
 const f=fixture(),root=await mount(f.Harness,{value:scope()});await React.act(async()=>f.calls[0].resolve(result(f.calls[0].request)));
 await update(root,f.Harness,{value:scope({brands:['fixture brand']}),compact:true,drawer:true});assert.equal(f.calls.length,1);assert.equal(state(root).loading,false);
 await update(root,f.Harness,{value:scope({price:[1,50],sort:'reviews',page:2}),compact:false,drawer:false});assert.equal(f.calls.length,1);
 await update(root,f.Harness,{value:scope({resolvedFromDate:'2026-10-03',resolvedToDate:'2026-10-03'})});assert.equal(f.calls.length,2);assert.equal(f.calls[1].request.date,'2026-10-03');await unmount(root);
});
test('multi-day scopes issue no daily requests and stop an obsolete request',async()=>{
 const f=fixture(),root=await mount(f.Harness,{value:scope({period:'7d'})});assert.equal(f.calls.length,0);assert.equal(state(root),null);
 await update(root,f.Harness,{value:scope()});assert.equal(f.calls.length,1);await update(root,f.Harness,{value:scope({period:'custom',fromDate:'2026-10-01',toDate:'2026-10-04'})});assert.equal(state(root),null);assert.equal(f.calls[0].signal.aborted,true);
 await React.act(async()=>f.calls[0].resolve(result(f.calls[0].request)));assert.equal(state(root),null);await unmount(root);
});
test('error, missing-day, no-rise, cap and unknown metrics have distinct actual panel output',()=>{
 const f=fixture(),req={categoryCode:'000',genderFilter:'A',ageFilter:'AGE_BAND_ALL'};
 const html=(data,error=false)=>SSR.renderToString(React.createElement(f.default,{scope:scope(),compact:true,load:{key:'fixture',loading:false,data,error}}));
 assert.match(html(null,true),/role="alert"/);assert.match(html(result(req,{previous:[]})),/직전 달력 날짜/);
 assert.match(html(result(req,{current:[]})),/관측이 없습니다/);assert.match(html(result(req,{previous:[row(1,1,'2026-10-03',req)]})),/순위 상승이 없습니다/);
 assert.match(html(result(req,{current:Array.from({length:1000},()=>row(1,1,'2026-10-04',req))})),/조회 상한/);
 const unknown=result(req);unknown.current[0].final_price=null;unknown.current[0].discount_rate=null;const output=html(unknown);assert.match(output,/미확인/);assert.match(output,/퍼센트포인트/);assert.match(output,/2026-10-03/);assert.match(output,/2026-10-04/);
 assert.ok(!output.includes('NEW'));assert.match(output,/product\?no=1/);assert.match(output,/resolvedToDate=2026-10-04/);
});
test('actual route root retains the daily read across matching viewport changes and note URL open/close',async()=>{
 const f=fixture(),listeners=new Set(),media={matches:false,addEventListener(_event,fn){listeners.add(fn)},removeEventListener(_event,fn){listeners.delete(fn)}};
 const saved={window:global.window,document:global.document,localStorage:global.localStorage,IntersectionObserver:global.IntersectionObserver};let search='';
 global.window={matchMedia:()=>media,addEventListener(){},removeEventListener(){},dispatchEvent(){}};global.document={addEventListener(){},removeEventListener(){}};global.localStorage={getItem:()=>null,setItem(){}};global.IntersectionObserver=class{observe(){}disconnect(){}};
 const queries={...f.mocks['@/lib/queries'],fetchLatestRanking:async()=>[],fetchBrandOptions:async()=>[],fetchCompanyOptions:async()=>[]};
 const mocks={...f.mocks,'@/lib/queries':queries,'next/navigation':{useSearchParams:()=>new URLSearchParams(search),useRouter:()=>({push(){}})},'@/lib/queries-me':{fetchNoteCountForEntity:async()=>0,logView:async()=>{}},'@/components/me/NoteDrawer':{...inert,useSourceNoteDrawer:()=>({noteDrawerOpen:false,setNoteDrawerOpen(){}})}};
 for(const id of ['@/components/ui/filters','@/components/ui/icons','@/components/me/SavedFiltersDropdown','@/components/mobile/MobileFilterChips','@/components/mobile/MobileBottomSheet','@/components/mobile/MobileEmptyState','@/components/mobile/MobileSegmentBadge'])mocks[id]=inert;
 let root;
 try{const Page=load('src/app/(app)/ranking/page.tsx',mocks).default;root=await mount(Page,{});assert.equal(f.calls.length,1);await React.act(async()=>f.calls[0].resolve(result(f.calls[0].request)));
 for(const matches of [true,false,true]){await React.act(async()=>{media.matches=matches;for(const fn of [...listeners])fn({matches});});assert.equal(f.calls.length,1);}
 await unmount(root);root=null;
 search='period=today&category=000&gender=A&age=AGE_BAND_ALL&notes=open';root=await mount(Page,{});const count=f.calls.length;search='period=today&category=000&gender=A&age=AGE_BAND_ALL';await update(root,Page,{});assert.equal(f.calls.length,count);
 }finally{if(root)await unmount(root);for(const [key,value]of Object.entries(saved)){if(value===undefined)delete global[key];else global[key]=value;}}
});
