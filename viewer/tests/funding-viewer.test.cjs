const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), Renderer = require('react-test-renderer');
const load = require('./helpers/load-source.cjs');
const { AuthSessionMissingError } = require('@supabase/supabase-js');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const originalFetch = global.fetch;
test.before(() => { global.fetch = async () => assert.fail('QA external network forbidden'); });
test.after(() => { global.fetch = originalFetch; });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const row = (company='a') => ({ id:company+'-round', company_id:company, investors:[], source_type:'news', round_type:company+' timeline', amount_krw:1, announced_date:'2026-01-01', confidence:null });
const job = (company='a', id='j1', status='running') => ({ id, company_id:company, status, requested_by:'owner', rounds_found:2, error:null });
function sdkFixture() {
  const listeners=new Set(), calls=[], plans=[]; let user='owner', authResult=null;
  const sdk={ auth:{
    getUser:async()=>authResult ?? {data:{user:user?{id:user}:null},error:null},
    onAuthStateChange(fn){listeners.add(fn);return {data:{subscription:{unsubscribe(){listeners.delete(fn);}}}};},
  }, from(table){
    const call={table,filters:{},write:false};
    const q={select(){return q;},eq(k,v){call.filters[k]=v;return q;},order(){return q;},limit(){return q;},abortSignal(signal){call.signal=signal;return q;},insert(){throw Error('QA database write forbidden');},
      maybeSingle(){return execute();}, then(a,b){return execute().then(a,b);} };
    function execute(){calls.push(call);const index=plans.findIndex(p=>!p?.table||p.table===table);const p=index<0?null:plans.splice(index,1)[0];if(p)return Promise.resolve(p.table?p.result:typeof p==='function'?p(call):p);return Promise.resolve({data:table==='funding_rounds'?[row(call.filters.company_id)]:null,error:null});}
    return q;
  }};
  return { sdk,calls,plans,listeners,auth(id){user=id;for(const fn of listeners)fn(id?'SIGNED_IN':'SIGNED_OUT',id?{user:{id}}:null);},authError(){authResult={data:{user:null},error:{message:'inert'}};},authOK(){authResult=null;} };
}
function fixture() {
  const f=sdkFixture(), client={supabaseBrowser:()=>f.sdk};
  const mocks={'@/lib/supabase/client':client,'./supabase/client':client};
  const {useFundingRounds}=load('src/components/uttu/use-funding-rounds.ts',mocks);
  const {FundingRoundsView}=load('src/components/uttu/funding-rounds-view.tsx',mocks);
  let state;
  function View({company='a'}) { state=useFundingRounds(company);return React.createElement(FundingRoundsView,{funding:state}); }
  return {...f,View,state:()=>state};
}
const act = fn => React.act(fn);
const text = root => JSON.stringify(root.toJSON());
const button = (root,label) => root.root.findAllByType('button').find(n=>n.children.join('')===label);

