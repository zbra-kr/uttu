const test=require('node:test'),assert=require('node:assert/strict'),React=require('react'),Renderer=require('react-test-renderer');
const load=require('./helpers/load-source.cjs'),SSR=require('react-dom/server');globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const inert=new Proxy({__esModule:true,default:()=>null},{get:(t,k)=>t[k]??(()=>null)});
function fixture({pending=false,lateIdentity=false}={}){
 const saved={window:global.window,document:global.document,localStorage:global.localStorage,IntersectionObserver:global.IntersectionObserver,now:Date.now};let clock=1000000,path='/ranking',search='period=today&category=000&gender=A&age=AGE_BAND_ALL',owner='account-a';
 const listeners=new Set(),authListeners=new Set(),calls=[],identityCalls=[];let unsubscribed=0;
 const media={matches:false,addEventListener(_event,fn){listeners.add(fn)},removeEventListener(_event,fn){listeners.delete(fn)}};
 global.window={matchMedia:()=>media,addEventListener(){},removeEventListener(){},dispatchEvent(){}};global.document={addEventListener(){},removeEventListener(){},documentElement:{setAttribute(){},style:{setProperty(){}}}};global.localStorage={getItem:()=>null,setItem(){}};global.IntersectionObserver=class{observe(){}disconnect(){}};Date.now=()=>clock;
 const sdk={auth:{getUser(){return lateIdentity?new Promise(resolve=>identityCalls.push(resolve)):Promise.resolve({data:{user:owner?{id:owner}:null}})},onAuthStateChange(fn){authListeners.add(fn);return{data:{subscription:{unsubscribe(){authListeners.delete(fn);unsubscribed++;}}}}}},from(table){const call={table,ops:[],owner};const query=new Proxy({}, {get(_,method){if(method==='then')return(resolve,reject)=>{calls.push(call);return new Promise((yes,no)=>{call.resolve=yes;call.reject=no;if(!pending)yes(response(call));}).then(resolve,reject)};return(...args)=>{call.ops.push([method,...args]);if(method==='abortSignal')call.signal=args[0];return query}}});return query;}};
 function response(call){const select=call.ops.find(x=>x[0]==='select')[1];if(select==='snapshot_date,store_code')return{data:[{snapshot_date:'2026-10-04',store_code:'musinsa'}],error:null};const eq=field=>call.ops.find(x=>x[0]==='eq'&&x[1]===field)?.[2],date=eq('snapshot_date');return{data:[{store_code:eq('store_code'),snapshot_date:date,category_code:eq('category_code'),gender_filter:eq('gender_filter'),age_filter:eq('age_filter'),musinsa_no:call.owner==='account-a'?'1':'2',rank_position:date==='2026-10-04'?1:10,product_name:call.owner+' observed product',brand_name:'fixture brand',final_price:10000,discount_rate:10,products:null}],error:null};}
 const router={push(href){search=new URL(href,'https://fixture.test').search.slice(1)},replace(href){search=new URL(href,'https://fixture.test').search.slice(1)}};
 const mocks={'next/navigation':{usePathname:()=>path,useSearchParams:()=>new URLSearchParams(search),useRouter:()=>router},'next/link':{__esModule:true,default:p=>React.createElement('a',p)},'@/lib/supabase/client':{supabaseBrowser:()=>sdk},'./supabase/client':{supabaseBrowser:()=>sdk},'@/lib/format':{kstToday:()=> '2026-10-04',kstDaysAgo:()=> '2026-10-04',fmtDateTime:()=>''},'@/lib/queries':{CATEGORY_MAP:{'000':'전체','001':'상의'},AGE_MAP:{AGE_BAND_ALL:'전체'},fetchShellStats:async()=>null,fetchLatestRanking:async()=>[],fetchBrandOptions:async()=>[],fetchCompanyOptions:async()=>[]},'@/lib/queries-me':{fetchNoteCountForEntity:async()=>0,logView:async()=>{}}};
 mocks['@/lib/queries-ranking-daily']=load('src/lib/queries-ranking-daily.ts',mocks);
 const provider=load('src/components/ranking/RankingDailyProvider.tsx',mocks);mocks['./RankingDailyProvider']=provider;mocks['@/components/ranking/RankingDailyProvider']=provider;
 const actualNoteHook=load('src/components/me/NoteDrawer.tsx',{...mocks,'./MentionAutocomplete':inert,'../ui/icons':inert}).useSourceNoteDrawer;mocks['@/components/me/NoteDrawer']={__esModule:true,default:p=>React.createElement('fixture-note-drawer',p),useSourceNoteDrawer:actualNoteHook};
 for(const id of ['@/components/ui/filters','@/components/ui/icons','@/components/me/SavedFiltersDropdown','@/components/mobile/MobileFilterChips','@/components/mobile/MobileBottomSheet','@/components/mobile/MobileEmptyState','@/components/mobile/MobileSegmentBadge','./Sidebar','./Topbar','./AiPanel','./CmdK'])mocks[id]=inert;
 mocks['./MobileShell']={__esModule:true,default:p=>React.createElement('fixture-mobile-shell',null,p.children)};mocks['@/components/onboarding/OnboardingProvider']={__esModule:true,default:p=>p.children,useOnboarding:()=>({active:false,step:0})};
 mocks['@/components/shell/ShellClient']={__esModule:true,default:load('src/components/shell/ShellClient.tsx',mocks).default};
 const Layout=load('src/app/(app)/layout.tsx',mocks).default,Page=load('src/app/(app)/ranking/page.tsx',mocks).default;
 function App(){return React.createElement(Layout,null,path==='/ranking'?React.createElement(Page):React.createElement('fixture-other-route'));}
 return{App,calls,identityCalls,response,setPending(value){pending=value},setClock(value){clock=value},setSearch(value){search=value},getSearch:()=>search,setPath(value){path=value},navigate(href){router.push(href)},auth(event,id){owner=id;for(const fn of [...authListeners])fn(event,id?{user:{id}}:null)},async resize(root,mobile){await React.act(async()=>{media.matches=mobile;for(const fn of [...listeners])fn({matches:mobile});});assert.equal(root.root.findAllByType('fixture-mobile-shell').length,mobile?1:0)},getUnsubscribed:()=>unsubscribed,restore(){Date.now=saved.now;for(const key of ['window','document','localStorage','IntersectionObserver']){if(saved[key]===undefined)delete global[key];else global[key]=saved[key];}}};
}
async function mount(f){let root;await React.act(async()=>{root=Renderer.create(React.createElement(f.App));});return root;}
async function update(f,root){await React.act(async()=>root.update(React.createElement(f.App)));}
async function cleanup(f,root){if(root)await React.act(async()=>root.unmount());f.restore();}
const articles=root=>root.root.findAllByType('article');
const noteLink=root=>root.root.findAllByType('a').find(x=>x.props.children==='이 관측 메모');
const drawer=root=>root.root.findByType('fixture-note-drawer').props;

