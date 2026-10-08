const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const {act, create} = require('react-test-renderer');
const {renderToStaticMarkup} = require('react-dom/server');
const load = require('./helpers/load-source.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const dates = load('src/lib/briefing-anomaly-date.ts');
const TODAY = '2026-10-08';
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve}; };
const blank = () => null;
const link = props => React.createElement('a', props, props.children);

test('real calendar validation accepts leap days and rejects normalized impossible dates', () => {
  for (const date of ['2024-02-29','2026-10-02','0099-12-31']) assert.equal(dates.realCalendarDate(date), date);
  for (const date of ['2026-02-29','2026-04-31','2026-13-01','0000-01-01','2026-1-01','2026-10-02junk','',null]) assert.equal(dates.realCalendarDate(date), null);
});
test('date links preserve every existing anomaly parameter and fragment', () => {
  const next = new URL(dates.briefingAnomalyHref('/anomaly?id=entity&sev=hi&extra=a&extra=b&date=2026-10-01#daily', '2026-10-02'), 'https://fixture.test');
  assert.equal(next.searchParams.get('date'), '2026-10-02');
  assert.equal(next.searchParams.get('id'), 'entity'); assert.equal(next.searchParams.get('sev'), 'hi');
  assert.deepEqual(next.searchParams.getAll('extra'), ['a','b']); assert.equal(next.hash, '#daily');
  for (const href of ['/ranking?date=old','https://other.test/anomaly','/anomaly-other']) assert.equal(dates.briefingAnomalyHref(href,'2026-10-02'),href);
  assert.equal(dates.briefingAnomalyHref('/anomaly?sev=hi','2026-02-29'), '/anomaly?sev=hi');
});
for (const mobile of [false,true]) test(`actual ${mobile?'mobile':'desktop'} staff briefing card retains date and existing style`, () => {
  const mocks = {'next/link':{__esModule:true,default:link}};
  for (const name of ['BriefingHeadline','BriefingKpiRow','BriefingInsight','mobile/MobileBriefingTabs','mobile/MobileBriefingHeadline','mobile/MobileBriefingInsight','mobile/MobileNewsPickList','CSDailyReviewCheck']) mocks['@/components/briefing/'+name] = {__esModule:true,default:blank};
  // Relative imports use the same mock identities.
  for (const name of ['./BriefingHeadline','./BriefingKpiRow','./BriefingInsight','./MobileBriefingTabs','./MobileBriefingHeadline','./MobileBriefingInsight','./MobileNewsPickList','../CSDailyReviewCheck','../StaffDailyPlanningCheck']) mocks[name]={__esModule:true,default:blank};
  const briefing={briefing_date:'2026-10-02',audience:'staff',headline:'fixture',daily_brief:[],card_comments:{anomaly:'수집된 가격 변화 확인',own_ranking:'랭킹 관측'},insights:[]};
  const C=load(mobile?'src/components/briefing/mobile/MobileTodayView.tsx':'src/components/briefing/StaffBriefingView.tsx',mocks).default;
  const props=mobile?{activeTab:'staff',data:{staff:briefing},loading:false,activeDate:briefing.briefing_date,availableDates:[],onTabSelect(){},onDateChange(){}}:{briefing,kpiData:null};
  const html=renderToStaticMarkup(React.createElement(C,props));
  assert.match(html,/href="\/anomaly\?date=2026-10-02"/);assert.match(html,/2026-10-02 브리핑 · 해당일 감지 기록/);
  assert.match(html,/href="\/ranking"/);assert.match(html,/border-radius:10px/);
});

