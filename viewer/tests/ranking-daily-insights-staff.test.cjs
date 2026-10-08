const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), Renderer = require('react-test-renderer');
const load = require('./helpers/load-source.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { staffDailyPlanningScope } = load('src/lib/staff-daily-planning.ts');
const { dailyRequest } = load('src/lib/ranking-daily-insights.ts');
test('briefing cutoff uses calendar D−1 across year/month/leap boundaries and rejects invalid/future dates', () => {
  for (const [date, expected] of [['2026-01-01','2025-12-31'],['2024-03-01','2024-02-29'],['2025-03-01','2025-02-28'],['2026-10-08','2026-10-07']]) {
    const scope = staffDailyPlanningScope(date, '2026-10-08');
    assert.deepEqual(dailyRequest(scope), {categoryCode:'000',genderFilter:'A',ageFilter:'AGE_BAND_ALL',date:expected});
    assert.equal(scope.resolvedFromDate, expected);
  }
  for (const date of ['2025-02-29','2026-02-30','bad','2026-10-09','2000-01-01']) assert.equal(staffDailyPlanningScope(date,'2026-10-08'),null);
});
test('KST midnight changes the eligible briefing day without using host-local timezone', () => {
  const { kstToday } = load('src/lib/format.ts');
  const OriginalDate = global.Date;
  try {
    for (const [instant, expected] of [['2026-10-07T14:59:59Z','2026-10-07'],['2026-10-07T15:00:00Z','2026-10-08']]) {
      global.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : [instant])); } };
      assert.equal(kstToday(), expected);
      assert.equal(dailyRequest(staffDailyPlanningScope(expected,kstToday())).date, expected === '2026-10-07' ? '2026-10-06' : '2026-10-07');
    }
  } finally { global.Date = OriginalDate; }
});
function fixture() {
  let search='tab=staff&date=2026-10-08', mobile=false, path='/today', user='account-a';
  const calls=[], listeners=new Set();
  const empty = () => null;
  const mocks={
    'next/navigation':{usePathname:()=>path,useSearchParams:()=>new URLSearchParams(search),useRouter:()=>({push(href){search=new URL(href,'https://fixture.test').search.slice(1)}})},
    'next/link':{__esModule:true,default:p=>React.createElement('a',p)},
    '@/hooks/useViewport':{useIsMobile:()=>mobile}, '@/hooks/useKstToday':{useKstToday:()=> '2026-10-08'},
    '@/lib/format':{kstDaysAgo:()=> '2026-10-08'},
    '@/lib/queries':{CATEGORY_MAP:{'000':'전체'},AGE_MAP:{AGE_BAND_ALL:'전체'}},
    '@/lib/supabase/client':{supabaseBrowser:()=>({auth:{getUser:async()=>({data:{user:user?{id:user}:null}}),onAuthStateChange(fn){listeners.add(fn);return{data:{subscription:{unsubscribe(){listeners.delete(fn)}}}}}}})},
    '@/lib/queries-ranking-daily':{fetchRankingDaily:(request,signal)=>new Promise((resolve,reject)=>calls.push({request,signal,resolve,reject}))},
    '@/lib/cs-daily-review-context':{useCSDailyReviewState:()=>null},
    '@/hooks/useBriefingRead':{useBriefingScope:()=>({}),useBriefingRead:()=>({value:null,loading:false,loaded:true,retry(){}})},
    '@/components/briefing/BriefingReadStatus':{__esModule:true,default:empty},
  };
  for(const id of ['BriefingTabs','ExecutiveBriefingView','StaffBriefingView','CSBriefingView','CSDailyReviewCheck']) mocks['@/components/briefing/'+id]={__esModule:true,default:empty};
  for(const id of ['MobileBriefingTabs','MobileBriefingHeadline','MobileBriefingCard','MobileBriefingInsight','MobileNewsPickList']) mocks['./'+id]={__esModule:true,default:empty};
  const provider=load('src/components/ranking/RankingDailyProvider.tsx',mocks);
  mocks['./RankingDailyProvider']=provider;mocks['@/components/ranking/RankingDailyProvider']=provider;
  const Page=load('src/app/(app)/today/page.tsx',mocks).default;
  function App(){return React.createElement(provider.default,null,path==='/today'?React.createElement(Page):null);}
  const response=(call,patch={})=>{
    const req=call.request,date=req.date, previousDate=load('src/lib/ranking-daily-insights.ts').previousCalendarDate(date);
    const row=(day,rank)=>({store_code:'musinsa',snapshot_date:day,category_code:'000',gender_filter:'A',age_filter:'AGE_BAND_ALL',musinsa_no:user==='account-a'?'1':'2',rank_position:rank,product_name:'stored product',final_price:10000,discount_rate:10});
    return{request:req,date,previousDate,current:[row(date,1)],previous:[row(previousDate,10)],...patch};
  };
  return{App,calls,response,setSearch(v){search=v},setMobile(v){mobile=v},setPath(v){path=v},auth(event,id){user=id;for(const fn of [...listeners])fn(event,id?{user:{id}}:null)}};
}
async function update(f,root){await React.act(async()=>root.update(React.createElement(f.App)));}
const articles=root=>root.root.findAllByType('article');
const memo=root=>root.root.findAllByType('a').find(x=>x.props.children==='이 관측 메모');
test('actual Today desktop/mobile show independent Staff stored cards, pin dates, retain responsive reads and invalidate navigation/auth/retry',async()=>{
  const f=fixture();let root;
  try {
    await React.act(async()=>{root=Renderer.create(React.createElement(f.App))});
    assert.equal(f.calls.length,1);assert.equal(f.calls[0].request.date,'2026-10-07');
    await React.act(async()=>f.calls[0].resolve(f.response(f.calls[0])));
    assert.equal(articles(root).length,1);assert.ok(root.root.findAllByType('h3').some(x=>x.props.children==='오늘 영업기획 확인'));
    const memoParams = new URL(memo(root).props.href,'https://fixture.test').searchParams;
    assert.equal(memoParams.get('resolvedToDate'),'2026-10-07');
    assert.equal(memoParams.get('category'),'000'); assert.equal(memoParams.get('gender'),'A'); assert.equal(memoParams.get('age'),'AGE_BAND_ALL');
    const productParams = new URL(articles(root)[0].findByType('a').props.href,'https://fixture.test').searchParams;
    assert.equal(productParams.get('date'),'2026-10-07');
    assert.match(JSON.stringify(root.toJSON()), /AI 브리핑 생성 여부와 별개/);
    for(const mobile of [true,false,true]){f.setMobile(mobile);await update(f,root);assert.equal(f.calls.length,1);assert.equal(articles(root).length,1);}
    const historical='tab=staff&date=2024-03-01';f.setSearch(historical);await update(f,root);const old=f.calls.at(-1);assert.equal(old.request.date,'2024-02-29');assert.equal(articles(root).length,0);assert.equal(memo(root),undefined);
    f.setSearch('tab=staff&date=2026-01-01');await update(f,root);assert.ok(old.signal.aborted);const current=f.calls.at(-1);assert.equal(current.request.date,'2025-12-31');
    await React.act(async()=>old.resolve(f.response(old)));assert.equal(memo(root),undefined);
    await React.act(async()=>current.resolve(f.response(current,{previous:[]})));assert.equal(articles(root).length,0);
    assert.match(JSON.stringify(root.toJSON()), /더 오래된 날짜로 대체하지 않습니다/);
    // Simulated Back/Forward URL transitions acquire only their explicit dates.
    f.setSearch(historical);await update(f,root);assert.equal(f.calls.at(-1).request.date,'2024-02-29');
    f.setSearch('tab=staff&date=2026-01-01');await update(f,root);const failed=f.calls.at(-1);
    await React.act(async()=>failed.reject(Error('unavailable')));assert.equal(root.root.findAllByProps({role:'alert'}).length,1);
    await React.act(async()=>root.root.findAllByType('button').find(x=>x.props.children==='다시 조회').props.onClick());const retry=f.calls.at(-1);
    await React.act(async()=>retry.resolve(f.response(retry)));assert.equal(articles(root).length,1);
    await React.act(async()=>f.auth('SIGNED_IN','account-b'));assert.equal(articles(root).length,0);const switched=f.calls.at(-1);
    await React.act(async()=>f.auth('SIGNED_OUT',null));assert.ok(switched.signal.aborted);assert.equal(memo(root),undefined);
    await React.act(async()=>switched.resolve(f.response(switched)));assert.equal(articles(root).length,0);
    await React.act(async()=>f.auth('SIGNED_IN','account-a'));const pending=f.calls.at(-1);
    f.setSearch('tab=cs&date=2026-01-01');await update(f,root);assert.ok(pending.signal.aborted);const count=f.calls.length;
    for(const search of ['tab=executive','tab=staff&date=2026-10-09','tab=staff&date=2026-02-30','tab=staff&date=bad']){f.setSearch(search);await update(f,root);assert.equal(f.calls.length,count);assert.equal(articles(root).length,0);}
    f.setSearch('tab=staff&date=2026-10-08');await update(f,root);const exit=f.calls.at(-1);f.setPath('/me');await update(f,root);assert.ok(exit.signal.aborted);
  } finally {if(root)await React.act(async()=>root.unmount());}
});
