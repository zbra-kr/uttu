const test = require('node:test'), assert = require('node:assert/strict');
const load = require('./helpers/load-source.cjs');
const api = load('src/lib/cs-daily-review-check.ts');
const row = (values = {}) => ({ id: 'review', product_id: 'product', musinsa_no: '123', rating: 2, review_date: '2026-10-04', review_text: 'Source', ...values });
test('CS D-minus-one calendar is explicit across leap/year/month boundaries and host timezones', () => {
  const saved = process.env.TZ;
  try { for (const zone of ['UTC', 'Asia/Seoul', 'America/Los_Angeles']) {
    process.env.TZ = zone;
    for (const [date, expected] of [['2026-10-05', '2026-10-04'], ['2026-01-01', '2025-12-31'], ['2024-03-01', '2024-02-29'], ['2026-03-01', '2026-02-28']]) assert.equal(api.csReviewDate(date, '2026-10-05'), expected);
    for (const invalid of ['2026-02-30', '2026-10-06', '', '2026-1-1', 'garbage', '2026-10-05T00:00:00Z']) assert.equal(api.csReviewDate(invalid, '2026-10-05'), null);
    const format = load('src/lib/format.ts');
    const Original = global.Date;
    try { for (const [now, expected] of [['2026-10-04T14:59:59Z', '2026-10-04'], ['2026-10-04T15:00:00Z', '2026-10-05']]) {
      global.Date = class extends Original { constructor(...args) { super(...(args.length ? args : [now])); } };
      assert.equal(format.kstToday(), expected);
    } } finally { global.Date = Original; }
  } } finally { if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved; }
});
test('source rows keep missing product identity but reject bad dates/ratings/text and all ambiguous duplicates', () => {
  const rows = [row({ id: 'missing', product_id: null }), row({ id: 'wrong-date', review_date: '2026-10-03' }), row({ id: 'wrong-rating', rating: 5 }), row({ id: 'wrong-text', review_text: {} }), row(), row()];
  const result = api.checkCSReviews({ rows, total: 30 }, '2026-10-04');
  assert.equal(result.rows.length, 1); assert.equal(result.excluded, 5); assert.equal(result.total, 30);
  assert.equal(api.currentCSProductHref(result.rows[0]), null);
  assert.equal(api.currentCSProductHref(row()), '/product?no=123');
  for (const value of ['javascript:alert(1)', '1&date=2026-10-04', '0', '01', '', null]) assert.equal(api.currentCSProductHref(row({ musinsa_no: value })), null);
});
test('exact saved count distinguishes genuine empty, bounded subset and inconsistent responses', () => {
  assert.deepEqual(api.checkCSReviews({ rows: [], total: 0 }, '2026-10-04'), { rows: [], total: 0, excluded: 0 });
  assert.equal(api.checkCSReviews({ rows: [row()], total: 100 }, '2026-10-04').total, 100);
  for (const result of [{ rows: [], total: 1 }, { rows: [row()], total: 0 }, { rows: [], total: -1 }, { rows: [], total: null }, { rows: Array(21).fill(row()), total: 21 }]) assert.throws(() => api.checkCSReviews(result, '2026-10-04'));
});
