const test=require('node:test'),assert=require('node:assert/strict'),React=require('react'),Renderer=require('react-test-renderer'),load=require('./helpers/load-source.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const act=fn=>React.act(fn),flatten=node=>typeof node==='string'?node:Array.isArray(node)?node.map(flatten).join(''):node?.children?.map(flatten).join('')??'',text=root=>flatten(root.toJSON()),deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const button=(root,label)=>root.root.findAllByType('button').find(b=>b.children.join('')===label);
const briefing=(date,label='stored news')=>({briefing_date:date,audience:'executive',headline:label,daily_brief:['stored summary'],card_comments:{},insights:[],news_picks:[{headline:label,summary:'saved article',source_name:'fixture source',source_url:'https://example.invalid/article',relevance:4}],insight_pages:[{idx:0,title:label,body:'stored insight',link:'',article:'stored article',key_metrics:[],chart:null}],generated_at:date+'T00:00:00Z',model:'fixture'});
const savedFetch=global.fetch;test.before(()=>{global.fetch=async()=>assert.fail('No fixture network');});test.after(()=>{global.fetch=savedFetch;});
function fixture(mobile=false,insight=false){
  let params='',today='2026-10-05',owner='owner',authPlan=null,timerId=0;
  const calls=[],plans=[],listeners=new Set(),timers=new Map(),saved={setTimeout:global.setTimeout,clearTimeout:global.clearTimeout};
  global.setTimeout=(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId;};global.clearTimeout=id=>timers.delete(id);
  const sdk={auth:{getUser:()=>authPlan??Promise.resolve({data:{user:owner?{id:owner}:null},error:null}),onAuthStateChange(fn){listeners.add(fn);return {data:{subscription:{unsubscribe(){listeners.delete(fn);}}}};}},from(table){
    const call={kind:table,date:null,signal:null};const q={select(cols){if(table==='daily_briefings')call.kind=cols==='briefing_date'?'dates':'briefing';return q;},eq(k,v){if(k==='briefing_date')call.date=v;return q;},gte(){return q;},lte(){return q;},in(){return q;},order(){return q;},limit(){return q;},abortSignal(signal){call.signal=signal;return q;},insert(){assert.fail('No fixture writes');},upsert(){assert.fail('No fixture writes');},then(a,b){calls.push(call);const i=plans.findIndex(p=>p.kind===call.kind);const p=i<0?null:plans.splice(i,1)[0];const result=p?p.value:{data:call.kind==='briefing'?[briefing(call.date)]:call.kind==='dates'?[{briefing_date:today}]:[],error:null,count:0};return Promise.resolve(result).then(a,b);}};return q;
  }};
  const format={...load('src/lib/format.ts'),kstToday:()=>today},client={supabaseBrowser:()=>sdk};
  const mocks={'@/lib/supabase/client':client,'./supabase/client':client,'@/lib/format':format,'./format':format,'next/navigation':{useSearchParams:()=>new URLSearchParams(params),useRouter:()=>({push(){assert.fail('No fixture route writes');},back(){}})},'next/link':({children,...props})=>React.createElement('a',props,children),'@/hooks/useViewport':{useIsMobile:()=>mobile},'./page.module.css':{},'@/lib/cs-daily-review-context':{useCSDailyReviewState:()=>{const date=new URLSearchParams(params).get('date')??today;return {status:'ready',briefingDate:date,reviewDate:load('src/lib/cs-daily-review-check.ts').csReviewDate(date,today),result:{total:0,rows:[],excluded:0},retry(){}};}}};
  const Page=load(insight?'src/app/(app)/today/insight/page.tsx':'src/app/(app)/today/page.tsx',mocks).default;
  return {Page,calls,plans,timers,listeners,mocks,route:p=>{params=p;},today:d=>{today=d;},authPlan:p=>{authPlan=p;},auth:id=>{owner=id;for(const fn of listeners)fn(id?'SIGNED_IN':'SIGNED_OUT',id?{user:{id}}:null);},plan:(kind,value)=>plans.push({kind,value}),async fire(delay){const pair=[...timers.entries()].find(([,v])=>delay==='midnight'?v.delay>15000:v.delay===delay);assert.ok(pair,'Expected timer '+delay);timers.delete(pair[0]);await act(async()=>pair[1].fn());},restore(){Object.assign(global,saved);}};
}
for(const mobile of [false,true]){
  test(`${mobile?'mobile':'desktop'} Today initial error, stable manual retry, same-date retained news and legitimate absence`,async()=>{
    const f=fixture(mobile);let root;
    try{
      f.plan('briefing',{data:null,error:{code:'403'}});await act(async()=>{root=Renderer.create(React.createElement(f.Page));});assert.match(text(root),/브리핑.*조회에 실패/);assert.doesNotMatch(text(root),/아직 생성되지|stored news/);
      const pending=deferred();f.plan('briefing',pending.promise);const control=button(root,'브리핑 다시 조회');await act(async()=>{control.props.onClick();control.props.onClick();});assert.equal(f.calls.filter(c=>c.kind==='briefing').length,2);assert.equal(button(root,'브리핑 다시 조회'),control);assert.equal(control.props['aria-disabled'],true);
      await act(async()=>pending.resolve({data:[briefing('2026-10-05')],error:null}));assert.match(text(root),/stored news/);
      f.plan('briefing',Promise.reject(Error('offline')));await act(async()=>control.props.onClick());assert.match(text(root),/stored news|이전에 조회한 같은 날짜/);assert.doesNotMatch(text(root),/아직 생성되지/);
      f.plan('briefing',{data:[],error:null});await act(async()=>control.props.onClick());assert.match(text(root),/2026-10-05 브리핑이 아직 생성되지/);assert.doesNotMatch(text(root),/stored news/);
    }finally{await act(async()=>root?.unmount());assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);f.restore();}
  });
  test(`${mobile?'mobile':'desktop'} optional dates/KPI errors do not remove briefing, each retry is independent`,async()=>{
    const f=fixture(mobile);let root;
    try{
      f.plan('dates',{data:null,error:{code:'403'}});f.plan('anomalies',{data:null,error:{code:'503'}});await act(async()=>{root=Renderer.create(React.createElement(f.Page));});assert.match(text(root),/stored news/);assert.doesNotMatch(text(root),/참고 지표 조회에 실패/);if(!mobile)assert.match(text(root),/읽기 실패/);assert.match(text(root),/날짜 목록.*조회에 실패/);
      const count=f.calls.filter(c=>c.kind==='briefing').length;await act(async()=>button(root,'참고 지표 다시 조회').props.onClick());assert.doesNotMatch(text(root),/참고 지표 조회에 실패/);assert.equal(f.calls.filter(c=>c.kind==='briefing').length,count);
      await act(async()=>button(root,'날짜 목록 다시 조회').props.onClick());assert.doesNotMatch(text(root),/날짜 목록.*조회에 실패/);assert.match(text(root),/stored news/);
    }finally{await act(async()=>root?.unmount());assert.equal(f.timers.size,0);f.restore();}
  });
  test(`${mobile?'mobile':'desktop'} timeout manual retry masks abort-ignoring old result and unmount clears timers`,async()=>{
    const f=fixture(mobile),old=deferred(),fresh=deferred();let root;
    try{
      f.plan('briefing',old.promise);await act(async()=>{root=Renderer.create(React.createElement(f.Page));});const call=f.calls.find(c=>c.kind==='briefing');await f.fire(15000);assert.equal(call.signal.aborted,true);assert.match(text(root),/조회 시간이 초과/);assert.doesNotMatch(text(root),/아직 생성되지/);
      f.plan('briefing',fresh.promise);await act(async()=>button(root,'브리핑 다시 조회').props.onClick());await act(async()=>old.resolve({data:[briefing('2026-10-05','obsolete')],error:null}));assert.doesNotMatch(text(root),/obsolete/);
      await act(async()=>fresh.resolve({data:[briefing('2026-10-05','current')],error:null}));assert.match(text(root),/current/);
      const last=deferred();f.plan('briefing',last.promise);await act(async()=>button(root,'브리핑 다시 조회').props.onClick());const active=f.calls.filter(c=>c.kind==='briefing').at(-1);await act(async()=>root.unmount());root=null;assert.equal(active.signal.aborted,true);assert.equal(f.timers.size,0);await act(async()=>last.reject(Error('late disposal')));
    }finally{await act(async()=>root?.unmount());f.restore();}
  });
  test(`${mobile?'mobile':'desktop'} date/owner/tab changes hide old data immediately and CS source queue survives briefing failure`,async()=>{
    const f=fixture(mobile),old=deferred();let root;
    try{
      f.plan('briefing',old.promise);await act(async()=>{root=Renderer.create(React.createElement(f.Page));});const call=f.calls.find(c=>c.kind==='briefing');f.route('date=2026-10-04');await act(async()=>root.update(React.createElement(f.Page)));assert.equal(call.signal.aborted,true);assert.match(text(root),/2026-10-04/);
      await act(async()=>old.resolve({data:[briefing('2026-10-05','old date')],error:null}));assert.doesNotMatch(text(root),/old date/);
      const replacement=deferred();f.plan('briefing',replacement.promise);await act(async()=>f.auth('replacement'));assert.doesNotMatch(text(root),/stored news/);await act(async()=>replacement.resolve({data:[briefing('2026-10-04','new owner')],error:null}));assert.match(text(root),/new owner/);
      f.plan('briefing',{data:null,error:{code:'500'}});f.route('tab=cs&date=2026-10-04');await act(async()=>root.update(React.createElement(f.Page)));assert.match(text(root),/확인할 저평점 리뷰/);assert.match(text(root),/조건에 맞는 저장 리뷰가 없습니다/);assert.match(text(root),/브리핑.*조회에 실패/);assert.doesNotMatch(text(root),/new owner|아직 생성되지/);
      await act(async()=>f.auth(null));assert.match(text(root),/로그인 후 브리핑/);assert.doesNotMatch(text(root),/new owner/);
    }finally{await act(async()=>root?.unmount());assert.equal(f.timers.size,0);f.restore();}
  });
  test(`${mobile?'mobile':'desktop'} midnight updates implicit date and excludes previous-day content under new label`,async()=>{
    const f=fixture(mobile);let root;
    try{
      await act(async()=>{root=Renderer.create(React.createElement(f.Page));});const next=deferred();f.plan('briefing',next.promise);f.today('2026-10-06');await f.fire('midnight');assert.match(text(root),/2026-10-06/);assert.doesNotMatch(text(root),/stored news|2026-10-05 브리핑이/);
      await act(async()=>next.resolve({data:[],error:null}));assert.match(text(root),/2026-10-06 브리핑이 아직 생성되지/);
    }finally{await act(async()=>root?.unmount());assert.equal(f.timers.size,0);f.restore();}
  });
}
test('insight error, absence, timeout, route/owner cancellation and manual retry use the same guarded contract',async()=>{
  const f=fixture(false,true);let root;
  try{
    f.plan('briefing',{data:null,error:{code:'403'}});await act(async()=>{root=Renderer.create(React.createElement(f.Page));});assert.match(text(root),/인사이트.*조회에 실패/);assert.doesNotMatch(text(root),/아직 생성된 상세/);
    await act(async()=>button(root,'인사이트 다시 조회').props.onClick());assert.match(text(root),/stored article/);
    const old=deferred();f.plan('briefing',old.promise);await act(async()=>button(root,'인사이트 다시 조회').props.onClick());await f.fire(15000);assert.match(text(root),/stored article|조회 시간이 초과/);
    f.route('date=2026-10-04&idx=1');await act(async()=>root.update(React.createElement(f.Page)));assert.doesNotMatch(text(root),/stored article/);assert.match(text(root),/아직 생성된 상세/);await act(async()=>old.reject(Error('old route')));
    f.plan('briefing',{data:[],error:null});await act(async()=>f.auth('replacement'));assert.match(text(root),/아직 생성된 상세/);
  }finally{await act(async()=>root?.unmount());assert.equal(f.timers.size,0);f.restore();}
});
test('KPI failures preserve healthy sections and brand name fallback',async()=>{
  for(const table of ['ranking_snapshots','brands','anomalies','brand_ranking_snapshots']){const f=fixture();try{f.plan(table,{data:null,error:{code:'500'}});const value=await load('src/lib/queries-kpi.ts',f.mocks).fetchBriefingKpiData('2026-10-05'); const key={ranking_snapshots:'rank_status',anomalies:'anomaly_status',brand_ranking_snapshots:'competitor_status'}[table];if(key)assert.equal(value[key],'unavailable');for(const other of ['rank_status','anomaly_status','competitor_status'])if(other!==key)assert.equal(value[other],'complete');}finally{f.restore();}}
});
test('shared readers reject error, invalid/wrong-date/duplicate audience payloads; valid absence stays empty',async()=>{
  const f=fixture(),q=load('src/lib/queries-briefing.ts',f.mocks);
  try{
    for(const value of [{data:null,error:null},{data:[briefing('2026-10-04')],error:null},{data:[briefing('2026-10-05'),briefing('2026-10-05')],error:null},{data:[{...briefing('2026-10-05'),news_picks:[{relevance:-1}]}],error:null}]){f.plan('briefing',value);await assert.rejects(q.fetchAllBriefings('2026-10-05'));}
    f.plan('dates',{data:null,error:{code:'403'}});await assert.rejects(q.fetchAvailableBriefingDates());f.plan('dates',{data:[],error:null});assert.deepEqual(await q.fetchAvailableBriefingDates(),[]);f.plan('briefing',{data:[],error:null});assert.deepEqual(await q.fetchAllBriefings('2026-10-05'),{executive:null,staff:null,cs:null,briefing_date:'2026-10-05'});
  }finally{f.restore();}
});
test('identity verification timeout is retryable and a late old identity cannot republish',async()=>{
  const f=fixture(),old=deferred();let root;
  try{
    f.authPlan(old.promise);await act(async()=>{root=Renderer.create(React.createElement(f.Page));});await f.fire(15000);assert.match(text(root),/조회에 실패/);assert.equal(f.calls.length,0);
    f.authPlan(null);await act(async()=>button(root,'브리핑 다시 조회').props.onClick());assert.match(text(root),/stored news/);await act(async()=>old.resolve({data:{user:{id:'old owner'}},error:null}));assert.match(text(root),/stored news/);
  }finally{await act(async()=>root?.unmount());assert.equal(f.timers.size,0);f.restore();}
});
test('optional read rejection and deadlines preserve required content; obsolete settlements stay masked',async()=>{
  for(const [kind,label]of [['dates','날짜 목록'],['anomalies','참고 지표']]){
    const f=fixture(),old=deferred();let root;
    try{
      f.plan(kind,old.promise);await act(async()=>{root=Renderer.create(React.createElement(f.Page));});assert.match(text(root),/stored news/);await f.fire(15000);assert.match(text(root),new RegExp(label+' 조회 시간이 초과'));assert.match(text(root),/stored news/);
      await act(async()=>button(root,label+' 다시 조회').props.onClick());assert.doesNotMatch(text(root),new RegExp(label+' 조회 시간이 초과'));await act(async()=>old.reject(Error('late optional')));assert.match(text(root),/stored news/);
      f.plan(kind,Promise.reject(Error('optional offline')));await act(async()=>button(root,label+' 다시 조회').props.onClick());if(kind==='dates')assert.match(text(root),new RegExp(label+' 조회에 실패'));else {assert.doesNotMatch(text(root),/참고 지표 조회에 실패/);assert.match(text(root),/읽기 실패/);}assert.match(text(root),/stored news/);
    }finally{await act(async()=>root?.unmount());assert.equal(f.timers.size,0);f.restore();}
  }
});
test('date changes preserve unfiltered options while identity changes dispose all old-owner reads',async()=>{
  const f=fixture(),old=deferred(),dates=deferred(),kpi=deferred(),fresh=deferred();let root;
  try{
    f.plan('briefing',old.promise);f.plan('dates',dates.promise);f.plan('anomalies',kpi.promise);await act(async()=>{root=Renderer.create(React.createElement(f.Page));});const oldCalls=[...f.calls];
    f.plan('briefing',fresh.promise);f.route('date=2026-10-04');await act(async()=>root.update(React.createElement(f.Page)));assert.ok(oldCalls.filter(call=>call.kind!=='dates').every(call=>call.signal.aborted));assert.equal(oldCalls.find(call=>call.kind==='dates').signal.aborted,false);
    await act(async()=>{f.auth('other');});assert.ok(oldCalls.every(call=>call.signal.aborted));await act(async()=>{old.resolve({data:[briefing('2026-10-05','stale')],error:null});dates.reject(Error('old dates'));kpi.resolve({data:null,error:{code:'500'}});fresh.resolve({data:[briefing('2026-10-04','wrong owner')],error:null});});
    assert.doesNotMatch(text(root),/stale|wrong owner|조회에 실패/);assert.match(text(root),/stored news/);
  }finally{await act(async()=>root?.unmount());assert.equal(f.timers.size,0);f.restore();}
});