function componentHarness(mobile, details = null) {
  const detailCalls = [];
  let params=new URLSearchParams('date=2026-10-02&sev=hi&from=briefing');const calls=[];
  const proxy=new Proxy({}, {get:()=>blank});
  const records={rows:[],loading:false,error:null,hasMore:false,identity:null,identityKey:'fixture',loadMore(){},retry(){}};
  const mocks={
    'next/navigation':{useSearchParams:()=>params,useRouter:()=>({push(){throw Error('unexpected navigation');}})},
    '@/lib/format':{kstToday:()=>TODAY}, '@/hooks/useViewport':{useIsMobile:()=>mobile},
    '@/hooks/useAnomalyRecords':{useAnomalyRecords:(from,to)=>{calls.push([from,to]);return records;}},
    '@/lib/supabase/client':{supabaseBrowser(){
      if (!details) throw Error('database forbidden');
      return {from(table){const ops=[];detailCalls.push({table,ops});const q={
        select(...args){ops.push(['select',...args]);return q;},
        eq(...args){ops.push(['eq',...args]);return q;},
        single(){const response=details.shift();assert.ok(response,'unexpected detail query');return response.promise??Promise.resolve(response);},
      };return q;}};
    }},
    '@/lib/queries-me':{fetchNoteCountForEntity:async()=>0},
    '@/components/ui/filters':proxy,'@/components/ui/icons':proxy,
    '@/components/me/SavedFiltersDropdown':{__esModule:true,default:blank},'@/components/me/NoteDrawer':{__esModule:true,default:blank},
  };
  const C=load(mobile?'src/app/(app)/anomaly/MobileAnomalyView.tsx':'src/app/(app)/anomaly/page.tsx',mocks).default;
  return {C,calls,records,detailCalls,params:()=>params,navigate(value){params=new URLSearchParams(value);}};
}
for (const mobile of [false,true]) test(`actual ${mobile?'mobile':'desktop'} URL Back/Forward/repeated dates query selected endpoints and retain parameters`, async()=>{
  const h=componentHarness(mobile);let app;await act(async()=>app=create(React.createElement(h.C)));
  assert.ok(h.calls.every(([from,to])=>from==='2026-10-02'&&to==='2026-10-02'));
  for (const date of ['2026-10-03','2026-10-02','2026-10-03','2026-10-03']) {
    const offset=h.calls.length;h.navigate(`date=${date}&sev=hi&from=briefing`);
    await act(async()=>app.update(React.createElement(h.C)));
    assert.ok(h.calls.slice(offset).every(pair=>pair[0]===date&&pair[1]===date));
    assert.equal(h.params().get('sev'),'hi');assert.equal(h.params().get('from'),'briefing');
  }
  h.navigate('date=2026-02-29&sev=lo');await act(async()=>app.update(React.createElement(h.C)));
  assert.deepEqual(h.calls.at(-1),mobile?['2026-10-02',TODAY]:[TODAY,TODAY]);
  h.navigate('');await act(async()=>app.update(React.createElement(h.C)));
  assert.deepEqual(h.calls.at(-1),mobile?['2026-10-02',TODAY]:[TODAY,TODAY]);
  await act(async()=>app.unmount());
});

function queryHarness(responses) {
  const calls=[];
  const client={auth:{getUser:async()=>({data:{user:{id:'fixture'}},error:null}),onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};}},from(table){
    const ops=[];calls.push({table,ops});const result=responses.shift();assert.ok(result,'unexpected cross-day query');
    const q=new Proxy({}, {get:(_,method)=>method==='then'?((resolve,reject)=>Promise.resolve(result.promise??result).then(resolve,reject)):((...args)=>{ops.push([method,...args]);return q;})});return q;
  }};
  const mocks={'@/lib/supabase/client':{supabaseBrowser:()=>client},'@/lib/format':{kstToday:()=>TODAY}};
  const scope=load('src/hooks/useAnomalyDateScope.ts',mocks).useAnomalyDateScope;
  const reader=load('src/hooks/useAnomalyRecords.ts',mocks).useAnomalyRecords;
  let current;const paints=[];
  function Probe({date}){const {from,to}=scope(date);current=reader(from,to);paints.push({date,ids:current.rows.map(r=>r.id)});return null;}
  return {calls,Probe,paints,get current(){return current;}};
}
test('new URL date immediately hides old rows; stale responses cannot replace later data',async()=>{
  const old=deferred(),fresh=deferred();const h=queryHarness([old,fresh]);let app;
  await act(async()=>app=create(React.createElement(h.Probe,{date:'2026-10-02'})));
  await act(async()=>app.update(React.createElement(h.Probe,{date:'2026-10-03'})));
  await act(async()=>fresh.resolve({data:[{id:'new',detection_date:'2026-10-03'}],error:null}));
  await act(async()=>old.resolve({data:[{id:'old',detection_date:'2026-10-02'}],error:null}));
  assert.deepEqual(h.current.rows.map(r=>r.id),['new']);
  assert.ok(!h.paints.some(p=>p.date==='2026-10-03'&&p.ids.includes('old')));
  h.calls.forEach((call,i)=>{const date=i?'2026-10-03':'2026-10-02';assert.ok(call.ops.some(o=>o[0]==='gte'&&o[2]===date));assert.ok(call.ops.some(o=>o[0]==='lte'&&o[2]===date));});
  await act(async()=>app.unmount());
});
for (const failure of [false,true]) test(`selected day ${failure?'error':'empty'} does not query another day`,async()=>{
  const h=queryHarness([{data:failure?null:[],error:failure?new Error('fixture unavailable'):null}]);let app;
  await act(async()=>app=create(React.createElement(h.Probe,{date:'2026-10-02'})));
  assert.equal(h.calls.length,1);assert.deepEqual(h.current.rows,[]);assert.equal(h.current.error,failure?'fixture unavailable':null);
  assert.ok(h.calls[0].ops.some(o=>o[0]==='gte'&&o[2]==='2026-10-02'));
  await act(async()=>app.unmount());
});

