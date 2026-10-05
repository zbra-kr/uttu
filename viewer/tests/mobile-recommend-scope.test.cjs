const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, row } = require('./helpers/recommend-state-fixture.cjs');
const bounds = f => f.calls.at(-1).params.filter(([key]) => key === 'snapshot_date').map(([, value]) => value.slice(4));

test('recommend KST bounds use UTC calendar arithmetic in non-KST DST browser timezones', () => {
  const { execFileSync } = require('node:child_process');
  for (const timezone of ['America/New_York', 'Asia/Seoul', 'UTC']) {
    const output = execFileSync(process.execPath, ['-e', `const load=require('./tests/helpers/load-source.cjs');const {recommendRequestWindow}=load('src/app/(app)/recommend/MobileRecommendView.tsx',{'@/lib/supabase/client':{}});console.log(JSON.stringify(recommendRequestWindow(Date.parse('2026-11-01T15:30:00Z'))))`], { encoding: 'utf8', cwd: require('node:path').resolve(__dirname, '..'), env: { ...process.env, TZ: timezone } });
    assert.deepEqual(JSON.parse(output), { fromDate: '2026-10-26', today: '2026-11-02' });
  }
});

test('recommend completion across KST midnight and ordinary rerender retain actual request window without auto-refresh', async () => {
  const original = Date.now; let now = Date.parse('2026-10-05T14:59:59Z'); Date.now = () => now;
  let f;
  try {
    f = await fixture(); assert.deepEqual(bounds(f), ['2026-09-28', '2026-10-05']);
    now = Date.parse('2026-10-05T15:00:01Z');
    await f.settle(0, [row('A')]); await f.rerender();
    assert.equal(f.calls.length, 1);
    assert.ok(f.snapshot().tree.includes('2026-09-28')); assert.ok(f.snapshot().tree.includes('2026-10-05'));
    assert.ok(!f.snapshot().tree.includes('2026-10-06'));
    await f.select('M'); assert.deepEqual(bounds(f), ['2026-09-29', '2026-10-06']);
    assert.ok(f.snapshot().tree.includes('2026-09-29')); assert.ok(f.snapshot().tree.includes('2026-10-06'));
  } finally { if (f) await f.close(); Date.now = original; }
});

test('recommend failed request retains captured dates across rollover; explicit retry captures new eight-day window', async () => {
  const original = Date.now; let now = Date.parse('2026-10-05T14:59:59Z'); Date.now = () => now;
  let f;
  try {
    f = await fixture(); now = Date.parse('2026-10-05T15:00:01Z');
    await f.settle(0, [], true); await f.rerender();
    assert.ok(f.snapshot().tree.includes('2026-09-28')); assert.ok(!f.snapshot().tree.includes('2026-10-06'));
    await f.invoke(f.retry()); assert.deepEqual(bounds(f), ['2026-09-29', '2026-10-06']);
    assert.ok(f.snapshot().tree.includes('2026-10-06'));
    now = Date.parse('2026-10-06T15:00:01Z'); await f.settle(1, [row('A')]); await f.rerender();
    assert.equal(f.calls.length, 2); assert.ok(f.snapshot().tree.includes('2026-10-06')); assert.ok(!f.snapshot().tree.includes('2026-10-07'));
  } finally { if (f) await f.close(); Date.now = original; }
});

test('recommend discloses actual inclusive KST bounds and unchanged total cap during loading', async () => {
  const f = await fixture();
  try {
    const params = Object.fromEntries(f.calls[0].params), text = f.snapshot().tree;
    const bounds = f.calls[0].params.filter(([key]) => key === 'snapshot_date').map(([, value]) => value.slice(4));
    assert.equal((Date.parse(bounds[1]) - Date.parse(bounds[0])) / 86400000, 7);
    bounds.forEach(date => assert.ok(text.includes(date)));
    assert.ok(text.includes('KST, 양끝 포함 8일'));
    assert.ok(text.includes('기간 전체에서 최신순 최대 100개'));
    assert.equal(params.limit, '100');
    assert.deepEqual(f.snapshot().kpis, ['—', '—']);
    assert.ok(!text.includes('100개 조회:'));
  } finally { await f.close(); }
});

test('recommend below cap keeps duplicate item-list lengths without claiming unique products', async () => {
  const f = await fixture();
  try {
    await f.settle(0, [row('A'), { ...row('A'), id: 'same-list-second-module' }]);
    const s = f.snapshot();
    assert.deepEqual(s.kpis, ['2', '14']);
    assert.ok(s.tree.includes('중복을 포함할 수 있습니다'));
    assert.ok(s.tree.includes('실제 노출 수·고유 상품 수·시장 전체 합계가 아닙니다'));
    assert.ok(!s.tree.includes('100개 조회:'));
  } finally { await f.close(); }
});

test('recommend at cap reports unknown completeness and clears cap message on error or empty', async () => {
  const f = await fixture();
  try {
    await f.settle(0, Array.from({ length: 100 }, (_, index) => ({ ...row('A'), id: String(index) })));
    assert.ok(f.snapshot().tree.includes('전체 데이터가 포함되었는지는 알 수 없습니다'));
    await f.select('M');
    assert.ok(!f.snapshot().tree.includes('100개 조회:'));
    await f.settle(1, [], true);
    assert.deepEqual(f.snapshot().kpis, ['—', '—']);
    assert.ok(!f.snapshot().tree.includes('100개 조회:'));
    await f.invoke(f.retry()); await f.settle(2, []);
    assert.deepEqual(f.snapshot().kpis, ['0', '0']);
    assert.ok(!f.snapshot().tree.includes('100개 조회:'));
  } finally { await f.close(); }
});

test('recommend missing dates remain absent rather than zero-filled and chart discloses coverage limits', async () => {
  const f = await fixture();
  try {
    await f.settle(0, [{ ...row('A'), snapshot_date: '2026-10-02', items_count: 11 }, row('A')]);
    const s = f.snapshot();
    assert.deepEqual(s.charts[0].map(x => [x.date, x.items]), [['10-02', 11], ['10-05', 7]]);
    assert.ok(s.tree.includes('조회분 상품 항목 추이'));
    assert.ok(s.tree.includes('빠진 날짜는 0이 아니며, 날짜별 전체 수집 여부는 확인되지 않았습니다'));
  } finally { await f.close(); }
});
