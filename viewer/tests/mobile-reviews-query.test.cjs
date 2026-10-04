const test = require('node:test'), assert = require('node:assert/strict');
const load = require('./helpers/load-source.cjs');
function fixture(response) {
  const calls = [];
  const query = new Proxy({}, { get(_, key) {
    if (key === 'then') return (resolve, reject) => Promise.resolve(response).then(resolve, reject);
    return (...args) => { calls.push([key, ...args]); return query; };
  } });
  const api = load('src/lib/queries.ts', { './supabase/client': { supabaseBrowser: () => ({ from(name) { calls.push(['from', name]); return query; } }) } });
  return { calls, api };
}
test('mobile page preserves exact filter/sort, bounded range, stable ID tie-break and AbortSignal', async () => {
  const f = fixture({ data: [], error: null, count: 0 }), signal = new AbortController().signal;
  await f.api.fetchReviews({ brandIds: ['own'], ratingMin: 1, ratingMax: 2, sort: 'recent', limit: 50, offset: 200, signal, requireExactCount: true, stableOrder: true });
  assert.deepEqual(f.calls.find(call => call[0] === 'range'), ['range', 200, 249]);
  assert.deepEqual(f.calls.filter(call => call[0] === 'order'), [['order', 'review_date', { ascending: false }], ['order', 'id', { ascending: false }]]);
  assert.ok(f.calls.some(call => call[0] === 'eq' && call[1] === 'products.is_own' && call[2] === true));
  assert.ok(f.calls.some(call => call[0] === 'in' && call[1] === 'products.brand_id' && call[2][0] === 'own'));
  assert.equal(f.calls.find(call => call[0] === 'abortSignal')[1], signal);
});
test('strict page count rejects unavailable counts/data; legacy readers retain previous contract', async () => {
  for (const response of [{ data: [], error: null, count: null }, { data: null, error: null, count: 0 }]) {
    await assert.rejects(fixture(response).api.fetchReviews({ requireExactCount: true }), /count unavailable/);
  }
  assert.deepEqual(await fixture({ data: null, error: null, count: null }).api.fetchReviews({}), { rows: [], total: 0 });
});
test('own-brand read accepts cancellation without changing source constraints', async () => {
  const f = fixture({ data: [], error: null }), signal = new AbortController().signal;
  await f.api.fetchOwnBrands(signal);
  assert.deepEqual(f.calls.find(call => call[0] === 'eq'), ['eq', 'is_own', true]);
  assert.equal(f.calls.find(call => call[0] === 'abortSignal')[1], signal);
});