test('refresh after settled REAL ShellClient resize replaces the observation in both shell directions',async()=>{
 const f=fixture();let root;try{root=await mount(f);
 for(const mobile of [true,false]){await f.resize(root,mobile);const before=f.calls.length;
 const refresh=root.root.findAllByType('button').find(x=>x.props.children==='다시 조회');
 await React.act(async()=>refresh.props.onClick());assert.equal(f.calls.length,before+3);assert.equal(articles(root).length,1);}
 }finally{await cleanup(f,root);}
});

test('refresh after pending REAL ShellClient resize aborts the previous request and ignores its late result',async()=>{
 const f=fixture({pending:true});let root;try{root=await mount(f);const old=f.calls[0];
 for(const mobile of [true,false])await f.resize(root,mobile);
 const refresh=root.root.findAllByType('button').find(x=>x.props.children==='다시 조회');
 await React.act(async()=>refresh.props.onClick());assert.equal(f.calls.length,2);assert.ok(old.signal.aborted);assert.equal(articles(root).length,0);
 await React.act(async()=>old.resolve(f.response(old)));assert.equal(f.calls.length,2);
 const fresh=f.calls[1];await React.act(async()=>fresh.resolve(f.response(fresh)));assert.equal(f.calls.length,4);
 await React.act(async()=>{for(const call of f.calls.slice(2))call.resolve(f.response(call));});assert.equal(articles(root).length,1);
 }finally{await cleanup(f,root);}
});