test('actual readers distinguish errors from empty and poll exact company/job',async()=>{
  const f=sdkFixture(), q=load('src/lib/queries-funding.ts',{'./supabase/client':{supabaseBrowser:()=>f.sdk}});
  f.plans.push({data:null,error:{code:'403'}});await assert.rejects(q.getFundingRounds('a'));
  f.plans.push({data:[],error:null});assert.deepEqual(await q.getFundingRounds('a'),[]);
  for(const data of [null,{},[row('other')]]){f.plans.push({data,error:null});await assert.rejects(q.getFundingRounds('a'));}
  f.plans.push({data:null,error:{code:'401'}});await assert.rejects(q.getLatestFundingJob('a'));
  f.plans.push({data:null,error:null});assert.equal(await q.getLatestFundingJob('a'),null);
  f.plans.push({data:job(),error:null});await q.pollFundingJob('a','j1');assert.deepEqual(f.calls.at(-1).filters,{company_id:'a',id:'j1'});
  f.plans.push(Promise.reject(Error('transport')));await assert.rejects(q.pollFundingJob('a','j1'));
  for(const data of [undefined,job('other'),job('a','wrong'),job('a','j1','unknown')]){f.plans.push({data,error:null});await assert.rejects(q.pollFundingJob('a','j1'));}
});
test('initial failure has retry, valid empty is distinct, retry is single flight',async()=>{
  const f=fixture();f.plans.push({data:null,error:{code:'403'}});let root;
  try{
    await act(async()=>{root=Renderer.create(React.createElement(f.View));});
    assert.match(text(root),/불러오지 못했습니다/);assert.doesNotMatch(text(root),/수집된 투자정보가 없습니다/);
    const retry=button(root,'투자정보 다시 조회');
    const pending=deferred();f.plans.push(pending.promise);
    await act(async()=>{void f.state().refresh();void f.state().refresh();});assert.equal(f.calls.length,2);
    assert.equal(button(root,'투자정보 다시 조회'),retry);assert.equal(retry.props['aria-disabled'],true);
    await act(async()=>pending.resolve({data:[],error:null}));assert.match(text(root),/수집된 투자정보가 없습니다/);assert.doesNotMatch(text(root),/불러오지 못했습니다/);
    assert.equal(button(root,'투자정보 다시 조회'),retry);assert.equal(retry.props['aria-disabled'],false);
  }finally{await act(async()=>root?.unmount());assert.equal(f.listeners.size,0);}
});
test('same-company refresh failure retains last good data; successful empty replaces it',async()=>{
  const f=fixture();let root;
  try{
    await act(async()=>{root=Renderer.create(React.createElement(f.View));});assert.match(text(root),/a timeline/);
    f.plans.push({data:null,error:{code:'500'}});await act(async()=>f.state().refresh());
    assert.match(text(root),/a timeline/);assert.match(text(root),/이전에 조회한/);
    f.plans.push({data:[],error:null});await act(async()=>button(root,'투자정보 다시 조회').props.onClick());
    assert.doesNotMatch(text(root),/a timeline/);assert.match(text(root),/수집된 투자정보가 없습니다/);
  }finally{await act(async()=>root?.unmount());}
});
test('company changes mask previous data immediately and reject late success/error/finally',async()=>{
  for(const outcome of ['success','error','reject']){
    const f=fixture();let root;const old=deferred(),next=deferred();
    try{
      await act(async()=>{root=Renderer.create(React.createElement(f.View));});
      f.plans.push(old.promise);await act(async()=>{void f.state().refresh();});
      f.plans.push(next.promise);await act(async()=>root.update(React.createElement(f.View,{company:'b'})));
      assert.doesNotMatch(text(root),/a timeline/);assert.equal(f.state().loading,true);
      await act(async()=> outcome==='reject'?old.reject(Error('late')):old.resolve(outcome==='error'?{data:null,error:{code:'500'}}:{data:[row('a')],error:null}));
      assert.doesNotMatch(text(root),/a timeline|이전에 조회한/);assert.equal(f.state().loading,true);assert.equal(f.state().error,false);
      await act(async()=>next.resolve({data:[row('b')],error:null}));assert.match(text(root),/b timeline/);
    }finally{await act(async()=>root?.unmount());}
  }
});
test('identity changes clear retained data and late requests; unmount detaches auth',async()=>{
  const f=fixture();let root;const old=deferred();
  try{
    await act(async()=>{root=Renderer.create(React.createElement(f.View));});f.plans.push(old.promise);await act(async()=>{void f.state().refresh();});
    await act(async()=>f.auth(null));assert.doesNotMatch(text(root),/a timeline/);assert.match(text(root),/로그인 후/);
    f.plans.push({data:[],error:null});await act(async()=>f.auth('other'));assert.match(text(root),/수집된 투자정보가 없습니다/);
    await act(async()=>old.resolve({data:[row()],error:null}));assert.doesNotMatch(text(root),/a timeline/);
    const last=deferred();f.plans.push(last.promise);await act(async()=>{void f.state().refresh();});await act(async()=>root.unmount());root=null;
    await act(async()=>last.reject(Error('unmounted')));assert.equal(f.listeners.size,0);
  }finally{await act(async()=>root?.unmount());}
});
test('auth lookup failure offers a bounded read-only retry',async()=>{
  const f=fixture();f.authError();let root;
  try{
    await act(async()=>{root=Renderer.create(React.createElement(f.View));});assert.match(text(root),/불러오지 못했습니다/);assert.equal(f.calls.length,0);
    f.authOK();await act(async()=>button(root,'투자정보 다시 조회').props.onClick());assert.match(text(root),/a timeline/);assert.equal(f.calls.length,1);
  }finally{await act(async()=>root?.unmount());}
});
test('genuine missing session is signed-out, while auth transport failure remains retryable',async()=>{
  const f=fixture();f.sdk.auth.getUser=async()=>({data:{user:null},error:new AuthSessionMissingError()});let root;
  try{
    await act(async()=>{root=Renderer.create(React.createElement(f.View));});
    assert.match(text(root),/로그인 후/);assert.doesNotMatch(text(root),/불러오지 못했습니다|다시 조회/);assert.equal(f.calls.length,0);
  }finally{await act(async()=>root?.unmount());assert.equal(f.listeners.size,0);}
});
test('exact job completion supersedes the pending pre-completion timeline snapshot',async()=>{
  const f=sdkFixture(),client={supabaseBrowser:()=>f.sdk},mocks={'@/lib/supabase/client':client,'./supabase/client':client};
  const {useFundingRounds}=load('src/components/uttu/use-funding-rounds.ts',mocks);
  const {FundingCollectButton}=load('src/components/uttu/funding-collect-button.tsx',mocks);
  const {FundingRoundsView}=load('src/components/uttu/funding-rounds-view.tsx',mocks);
  const old=deferred(),fresh=deferred(),timers=new Map();let id=0,root,state;
  const saved={setTimeout:global.setTimeout,clearTimeout:global.clearTimeout};
  global.setTimeout=(fn,delay)=>{timers.set(++id,{fn,delay});return id;};global.clearTimeout=id=>timers.delete(id);
  function View(){state=useFundingRounds('a');return React.createElement(React.Fragment,null,
    React.createElement(FundingCollectButton,{companyId:'a',fundingLastCollectedAt:null,onDone:state.refreshAfterJob}),
    React.createElement(FundingRoundsView,{funding:state}));}
  try{
    f.plans.push({table:'funding_rounds',result:old.promise},{table:'funding_collection_jobs',result:{data:job(),error:null}});
    await act(async()=>{root=Renderer.create(React.createElement(View));});assert.equal([...timers.values()].filter(t=>t.delay===4000).length,1);
    f.plans.push({table:'funding_collection_jobs',result:{data:job('a','j1','done'),error:null}},{table:'funding_rounds',result:fresh.promise});
    const [timer,{fn}]=[...timers.entries()].find(([,t])=>t.delay===4000);timers.delete(timer);await act(async()=>fn());
    assert.equal(f.calls.filter(c=>c.table==='funding_rounds').length,2);assert.deepEqual(f.calls.find(c=>c.filters.id==='j1').filters,{company_id:'a',id:'j1'});
    await act(async()=>old.resolve({data:[{...row(),round_type:'obsolete snapshot'}],error:null}));
    assert.equal(state.loaded,false);assert.equal(state.loading,true);assert.doesNotMatch(text(root),/obsolete snapshot/);
    await act(async()=>fresh.resolve({data:[{...row(),round_type:'post-completion snapshot'}],error:null}));
    assert.match(text(root),/post-completion snapshot/);assert.doesNotMatch(text(root),/obsolete snapshot/);assert.equal(state.loading,false);
  }finally{await act(async()=>root?.unmount());Object.assign(global,saved);assert.equal(timers.size,0);assert.equal(f.listeners.size,0);}
});

