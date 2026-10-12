const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./helpers/load-source.cjs');
function fixture(links, snaps) {
  const calls = [];
  const client = { from(table) {
    const methods = []; calls.push({ table, methods });
    const q = { then(resolve, reject) { return Promise.resolve({ data: table === 'snap_profile_snaps' ? links : snaps }).then(resolve, reject); } };
    for (const method of ['select', 'in', 'gte', 'lte', 'limit']) q[method] = (...args) => { methods.push([method, ...args]); return q; };
    return q;
  } };
  return { calls, query: load('src/lib/queries-snap.ts', { './supabase/client': { supabaseBrowser: () => client } }).getProfileSnapStats };
}
const snap = { snap_id: 's1', like_count: 100, view_count: 1000, scrap_count: 13, goods_click_count: 17, comment_count: 19 };
const expected = (id, n = 1) => ({ profile_id: id, total_likes: 100*n, total_views: 1000*n, total_scraps: 13*n, total_goods_click: 17*n, total_comments: 19*n });
const run = f => f.query(['p1', 'p2'], '2026-10-01', '2026-10-07');
test('seven daily observations count each profile/snap once across every reaction metric', async () => {
  const links = Array.from({length: 7}, (_, i) => ({profile_id: 'p1', snap_id: 's1', snapshot_date: `2026-10-0${i+1}`}));
  const f = fixture(links, [snap]);
  assert.deepEqual((await run(f)).get('p1'), expected('p1'));
  assert.deepEqual(f.calls, [
    {table: 'snap_profile_snaps', methods: [['select', 'profile_id, snap_id'], ['in', 'profile_id', ['p1', 'p2']], ['gte', 'snapshot_date', '2026-10-01'], ['lte', 'snapshot_date', '2026-10-07'], ['limit', 5000]]},
    {table: 'snaps', methods: [['select', 'snap_id, like_count, view_count, scrap_count, goods_click_count, comment_count'], ['in', 'snap_id', ['s1']], ['limit', 5000]]},
  ]);
});
test('duplicate rows and order preserve distinct snaps and profiles, including delimiter-like IDs', async () => {
  const links = [{profile_id:'p1',snap_id:'s1'}, {profile_id:'p1',snap_id:'s2'}, {profile_id:'p2',snap_id:'s1'}, {profile_id:'p1',snap_id:'missing'}, {profile_id:'a:b',snap_id:'c'}, {profile_id:'a',snap_id:'b:c'}];
  const snaps = [snap, {...snap,snap_id:'s2'}, {...snap,snap_id:'c'}, {...snap,snap_id:'b:c'}];
  for (const rows of [links, [...links,...links], [...links,...links].reverse()]) {
    const result = await run(fixture(rows, snaps));
    assert.equal(result.size,4);
    assert.deepEqual(result.get('p1'),expected('p1',2));
    for (const id of ['p2','a:b','a']) assert.deepEqual(result.get(id),expected(id));
  }
});
test('single date, null and zero metrics retain semantics', async () => {
  const f=fixture([{profile_id:'p1',snap_id:'s1'}],[{...snap,like_count:null,view_count:0,scrap_count:null,goods_click_count:0,comment_count:null}]);
  assert.deepEqual((await f.query(['p1'],'2026-10-01','2026-10-01')).get('p1'), {profile_id:'p1',total_likes:0,total_views:0,total_scraps:0,total_goods_click:0,total_comments:0});
});
test('empty inputs/results and absent snaps produce no phantom profiles', async () => {
  const empty=fixture([],[]); assert.equal((await empty.query([],'a','b')).size,0);assert.equal(empty.calls.length,0);
  for (const links of [null,[]]) {const f=fixture(links,[snap]);assert.equal((await run(f)).size,0);assert.equal(f.calls.length,1);}
  for (const snaps of [null,[]]) assert.equal((await run(fixture([{profile_id:'p1',snap_id:'missing'}],snaps))).size,0);
});
test('member metric explanation retains cumulative and partial-coverage meaning', () => {
  const source=fs.readFileSync(path.join(__dirname,'../src/app/(app)/snap/page.tsx'),'utf8');
  assert.match(source, /tab === 'MEMBER' && \([\s\S]*?조회·좋아요는 조회된 고유 스냅의 최신 저장 누적값 합계입니다。?/);
  assert.ok(source.includes('기간 내 증가량이나 전체 게시물 통계가 아니며, 조회 상한으로 일부만 포함될 수 있습니다.'));
});
