const test = require('node:test'), assert = require('node:assert/strict');
const load = require('./helpers/load-source.cjs');
function fixture(responses) {
  const calls = []; let index = 0;
  const api = load('src/lib/queries.ts', { './format': { kstDaysAgo: days => `fixture-date-${days}` }, './supabase/client': { supabaseBrowser: () => ({ from(table) {
    const operations = []; const position = table === 'reviews' ? index++ : -1;
    calls.push({ table, operations });
    const query = new Proxy({}, { get(_, key) {
      if (key === 'then') return (resolve, reject) => Promise.resolve(position < 0 ? { count: 2, error: null } : responses[position]).then(resolve, reject);
      return (...args) => { operations.push([key, ...args]); return query; };
    } }); return query;
  } }) } });
  return { api, calls };
}
const valid = counts => counts.map(count => ({ count, error: null }));
test('all six failures and each mixed failure reject instead of manufacturing partial metrics', async () => {
  await assert.rejects(fixture(Array.from({ length: 6 }, () => ({ count: null, error: { message: 'offline' } }))).api.fetchReviewStats(30), /unavailable/);
  for (let i = 0; i < 6; i++) {
    const responses = valid([5, 4, 3, 2, 1, 3]); responses[i] = { count: 0, error: { message: 'failed count' } };
    await assert.rejects(fixture(responses).api.fetchReviewStats(30), /unavailable/);
  }
});
test('missing, negative, fractional and nonfinite counts are unavailable at every count position', async () => {
  for (const count of [null, undefined, -1, 0.5, NaN, Infinity]) for (let i = 0; i < 6; i++) {
    const responses = valid([5, 4, 3, 2, 1, 3]); responses[i] = { count, error: null };
    await assert.rejects(fixture(responses).api.fetchReviewStats(7), /unavailable/);
  }
});
test('valid zero counts remain zero; dated six head queries preserve filters and AbortSignal', async () => {
  const f = fixture(valid([0, 0, 0, 0, 0, 0])), signal = new AbortController().signal;
  assert.deepEqual(await f.api.fetchReviewStats(7, signal), { total: 0, avgRating: 0, lowCount: 0, ratingDist: [0, 0, 0, 0, 0], imageCount: 0 });
  assert.equal(f.calls.length, 6);
  for (const call of f.calls) {
    assert.equal(call.table, 'reviews');
    assert.deepEqual(call.operations.find(x => x[0] === 'select'), ['select', '*', { count: 'exact', head: true }]);
    assert.deepEqual(call.operations.find(x => x[0] === 'gte'), ['gte', 'review_date', 'fixture-date-7']);
    assert.equal(call.operations.find(x => x[0] === 'abortSignal')[1], signal);
  }
  assert.deepEqual(f.calls.map(call => call.operations.find(x => x[0] === 'eq')), [['eq', 'rating', 5], ['eq', 'rating', 4], ['eq', 'rating', 3], ['eq', 'rating', 2], ['eq', 'rating', 1], ['eq', 'has_image', true]]);
});
test('valid actual counts compute unchanged metrics; all-time omits only the date filter', async () => {
  const f = fixture(valid([5, 4, 3, 2, 1, 3]));
  assert.deepEqual(await f.api.fetchReviewStats(999), { total: 15, avgRating: 3.67, lowCount: 3, ratingDist: [5, 4, 3, 2, 1], imageCount: 3 });
  assert.equal(f.calls.some(call => call.operations.some(x => x[0] === 'gte')), false);
});
test('shell review fields stay unavailable when the shared aggregate fails', async () => {
  const stats = await fixture(Array.from({ length: 6 }, () => ({ count: null, error: { message: 'offline' } }))).api.fetchShellStats();
  assert.equal(stats.reviewTotal, null); assert.equal(stats.reviewAvgRating, null); assert.equal(stats.reviewLowCount, null);
  assert.equal(stats.anomalyCount, 2);
});
