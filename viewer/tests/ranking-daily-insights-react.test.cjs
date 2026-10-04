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

function noteRouteFixture({mobile=false,tableEmpty=false}={}){
 const f=fixture(),listeners=new Set(),media={matches:mobile,addEventListener(_event,fn){listeners.add(fn)},removeEventListener(_event,fn){listeners.delete(fn)}};
 const saved={window:global.window,document:global.document,localStorage:global.localStorage,IntersectionObserver:global.IntersectionObserver};let search='';const navigation=[];
 global.window={matchMedia:()=>media,addEventListener(){},removeEventListener(){},dispatchEvent(){}};global.document={addEventListener(){},removeEventListener(){}};global.localStorage={getItem:()=>null,setItem(){}};global.IntersectionObserver=class{observe(){}disconnect(){}};
 const router={push(href){navigation.push(href);search=new URL(href,'https://fixture.test').search.slice(1)},replace(href){navigation.push(href);search=new URL(href,'https://fixture.test').search.slice(1)}};
 const next={'next/navigation':{useSearchParams:()=>new URLSearchParams(search),usePathname:()=>'/ranking',useRouter:()=>router}};
 const actualHook=load('src/components/me/NoteDrawer.tsx',{...next,'@/lib/queries-me':{},'@/lib/supabase/client':{supabaseBrowser(){throw Error('Fixture must not read authentication')}},'./MentionAutocomplete':inert,'../ui/icons':inert,'@/lib/format':{fmtDateTime:()=>''}}).useSourceNoteDrawer;
 const tableCalls=[];const tableRow={...row(1,1,'2026-10-02',{categoryCode:'000',genderFilter:'A',ageFilter:'AGE_BAND_ALL'}),company_name:null,list_price:10000,is_sold_out:false,review_count:0,review_score:100,is_own:false,product_id:null,rank_change:null,thumbnail_url:null};
 const queries={...f.mocks['@/lib/queries'],fetchLatestRanking:async request=>{tableCalls.push(request);return tableEmpty||request.fromDate?[]:[tableRow]},fetchBrandOptions:async()=>[],fetchCompanyOptions:async()=>[]};
 const mocks={...f.mocks,...next,'@/lib/queries':queries,'@/lib/queries-me':{fetchNoteCountForEntity:async()=>0,logView:async()=>{}},'@/components/me/NoteDrawer':{__esModule:true,default:props=>React.createElement('fixture-note-drawer',props),useSourceNoteDrawer:actualHook}};
 for(const id of ['@/components/ui/filters','@/components/ui/icons','@/components/me/SavedFiltersDropdown','@/components/mobile/MobileFilterChips','@/components/mobile/MobileBottomSheet','@/components/mobile/MobileEmptyState','@/components/mobile/MobileSegmentBadge'])mocks[id]=inert;
 const Page=load('src/app/(app)/ranking/page.tsx',mocks).default;
 return{...f,Page,tableCalls,media,listeners,navigation,setSearch(value){search=value},getSearch:()=>search,navigate(href){router.push(href)},restore(){for(const[key,value]of Object.entries(saved)){if(value===undefined)delete global[key];else global[key]=value;}}};
}
const noteLink=root=>root.root.findAllByType('a').find(x=>x.props.children==='이 관측 메모');
const drawer=root=>root.root.findByType('fixture-note-drawer').props;

