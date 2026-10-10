const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./helpers/load-source.cjs');
const { formatMatchingScore: format, getMatchingGrade: grade } = load('src/lib/matching-score.ts');

for (const [value, expected, expectedGrade] of [
  [100, '매칭 점수 100점', 'A'], [90, '매칭 점수 90점', 'A'],
  [85, '매칭 점수 85점', 'A'], [70, '매칭 점수 70점', 'A'],
  [65, '매칭 점수 65점', 'B'], [60, '매칭 점수 60점', 'B'],
  [50, '매칭 점수 50점', 'B'], [35, '매칭 점수 35점', 'B'],
  [0, '매칭 점수 0점', 'B'], [1, '매칭 점수 1점', 'B'],
  [0.9, '매칭 점수 0.9점', 'B'], [69.99, '매칭 점수 69.99점', 'B'],
  [null, '점수 없음', null], [undefined, '점수 없음', null],
  ...[-1, 100.01, 10000, NaN, Infinity, -Infinity, '100', '', {}, true]
    .map(v => [v, '점수 확인 필요', null]),
]) {
  test(`point display and grade: ${String(value)}`, () => {
    assert.equal(format(value), expected);
    assert.equal(grade('auto', value), expectedGrade);
    for (const status of ['confirmed', 'excluded', 'unknown']) assert.equal(grade(status, value), null);
    assert.ok(!format(value).includes('%'));
  });
}

// Execute the real query functions against a recording, entirely offline client.
function queryHarness(responses) {
  const calls = [];
  const supabase = { from(table) {
    const ops = [];
    calls.push({ table, ops });
    const query = new Proxy({}, { get(_, method) {
      if (method === 'then') return (resolve, reject) => {
        assert.ok(responses.length, `Unexpected query ${table}: ${JSON.stringify(ops)}`);
        const response = responses.shift();
        return Promise.resolve({data:null,error:null,status:200,count:Array.isArray(response?.data)?response.data.length:null,...response}).then(resolve, reject);
      };
      return (...args) => { ops.push([method, ...args]); return query; };
    }});
    return query;
  }};
  return { calls, queries: load('src/lib/queries.ts', { './supabase/client': { supabaseBrowser: () => supabase } }) };
}
for (const [level, expectedA, expectedB] of [[0,100,65],[1,90,60],[2,85,50],[3,70,35]]) {
  test(`auto producer tier ${level} preserves raw points and ranking flow`, async () => {
    const responses = [
      {data:{brand_id:'own-brand',category_code:'001',category_d2_code:'001004',category_path:'상의 > 티셔츠 > 긴팔'}},
      {data:[{brand_id:'pool-brand'}]},
      ...Array.from({length:level * 2}, () => ({data:[]})),
      {data:[{id:'a-product'}]}, {data:[{id:'b-product'}]},
      {data:[],error:null}, {error:null}, {error:null},
    ];
    const {calls, queries} = queryHarness(responses);
    assert.equal(await queries.runAutoMatch('own-product'), 2);
    assert.equal(responses.length, 0);
    const inserted = calls.flatMap(c => c.ops).find(o => o[0] === 'insert')[1];
    assert.deepEqual(inserted.map(r => [r.competitor_product_id,r.score,r.status]),
      [['a-product',expectedA,'auto'],['b-product',expectedB,'auto']]);
    assert.equal(grade('auto', inserted[0].score), 'A');
    assert.equal(grade('auto', inserted[1].score), 'B');
    assert.ok(calls.some(c => c.ops.some(o => o[0] === 'order' && o[1] === 'review_count')));
  });
}
test('manual matches retain null and confirmation retains score', async () => {
  const {calls,queries} = queryHarness([{error:null},{error:null}]);
  await queries.addManualMatch('own','competitor');
  await queries.setMatchStatus('match','confirmed');
  const ops = calls.flatMap(c => c.ops);
  assert.equal(ops.find(o => o[0] === 'upsert')[1].score, null);
  assert.equal(ops.find(o => o[0] === 'upsert')[1].status, 'confirmed');
  assert.ok(!Object.hasOwn(ops.find(o => o[0] === 'update')[1], 'score'));
});
test('read adapter keeps scores unchanged, sorted descending and excludes excluded matches', async () => {
  const {calls,queries} = queryHarness([{data:[{id:'m',competitor_product_id:'c',status:'auto',score:100,products:{}}]}]);
  const rows = await queries.fetchProductMatches('own');
  assert.equal(rows[0].score, 100);
  assert.ok(calls[0].ops.some(o => o[0] === 'order' && o[1] === 'score' && o[2].ascending === false));
  assert.ok(calls[0].ops.some(o => o[0] === 'neq' && o[1] === 'status' && o[2] === 'excluded'));
});

