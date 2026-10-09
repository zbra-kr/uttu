const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const load = require('./helpers/load-source.cjs');
const View = load('src/components/briefing/BriefingKpiRow.tsx', {
  'next/link': { __esModule:true, default: p => React.createElement('a',p) },
}).default;
const render = data => renderToStaticMarkup(React.createElement(View, {
  ownBrands:data.own_brands, anomalies:data.anomalies, competitor_top5:data.competitor_top5, metadata:data,
}));
function fixture(patch={}) {
  const calls=[];
  const client = { from(table) {
    const call={table,filters:[],limit:null,signal:null};calls.push(call);
    const q={ select(cols,options){call.options=options;return q;},
      in(...a){call.filters.push(['in',...a]);return q;},eq(...a){call.filters.push(['eq',...a]);return q;},
      gte(...a){call.filters.push(['gte',...a]);return q;},lte(...a){call.filters.push(['lte',...a]);return q;},
      order(...a){call.order=a;return q;},limit(n){call.limit=n;return q;},abortSignal(s){call.signal=s;return q;},
      then(a,b){ const value=patch[table]??{data:[],count:0,error:null};return Promise.resolve(typeof value==='function'?value():value).then(a,b); },
      insert(){assert.fail('write');},rpc(){assert.fail('rpc');} };return q;
  }};
  return {...load('src/lib/queries-kpi.ts',{'./supabase/client':{supabaseBrowser:()=>client}}),calls};
}
const result=(data,count=data.length)=>({data,count,error:null});
const ranking=n=>Array.from({length:n},()=>({brand_slug:'covernat',snapshot_date:'2026-10-02',rank_position:20}));
const anomalies=n=>Array.from({length:n},()=>({severity:'low',detection_date:'2026-10-08'}));
for(const n of [1999,2000,2001]) test(`ranking ${n}: bounded coverage gates real metric`,async()=>{
  const rows=ranking(n);rows[n-1]={...rows[n-1],snapshot_date:'2026-10-08',rank_position:7};
  const f=fixture({ranking_snapshots:result(rows.slice(0,2000),n)}),v=await f.fetchBriefingKpiData('2026-10-09');
  assert.equal(v.rank_status,n>2000?'truncated':'complete');
  assert.equal(v.own_brands[0].best_rank_yesterday,n>2000?null:7);
  assert.match(render(v),n>2000?/집계 보류/:/#7/);
  assert.equal(f.calls.length,4); assert.equal(f.calls[0].limit,2000);assert.deepEqual(f.calls[0].options,{count:'exact'});
});
for(const n of [299,300,301]) test(`anomaly ${n}: exact count coverage, bounded sample honesty`,async()=>{
  const rows=anomalies(n); rows[n-1].severity='HIGH';
  const f=fixture({anomalies:result(rows.slice(0,300),n)}),v=await f.fetchBriefingKpiData('2026-10-09'),html=render(v);
  assert.equal(v.anomaly_status,n>300?'truncated':'complete'); assert.equal(v.anomalies.high,n>300?0:1);
  assert.match(html,n>300?/제한 표본 300건/:new RegExp(`조회 총 ${n}건`));
  if(n>300){assert.doesNotMatch(html,/조회 총 300건|전체 건수 미확인/);assert.match(html,/전체 분포 미확인/);}
  assert.equal(f.calls.length,4);assert.equal(f.calls[2].limit,300);assert.deepEqual(f.calls[2].options,{count:'exact'});
});
test('server cap, unknown counts, invalid counts never establish complete coverage',async()=>{
  for(const count of [2000,null,undefined,-1,NaN,1.5,999]){
    const f=fixture({ranking_snapshots:{data:ranking(1000),count,error:null},anomalies:{data:anomalies(100),count,error:null}});
    const v=await f.fetchBriefingKpiData('2026-10-09');assert.equal(v.rank_status,'truncated');assert.equal(v.anomaly_status,'truncated');
    assert.equal(v.own_brands[0].weekly_trend.length,0);assert.match(render(v),/표본/);
  }
});
test('invalid rank/date/brand withholds aggregation; valid zero renders zero',async()=>{
  for(const patch of [{rank_position:null},{rank_position:'7'},{rank_position:0},{rank_position:-1},{rank_position:NaN},{rank_position:1.2},
    {snapshot_date:'2026-02-30'},{snapshot_date:'2026-10-01'},{snapshot_date:'2026-10-10'},{snapshot_date:'2026-10-08T00:00:00Z'},{brand_slug:'other'}]){
    const v=await fixture({ranking_snapshots:result([{...ranking(1)[0],...patch}])}).fetchBriefingKpiData('2026-10-09');
    assert.equal(v.rank_status,'invalid');assert.equal(v.own_brands[0].best_rank_yesterday,null);assert.match(render(v),/유효하지 않은 자료/);
  }
  const v=await fixture().fetchBriefingKpiData('2026-10-09');assert.equal(v.rank_status,'complete');assert.equal(v.anomaly_status,'complete');
  assert.match(render(v),/조회 총 0건/);assert.match(render(v),/조회 결과 0건/);assert.doesNotMatch(render(v),/집계 중|수집 중|어제/);
});
test('unknown severity is never LOW and remains visible',async()=>{
  for(const severity of [null,4,'urgent','',{}]){
    const v=await fixture({anomalies:result([{severity,detection_date:'2026-10-08'}])}).fetchBriefingKpiData('2026-10-09');
    assert.equal(v.anomaly_status,'invalid');assert.equal(v.anomalies.low,0);assert.equal(v.anomalies.unknown,1);assert.match(render(v),/자료 미확인 1건/);
  }
});
test('HTTP and rejected reads preserve independent healthy sections, use fallback brand names',async()=>{
  for(const table of ['ranking_snapshots','brands','anomalies','brand_ranking_snapshots'])for(const failure of [{data:null,error:{code:'403'}},()=>Promise.reject(Error('offline'))]){
    const f=fixture({[table]:failure}),v=await f.fetchBriefingKpiData('2026-10-09');
    const key={ranking_snapshots:'rank_status',anomalies:'anomaly_status',brand_ranking_snapshots:'competitor_status'}[table];
    if(key)assert.equal(v[key],'unavailable');for(const other of ['rank_status','anomaly_status','competitor_status'])if(other!==key)assert.equal(v[other],'complete');
    assert.equal(v.own_brands[0].name,'covernat');if(key)assert.match(render(v),/읽기 실패/);
  }
});
test('competitor intended top5 scope is distinct from total rows and detects short server cap',async()=>{
  const rows=Array.from({length:5},(_,i)=>({musinsa_brand_slug:`brand${i}`,brand_name:`Brand ${i}`,rank_position:i+1,snapshot_date:'2026-10-08'}));
  let v=await fixture({brand_ranking_snapshots:result(rows,100)}).fetchBriefingKpiData('2026-10-09');assert.equal(v.competitor_status,'complete');assert.equal(v.competitor_top5.length,5);
  v=await fixture({brand_ranking_snapshots:result(rows.slice(0,2),100)}).fetchBriefingKpiData('2026-10-09');assert.equal(v.competitor_status,'truncated');assert.equal(v.competitor_top5.length,0);
  v=await fixture({brand_ranking_snapshots:result([{...rows[0],rank_position:0}])}).fetchBriefingKpiData('2026-10-09');assert.equal(v.competitor_status,'invalid');
});
test('historical, year-end and leap dates are UTC-calendar independent and preserve D-1 links',async()=>{
  const old=process.env.TZ;
  try {for(const tz of ['UTC','Asia/Seoul','America/Los_Angeles']){process.env.TZ=tz;
    for(const [date,source,since]of [['2026-01-01','2025-12-31','2025-12-25'],['2024-03-01','2024-02-29','2024-02-23'],['2025-03-01','2025-02-28','2025-02-22']]){
      const f=fixture(),v=await f.fetchBriefingKpiData(date),html=render(v);assert.equal(v.source_date,source);assert.equal(v.since,since);
      assert.match(html,new RegExp(`/anomaly\\?date=${source}`));assert.match(html,/KST/);assert.match(html,/모든 카테고리\/스토어 혼합/);assert.doesNotMatch(html,/어제/);
      assert.ok(f.calls[2].filters.some(x=>x[1]==='detection_date'&&x[2]===source));
    }
  }}finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}
});
test('invalid requested date rejects before any reads; repeated reads have bounded request count and signal',async()=>{
  for(const date of ['2026-02-29','2026-13-01','x','2026-1-01','2026-02-30']){const f=fixture();await assert.rejects(f.fetchBriefingKpiData(date),/Invalid/);assert.equal(f.calls.length,0);}
  const f=fixture(),controller=new AbortController();for(let i=0;i<3;i++)await f.fetchBriefingKpiData('2026-10-09',controller.signal);
  assert.equal(f.calls.length,12);assert.ok(f.calls.every(c=>c.signal===controller.signal));
});


