const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./helpers/load-source.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const priority = load('src/lib/anomaly-priority.ts');
const row = (n, type='rank_drop_own', severity='high') => ({ id: `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`, detected_at:'2026-10-06T01:00:00+00:00', detection_date:'2026-10-06', module:'product_planning', anomaly_type:type, severity, entity_type:'product', entity_id:'p', entity_name:'fixture', description:'fixture description', meta:null });
const deferred = () => { let resolve; const promise=new Promise(r=>resolve=r); return {promise,resolve}; };
test('only explicit known legacy versions deprioritized; recorded severity unchanged',()=>{
  for(const type of priority.LEGACY_RANK_RULES) {
    const r=row(1,type); assert.equal(priority.prioritySeverity(r),'lo'); assert.equal(r.severity,'high');
    assert.equal(priority.prioritySeverity({...r,meta:{policy_version:'confirmed-v4'}}),'hi');
  }
  for(const type of ['sold_out','price_drop','review_rating_drop','future_rank_rule']) assert.equal(priority.prioritySeverity(row(1,type)),'hi');
  assert.match(priority.observationExplanation(row(1,'rank_exit_own')),/누락 원인 미확인/);
});
function harness(responses) {
  const calls=[]; let authCallback; const client={auth:{getUser:async()=>({data:{user:{id:'owner'}},error:null}),onAuthStateChange(cb){authCallback=cb;return {data:{subscription:{unsubscribe(){}}}};}},from(table){
    const ops=[];calls.push({table,ops}); const result=responses.shift(); assert.ok(result,'unexpected query');
    const q=new Proxy({}, {get(_,method){if(method==='then')return (resolve,reject)=>Promise.resolve(result.promise??result).then(resolve,reject);return(...args)=>{ops.push([method,...args]);return q;};}});return q;
  }};
  const hook=load('src/hooks/useAnomalyRecords.ts',{'@/lib/supabase/client':{supabaseBrowser:()=>client}}).useAnomalyRecords;
  let current; function Probe({from='2026-10-01',to='2026-10-06'}){current=hook(from,to);return null;}
  return {client,calls,Probe,get current(){return current;},auth(id){authCallback('SIGNED_IN',id?{user:{id}}:null);}};
}
test('stable cursor pagination uses both sort keys, deduplicates and retains all >1000 records',async()=>{
  const all=Array.from({length:1101},(_,i)=>row(2000-i));
  const responses=[];for(let i=0;i<all.length;i+=100)responses.push({data:all.slice(i,i+101),error:null});
  const h=harness(responses);let app;await act(async()=>{app=create(React.createElement(h.Probe));});
  while(h.current.hasMore)await act(async()=>{await h.current.loadMore();});
  assert.equal(h.current.rows.length,1101);
  assert.ok(h.calls.every(c=>c.ops.some(o=>o[0]==='gte'&&o[1]==='detection_date')&&c.ops.filter(o=>o[0]==='order').length===2));
  assert.match(h.calls[1].ops.find(o=>o[0]==='or')[1],/detected_at.lt.*id.lt/);
  await act(async()=>app.unmount());
});
test('period change and stale first/append requests cannot leak rows',async()=>{
  const old=deferred(), append=deferred();const h=harness([old,{data:Array.from({length:101},(_,i)=>row(500-i)),error:null},append,{data:[row(9)],error:null}]);let app;
  await act(async()=>{app=create(React.createElement(h.Probe));});
  await act(async()=>app.update(React.createElement(h.Probe,{from:'2026-10-02'})));
  await act(async()=>{void h.current.loadMore();});
  await act(async()=>app.update(React.createElement(h.Probe,{from:'2026-10-03'})));
  await act(async()=>{old.resolve({data:[row(1)],error:null});append.resolve({data:[row(2)],error:null});});
  assert.deepEqual(h.current.rows.map(r=>r.id),[row(9).id]);
  await act(async()=>app.unmount());
});
test('identity change/signout clears rows and prevents stale owner response',async()=>{
  const old=deferred();const h=harness([old,{data:[row(8)],error:null}]);let app;
  await act(async()=>{app=create(React.createElement(h.Probe));});
  await act(async()=>h.auth('new-owner'));
  await act(async()=>old.resolve({data:[row(1)],error:null}));
  assert.deepEqual(h.current.rows.map(r=>r.id),[row(8).id]);
  await act(async()=>h.auth(null));assert.equal(h.current.rows.length,0);assert.equal(h.current.hasMore,false);
  await act(async()=>app.unmount());
});
test('failed append is retryable and does not discard first page; double click is bounded',async()=>{
  const pending=deferred();const h=harness([{data:Array.from({length:101},(_,i)=>row(900-i)),error:null},pending,{data:[row(5)],error:null}]);let app;
  await act(async()=>{app=create(React.createElement(h.Probe));});
  await act(async()=>{void h.current.loadMore();void h.current.loadMore();});assert.equal(h.calls.length,2);
  await act(async()=>pending.resolve({data:null,error:new Error('offline')}));assert.equal(h.current.rows.length,100);assert.match(h.current.error,/offline/);
  await act(async()=>h.current.retry());assert.equal(h.current.rows.length,101);
  await act(async()=>app.unmount());
});

