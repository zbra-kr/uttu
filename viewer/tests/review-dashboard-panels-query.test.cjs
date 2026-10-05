const test = require('node:test'), assert = require('node:assert/strict');
const load = require('./helpers/load-source.cjs');
function fixture(response) {
  const calls = [];
  const api = load('src/lib/queries.ts', { './supabase/client': { supabaseBrowser: () => ({ from(table) {
    const ops = []; calls.push({ table, ops });
    const query = new Proxy({}, { get(_, method) { if (method === 'then') return (yes, no) => Promise.resolve(response).then(yes, no); return (...args) => { ops.push([method, ...args]); return query; }; } }); return query;
  } }) } });
  return { api, calls };
}
test('own-product read retains limit/own/order constraints with optional cancellation and genuine empty', async () => {
  const signal = new AbortController().signal, a = fixture({ data: [], error: null }), b = fixture({ data: [], error: null });
  assert.deepEqual(await a.api.fetchOwnProducts(10, signal), []); assert.deepEqual(await b.api.fetchOwnProducts(10), []);
  assert.equal(a.calls[0].table, 'products');
  assert.deepEqual(a.calls[0].ops.filter(op => op[0] !== 'abortSignal'), b.calls[0].ops);
  assert.deepEqual(a.calls[0].ops.find(op => op[0] === 'eq'), ['eq', 'is_own', true]);
  assert.deepEqual(a.calls[0].ops.find(op => op[0] === 'order'), ['order', 'review_count', { ascending: false }]);
  assert.deepEqual(a.calls[0].ops.find(op => op[0] === 'limit'), ['limit', 10]);
  assert.equal(a.calls[0].ops.find(op => op[0] === 'abortSignal')[1], signal);
});
test('CS read retains module/date-order/severity/limit constraints with optional cancellation', async () => {
  const signal = new AbortController().signal, f = fixture({ data: [], error: null });
  assert.deepEqual(await f.api.fetchCsAnomalies({ severity: 'high', limit: 200 }, signal), []);
  assert.equal(f.calls[0].table, 'anomalies');
  assert.deepEqual(f.calls[0].ops.filter(op => op[0] === 'eq'), [['eq', 'module', 'cs'], ['eq', 'severity', 'high']]);
  assert.deepEqual(f.calls[0].ops.filter(op => op[0] === 'order'), [['order', 'detection_date', { ascending: false }], ['order', 'severity', { ascending: true }]]);
  assert.deepEqual(f.calls[0].ops.find(op => op[0] === 'limit'), ['limit', 200]);
  assert.equal(f.calls[0].ops.find(op => op[0] === 'abortSignal')[1], signal);
  const dashboard = fixture({ data: [], error: null }); await dashboard.api.fetchCsAnomalies({ limit: 10 });
  assert.equal(dashboard.calls[0].ops.some(op => op[0] === 'abortSignal' || op[0] === 'gte'), false);
});
test('both actual readers reject errors rather than returning empty arrays', async () => {
  const response = { data: null, error: Error('fixture unavailable') };
  await assert.rejects(fixture(response).api.fetchOwnProducts(10), /unavailable/);
  await assert.rejects(fixture(response).api.fetchCsAnomalies({ limit: 10 }), /unavailable/);
});