test('existing id deep link is date bounded; late and wrong-day detail cannot replace current selection',async()=>{
  const old=deferred(),fresh=deferred();const h=componentHarness(false,[old,fresh]);
  h.records.identity='fixture';h.navigate('date=2026-10-02&id=same&sev=hi');let app;
  await act(async()=>app=create(React.createElement(h.C)));
  h.navigate('date=2026-10-03&id=same&sev=hi');await act(async()=>app.update(React.createElement(h.C)));
  const detail = (date,name) => ({id:'same',detection_date:date,detected_at:'2026-10-03T01:00:00Z',module:'product_planning',severity:'high',anomaly_type:'sold_out',entity_name:name,entity_type:null,entity_id:null,meta:null});
  await act(async()=>fresh.resolve({data:detail('2026-10-02','WRONG_DAY')}));
  await act(async()=>old.resolve({data:detail('2026-10-02','STALE_DAY')}));
  assert.doesNotMatch(JSON.stringify(app.toJSON()),/WRONG_DAY|STALE_DAY/);
  assert.equal(h.detailCalls.length,2);
  for (let i=0;i<2;i++) assert.ok(h.detailCalls[i].ops.some(o=>o[0]==='eq'&&o[1]==='detection_date'&&o[2]===['2026-10-02','2026-10-03'][i]));
  assert.equal(h.params().get('id'),'same');assert.equal(h.params().get('sev'),'hi');
  await act(async()=>app.unmount());
});
test('already loaded prior-day records disappear on first render of a newer URL date',async()=>{
  const fresh=deferred();const h=queryHarness([{data:[{id:'old',detection_date:'2026-10-02'}],error:null},fresh]);let app;
  await act(async()=>app=create(React.createElement(h.Probe,{date:'2026-10-02'})));
  assert.deepEqual(h.current.rows.map(r=>r.id),['old']);
  await act(async()=>app.update(React.createElement(h.Probe,{date:'2026-10-03'})));
  assert.ok(!h.paints.some(p=>p.date==='2026-10-03'&&p.ids.includes('old')));
  assert.deepEqual(h.current.rows,[]);
  await act(async()=>fresh.resolve({data:[],error:null}));assert.deepEqual(h.current.rows,[]);
  await act(async()=>app.unmount());
});