for(const mobile of [false,true])test(`${mobile?'mobile':'desktop'} date options survive date/tab changes and failed refresh, isolate owners, and refresh at midnight`,async()=>{
  const f=fixture(mobile),history=[{briefing_date:'2026-10-05'},{briefing_date:'2026-10-04'}];let root;
  try{
    f.plan('dates',{data:history,error:null});await act(async()=>{root=Renderer.create(React.createElement(f.Page));});const initial=f.calls.filter(c=>c.kind==='dates').length;
    for(const route of ['date=2026-10-04','date=2026-10-04&tab=staff','date=2026-10-05&tab=executive']){f.route(route);await act(async()=>root.update(React.createElement(f.Page)));assert.equal(f.calls.filter(c=>c.kind==='dates').length,initial);}
    f.route('date=2026-10-04');await act(async()=>root.update(React.createElement(f.Page)));const retry=button(root,'날짜 목록 다시 조회'),pending=deferred();f.plan('dates',pending.promise);await act(async()=>{retry.props.onClick();retry.props.onClick();});assert.equal(f.calls.filter(c=>c.kind==='dates').length,initial+1);assert.equal(button(root,'날짜 목록 다시 조회'),retry);assert.equal(retry.props['aria-disabled'],true);if(mobile)assert.equal(typeof button(root,'▶').props.onClick,'function');
    await act(async()=>pending.reject(Error('options offline')));assert.match(text(root),/같은 로그인 상태에서 이전에 조회한 날짜 목록/);assert.match(text(root),/stored news/);if(mobile)assert.equal(typeof button(root,'▶').props.onClick,'function');
    f.plan('dates',{data:history,error:null});await act(async()=>retry.props.onClick());assert.doesNotMatch(text(root),/날짜 목록 조회에 실패/);
    const oldOwner=deferred(),newOwner=deferred();f.plan('dates',oldOwner.promise);await act(async()=>retry.props.onClick());f.plan('dates',newOwner.promise);await act(async()=>f.auth('replacement'));if(mobile)assert.equal(button(root,'▶').props.onClick,undefined);await act(async()=>oldOwner.resolve({data:history,error:null}));if(mobile)assert.equal(button(root,'▶').props.onClick,undefined);await act(async()=>newOwner.resolve({data:[{briefing_date:'2026-10-04'}],error:null}));if(mobile)assert.equal(button(root,'▶').props.onClick,undefined);
    const beforeMidnight=f.calls.filter(c=>c.kind==='dates').length;f.plan('dates',{data:null,error:{code:'500'}});f.today('2026-10-06');await f.fire('midnight');assert.equal(f.calls.filter(c=>c.kind==='dates').length,beforeMidnight+1);assert.match(text(root),/같은 로그인 상태에서 이전에 조회한 날짜 목록/);await act(async()=>f.auth(null));assert.match(text(root),/로그인 후 날짜 목록/);if(mobile)assert.equal(button(root,'▶').props.onClick,undefined);
  }finally{await act(async()=>root?.unmount());assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);f.restore();}
});


