const test=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),Renderer=require('react-test-renderer'),load=require('./helpers/load-source.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const act=fn=>React.act(fn),text=root=>JSON.stringify(root.toJSON());
const button=(root,label)=>root.root.findAllByType('button').find(n=>n.children.join('')===label);
const row=(company,label=company+' timeline')=>({id:company+'-round',company_id:company,round_type:label,investors:[],source_type:'news',confidence:null});
const job=(company,id='j1',status='running')=>({id,company_id:company,status,rounds_found:2,error:null});
const originalFetch=global.fetch;
test.before(()=>{global.fetch=async()=>assert.fail('QA network forbidden');});test.after(()=>{global.fetch=originalFetch;});
function fixture(){
  const calls=[],plans=[],listeners=new Set(),timers=new Map();let serial=0,owner='owner',authPlan=null;
  const saved={setTimeout:global.setTimeout,clearTimeout:global.clearTimeout};
  global.setTimeout=(fn,delay)=>{timers.set(++serial,{fn,delay});return serial;};global.clearTimeout=id=>timers.delete(id);
  const sdk={auth:{getUser:()=>authPlan??Promise.resolve({data:{user:owner?{id:owner}:null},error:null}),onAuthStateChange(fn){listeners.add(fn);return {data:{subscription:{unsubscribe(){listeners.delete(fn);}}}};}},from(table){
    const call={table,filters:{},signal:null};const q={select(){return q;},eq(k,v){call.filters[k]=v;return q;},order(){return q;},limit(){return q;},abortSignal(signal){call.signal=signal;return q;},insert(){assert.fail('QA write forbidden');},maybeSingle(){return execute();},then(a,b){return execute().then(a,b);}};
    function execute(){calls.push(call);const index=plans.findIndex(p=>p.table===table);const p=index<0?null:plans.splice(index,1)[0];return p?p.promise:Promise.resolve({data:table==='funding_rounds'?[row(call.filters.company_id)]:null,error:null});}return q;
  }};
  const creates=[],createPlans=[];
  const client={supabaseBrowser:()=>sdk},mocks={'@/lib/supabase/client':client,'./supabase/client':client};
  mocks['@/lib/queries-funding']={...load('src/lib/queries-funding.ts',mocks),createFundingJob(company,force){creates.push({company,force});assert.ok(createPlans.length,'inert create must be planned');return createPlans.shift();}};
  const {useFundingRounds}=load('src/components/uttu/use-funding-rounds.ts',mocks),{FundingRoundsView}=load('src/components/uttu/funding-rounds-view.tsx',mocks),{FundingCollectButton}=load('src/components/uttu/funding-collect-button.tsx',mocks);
  let state,done=0;
  function View({company='a',control=false}){state=useFundingRounds(company);return React.createElement(React.Fragment,null,control&&React.createElement(FundingCollectButton,{companyId:company,fundingLastCollectedAt:null,onDone:()=>{done++;void state.refreshAfterJob();}}),React.createElement(FundingRoundsView,{funding:state}));}
  return {View,Control:FundingCollectButton,calls,plans,listeners,timers,creates,createPlan:p=>createPlans.push(p),state:()=>state,done:()=>done,
    plan(table,value){plans.push({table,promise:value});},authPlan(value){authPlan=value;},auth(id){owner=id;for(const fn of listeners)fn(id?'SIGNED_IN':'SIGNED_OUT',id?{user:{id}}:null);},
    async fire(delay){const entry=[...timers.entries()].find(([,v])=>v.delay===delay);assert.ok(entry,'expected timer '+delay);timers.delete(entry[0]);await act(async()=>entry[1].fn());},
    restore(){Object.assign(global,saved);},
  };
}
test('manual verification cannot remount control or duplicate a deferred create',async()=>{
  const f=fixture(),first=deferred();let root;
  try{
    await act(async()=>{root=Renderer.create(React.createElement(f.Control,{companyId:'a',fundingLastCollectedAt:null}));});
    f.createPlan(first.promise);await act(async()=>{void button(root,'투자정보 수집').props.onClick();});
    const collect=button(root,'투자정보 수집'),verify=button(root,'로그인 상태 다시 조회'),reads=f.calls.length;assert.equal(verify.props['aria-disabled'],true);
    await act(async()=>{verify.props.onClick();verify.props.onClick();});assert.equal(button(root,'투자정보 수집'),collect);assert.equal(button(root,'로그인 상태 다시 조회'),verify);assert.equal(collect.props.disabled,true);assert.equal(f.calls.length,reads);
    await act(async()=>{void collect.props.onClick();});assert.equal(f.creates.length,1);
    await act(async()=>first.resolve({type:'error'}));assert.equal(collect.props.disabled,false);
  }finally{await act(async()=>root?.unmount());assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);f.restore();}
});
for(const id of [null,'replacement-owner'])test('external '+String(id)+' still clears a control with deferred create',async()=>{
  const f=fixture(),first=deferred();let root;
  try{
    await act(async()=>{root=Renderer.create(React.createElement(f.Control,{companyId:'a',fundingLastCollectedAt:null}));});
    f.createPlan(first.promise);await act(async()=>{void button(root,'투자정보 수집').props.onClick();});const old=button(root,'투자정보 수집');
    await act(async()=>f.auth(id));assert.notEqual(button(root,'투자정보 수집'),old);assert.equal(button(root,'투자정보 수집').props.disabled,id===null);
    const reads=f.calls.length;await act(async()=>first.resolve({type:'created',job:job('a','obsolete-job')}));assert.equal(f.calls.length,reads);assert.doesNotMatch(text(root),/수집 중…/);assert.equal(f.creates.length,1);
  }finally{await act(async()=>root?.unmount());assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);f.restore();}
});
test('funding stalled identity times out, retries verification without collection, and ignores late old identity',async()=>{
  const f=fixture(),old=deferred(),fresh=deferred();let root;
  try{
    f.authPlan(old.promise);await act(async()=>{root=Renderer.create(React.createElement(f.View,{control:true}));});assert.equal(f.calls.length,0);assert.equal(f.state().loading,true);assert.equal([...f.timers.values()].filter(t=>t.delay===15000).length,2);
    await f.fire(15000);await f.fire(15000);assert.equal(f.state().loading,false);assert.equal(f.state().error,true);assert.match(text(root),/로그인 상태를 확인하지 못했습니다/);assert.equal(f.timers.size,0);
    const verify=button(root,'로그인 상태 다시 조회');f.authPlan(fresh.promise);await act(async()=>{verify.props.onClick();verify.props.onClick();button(root,'투자정보 다시 조회').props.onClick();});assert.equal(button(root,'로그인 상태 다시 조회'),verify);assert.equal(verify.props['aria-disabled'],true);assert.equal(f.calls.length,0);assert.equal(f.timers.size,2);
    await act(async()=>old.resolve({data:{user:{id:'obsolete-owner'}},error:null}));assert.equal(f.calls.length,0);assert.equal(f.state().loading,true);
    await act(async()=>fresh.resolve({data:{user:{id:'verified-owner'}},error:null}));assert.match(text(root),/a timeline/);assert.equal(button(root,'로그인 상태 다시 조회'),verify);assert.equal(verify.props['aria-disabled'],true);assert.equal(f.state().error,false);assert.equal(f.timers.size,0);assert.equal(f.calls.filter(c=>c.table==='funding_rounds').length,1);assert.equal(f.calls.filter(c=>c.table==='funding_collection_jobs').length,1);
  }finally{await act(async()=>root?.unmount());assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);f.restore();}
});
for(const id of [null,'replacement-owner'])test('funding explicit '+String(id)+' event wins stalled identity and late settlement',async()=>{
  const f=fixture(),old=deferred();let root;
  try{
    f.authPlan(old.promise);await act(async()=>{root=Renderer.create(React.createElement(f.View,{control:true}));});await act(async()=>f.auth(id));const calls=f.calls.length;assert.equal(f.timers.size,0);
    if(id){assert.match(text(root),/a timeline/);assert.equal(f.state().error,false);}else{assert.equal(calls,0);assert.match(text(root),/로그인 후 투자정보/);assert.equal(button(root,'로그인 상태 다시 조회'),undefined);}
    await act(async()=>old.resolve({data:{user:{id:'late-owner'}},error:null}));assert.equal(f.calls.length,calls);assert.equal(f.state().signedOut,id===null);assert.equal(f.state().error,false);
  }finally{await act(async()=>root?.unmount());assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);f.restore();}
});
test('funding pending identity unmount clears deadline and subscription before late rejection',async()=>{
  const f=fixture(),old=deferred();let root;try{f.authPlan(old.promise);await act(async()=>{root=Renderer.create(React.createElement(f.View,{control:true}));});await act(async()=>root.unmount());root=null;assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);await act(async()=>old.reject(Error('late auth')));assert.equal(f.calls.length,0);}finally{await act(async()=>root?.unmount());f.restore();}
});
test('deadline helper settles UI after 15 seconds, clears timers and ignores abort-ignoring late transport',async()=>{
  const f=fixture(),{startFundingRead}=load('src/lib/funding-read.ts');let signal;
  try{
    const raw=deferred(),read=startFundingRead(s=>{signal=s;return raw.promise;});const rejected=assert.rejects(read.promise,{name:'FundingReadTimeoutError'});
    assert.equal([...f.timers.values()][0].delay,15000);await f.fire(15000);await rejected;assert.equal(signal.aborted,true);assert.equal(f.timers.size,0);
    raw.resolve('too late');await act(async()=>{});assert.equal(f.timers.size,0);
    const next=startFundingRead(async()=> 'success');assert.equal(await next.promise,'success');assert.equal(f.timers.size,0);
    const hanging=deferred(),cancelled=startFundingRead(()=>hanging.promise),disposed=assert.rejects(cancelled.promise,{name:'AbortError'});cancelled.cancel();await disposed;assert.equal(f.timers.size,0);hanging.reject(Error('late rejection'));await act(async()=>{});
  }finally{f.restore();}
});
test('timeline timeout retains same-scope data; manual retry is single-flight and late old success is masked',async()=>{
  const f=fixture();let root;
  try{
    await act(async()=>{root=Renderer.create(React.createElement(f.View));});const old=deferred(),fresh=deferred();f.plan('funding_rounds',old.promise);
    await act(async()=>{void f.state().refresh();});const oldCall=f.calls.at(-1);assert.equal(f.timers.size,1);
    await f.fire(15000);assert.equal(oldCall.signal.aborted,true);assert.match(text(root),/조회 시간이 초과|이전에 조회한/);assert.match(text(root),/a timeline/);assert.equal(f.state().loading,false);assert.equal(f.calls.length,2);
    f.plan('funding_rounds',fresh.promise);await act(async()=>{button(root,'투자정보 다시 조회').props.onClick();button(root,'투자정보 다시 조회').props.onClick();});assert.equal(f.calls.length,3);assert.equal(f.timers.size,1);
    await act(async()=>old.resolve({data:[row('a','obsolete')],error:null}));assert.doesNotMatch(text(root),/obsolete/);assert.equal(f.state().loading,true);
    await act(async()=>fresh.resolve({data:[row('a','fresh')],error:null}));assert.match(text(root),/fresh/);assert.doesNotMatch(text(root),/조회 시간이 초과|obsolete/);assert.equal(f.timers.size,0);
  }finally{await act(async()=>root?.unmount());assert.equal(f.timers.size,0);f.restore();}
});
test('initial timeline timeout is unavailable, retry succeeds, late transport rejection cannot replace success',async()=>{
  const f=fixture(),old=deferred();let root;
  try{
    f.plan('funding_rounds',old.promise);await act(async()=>{root=Renderer.create(React.createElement(f.View));});await f.fire(15000);
    assert.match(text(root),/조회 시간이 초과/);assert.doesNotMatch(text(root),/수집된 투자정보가 없습니다/);
    await act(async()=>button(root,'투자정보 다시 조회').props.onClick());assert.match(text(root),/a timeline/);
    await act(async()=>old.reject(Error('late offline')));assert.match(text(root),/a timeline/);assert.doesNotMatch(text(root),/초과|불러오지 못했습니다/);
  }finally{await act(async()=>root?.unmount());assert.equal(f.timers.size,0);f.restore();}
});
test('company/owner changes dispose the old deadline and suppress queued timeout and late settlement',async()=>{
  for(const change of ['company','owner']){
    const f=fixture();let root;const old=deferred(),fresh=deferred();
    try{
      await act(async()=>{root=Renderer.create(React.createElement(f.View));});f.plan('funding_rounds',old.promise);await act(async()=>{void f.state().refresh();});
      const timeout=[...f.timers.values()][0].fn,oldCall=f.calls.at(-1);f.plan('funding_rounds',fresh.promise);
      await act(async()=>change==='company'?root.update(React.createElement(f.View,{company:'b'})):f.auth('replacement-owner'));
      assert.equal(oldCall.signal.aborted,true);assert.equal(f.timers.size,1);assert.doesNotMatch(text(root),/a timeline/);
      await act(async()=>timeout());assert.equal(f.state().loading,true);assert.equal(f.state().timedOut,false);
      await act(async()=>old.resolve({data:[row('a','old owner/company')],error:null}));assert.doesNotMatch(text(root),/old owner\/company/);
      await act(async()=>fresh.resolve({data:[row(change==='company'?'b':'a','current scope')],error:null}));assert.match(text(root),/current scope/);
      const last=deferred();f.plan('funding_rounds',last.promise);await act(async()=>{void f.state().refresh();});const call=f.calls.at(-1);
      await act(async()=>root.unmount());root=null;assert.equal(call.signal.aborted,true);assert.equal(f.timers.size,0);await act(async()=>last.reject(Error('unmounted')));
    }finally{await act(async()=>root?.unmount());assert.equal(f.timers.size,0);f.restore();}
  }
});
test('exact-job timeout pauses serial polling, manual retry owns one read, late old done cannot publish',async()=>{
  const f=fixture();let root,done=0;const old=deferred(),fresh=deferred();
  try{
    f.plan('funding_collection_jobs',Promise.resolve({data:job('a'),error:null}));
    await act(async()=>{root=Renderer.create(React.createElement(f.Control,{companyId:'a',fundingLastCollectedAt:null,onDone:()=>done++}));});
    f.plan('funding_collection_jobs',old.promise);await f.fire(4000);const oldCall=f.calls.at(-1);assert.equal(f.timers.size,1);
    await act(async()=>button(root,'수집 상태 다시 조회').props.onClick());assert.equal(f.calls.length,2);
    await f.fire(15000);assert.equal(oldCall.signal.aborted,true);assert.match(text(root),/수집 상태 조회 시간이 초과/);assert.equal(f.timers.size,0);assert.equal(done,0);
    f.plan('funding_collection_jobs',fresh.promise);await act(async()=>{button(root,'수집 상태 다시 조회').props.onClick();button(root,'수집 상태 다시 조회').props.onClick();});
    assert.equal(f.calls.length,3);assert.deepEqual(f.calls.at(-1).filters,{company_id:'a',id:'j1'});assert.equal(f.timers.size,1);assert.equal(f.calls.at(-1).signal.aborted,false);
    await act(async()=>old.resolve({data:job('a','j1','done'),error:null}));assert.equal(done,0);assert.equal(button(root,'수집 상태 다시 조회').props['aria-disabled'],true);
    await act(async()=>fresh.resolve({data:job('a','j1','done'),error:null}));assert.equal(done,1);assert.equal(f.timers.size,0);assert.doesNotMatch(text(root),/조회 시간이 초과/);
  }finally{await act(async()=>root?.unmount());assert.equal(f.timers.size,0);f.restore();}
});
test('stalled job restoration times out; company/auth changes and unmount cancel deadlines without callbacks',async()=>{
  const f=fixture();let root,done=0;const first=deferred(),second=deferred(),third=deferred();
  try{
    f.plan('funding_collection_jobs',first.promise);await act(async()=>{root=Renderer.create(React.createElement(f.Control,{companyId:'a',fundingLastCollectedAt:null,onDone:()=>done++}));});await f.fire(15000);
    assert.match(text(root),/조회 시간이 초과/);assert.equal(f.calls[0].signal.aborted,true);assert.equal(f.timers.size,0);
    f.plan('funding_collection_jobs',second.promise);await act(async()=>root.update(React.createElement(f.Control,{companyId:'b',fundingLastCollectedAt:null,onDone:()=>done++})));const queued=[...f.timers.values()][0].fn;
    f.plan('funding_collection_jobs',third.promise);await act(async()=>f.auth('other'));assert.equal(f.calls.at(-2).signal.aborted,true);assert.equal(f.timers.size,1);
    await act(async()=>queued());assert.doesNotMatch(text(root),/조회 시간이 초과/);
    await act(async()=>{first.resolve({data:job('a','old','done'),error:null});second.resolve({data:job('b','old','done'),error:null});});assert.equal(done,0);
    const current=f.calls.at(-1);await act(async()=>root.unmount());root=null;assert.equal(current.signal.aborted,true);assert.equal(f.timers.size,0);await act(async()=>third.reject(Error('late')));assert.equal(done,0);
  }finally{await act(async()=>root?.unmount());assert.equal(f.timers.size,0);f.restore();}
});