test('divergent latest table/insight dates keep ordinary notes on the table and explicit notes on strict pinned replay',async()=>{
 const f=noteRouteFixture();let root;
 try{root=await mount(f.Page,{});await React.act(async()=>f.calls[0].resolve(result(f.calls[0].request)));
 assert.equal(drawer(root).sourceContext.resolvedToDate,'2026-10-02');assert.equal(drawer(root).open,false);
 const generic=root.root.findAllByType('button').find(x=>x.props['data-tour']==='note-entry');await React.act(async()=>generic.props.onClick());assert.equal(drawer(root).open,true);assert.equal(drawer(root).sourceContext.resolvedToDate,'2026-10-02');await React.act(async()=>drawer(root).onClose());
 const href=noteLink(root).props.href;const query=new URL(href,'https://fixture.test').searchParams;assert.equal(query.get('resolvedToDate'),'2026-10-04');assert.equal(query.get('notes'),'open');assert.equal(query.get('category'),'000');
 f.navigate(href);await update(root,f.Page,{});assert.equal(f.calls.length,2);assert.equal(f.calls[1].request.date,'2026-10-04');assert.equal(drawer(root).open,true);assert.equal(drawer(root).sourceContext.resolvedToDate,'2026-10-04');assert.equal(drawer(root).saveBlockedReason,undefined);
 assert.equal(f.tableCalls.at(-1).fromDate,'2026-10-04');assert.equal(root.root.findAllByType('tbody').flatMap(x=>x.findAllByType('tr')).length,0);
 await React.act(async()=>f.calls[1].resolve(result(f.calls[1].request)));const settled=f.calls.length;
 await React.act(async()=>drawer(root).onClose());await update(root,f.Page,{});assert.equal(drawer(root).open,false);assert.equal(new URLSearchParams(f.getSearch()).get('resolvedToDate'),'2026-10-04');assert.equal(f.calls.length,settled);
 f.setSearch(query.toString());await update(root,f.Page,{});assert.equal(drawer(root).open,true);assert.equal(f.calls.length,settled); // Back
 query.delete('notes');f.setSearch(query.toString());await update(root,f.Page,{});assert.equal(drawer(root).open,false);assert.equal(f.calls.length,settled); // Forward
 }finally{if(root)await unmount(root);f.restore();}
});

test('empty table enrichment does not supply a latest table date but strict base observations still open an explicitly pinned note',async()=>{
 const f=noteRouteFixture({tableEmpty:true});let root;
 try{root=await mount(f.Page,{});assert.equal(drawer(root).sourceContext,undefined);assert.ok(drawer(root).saveBlockedReason);
 const observed=result(f.calls[0].request);observed.current[0].products=null;observed.previous[0].products=null;await React.act(async()=>f.calls[0].resolve(observed));
 assert.equal(drawer(root).sourceContext,undefined);f.navigate(noteLink(root).props.href);await update(root,f.Page,{});assert.equal(drawer(root).sourceContext.resolvedToDate,'2026-10-04');assert.equal(drawer(root).saveBlockedReason,undefined);assert.equal(drawer(root).open,true);
 }finally{if(root)await unmount(root);f.restore();}
});

test('native mobile insight note replay opens the existing compact source drawer with the strict date',async()=>{
 const f=noteRouteFixture({mobile:true,tableEmpty:true});let root;
 try{root=await mount(f.Page,{});assert.equal(root.root.findAllByType('fixture-note-drawer').length,0);await React.act(async()=>f.calls[0].resolve(result(f.calls[0].request)));
 f.navigate(noteLink(root).props.href);await update(root,f.Page,{});assert.equal(drawer(root).open,true);assert.equal(drawer(root).sourceContext.resolvedToDate,'2026-10-04');assert.equal(f.calls[1].request.date,'2026-10-04');assert.equal(drawer(root).saveBlockedReason,undefined);
 }finally{if(root)await unmount(root);f.restore();}
});

test('rapid source scopes cannot expose a stale insight note link or substitute a different segment',async()=>{
 const f=noteRouteFixture();let root;
 try{root=await mount(f.Page,{});const a=f.calls[0];f.setSearch('period=today&category=001&gender=M&age=AGE_BAND_ALL');await update(root,f.Page,{});const b=f.calls.at(-1);
 f.setSearch('period=today&category=002&gender=F&age=AGE_BAND_ALL');await update(root,f.Page,{});const c=f.calls.at(-1);assert.ok(a.signal.aborted&&b.signal.aborted);assert.equal(noteLink(root),undefined);
 await React.act(async()=>{a.resolve(result(a.request));b.resolve(result(b.request));});assert.equal(noteLink(root),undefined);await React.act(async()=>c.resolve(result(c.request)));
 const q=new URL(noteLink(root).props.href,'https://fixture.test').searchParams;assert.equal(q.get('category'),'002');assert.equal(q.get('gender'),'F');assert.equal(q.get('resolvedToDate'),'2026-10-04');
 }finally{if(root)await unmount(root);f.restore();}
});