test('actual KPI values isolate dates and owners; repeated retry performs one bounded read set',async()=>{
  const f=fixture(),old=deferred();let root;
  const ranks=(date,rank)=>({data:[{brand_slug:'covernat',snapshot_date:date,rank_position:rank}],count:1,error:null});
  try{
    f.plan('ranking_snapshots',old.promise);await act(async()=>{root=Renderer.create(React.createElement(f.Page));});
    const oldCall=f.calls.find(c=>c.kind==='ranking_snapshots');
    f.route('date=2026-10-04');f.plan('ranking_snapshots',ranks('2026-10-03',3));await act(async()=>root.update(React.createElement(f.Page)));
    assert.equal(oldCall.signal.aborted,true);assert.match(text(root),/#3/);assert.match(text(root),/기준 2026-10-03/);
    await act(async()=>old.resolve(ranks('2026-10-04',7)));assert.doesNotMatch(text(root),/#7/);
    const fresh=deferred();f.plan('ranking_snapshots',fresh.promise);const before=f.calls.length;
    await act(async()=>{const retry=button(root,'참고 지표 다시 조회');retry.props.onClick();retry.props.onClick();});
    assert.equal(f.calls.length,before+4);assert.equal(button(root,'참고 지표 다시 조회').props['aria-disabled'],true);
    const newOwner=deferred();f.plan('ranking_snapshots',newOwner.promise);await act(async()=>f.auth('replacement'));
    assert.doesNotMatch(text(root),/#3/);await act(async()=>fresh.resolve(ranks('2026-10-03',9)));assert.doesNotMatch(text(root),/#9/);
    await act(async()=>newOwner.resolve(ranks('2026-10-03',4)));assert.match(text(root),/#4/);
    await act(async()=>f.auth(null));assert.doesNotMatch(text(root),/#4/);assert.match(text(root),/로그인 후 참고 지표/);
  }finally{await act(async()=>root?.unmount());assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);f.restore();}
});