test('initial session cannot hide failed verification; newer auth event beats delayed getUser',async()=>{
  const f=sdkFixture(), old=deferred();f.sdk.auth.getUser=()=>old.promise;
  const client={supabaseBrowser:()=>f.sdk};const {useFundingRounds}=load('src/components/uttu/use-funding-rounds.ts',{'@/lib/supabase/client':client,'./supabase/client':client});let state,root;
  function View(){state=useFundingRounds('a');return null;}
  try{
    await act(async()=>{root=Renderer.create(React.createElement(View));});
    await act(async()=>{for(const fn of f.listeners)fn('INITIAL_SESSION',null);});assert.equal(f.calls.length,0);assert.equal(state.signedOut,false);
    await act(async()=>f.auth('new-owner'));assert.equal(f.calls.length,1);
    await act(async()=>old.resolve({data:{user:{id:'old-owner'}},error:null}));assert.equal(f.calls.length,1);assert.equal(state.loaded,true);
  }finally{await act(async()=>root?.unmount());}
});

for(const mobile of [false,true]) test(`actual ${mobile?'mobile':'desktop'} company integration isolates funding failure and retains only current company`,async()=>{
  const f=sdkFixture(),client={supabaseBrowser:()=>f.sdk};let company='a',root;const saved=global.window;
  global.window={dispatchEvent(){},matchMedia:()=>({matches:mobile,addEventListener(){},removeEventListener(){}})};
  const queries={CATEGORY_MAP:{},fetchCompanyInfo:async id=>({id,corp_name:id+' company',stock_code:null}),fetchCompanyBrands:async()=>[],fetchCompanyFinancials:async()=>[],fetchCompanyDisclosures:async()=>[],fetchChildCompanies:async()=>[]};
  const hidden={__esModule:true,default:()=>null};
  const mocks={'@/lib/supabase/client':client,'./supabase/client':client,'@/lib/queries':queries,
    '@/hooks/useViewport':{useIsMobile:()=>mobile},'next/navigation':{useSearchParams:()=>new URLSearchParams('id='+company),useRouter:()=>({push(){}})},
    '@/lib/queries-me':{fetchNoteCountForEntity:async()=>0,logView:async()=>{}},
    '@/components/me/NoteDrawer':{...hidden,useSourceNoteDrawer:()=>({noteDrawerOpen:false,setNoteDrawerOpen(){}}),SourceNoteFallback:()=>null},
    '@/components/me/BookmarkToggle':hidden,'@/components/uttu/funding-brief':{FundingBrief:()=>null},
    '@/components/ui/charts':{Line:()=>null,HorizBars:()=>null},recharts:{},
  };
  const Page=load('src/app/(app)/company/'+(mobile?'MobileCompanyDetailView.tsx':'page.tsx'),mocks).default;
  try{
    f.plans.push({table:'funding_rounds',result:{data:null,error:{code:'403'}}});
    await act(async()=>{root=Renderer.create(React.createElement(Page));});assert.match(text(root),/a company/);
    const tab=root.root.findAllByType('button').find(n=>n.children.includes('투자정보'));assert.ok(tab);await act(async()=>tab.props.onClick());
    assert.match(text(root),/불러오지 못했습니다/);assert.doesNotMatch(text(root),/수집된 투자정보가 없습니다/);
    await act(async()=>button(root,'투자정보 다시 조회').props.onClick());assert.match(text(root),/a timeline/);
    f.plans.push({table:'funding_rounds',result:{data:null,error:{code:'500'}}});await act(async()=>button(root,'투자정보 다시 조회').props.onClick());assert.match(text(root),/a timeline/);assert.match(text(root),/이전에 조회한/);
    const old=deferred();f.plans.push({table:'funding_rounds',result:old.promise});await act(async()=>{void button(root,'투자정보 다시 조회').props.onClick();});
    company='b';await act(async()=>root.update(React.createElement(Page)));assert.doesNotMatch(text(root),/a timeline/);assert.match(text(root),/b timeline/);
    await act(async()=>old.resolve({data:[row('a')],error:null}));assert.match(text(root),/b timeline/);assert.doesNotMatch(text(root),/a timeline/);
  }finally{await act(async()=>root?.unmount());assert.equal(f.listeners.size,0);if(saved===undefined)delete global.window;else global.window=saved;}
});

