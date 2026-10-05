const test=require('node:test'),assert=require('node:assert/strict'),React=require('react'),Renderer=require('react-test-renderer');
const load=require('./helpers/load-source.cjs');global.IS_REACT_ACT_ENVIRONMENT=true;
const tick=()=>new Promise(r=>setImmediate(r));
function fixture({mobile=true,pending=false}={}){
 const saved=global.window,listeners=new Set(),authListeners=new Set(),calls=[],navigation=[];
 let path='/',owner='fixture-home-owner',identityReads=0,summaryReads=0,mode='ready';
 const media={matches:mobile,addEventListener(_,fn){listeners.add(fn)},removeEventListener(_,fn){listeners.delete(fn)}};
 global.window={matchMedia:()=>media};
 const sdk={auth:{getUser(){identityReads++;return Promise.resolve({data:{user:owner?{id:owner}:null}})},onAuthStateChange(fn){authListeners.add(fn);return{data:{subscription:{unsubscribe(){authListeners.delete(fn)}}}}}},from(table){
  assert.equal(table,'ranking_snapshots');const call={ops:[],owner,settled:false};
  const query=new Proxy({}, {get(_,method){if(method==='then')return(resolve,reject)=>{calls.push(call);return new Promise((yes,no)=>{call.resolve=value=>{call.settled=true;yes(value)};call.reject=no;if(!pending)call.resolve(response(call));}).then(resolve,reject)};return(...args)=>{call.ops.push([method,...args]);if(method==='abortSignal')call.signal=args[0];return query}}});return query;
 }};
 const select=c=>c.ops.find(x=>x[0]==='select')[1],eq=(c,key)=>c.ops.find(x=>x[0]==='eq'&&x[1]===key)?.[2];
 function response(c){
  const columns=select(c),daily=columns.includes('store_code');
  if(mode==='error'&&daily)return{data:null,error:{message:'fixture failure'}};
  if(columns==='snapshot_date'||columns==='snapshot_date,store_code')return{data:[{snapshot_date:'2026-10-05',store_code:'musinsa'}],error:null};
  const date=eq(c,'snapshot_date'),gender=eq(c,'gender_filter'),current=date==='2026-10-05';
  if(daily&&((mode==='missing-current'&&current)||(mode==='missing-previous'&&!current)))return{data:[],error:null};
  const row={store_code:'musinsa',snapshot_date:date,category_code:'000',gender_filter:gender,age_filter:'AGE_BAND_ALL',musinsa_no:'1',rank_position:current?1:10,product_name:'관측 '+gender+' 상품',brand_name:'fixture brand',final_price:10000,discount_rate:current?15:10,products:null};
  if(mode==='no-rise')row.rank_position=1;
  const rows=mode==='cap'&&daily?Array.from({length:1000},(_,i)=>({...row,musinsa_no:String(i+1)})):[row];
  if(mode==='partial'&&daily)rows.push({...row,musinsa_no:'2',store_code:'wrong-store'});
  return{data:rows,error:null};
 }
 const mocks={'next/navigation':{usePathname:()=>path,useRouter:()=>({push:href=>navigation.push(href)})},'next/link':{__esModule:true,default:p=>React.createElement('a',p)},'@/lib/supabase/client':{supabaseBrowser:()=>sdk},'./supabase/client':{supabaseBrowser:()=>sdk}};
 const queries=load('src/lib/queries.ts',mocks);
 mocks['@/lib/queries']={...queries,...Object.fromEntries(['fetchAnomalySignals','fetchOwnBrandBreakdown','fetchActivePromotions'].map(name=>[name,async()=>{summaryReads++;return[]}])) ,fetchReviewStats:async()=>{summaryReads++;return null}};
 mocks['@/lib/queries-ranking-daily']=load('src/lib/queries-ranking-daily.ts',mocks);
 const provider=load('src/components/ranking/RankingDailyProvider.tsx',mocks);mocks['./RankingDailyProvider']=provider;mocks['@/components/ranking/RankingDailyProvider']=provider;
 const Home=load('src/app/(app)/MobileHomeView.tsx',mocks).default,viewport=load('src/hooks/useViewport.ts',mocks);
 function App(){const isMobile=viewport.useIsMobile();return React.createElement(provider.default,null,path==='/'&&isMobile?React.createElement(Home):React.createElement('fixture-other-route'));}
 let root;
 return{calls,navigation,select,eq,response,async mount(){await React.act(async()=>{root=Renderer.create(React.createElement(App));await tick()});return root},get root(){return root},async resize(value){await React.act(async()=>{media.matches=value;for(const fn of listeners)fn({matches:value});await tick()})},async route(value){path=value;await React.act(async()=>{root.update(React.createElement(App));await tick()})},async auth(id){owner=id;await React.act(async()=>{for(const fn of authListeners)fn('SIGNED_IN',{user:{id}});await tick()})},async gender(value){await React.act(async()=>{root.root.find(x=>x.type.name==='MobileFilterChips').props.onChange(value);await tick()})},async resolveAll(next='ready'){mode=next;await React.act(async()=>{for(let i=0;i<4;i++){for(const c of calls.filter(c=>!c.settled))c.resolve(response(c));await tick()}})},async refresh(){await React.act(async()=>{root.root.findAllByType('button').find(x=>x.props.children==='다시 조회').props.onClick();await tick()})},setMode(value){mode=value},text(){return JSON.stringify(root.toJSON())},articles(){return root.root.findAllByType('article')},get identityReads(){return identityReads},get summaryReads(){return summaryReads},async close(){if(root)await React.act(async()=>root.unmount());if(saved===undefined)delete global.window;else global.window=saved}};
}