// Explicit render/passive-effect separation: real test renderer act() would flush
// effects and miss the window that these regressions protect.
function beforeEffectsHarness(mobile, responses) {
  let params=new URLSearchParams('date=2026-10-02&id=fixture');
  let identityKey='owner|1', cursor=0, tree;
  const slots=[], effects=[], pushes=[];
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const react={...React,
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},
    useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={value:{current:initial}};return slots[i].value;},
    useCallback(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={value:fn,deps};return slots[i].value;},
    useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const old=slots[i];slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}},
  };
  const fixture={id:'fixture',detected_at:'2026-10-02T01:00:00Z',detection_date:'2026-10-02',module:'product_planning',severity:'high',anomaly_type:'sold_out',entity_name:'OLD_DETAIL',entity_type:'product',entity_id:'p',meta:null};
  const proxy=new Proxy({}, {get:()=>blank});
  const mocks={react:{__esModule:true,...react,default:react},
    'next/navigation':{useSearchParams:()=>params,useRouter:()=>({push:route=>pushes.push(route)})},
    '@/hooks/useViewport':{useIsMobile:()=>mobile},'@/lib/format':{kstToday:()=>TODAY},
    '@/hooks/useAnomalyRecords':{useAnomalyRecords:()=>({rows:[fixture],identity:'owner',identityKey,loading:false,error:null,hasMore:false,loadMore(){},retry(){}})},
    '@/lib/supabase/client':{supabaseBrowser:()=>({from(){const q={select(){return q;},eq(){return q;},single(){const next=responses.shift();assert.ok(next,'unexpected fixture query');return next.promise??Promise.resolve(next);}};return q;}})},
    '@/lib/queries-me':{fetchNoteCountForEntity:async()=>0},
    '@/components/ui/filters':proxy,'@/components/ui/icons':proxy,
    '@/components/me/SavedFiltersDropdown':{__esModule:true,default:blank},'@/components/me/NoteDrawer':{__esModule:true,default:blank},
  };
  let C=load(mobile?'src/app/(app)/anomaly/MobileAnomalyView.tsx':'src/app/(app)/anomaly/page.tsx',mocks).default;
  if(!mobile){let element=C();while(element.type?.name!=='AnomalyPage'){element=typeof element.type==='function'?element.type(element.props):element.props.children;}C=element.type;}
  function render(){cursor=0;tree=C();return tree;}
  function find(node,predicate){if(!node||typeof node!=='object')return null;if(predicate(node))return node;return React.Children.toArray(node.props?.children).map(child=>find(child,predicate)).find(Boolean)??null;}
  return {fixture,pushes,render,get tree(){return tree;},find:predicate=>find(tree,predicate),
    flush(){while(effects.length){effects.shift()();render();}},
    navigate(date){params=new URLSearchParams(`date=${date}&id=fixture`);},identity(value){identityKey=value;},
  };
}
for(const change of ['date','identity'])test(`desktop old detail is masked in render before ${change} passive effects`,async()=>{
  const pending=deferred();const h=beforeEffectsHarness(false,[pending]);h.render();h.flush();
  pending.resolve({data:h.fixture});await Promise.resolve();h.render();
  assert.ok(h.find(node=>node.type?.name==='AnomalyDrawer'));
  if(change==='date')h.navigate('2026-10-03');else h.identity('owner|2');
  h.render(); // Intentionally do not flush the queued scope-clear effect.
  assert.equal(h.find(node=>node.type?.name==='AnomalyDrawer'),null);
});
for(const change of ['date','identity'])test(`desktop late detail cannot commit between ${change} render and passive effects`,async()=>{
  const pending=deferred();const h=beforeEffectsHarness(false,[pending]);h.render();h.flush();
  if(change==='date')h.navigate('2026-10-03');else h.identity('owner|2');h.render();
  pending.resolve({data:h.fixture});await Promise.resolve();h.render();
  assert.equal(h.find(node=>node.type?.name==='AnomalyDrawer'),null);
});
for(const change of ['date','identity'])for(const failure of [false,true])test(`mobile pending ${failure?'error':'product route'} ignored before ${change} effects`,async()=>{
  const pending=deferred();const h=beforeEffectsHarness(true,[pending]);h.render();h.flush();
  const button=h.find(node=>node.type==='button'&&node.props.children==='대상 보기');assert.ok(button);
  button.props.onClick({stopPropagation(){}});
  if(change==='date')h.navigate('2026-10-03');else h.identity('owner|2');h.render();
  pending.resolve(failure?{data:null,error:new Error('fixture lookup')}:{data:{musinsa_no:'OLD_PRODUCT'},error:null});
  await Promise.resolve();await Promise.resolve();h.render();
  assert.deepEqual(h.pushes,[]);assert.doesNotMatch(JSON.stringify(h.tree),/대상 정보를 조회할 수 없습니다/);
});
test('mobile prior lookup error is masked on new-date render without effect flushing',async()=>{
  const h=beforeEffectsHarness(true,[{data:null,error:new Error('fixture lookup')}]);h.render();h.flush();
  h.find(node=>node.type==='button'&&node.props.children==='대상 보기').props.onClick({stopPropagation(){}});
  await Promise.resolve();await Promise.resolve();h.render();assert.match(JSON.stringify(h.tree),/대상 정보를 조회할 수 없습니다/);
  h.navigate('2026-10-03');h.render();assert.doesNotMatch(JSON.stringify(h.tree),/대상 정보를 조회할 수 없습니다/);
});