function controlFixture(){
  const f=sdkFixture(), reads=[], signals=[], timers=new Map(),deadlines=new Map();let timerId=0,done=0,createCount=0;
  const plans=[],creates=[];
  const reader=(company,id,signal)=>{reads.push({company,id});signals.push(signal);const p=plans.shift();return Promise.resolve(p===undefined?null:p);};
  const Control=load('src/components/uttu/funding-collect-button.tsx',{
    '@/lib/supabase/client':{supabaseBrowser:()=>f.sdk},
    '@/lib/queries-funding':{getLatestFundingJob:(c,s)=>reader(c,undefined,s),pollFundingJob:(c,id,s)=>reader(c,id,s),createFundingJob:()=>{createCount++;return Promise.resolve(creates.shift());}},
    '@/lib/format':{fmtDate:v=>v},
  }).FundingCollectButton;
  const saved={setTimeout:global.setTimeout,clearTimeout:global.clearTimeout};
  global.setTimeout=(fn,delay)=>{(delay===15000?deadlines:timers).set(++timerId,fn);return timerId;};global.clearTimeout=id=>{timers.delete(id);deadlines.delete(id);};
  return {...f,Control,reads,signals,plans,creates,timers,deadlines,props:(company='a')=>({companyId:company,fundingLastCollectedAt:null,onDone:()=>done++}),done:()=>done,createsCount:()=>createCount,
    async expire(){const [id,fn]=deadlines.entries().next().value??[];assert.ok(fn,'expected deadline');deadlines.delete(id);await act(async()=>fn());},
    async tick(){const [id,fn]=timers.entries().next().value??[];assert.ok(fn,'expected bounded timer');timers.delete(id);await act(async()=>fn());},restore(){Object.assign(global,saved);} };
}
test('actual control polls the restored exact job, pauses on error, retry reads only and completes once',async()=>{
  const f=controlFixture();let root;
  try{
    f.plans.push(job());await act(async()=>{root=Renderer.create(React.createElement(f.Control,f.props()));});assert.equal(f.timers.size,1);
    f.plans.push(Promise.reject(Error('offline')));await f.tick();assert.equal(f.timers.size,0);assert.match(text(root),/확인하지 못했습니다/);
    f.plans.push(job('a','j1','done'));await act(async()=>button(root,'수집 상태 다시 조회').props.onClick());
    assert.deepEqual(f.reads.at(-1),{company:'a',id:'j1'});assert.equal(f.done(),1);assert.equal(f.createsCount(),0);assert.equal(f.timers.size,0);
  }finally{await act(async()=>root?.unmount());f.restore();assert.equal(f.listeners.size,0);}
});
test('control ignores previous company/job success, error and finally while active job remains pending',async()=>{
  for(const outcome of ['done','error']){
    const f=controlFixture();let root;const old=deferred(),next=deferred();
    try{
      f.plans.push(job());await act(async()=>{root=Renderer.create(React.createElement(f.Control,f.props()));});
      f.plans.push(old.promise);await f.tick();
      f.plans.push(next.promise);await act(async()=>root.update(React.createElement(f.Control,f.props('b'))));
      await act(async()=>outcome==='error'?old.reject(Error('late')):old.resolve(job('a','j1','done')));
      assert.equal(button(root,'투자정보 수집').props.disabled,true);assert.equal(f.timers.size,0);
      await act(async()=>next.resolve(job('b','j2')));
      assert.equal(f.done(),0);assert.doesNotMatch(text(root),/완료|확인하지 못했습니다/);assert.equal(f.timers.size,1);
      f.plans.push(job('b','j2','failed'));await f.tick();assert.deepEqual(f.reads.at(-1),{company:'b',id:'j2'});assert.equal(f.done(),0);assert.match(text(root),/실패/);
    }finally{await act(async()=>root?.unmount());assert.equal(f.timers.size,0);f.restore();}
  }
});
test('StrictMode cleanup permits a fresh status read and rejects the first delayed response',async()=>{
  const f=controlFixture();let root;const first=deferred();
  try{
    f.plans.push(first.promise,job());
    await act(async()=>{root=Renderer.create(React.createElement(React.StrictMode,null,React.createElement(f.Control,f.props())));});
    assert.equal(f.timers.size,1);assert.equal(f.reads.length,2);
    await act(async()=>first.resolve(job('a','j1','done')));assert.equal(f.done(),0);assert.equal(f.timers.size,1);
  }finally{await act(async()=>root?.unmount());assert.equal(f.timers.size,0);f.restore();}
});
test('control rejects mismatched job, bounds polling to 75 reads, and cancels on auth/unmount',async()=>{
  const f=controlFixture();let root;
  try{
    f.plans.push(job());await act(async()=>{root=Renderer.create(React.createElement(f.Control,f.props()));});
    f.plans.push(job('a','wrong','done'));await f.tick();assert.equal(f.done(),0);assert.equal(f.timers.size,0);
    f.plans.push(job());await act(async()=>button(root,'수집 상태 다시 조회').props.onClick());
    for(let i=0;i<74;i++){f.plans.push(job());await f.tick();}
    assert.equal(f.timers.size,0);assert.match(text(root),/状態|확인하지 못했습니다/);
    f.plans.push(job());await act(async()=>button(root,'수집 상태 다시 조회').props.onClick());assert.equal(f.timers.size,1);
    await act(async()=>f.auth(null));assert.equal(f.timers.size,0);assert.doesNotMatch(text(root),/수집 중…/);
    f.plans.push(job());await act(async()=>f.auth('other'));const last=deferred();f.plans.push(last.promise);await f.tick();
    await act(async()=>root.unmount());root=null;await act(async()=>last.resolve(job('a','j1','done')));assert.equal(f.done(),0);assert.equal(f.timers.size,0);
  }finally{await act(async()=>root?.unmount());f.restore();}
});
test('cached result is stored history, not new completion; create failure and late completion are inert',async()=>{
  const f=controlFixture();let root;
  try{
    await act(async()=>{root=Renderer.create(React.createElement(f.Control,f.props()));});
    f.creates.push({type:'cached',collectedAt:'2026-10-05'});await act(async()=>button(root,'투자정보 수집').props.onClick());
    assert.match(text(root),/저장된 최근 수집 기록/);assert.doesNotMatch(text(root),/7일 내 수집 완료/);assert.equal(f.done(),0);
    f.creates.push(Promise.reject(Error('inert create failure')));await act(async()=>button(root,'투자정보 수집').props.onClick());assert.equal(button(root,'투자정보 수집').props.disabled,false);
    const old=deferred();f.creates.push(old.promise);await act(async()=>{void button(root,'투자정보 수집').props.onClick();});
    f.plans.push(job('b','j2'));await act(async()=>root.update(React.createElement(f.Control,f.props('b'))));
    await act(async()=>old.resolve({type:'created',job:job()}));assert.equal(f.timers.size,1);assert.equal(f.done(),0);assert.doesNotMatch(text(root),/저장된 최근 수집 기록|처리하지 못했습니다/);
  }finally{await act(async()=>root?.unmount());f.restore();}
});
test('late create error/finally cannot clear active-company busy state, and auth changes cancel old create UI',async()=>{
  const f=controlFixture();let root;const old=deferred(),next=deferred();
  try{
    await act(async()=>{root=Renderer.create(React.createElement(f.Control,f.props()));});
    f.creates.push(old.promise);await act(async()=>{void button(root,'투자정보 수집').props.onClick();});
    f.plans.push(next.promise);await act(async()=>root.update(React.createElement(f.Control,f.props('b'))));
    await act(async()=>old.reject(Error('late create failure')));
    assert.equal(button(root,'투자정보 수집').props.disabled,true);assert.doesNotMatch(text(root),/처리하지 못했습니다/);
    await act(async()=>next.resolve(null));const authLate=deferred();f.creates.push(authLate.promise);
    await act(async()=>{void button(root,'투자정보 수집').props.onClick();});await act(async()=>f.auth(null));
    await act(async()=>authLate.resolve({type:'created',job:job('b','old-owner-job')}));
    assert.equal(f.timers.size,0);assert.equal(f.done(),0);assert.match(text(root),/로그인 후/);assert.doesNotMatch(text(root),/수집 중…/);
  }finally{await act(async()=>root?.unmount());f.restore();}
});