function componentHarness(mobile) {
  const queued=[];
  let params=new URLSearchParams();let records={rows:[row(1),row(2,'sold_out')],loading:false,error:null,hasMore:true,identity:'owner',identityKey:'owner|1',loadMore(){},retry(){}};
  const empty=()=>null;
  const PeriodMock=props=>React.createElement('button',{'data-period':true,onClick:()=>props.onChange('7d')},'period');
  const CheckMock=props=>React.createElement('button',{'data-check':true,onClick:props.onToggle},props.label);
  const proxy=new Proxy({PeriodFilter:PeriodMock,CheckRow:CheckMock,FilterBlock:props=>React.createElement(React.Fragment,null,props.children)},{get:(target,key)=>target[key]??empty});
  const mocks={
    '@/hooks/useAnomalyRecords':{useAnomalyRecords:()=>records},
    'next/navigation':{useSearchParams:()=>params,useRouter:()=>({push(){}})},
    '@/hooks/useViewport':{useIsMobile:()=>mobile},
    '@/lib/supabase/client':{supabaseBrowser:()=>({from(){const q={select(){return q;},eq(){return q;},single(){const value=queued.shift();return value?.promise??Promise.resolve(value??{data:null});}};return q;}})},
    '@/lib/queries-me':{fetchNoteCountForEntity:async()=>0},
    '@/components/ui/filters':proxy,'@/components/ui/icons':proxy,
    '@/components/me/SavedFiltersDropdown':{__esModule:true,default:empty},'@/components/me/NoteDrawer':{__esModule:true,default:empty},
  };
  const Component=load(mobile?'src/app/(app)/anomaly/MobileAnomalyView.tsx':'src/app/(app)/anomaly/page.tsx',mocks).default;
  return {Component,queued,setParams(v){params=new URLSearchParams(v);},setRecords(v){records={...records,...v};}};
}
for(const mobile of [false,true]) test(`actual ${mobile?'mobile':'desktop'} component: sections, original severity, future policy, Back/Forward severity filters`,async()=>{
  const h=componentHarness(mobile);let app;await act(async()=>app=create(React.createElement(h.Component)));
  let text=JSON.stringify(app.toJSON());assert.match(text,/일일 순위观测|일일 순위 관측/);assert.match(text,/우선 확인/);assert.match(text,/불러온/);
  const sections=app.root.findAllByType('details');assert.ok(sections.some(d=>d.props.open===false));
  h.setParams('sev=hi');await act(async()=>app.update(React.createElement(h.Component)));
  let summaries=app.root.findAllByType('summary');
  assert.ok(summaries.find(s=>s.children.join('').includes('일일 순위 관측')).children.join('').includes('0'));
  assert.ok(summaries.find(s=>s.children.join('').includes('우선 확인')).children.join('').includes('1'));
  h.setParams('sev=lo');await act(async()=>app.update(React.createElement(h.Component)));assert.match(JSON.stringify(app.toJSON()),/일일 순위/);
  h.setParams('');await act(async()=>app.update(React.createElement(h.Component)));
  if(!mobile){
    const observation=app.root.findAll(node=>node.type==='div' && node.props.className?.startsWith('row hover'))[1];
    await act(async()=>observation.props.onClick());
    assert.match(JSON.stringify(app.toJSON()),/기록된/);
    assert.match(JSON.stringify(app.toJSON()),/HIGH/);
  } else {
    assert.match(JSON.stringify(app.toJSON()),/기록된 심각도/);
    assert.match(JSON.stringify(app.toJSON()),/HIGH/);
  }
  h.setRecords({rows:[{...row(3),meta:{policy_version:'confirmed-v4'}}]});await act(async()=>app.update(React.createElement(h.Component)));
  const daily=app.root.findAllByType('summary').find(s=>s.children.join('').includes('일일 순위 관측'));assert.ok(daily.children.join('').includes('0'));
  if(mobile)assert.match(JSON.stringify(app.toJSON()),/HIGH/);
  await act(async()=>app.unmount());
});
test('desktop detail identity switch ignores stale product link and auth change closes drawer',async()=>{
  const h=componentHarness(false), old=deferred(), fresh=deferred();h.queued.push(old,fresh);let app;
  await act(async()=>app=create(React.createElement(h.Component)));
  const items=()=>app.root.findAll(node=>node.type==='div'&&node.props.className?.startsWith('row hover'));
  await act(async()=>items()[1].props.onClick());
  await act(async()=>items()[0].props.onClick());
  await act(async()=>fresh.resolve({data:{musinsa_no:'222'}}));
  await act(async()=>old.resolve({data:{musinsa_no:'111'}}));
  assert.ok(app.root.findAllByType('a').some(a=>a.props.href==='/product?no=222'));
  assert.ok(!app.root.findAllByType('a').some(a=>a.props.href==='/product?no=111'));
  h.setRecords({identity:null,identityKey:'|2',rows:[]});
  await act(async()=>app.update(React.createElement(h.Component)));
  assert.equal(app.root.findAllByType('aside').filter(a=>a.props.className==='drawer').length,0);
  await act(async()=>app.unmount());
});
test('desktop Back/Forward id requests cannot open stale detail',async()=>{
  const h=componentHarness(false), old=deferred(), fresh=deferred();h.queued.push(old,fresh,{data:null});h.setParams('id=old');let app;
  await act(async()=>app=create(React.createElement(h.Component)));
  h.setParams('id=new');await act(async()=>app.update(React.createElement(h.Component)));
  await act(async()=>fresh.resolve({data:{...row(9),entity_name:'NEW_DETAIL'}}));
  await act(async()=>old.resolve({data:{...row(8),entity_name:'OLD_DETAIL'}}));
  assert.match(JSON.stringify(app.toJSON()),/NEW_DETAIL/);assert.ok(!JSON.stringify(app.toJSON()).includes('OLD_DETAIL'));
  h.setParams('');await act(async()=>app.update(React.createElement(h.Component)));
  assert.ok(!JSON.stringify(app.toJSON()).includes('NEW_DETAIL'));
  await act(async()=>app.unmount());
});
for(const mobile of [false,true]) test(`actual ${mobile?'mobile':'desktop'} HIGH only on later page has honest subset/complete empty states`,async()=>{
  const h=componentHarness(mobile);h.setParams('sev=hi');h.setRecords({rows:[row(1)]});let app;
  await act(async()=>app=create(React.createElement(h.Component)));
  let text=JSON.stringify(app.toJSON());assert.match(text,/아직 확인하지 않은/);assert.match(text,/다음 기록에서 조건 계속 확인/);
  assert.ok(!text.includes('조건에 맞는 이상탐지가 없습니다'));
  h.setRecords({rows:[row(1),row(2,'sold_out')],hasMore:false});
  await act(async()=>app.update(React.createElement(h.Component)));assert.match(JSON.stringify(app.toJSON()),/우선 확인/);
  h.setRecords({rows:[row(1)],hasMore:false});await act(async()=>app.update(React.createElement(h.Component)));
  assert.match(JSON.stringify(app.toJSON()),/기록을 모두 불러왔으며/);
  assert.ok(!JSON.stringify(app.toJSON()).includes('아직 확인하지 않은'));
  await act(async()=>app.unmount());
});
for(const intent of ['selection','close','period','severity','area','url-severity'])test(`pending deep link cannot undo newer ${intent} intent`,async()=>{
  const h=componentHarness(false), pending=deferred();h.queued.push(pending,{data:null});h.setParams('id=A');let app;
  await act(async()=>app=create(React.createElement(h.Component)));
  const items=()=>app.root.findAll(node=>node.type==='div'&&node.props.className?.startsWith('row hover'));
  if(intent==='selection'||intent==='close'){
    await act(async()=>items()[0].props.onClick());
    if(intent==='close')await act(async()=>app.root.findAllByType('button').find(b=>b.props.title==='닫기').props.onClick());
  }else if(intent==='period')await act(async()=>app.root.findAllByType('button').find(b=>b.props['data-period']).props.onClick());
  else if(intent==='url-severity'){h.setParams('id=A&sev=lo');await act(async()=>app.update(React.createElement(h.Component)));}
  else {const checks=app.root.findAllByType('button').filter(b=>b.props['data-check']);await act(async()=>checks[intent==='severity'?0:3].props.onClick());}
  await act(async()=>pending.resolve({data:{...row(88),entity_name:'STALE_DEEP_LINK'}}));
  assert.ok(!JSON.stringify(app.toJSON()).includes('STALE_DEEP_LINK'));
  const drawers=app.root.findAllByType('aside').filter(a=>a.props.className==='drawer');
  assert.equal(drawers.length,intent==='selection'?1:0);
  if(intent==='severity'||intent==='url-severity'){
    const priority=app.root.findAllByType('summary').find(s=>s.children.join('').includes('우선 확인'));
    assert.ok(priority.children.join('').includes('0'));
  }
  await act(async()=>app.unmount());
});
