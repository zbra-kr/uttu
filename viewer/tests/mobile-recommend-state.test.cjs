const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, row } = require('./helpers/recommend-state-fixture.cjs');
const populated = async () => { const f = await fixture(); await f.settle(0, [row('A')]); return f; };
function pending(f, gender) { const s = f.snapshot(); assert.equal(s.gender, gender); assert.equal(s.alerts, 0); assert.equal(s.empty, 0); assert.ok(!s.tree.includes('POPULATED-')); assert.ok(s.tree.includes('불러오는 중')); }
function ready(f, gender) { const s = f.snapshot(); assert.equal(s.gender, gender); assert.equal(s.alerts, 0); assert.equal(s.empty, 0); assert.ok(s.tree.includes('POPULATED-' + gender)); }
function failed(f, gender) { const s = f.snapshot(); assert.equal(s.gender, gender); assert.equal(s.alerts, 1); assert.equal(s.empty, 0); assert.ok(!s.tree.includes('POPULATED-')); assert.ok(s.tree.includes('—')); }

test('recommend populated A -> M SDK failure clears wrong-filter rows and distinguishes error', async () => {
 const f = await populated(); try { await f.select('M'); pending(f, 'M'); await f.settle(1, null, true); failed(f, 'M'); assert.equal(f.calls[0].signal.aborted, true); } finally { await f.close(); }
});
test('recommend newer F result survives late populated M success', async () => {
 const f = await populated(); try { await f.select('M'); await f.select('F'); await f.settle(2, [row('F')]); ready(f, 'F'); await f.settle(1, [row('M')]); ready(f, 'F'); assert.ok(!f.snapshot().tree.includes('POPULATED-M')); } finally { await f.close(); }
});
test('recommend initial SDK failure differs from genuine empty and retry recovers once', async () => {
 const f = await fixture(), empty = await fixture(); try { await f.settle(0, null, true); failed(f, 'A'); await empty.settle(0, []); assert.equal(empty.snapshot().empty, 1); assert.equal(empty.snapshot().alerts, 0); assert.notEqual(f.snapshot().tree, empty.snapshot().tree); const retry = f.retry(); await f.invoke(retry, retry); assert.equal(f.calls.length, 2); pending(f, 'A'); await f.settle(1, [row('A')]); ready(f, 'A'); } finally { await f.close(); await empty.close(); }
});
test('recommend populated A -> M successful empty clears A and keeps zero distinct from failure', async () => {
 const f = await populated(); try { await f.select('M'); await f.settle(1, []); assert.equal(f.snapshot().empty, 1); assert.equal(f.snapshot().alerts, 0); assert.ok(!f.snapshot().tree.includes('POPULATED-A')); assert.ok(!f.snapshot().tree.includes('—')); } finally { await f.close(); }
});
for (const late of ['success', 'SDK error', 'transport rejection']) test('recommend rapid A/M/F/A ignores old ' + late + ' and finally while latest stays pending', async () => {
 const f = await fixture(); try { await f.select('M'); await f.select('F'); await f.select('A'); assert.deepEqual(f.calls.map(call => call.gender), ['A', 'M', 'F', 'A']); assert.ok(f.calls.slice(0, 3).every(call => call.signal.aborted));
  for (const i of [2, 0, 1]) { const before = f.writes.length; if (late === 'transport rejection') await f.reject(i); else await f.settle(i, [row(f.calls[i].gender)], late === 'SDK error'); pending(f, 'A'); assert.equal(f.writes.length, before); }
  await f.settle(3, [row('A')]); ready(f, 'A');
 } finally { await f.close(); }
});
for (const late of ['success', 'SDK error']) test('recommend late ' + late + '/finally cannot unlock a newer retry or gender request', async () => {
 const f = await fixture(); try { await f.settle(0, null, true); const retry = f.retry(); await f.invoke(retry); await f.select('F'); assert.equal(f.calls.length, 3); await f.settle(1, [row('A')], late === 'SDK error'); pending(f, 'F'); await f.invoke(retry); assert.equal(f.calls.length, 3); await f.settle(2, null, true); failed(f, 'F'); await f.invoke(f.retry()); assert.equal(f.calls.length, 4); assert.equal(f.calls[3].gender, 'F'); await f.settle(3, [row('F')]); ready(f, 'F'); } finally { await f.close(); }
});
test('recommend hides populated old gender before replacement effect runs', async () => {
 const f = await populated(); try { f.holdEffects(); await f.select('M'); assert.equal(f.calls.length, 1); pending(f, 'M'); await f.releaseEffects(); assert.equal(f.calls.length, 2); await f.settle(1, [row('M')]); ready(f, 'M'); } finally { await f.close(); }
});
for (const late of ['success', 'SDK error', 'transport rejection']) test('recommend unmount aborts and observes late ' + late + ' without rendering', async () => {
 const f = await fixture(); await f.close(); const before = f.writes.length; assert.equal(f.calls[0].signal.aborted, true); if (late === 'transport rejection') await f.reject(0); else await f.settle(0, [row('A')], late === 'SDK error'); assert.equal(f.calls.length, 1); assert.equal(f.writes.length, before);
});
test('recommend cooperative transport cancellation on gender change is not a visible error', async () => {
 const f = await fixture({ respectAbort: true }); try { await f.select('M'); pending(f, 'M'); assert.equal(f.calls[0].signal.aborted, true); await f.settle(1, [row('M')]); ready(f, 'M'); } finally { await f.close(); }
});
test('recommend preserves scalar projection, cohort, date bounds, ordering and 100-row cap', async () => {
 const f = await populated(); try { const params = new URLSearchParams(f.calls[0].params); assert.equal(params.get('select'), 'id,title,module_type,gender_filter,position,snapshot_date,items_count'); assert.equal(params.get('gender_filter'), 'eq.A'); assert.equal(params.get('order'), 'snapshot_date.desc,position.asc'); assert.equal(params.get('limit'), '100'); assert.equal(params.getAll('snapshot_date').length, 2); assert.ok(params.getAll('snapshot_date')[0].startsWith('gte.')); assert.ok(params.getAll('snapshot_date')[1].startsWith('lte.')); assert.ok(f.calls[0].signal instanceof AbortSignal); } finally { await f.close(); }
});