test('raw matched and conflicting observations remain separate records with non-round labels',async()=>{
  const f=sdkFixture(), q=load('src/lib/queries-funding.ts',{'./supabase/client':{supabaseBrowser:()=>f.sdk}});
  const {FundingTimeline}=load('src/components/uttu/funding-timeline.tsx');
  for(const amount of [1_000_000_000,9_000_000_000]){
    const records=[{...row(),id:'news',source_url:'https://fixture/news',amount_krw:amount},
      {...row(),id:'dart',source_type:'dart_piic',source_url:'https://fixture/dart',confidence:1,amount_krw:1_000_000_000}];
    f.plans.push({data:records,error:null});
    const observations=await q.getFundingRounds('a');assert.deepEqual(observations,records);
    let root;try{
      await act(async()=>{root=Renderer.create(React.createElement(FundingTimeline,{rounds:observations}));});
      const rendered=text(root);assert.match(rendered,/출처별 관측 기록/);
      assert.match(rendered,/같은 투자 라운드/);assert.match(rendered,/합산하지 않습니다/);
      assert.match(rendered,/충돌/);assert.match(rendered,/실패한 수집/);
      assert.equal(root.root.findAllByType('a').length,2);
      assert.equal((rendered.match(/출처 보고 금액/g)||[]).length,2);
      if(amount===9_000_000_000)assert.match(rendered,/90/);
    }finally{await act(async()=>root?.unmount());}
  }
});
test('done count denotes records and conflict status explains retained evidence and prior brief',async()=>{
  for(const status of ['done','failed']){
    const f=sdkFixture(),client={supabaseBrowser:()=>f.sdk};
    const {FundingCollectButton}=load('src/components/uttu/funding-collect-button.tsx',{'@/lib/supabase/client':client,'./supabase/client':client});
    f.plans.push({data:{...job('a','j1',status),error:status==='failed'?'funding_history_source_conflict':null},error:null});
    let root;try{
      await act(async()=>{root=Renderer.create(React.createElement(FundingCollectButton,{companyId:'a',fundingLastCollectedAt:null}));});
      const rendered=text(root);
      if(status==='done'){assert.match(rendered,/수집 기록/);assert.match(rendered,/라운드 수 아님/);assert.doesNotMatch(rendered,/건 수집됨/);}
      else{assert.match(rendered,/뉴스·공시 금액 충돌/);assert.match(rendered,/새 브리핑을 발행하지 않았습니다/);assert.match(rendered,/원본 출처 기록을 유지/);}
    }finally{await act(async()=>root?.unmount());assert.equal(f.listeners.size,0);}
  }
});
test('desktop and mobile section counts describe displayed source records, not economic rounds',()=>{
  const fs=require('node:fs'),path=require('node:path');
  for(const filename of ['page.tsx','MobileCompanyDetailView.tsx']){
    const source=fs.readFileSync(path.join(__dirname,'../src/app/(app)/company',filename),'utf8');
    assert.match(source,/투자 출처 기록/);assert.match(source,/표시 중/);assert.doesNotMatch(source,/투자 라운드 타임라인/);
  }
});