test('mixed category/store minimum, daily delta and weekly trend retain existing meaning',async()=>{
  const rows=[{brand_slug:'covernat',snapshot_date:'2026-10-07',rank_position:10},
    {brand_slug:'covernat',snapshot_date:'2026-10-08',rank_position:20,category_code:'001',store_code:'other'},
    {brand_slug:'covernat',snapshot_date:'2026-10-08',rank_position:7,category_code:'002',store_code:'musinsa'}];
  const f=fixture({ranking_snapshots:result(rows)}),v=await f.fetchBriefingKpiData('2026-10-09');
  assert.equal(v.own_brands[0].best_rank_yesterday,7);assert.equal(v.own_brands[0].rank_delta,3);
  assert.deepEqual(v.own_brands[0].weekly_trend,[{date:'2026-10-07',best_rank:10},{date:'2026-10-08',best_rank:7}]);
  assert.match(render(v),/↑3/);assert.match(render(v),/2026-10-08 최고순위/);
  assert.ok(!f.calls[0].filters.some(x=>['category_code','store_code'].includes(x[1])));
});
test('malformed rows and wrong evidence dates stay local to their section',async()=>{
  for(const row of [null,{severity:'high',detection_date:'2026-02-30'},{severity:'high',detection_date:'2026-10-07'}]){
    const v=await fixture({anomalies:result([row])}).fetchBriefingKpiData('2026-10-09');
    assert.equal(v.anomaly_status,'invalid');assert.equal(v.rank_status,'complete');assert.match(render(v),/유효하지 않은 자료/);
    assert.doesNotMatch(render(v),/조회 총 0건/);
  }
  const v=await fixture({ranking_snapshots:result([null]),brands:{data:{},error:null}}).fetchBriefingKpiData('2026-10-09');
  assert.equal(v.rank_status,'invalid');assert.equal(v.anomaly_status,'complete');assert.equal(v.own_brands[0].name,'covernat');
});
