const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-source.cjs');

const competitor = (brand, company = 'company') => ({
  id: `pool-${brand}`, own_brand_id: 'own', brand_id: brand, added_at: '2026-10-08',
  brands: { name: brand, company_id: company, companies: { corp_name: company } },
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(responses) {
  const calls = [];
  const client = { from(table) {
    const call = { table, ops: [], started: false }; calls.push(call);
    const query = new Proxy({}, { get(_, method) {
      if (method === 'then') return (resolve, reject) => {
        call.started = true;
        assert.ok(Object.hasOwn(responses, table), `Unexpected query: ${table}`);
        return Promise.resolve(responses[table]).then(resolve, reject);
      };
      return (...args) => { call.ops.push([method, ...args]); return query; };
    }});
    return query;
  }};
  return { calls, fetch: load('src/lib/queries.ts', {
    './supabase/client': { supabaseBrowser: () => client },
  }).fetchCompetitorBrands };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('finance and ranking start before either resolves; output retains latest rows and order', async () => {
  const finance = deferred(), ranking = deferred();
  const { calls, fetch } = harness({ competitor_brands: { data: [competitor('b'), competitor('a'), competitor('c', null)] },
    dart_financials: finance.promise, brand_ranking_snapshots: ranking.promise });
  let settled = false;
  const result = fetch('own').then(rows => { settled = true; return rows; });
  await flush();
  assert.deepEqual(calls.filter(c => c.started).map(c => c.table),
    ['competitor_brands', 'dart_financials', 'brand_ranking_snapshots']);
  ranking.resolve({ data: [{ brand_id: 'a', rank_position: 7 }, { brand_id: 'a', rank_position: 99 }] });
  await flush(); assert.equal(settled, false);
  finance.resolve({ data: [{ company_id: 'company', fiscal_year: 2025, revenue: 100, operating_income: 20 },
    { company_id: 'company', fiscal_year: 2024, revenue: 50 }] });
  const rows = await result;
  assert.deepEqual(rows.map(r => [r.brand_id, r.revenue, r.fiscal_year, r.brand_rank]),
    [['b', 100, 2025, null], ['a', 100, 2025, 7], ['c', null, null, null]]);
  assert.deepEqual(calls[1].ops.find(o => o[0] === 'in'), ['in', 'company_id', ['company']]);
  assert.deepEqual(calls[2].ops.filter(o => o[0] === 'eq'),
    [['eq', 'category_code', '000'], ['eq', 'gender_filter', 'A'], ['eq', 'age_filter', 'AGE_BAND_ALL']]);
  for (const c of calls.slice(1)) assert.equal(c.ops.find(o => o[0] === 'order')[2].ascending, false);
});
test('empty competitor pool performs one read only', async () => {
  const { calls, fetch } = harness({ competitor_brands: { data: [] } });
  assert.deepEqual(await fetch('own'), []); assert.equal(calls.length, 1);
});
test('competitor list error prevents enrichment reads and rejects unchanged', async () => {
  const error = new Error('list unavailable');
  const { calls, fetch } = harness({ competitor_brands: { error } });
  await assert.rejects(fetch('own'), e => e === error); assert.equal(calls.length, 1);
});
test('missing companies skips finance while retaining ranking', async () => {
  const { calls, fetch } = harness({ competitor_brands: { data: [competitor('a', null)] },
    brand_ranking_snapshots: { data: [{ brand_id: 'a', rank_position: 3 }] } });
  const [row] = await fetch('own');
  assert.equal(row.revenue, null); assert.equal(row.brand_rank, 3);
  assert.deepEqual(calls.map(c => c.table), ['competitor_brands', 'brand_ranking_snapshots']);
});
for (const failed of ['dart_financials', 'brand_ranking_snapshots']) {
  test(`resolved ${failed} error preserves existing optional enrichment behavior`, async () => {
    const responses = { competitor_brands: { data: [competitor('a')] },
      dart_financials: { data: [{ company_id: 'company', revenue: 100, fiscal_year: 2025 }] },
      brand_ranking_snapshots: { data: [{ brand_id: 'a', rank_position: 3 }] } };
    responses[failed] = { data: null, error: { message: 'unavailable' } };
    const [row] = await harness(responses).fetch('own');
    assert.equal(row.revenue, failed === 'dart_financials' ? null : 100);
    assert.equal(row.brand_rank, failed === 'brand_ranking_snapshots' ? null : 3);
  });
  test(`rejected ${failed} transport propagates without unhandled sibling rejection`, async () => {
    const finance = deferred(), ranking = deferred(), error = new Error('transport unavailable');
    const { fetch } = harness({ competitor_brands: { data: [competitor('a')] },
      dart_financials: finance.promise, brand_ranking_snapshots: ranking.promise });
    const rejection = assert.rejects(fetch('own'), e => e === error);
    await flush();
    (failed === 'dart_financials' ? finance : ranking).reject(error);
    await rejection;
    (failed === 'dart_financials' ? ranking : finance).reject(new Error('sibling unavailable'));
    await flush();
  });
}