test('mobile home actual combined ranking budget is six; strict daily reads preserve scope, cap and pinned product/note routes',async()=>{
 const f=fixture();try{await f.mount();assert.equal(f.calls.length,6);assert.equal(f.summaryReads,4);assert.equal(f.articles().length,1);
  const daily=f.calls.filter(c=>f.select(c).includes('store_code'));assert.equal(daily.length,3);
  for(const c of daily){assert.equal(f.eq(c,'store_code'),'musinsa');assert.equal(f.eq(c,'category_code'),'000');assert.equal(f.eq(c,'gender_filter'),'A');assert.equal(f.eq(c,'age_filter'),'AGE_BAND_ALL');assert.equal(c.ops.find(x=>x[0]==='limit')[1],f.select(c)==='snapshot_date,store_code'?1:1000)}
  const links=f.root.root.findAllByType('a'),note=links.find(x=>x.props.children==='이 관측 메모').props.href,product=f.articles()[0].findByType('a').props.href;
  const q=new URL(note,'https://fixture.invalid').searchParams;assert.equal(q.get('notes'),'open');assert.equal(q.get('resolvedFromDate'),'2026-10-05');assert.equal(q.get('resolvedToDate'),'2026-10-05');assert.equal(q.get('gender'),'A');
  const p=new URL(product,'https://fixture.invalid').searchParams;assert.equal(p.get('date'),'2026-10-05');assert.equal(p.get('gender'),'A');assert.equal(p.get('back'),note);
 }finally{await f.close()}
});

test('desktop home performs no mobile identity/daily reads; entering/leaving mobile and other routes cancels owned work',async()=>{
 const f=fixture({mobile:false,pending:true});try{await f.mount();assert.equal(f.calls.length,0);assert.equal(f.identityReads,0);await f.resize(true);assert.equal(f.calls.length,2);assert.equal(f.identityReads,1);
  await f.resize(false);assert.ok(f.calls.every(c=>c.signal.aborted));await f.resolveAll();assert.equal(f.calls.length,2);await f.resize(true);assert.equal(f.calls.length,4);await f.route('/product');assert.ok(f.calls.every(c=>c.signal.aborted));
 }finally{await f.close()}
});

test('mobile home rapid gender changes reject late top10/daily results and retain only selected cohort',async()=>{
 const f=fixture({pending:true});try{await f.mount();await f.gender('M');await f.gender('F');assert.equal(f.calls.length,6);assert.ok(f.calls.slice(0,4).every(c=>c.signal.aborted));assert.equal(f.articles().length,0);await f.resolveAll();assert.equal(f.calls.length,10);assert.equal(f.articles().length,1);assert.ok(f.text().includes('관측 F 상품'));assert.ok(!f.text().includes('관측 M 상품'));assert.ok(!f.text().includes('관측 A 상품'));assert.ok(f.text().includes('gender=F'));
 }finally{await f.close()}
});

test('mobile home error is explicit and manual retry recovers without rerunning top10 or home summaries',async()=>{
 const f=fixture();try{f.setMode('error');await f.mount();assert.ok(f.text().includes('조회에 실패했습니다'));assert.equal(f.articles().length,0);assert.equal(f.calls.length,4);f.setMode('ready');await f.refresh();assert.equal(f.calls.length,7);assert.equal(f.summaryReads,4);assert.equal(f.articles().length,1);
 }finally{await f.close()}
});

for(const [mode,text]of [['missing-current','선택한 구간·날짜의 관측이 없습니다'],['missing-previous','직전 달력 날짜의 관측이 없어'],['no-rise','순위 상승이 없습니다'],['cap','조회 상한에 도달해'],['partial','판별 불가/중복']])test('mobile home daily '+mode+' remains distinct',async()=>{
 const f=fixture();try{f.setMode(mode);await f.mount();assert.ok(f.text().includes(text));assert.equal(f.calls.length,6);assert.equal(f.articles().length,mode==='partial'?1:0)}finally{await f.close()}
});

test('mobile home account epoch discards pending prior identity results',async()=>{
 const f=fixture({pending:true});try{await f.mount();const old=f.calls.find(c=>f.select(c).includes('store_code'));await f.auth('other-fixture-owner');assert.equal(old.signal.aborted,true);await f.resolveAll();assert.equal(f.articles().length,1);const latest=f.calls.filter(c=>f.select(c).includes('store_code'));assert.ok(latest.slice(1).every(c=>c.owner==='other-fixture-owner'))}finally{await f.close()}
});