test('REAL ShellClient settled desktop/mobile remounts share exactly three strict reads for the same latest scope',async()=>{
 const f=fixture();let root;try{root=await mount(f);assert.equal(f.calls.length,3);assert.equal(articles(root).length,1);
 for(const mobile of [true,false,true,false]){await f.resize(root,mobile);assert.equal(f.calls.length,3);assert.equal(articles(root).length,1);}
 }finally{await cleanup(f,root);}assert.ok(f.getUnsubscribed()>0);
});
test('authenticated shell SSR is deterministic and reads neither identity nor ranking before mount',()=>{
 const f=fixture({lateIdentity:true});try{const first=SSR.renderToString(React.createElement(f.App)),second=SSR.renderToString(React.createElement(f.App));assert.equal(first,second);assert.equal(f.calls.length,0);assert.equal(f.identityCalls.length,0);}finally{f.restore();}
});
test('REAL ShellClient pending resize both ways retains the owned request through temporary null scopes',async()=>{
 const f=fixture({pending:true});let root;try{root=await mount(f);assert.equal(f.calls.length,1);const first=f.calls[0];for(const mobile of [true,false]){await f.resize(root,mobile);assert.equal(f.calls.length,1);assert.equal(first.signal.aborted,false);}
 await React.act(async()=>first.resolve(f.response(first)));assert.equal(f.calls.length,3);for(const mobile of [true,false]){await f.resize(root,mobile);assert.equal(f.calls.length,3);}
 await React.act(async()=>{for(const call of f.calls.slice(1))call.resolve(f.response(call));});assert.equal(articles(root).length,1);
 }finally{await cleanup(f,root);}
});
test('different scope replaces the single pending entry and ignores late A; returning to A performs a fresh read',async()=>{
 const f=fixture({pending:true});let root;try{root=await mount(f);const a=f.calls[0];f.setSearch('period=today&category=001&gender=M&age=AGE_BAND_ALL');await update(f,root);assert.equal(f.calls.length,2);assert.ok(a.signal.aborted);const b=f.calls[1];await React.act(async()=>a.resolve(f.response(a)));assert.equal(f.calls.length,2);assert.equal(noteLink(root),undefined);
 await React.act(async()=>b.resolve(f.response(b)));await React.act(async()=>{for(const call of f.calls.slice(2))call.resolve(f.response(call));});assert.equal(new URL(noteLink(root).props.href,'https://fixture.test').searchParams.get('category'),'001');
 f.setSearch('period=today&category=000&gender=A&age=AGE_BAND_ALL');await update(f,root);assert.equal(f.calls.length,5);assert.equal(f.calls.at(-1).ops.find(x=>x[0]==='eq'&&x[1]==='category_code')[2],'000');
 }finally{await cleanup(f,root);}
});
test('explicit refresh and freshness expiry acquire a new observation; a recent responsive remount does not',async()=>{
 const f=fixture();let root;try{root=await mount(f);assert.equal(f.calls.length,3);const refresh=root.root.findAllByType('button').find(x=>x.props.children==='다시 조회');await React.act(async()=>refresh.props.onClick());assert.equal(f.calls.length,6);
 f.setClock(1030000);await f.resize(root,true);assert.equal(f.calls.length,6);f.setClock(1060000);await f.resize(root,false);assert.equal(f.calls.length,9);
 }finally{await cleanup(f,root);}
});
test('observed account/session changes hide old results, sign-out aborts pending reads, and late getUser cannot restore an old account',async()=>{
 const f=fixture({pending:true,lateIdentity:true});let root;try{root=await mount(f);assert.equal(f.calls.length,0);await React.act(async()=>f.auth('SIGNED_IN','account-a'));assert.equal(f.calls.length,1);const a=f.calls[0];await React.act(async()=>f.auth('SIGNED_OUT',null));assert.ok(a.signal.aborted);assert.equal(articles(root).length,0);
 await React.act(async()=>f.identityCalls[0]({data:{user:{id:'account-a'}}}));assert.equal(f.calls.length,1);await React.act(async()=>a.resolve(f.response(a)));assert.equal(f.calls.length,1);
 f.setPending(false);await React.act(async()=>f.auth('SIGNED_IN','account-b'));assert.equal(f.calls.length,4);const productLink=articles(root)[0].findByType('a').props.href;assert.equal(new URL(productLink,'https://local.invalid').searchParams.get('no'),'2');assert.equal(new URL(productLink,'https://local.invalid').searchParams.get('obs'),'ranking-v1');await React.act(async()=>f.auth('USER_UPDATED','account-b'));assert.equal(f.calls.length,7);
 }finally{await cleanup(f,root);}
});
test('route exit and provider unmount abort pending work; re-entry never reuses the earlier route result',async()=>{
 const f=fixture({pending:true});let root;try{root=await mount(f);const first=f.calls[0];f.setPath('/me');await update(f,root);assert.ok(first.signal.aborted);await React.act(async()=>first.resolve(f.response(first)));assert.equal(f.calls.length,1);f.setPath('/ranking');await update(f,root);assert.equal(f.calls.length,2);const second=f.calls[1];await React.act(async()=>root.unmount());root=null;assert.ok(second.signal.aborted);await React.act(async()=>second.resolve(f.response(second)));assert.equal(f.calls.length,2);
 }finally{await cleanup(f,root);}
});
test('a failed observation remains distinct from missing data and retries on a new consumer instead of being cached indefinitely',async()=>{
 const f=fixture({pending:true});let root;try{root=await mount(f);await React.act(async()=>f.calls[0].reject(Error('fixture unavailable')));assert.equal(root.root.findAllByProps({role:'alert'}).length,1);assert.equal(articles(root).length,0);f.setPending(false);await f.resize(root,true);assert.equal(f.calls.length,4);assert.equal(articles(root).length,1);assert.equal(root.root.findAllByProps({role:'alert'}).length,0);}finally{await cleanup(f,root);}
});
test('REAL ShellClient pinned note replay/history uses two date reads once and retains them across Close, Back, Forward and resize',async()=>{
 const f=fixture();let root;try{root=await mount(f);assert.equal(f.calls.length,3);f.navigate(noteLink(root).props.href);await update(f,root);assert.equal(f.calls.length,5);assert.equal(drawer(root).sourceContext.resolvedToDate,'2026-10-04');assert.equal(drawer(root).open,true);const openSearch=f.getSearch();await React.act(async()=>drawer(root).onClose());await update(f,root);assert.equal(drawer(root).open,false);const closedSearch=f.getSearch();
 f.setSearch(openSearch);await update(f,root);assert.equal(drawer(root).open,true);await f.resize(root,true);assert.equal(drawer(root).open,true);f.setSearch(closedSearch);await update(f,root);assert.equal(drawer(root).open,false);await f.resize(root,false);assert.equal(f.calls.length,5);
 }finally{await cleanup(f,root);}
});