test('mobile renders real score 100 as points and explains category priority', () => {
  const states = [[], 'brand', [], {id:'own',name:'선택 상품'}, [
    {id:'m',score:100,status:'auto',competitor_name:'경쟁 상품',competitor_brand:'브랜드',competitor_musinsa_no:'123'},
    {id:'manual',score:null,status:'confirmed',competitor_name:'직접 추가',competitor_brand:'브랜드',competitor_musinsa_no:'456'},
  ], false, false, {ready:true,userId:'account-1',epoch:0}, {brands:null,products:null,matches:null}, {brands:0,products:0,matches:0}, false];
  const {default: Mobile} = load('src/app/(app)/matching/MobileMatchingView.tsx', {
    react:{...React,useState:()=>[states.shift(),()=>{}],useEffect:()=>{}},
    'next/link':({children, ...props})=>React.createElement('a', props, children),
    '@/lib/queries':{},
  });
  const html = renderToStaticMarkup(React.createElement(Mobile));
  assert.match(html, /매칭 점수 100점/);
  assert.match(html, /점수 없음/);
  assert.match(html, /카테고리와 경쟁 브랜드 풀/);
  assert.match(html, /href="\/product\?no=123"/);
  assert.doesNotMatch(html, /10000%|유사도 100|유사 경쟁 상품/);
});

test('both viewports share formatting; desktop badges, counts and filters share validation', () => {
  const root = path.join(__dirname,'../src/app/(app)/matching');
  const desktop = fs.readFileSync(path.join(root,'page.tsx'),'utf8');
  const mobile = fs.readFileSync(path.join(root,'MobileMatchingView.tsx'),'utf8');
  for (const src of [desktop,mobile]) {
    assert.match(src, /formatMatchingScore\(m.score\)/);
    assert.match(src, /\{MATCHING_SCORE_HELP\}/);
    assert.doesNotMatch(src, /m.score\s*\*\s*100|\{m.score\}%|fmtScore/);
  }
  assert.equal((desktop.match(/getMatchingGrade\(m.status, m.score\)/g)||[]).length,5);
  assert.doesNotMatch(desktop, /m.score\s*\?\?\s*0/);
  assert.match(desktop, /flexWrap: 'wrap'/);
});

for (const filter of ['all','a','b','confirmed']) {
  test(`desktop renders consistent total, grade counts and ${filter} filter with unknown/manual rows`, () => {
    const rows = [
      ['a',100,'auto'], ['b',65,'auto'], ['missing',null,'auto'],
      ['invalid',10000,'auto'], ['manual',null,'confirmed'],
    ].map(([id,score,status]) => ({id,score,status,competitor_product_id:id,
      competitor_review_count:0, competitor_name:`candidate-${id}`, competitor_brand:'브랜드',competitor_musinsa_no:id}));
    const states = ['products',
      [], new Set(), '', '', '', '', '', '', 0,
      [], 0, false,
      {id:'own',name:'선택 상품'}, rows, false,
      false, null, filter,
      '', [], false, null,
      {ready:true,userId:'account-1',epoch:0}, {brands:null,products:null},
    ];
    const {default: Desktop} = load('src/app/(app)/matching/page.tsx', {
      react:{...React,useState:()=>[states.shift(),()=>{}],useEffect:()=>{},
        useRef:(v)=>({current:v}),useMemo:(fn)=>fn(),useCallback:(fn)=>fn},
      '@/hooks/useViewport':{useIsMobile:()=>false},
      'next/link':({children,...props})=>React.createElement('a',props,children),
      '@/lib/queries':{CATEGORY_MAP:{}},
    });
    const html = renderToStaticMarkup(React.createElement(Desktop));
    assert.equal(states.length,0);
    assert.match(html,/전체 5/);
    assert.match(html,/A등급 1/);
    assert.match(html,/B등급 1/);
    assert.match(html,/확정 1/);
    const expected = filter === 'all' ? ['a','b','missing','invalid','manual']
      : filter === 'confirmed' ? ['manual'] : [filter];
    for (const row of rows) assert.equal(html.includes(`candidate-${row.id}`),expected.includes(row.id));
    if (filter === 'all') {
      assert.match(html,/매칭 점수 100점/);
      assert.match(html,/점수 없음/);
      assert.match(html,/점수 확인 필요/);
    }
    assert.match(html,/카테고리와 경쟁 브랜드 풀/);
    assert.doesNotMatch(html.replace(/<[^>]*>/g, ""),/10000%|100%/);
  });
}
