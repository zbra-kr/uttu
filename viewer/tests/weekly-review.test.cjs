'use strict';
// Fresh reconstruction: local contracts, no database, browser, or network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./helpers/load-source.cjs');
const w = load('src/lib/weekly-review.ts');
const drafts = load('src/lib/weekly-review-draft.ts');
const NOW = new Date('2026-10-03T09:00:00.000Z');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const BRAND = id(1), PRODUCT = id(2), USER = id(3);
const scope = Object.freeze({ brand: BRAND, from: '2024-02-28', to: '2024-03-05', rating: 'all', product: null, at: '2024-03-06T00:00:00.000Z' });
const params = (s = scope, ids = []) => new URLSearchParams(w.weeklyHref(s, ids).split('?')[1]);
const parse = p => w.parseWeeklyLocation(p, NOW);
const row = (n = 1, changes = {}) => ({ id: id(100 + n), product_id: PRODUCT, musinsa_review_id: `source-${n}`, product_name: 'Sample product', musinsa_no: '12345', brand_name: 'Sample brand', rating: 2, review_text: `Original review ${n}`, review_date: '2024-03-04', created_at: '2024-03-05T23:00:00.000Z', purchase_option: 'NAVY / M', ...changes });
const dbrow = (n, changes = {}) => { const r = row(n); return { id: r.id, product_id: r.product_id, musinsa_review_id: r.musinsa_review_id, rating: r.rating, review_text: r.review_text, review_date: r.review_date, created_at: r.created_at, purchase_option: r.purchase_option, products: { name: r.product_name, musinsa_no: 12345, brands: { name: r.brand_name } }, ...changes }; };
const ok = (data = []) => ({ data, error: null });
const input = changes => ({ scope: { ...scope, product: PRODUCT, rating: 'low' }, brandName: 'Sample brand', evidence: [row()], observation: '  Check seam feedback  ', nextCheck: '  Inspect selected originals  ', nextDate: '2024-03-12', ...changes });
function harness(responses = [ok()], auth = { data: { user: { id: USER } }, error: null }) {
  const calls = [], authCalls = []; let clients = 0;
  const client = { auth: { getUser: async () => { authCalls.push('getUser'); return typeof auth === 'function' ? auth() : auth; } }, from(table) {
    assert.ok(responses.length, `Unexpected query/fanout ${table}`); const response = responses.shift(), ops = []; calls.push({ table, ops }); let signal;
    const allowed = new Set(['select', 'eq', 'gte', 'lte', 'order', 'limit', 'in', 'or', 'abortSignal', 'contains']);
    const query = new Proxy({}, { get(_, method) {
      if (method === 'then') return (resolve, reject) => Promise.resolve().then(() => { if (signal?.aborted) throw signal.reason; return typeof response === 'function' ? response() : response; }).then(resolve, reject);
      assert.ok(allowed.has(method), `Unexpected count, fanout, mutation, or offset method ${String(method)}`);
      return (...args) => { ops.push([method, ...args]); if (method === 'abortSignal') signal = args[0]; return query; };
    } }); return query;
  } };
  return { calls, authCalls, clients: () => clients, q: load('src/lib/queries-weekly-review.ts', { './supabase/client': { supabaseBrowser: () => { clients++; return client; } } }) };
}
const ops = call => call.ops.map(op => op[0] === 'select' ? ['select', op[1].replace(/\s+/g, '')] : op);
const BASE = [['select', 'id,product_id,musinsa_review_id,rating,review_text,review_date,created_at,purchase_option,products!inner(name,musinsa_no,is_own,brand_id,brands(name))'], ['eq', 'products.is_own', true], ['eq', 'products.brand_id', BRAND], ['gte', 'review_date', scope.from], ['lte', 'review_date', scope.to], ['lte', 'created_at', scope.at], ['order', 'review_date', { ascending: false }], ['order', 'id', { ascending: false }], ['limit', 31]];

for (const [at, from, to] of [['2026-10-02T14:59:59.999Z', '2026-09-25', '2026-10-01'], ['2026-10-02T15:00:00.000Z', '2026-09-26', '2026-10-02'], ['2025-12-31T15:00:00.000Z', '2025-12-25', '2025-12-31'], ['2024-03-01T00:00:00.000Z', '2024-02-23', '2024-02-29']]) test(`KST closed-week boundary ${at}`, () => assert.deepEqual(w.kstClosedWeek(new Date(at)), { from, to }));
for (const value of ['2024-02-29', '2000-02-29', '2023-12-31']) test(`valid exact calendar date ${value}`, () => assert.equal(w.isWeeklyDate(value), true));
for (const value of ['', '2023-02-29', '2024-02-30', '2024-04-31', '2024-00-01', '2024-13-01', '2024-01-00', '2024-1-01', '2024-01-1', '2024-01-01T00:00:00Z', ' 2024-01-01', '2024-01-01\n']) test(`invalid exact calendar date ${JSON.stringify(value)}`, () => assert.equal(w.isWeeklyDate(value), false));
test('one through seven closed dates are allowed; reversed, eight-day, today, future, and impossible ranges are rejected', () => {
  assert.equal(w.weeklyPeriodError('2026-09-26', '2026-10-02', NOW), null); assert.equal(w.weeklyPeriodError('2026-10-02', '2026-10-02', NOW), null);
  for (const [a, b] of [['2026-09-25', '2026-10-02'], ['2026-10-02', '2026-10-01'], ['2026-10-03', '2026-10-03'], ['2026-10-04', '2026-10-04'], ['2024-02-30', '2024-03-01']]) assert.ok(w.weeklyPeriodError(a, b, NOW));
  assert.ok(w.weeklyPeriodError('2026-10-02', '2026-10-02', new Date('2026-10-02T14:59:59.999Z'))); assert.equal(w.weeklyPeriodError('2026-10-02', '2026-10-02', new Date('2026-10-02T15:00:00Z')), null);
});
test('blank or tracking-only URL is an unselected start; full context roundtrips without mutation', () => {
  for (const p of [new URLSearchParams(), new URLSearchParams('utm_source=test')]) assert.deepEqual(parse(p), { scope: null, evidence: [], error: null });
  for (const s of [scope, { ...scope, product: PRODUCT, rating: 'low' }]) { const p = params(s, [id(10), id(11)]), before = p.toString(); assert.deepEqual(parse(p), { scope: s, evidence: [id(10), id(11)], error: null }); assert.equal(p.toString(), before); assert.equal(w.weeklyHref(parse(p).scope, parse(p).evidence), w.weeklyHref(s, [id(10), id(11)])); }
  const p = params(); p.delete('rating'); assert.deepEqual(parse(p).scope, scope);
});
for (const [key, value] of [['brand', 'bad'], ['product', '../unsafe'], ['from', '2024-02-30'], ['to', '2024-03-06'], ['from', '2024-03-06'], ['rating', 'medium'], ['rating', ''], ['at', ''], ['at', '2024-02-30T00:00:00.000Z'], ['at', '2024-03-06T00:00:00Z'], ['at', '2024-03-06T09:00:00.000+09:00'], ['at', '2024-03-06'], ['at', '2099-01-01T00:00:00.000Z'], ['evidence', ''], ['evidence', 'bad'], ['evidence', `${id(10)},`], ['evidence', `${id(10)},${id(10)}`]]) test(`reject malformed URL ${key}=${JSON.stringify(value)}`, () => { const p = params(); p.set(key, value); assert.equal(parse(p).scope, null); assert.ok(parse(p).error); });
for (const key of ['brand', 'from', 'to', 'at']) test(`reject missing context field ${key}`, () => { const p = params(); p.delete(key); assert.ok(parse(p).error); });
for (const key of ['brand', 'from', 'to', 'rating', 'product', 'at', 'evidence']) test(`reject duplicated context field ${key}`, () => { const p = params({ ...scope, product: PRODUCT }, [id(10)]); p.append(key, p.get(key)); assert.ok(parse(p).error); });
test('empty-first brand cannot bypass duplicates; evidence is capped at ten unique normalized IDs', () => {
  const p = params(); p.set('brand', ''); p.append('brand', BRAND); assert.ok(parse(p).error);
  const ids = Array.from({ length: 11 }, (_, i) => id(30 + i)); assert.equal(parse(params(scope, ids.slice(0, 10))).error, null); assert.ok(parse(params(scope, ids)).error);
  const upper = 'AbCdEf01-AbCd-4Ef0-8AbC-AbCdEf012345'; assert.equal(w.isWeeklyId(upper), true); assert.equal(w.isWeeklyId(`${upper}\n`), false);
  const normalized = parse(params({ ...scope, brand: upper, product: upper }, [upper])); assert.equal(normalized.scope.brand, upper.toLowerCase()); assert.equal(normalized.scope.product, upper.toLowerCase()); assert.deepEqual(normalized.evidence, [upper.toLowerCase()]); assert.ok(parse(params(scope, [upper, upper.toLowerCase()])).error);
});
test('deduplication uses source identity and falls back to row ID; similar text never merges sources', () => {
  const first = row(), duplicate = row(2, { musinsa_review_id: first.musinsa_review_id, product_id: id(999) }), sameText = row(3, { review_text: first.review_text }), unknown = row(4, { musinsa_review_id: '' }), other = row(5, { musinsa_review_id: '', review_text: unknown.review_text });
  const rows = Object.freeze([first, duplicate, sameText, unknown, { ...unknown }, other]); assert.deepEqual(w.uniqueWeeklyEvidence(rows), [first, sameText, unknown, other]); assert.equal(rows.length, 6);
});
test('memo freezes original scope, cutoff, IDs, human next step, and uncertainty rather than counts', () => {
  const draft = input({ scope: Object.freeze({ ...scope, product: PRODUCT, rating: 'low' }), evidence: Object.freeze([Object.freeze(row()), Object.freeze(row(2)), Object.freeze(row(3, { musinsa_review_id: row().musinsa_review_id }))]) });
  const before = JSON.stringify(draft), body = w.buildWeeklyMemo(draft), href = w.weeklyHref(draft.scope, [row().id, row(2).id]); assert.equal(JSON.stringify(draft), before);
  for (const pattern of [/작성일 범위: 2024-02-28 ~ 2024-03-05 \(KST\)/, /조회 기준: 2024-03-06 09:00 KST/, /별점 조건: 1~2점/, /선택한 원문: 2건 \(브랜드 전체의 이슈 건수·비율이 아님\)/, /관찰: Check seam feedback\n다음 확인: Inspect selected originals\n다음 확인일: 2024-03-12/, /수집 완전성 미확인/, /조회 기준 이후 저장된 리뷰는 제외/, /원문 수정·삭제는 재열람에 반영/]) assert.match(body, pattern);
  assert.equal(body.split('\n').at(-1), `근거 보기: ${href}`); assert.equal(w.weeklyMemoHref(body), href); assert.equal(w.formatWeeklyTime('invalid'), '시각 확인 불가'); assert.equal(w.formatWeeklyTime('2024-12-31T15:05:00.000Z'), '2025-01-01 00:05 KST');
});
for (const [name, changes] of [['zero evidence', { evidence: [] }], ['over cap', { evidence: Array.from({ length: 11 }, (_, i) => row(i)) }], ['blank observation', { observation: ' \n' }], ['blank next check', { nextCheck: '\t' }], ['invalid next date', { nextDate: '2024-02-30' }], ['invalid scope', { scope: { ...scope, brand: 'bad' } }], ['overlong period', { scope: { ...scope, to: '2024-03-06' } }], ['invalid cutoff', { scope: { ...scope, at: 'bad' } }], ['invalid row ID', { evidence: [row(1, { id: 'bad' })] }], ['duplicate row IDs', { evidence: [row(), row(2, { id: row().id })] }], ['impossible review date', { evidence: [row(1, { review_date: '2024-02-30' })] }], ['early date', { evidence: [row(1, { review_date: '2024-02-27' })] }], ['late date', { evidence: [row(1, { review_date: '2024-03-06' })] }], ['wrong product', { evidence: [row(1, { product_id: id(999) })] }], ['outside low cohort', { evidence: [row(1, { rating: 5 })] }], ['post cutoff', { evidence: [row(1, { created_at: '2024-03-06T00:00:00.001Z' })] }], ['invalid storage time', { evidence: [row(1, { created_at: 'bad' })] }], ['long observation', { observation: 'x'.repeat(2001) }], ['long next check', { nextCheck: 'x'.repeat(2001) }]]) test(`memo rejects ${name}`, () => assert.throws(() => w.buildWeeklyMemo(input(changes))));
for (const rating of [0, 6, 1.5, NaN, Infinity, '2']) test(`memo rejects invalid integer-scale rating ${String(rating)}`, () => assert.throws(() => w.buildWeeklyMemo(input({ scope, evidence: [row(1, { rating })] }))));
test('memo cap follows source dedup; only canonical same-app evidence links are reconstructable', () => {
  assert.match(w.buildWeeklyMemo(input({ evidence: Array.from({ length: 11 }, (_, i) => row(i, { musinsa_review_id: 'same' })) })), /선택한 원문: 1건/);
  const prefix = `${w.WEEKLY_MEMO_HEADER}\n근거 보기: `, href = w.weeklyHref(scope, [id(10)]);
  for (const body of ['', 'ordinary note', `Other\n근거 보기: ${href}`, `${prefix}https://evil.example${href}`, `${prefix}//evil.example${href}`, `${prefix}javascript:alert(1)`, `${prefix}/reviews/weekly/other?${params(scope, [id(10)])}`, `${prefix}${w.weeklyHref(scope)}`, `${prefix}${href}&brand=${BRAND}`, `${prefix}${href.replace(BRAND, 'bad')}`, `${prefix}${href}\nhttps://evil.example`]) assert.equal(w.weeklyMemoHref(body), null);
  assert.equal(w.weeklyMemoHref(`${prefix}${href}&ignored=https%3A%2F%2Fevil.example`), href);
});
test('exact reviews query is one bounded inner join with current own, brand, both dates, and storage cutoff', async () => {
  const h = harness(); assert.deepEqual(await h.q.fetchWeeklyReviews(scope), { rows: [], next: null, fetchedRows: 0 }); assert.equal(h.clients(), 1); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].table, 'reviews'); assert.deepEqual(ops(h.calls[0]), BASE); assert.equal(h.calls[0].ops[0].length, 2); assert.deepEqual(h.authCalls, []);
});
test('product and low rating filters are ANDed with current-own and brand constraints', async () => {
  const h = harness(); await h.q.fetchWeeklyReviews({ ...scope, product: PRODUCT, rating: 'low' }); assert.deepEqual(ops(h.calls[0]), [...BASE, ['eq', 'product_id', PRODUCT], ['gte', 'rating', 1], ['lte', 'rating', 2]]); assert.equal(h.calls.length, 1);
});
for (const count of [0, 1, 29, 30, 31]) test(`30 plus sentinel boundary: ${count} rows`, async () => {
  const data = Array.from({ length: count }, (_, i) => dbrow(500 - i)), h = harness([ok(data)]), result = await h.q.fetchWeeklyReviews(scope);
  assert.equal(result.rows.length, Math.min(count, 30)); assert.equal(result.fetchedRows, Math.min(count, 30)); assert.deepEqual(result.next, count === 31 ? { date: data[29].review_date, id: data[29].id } : null); assert.equal(result.rows.some(r => r.id === data[30]?.id), false);
});
test('cursor stays on raw page boundary even if source dedup removes boundary row', async () => {
  const data = Array.from({ length: 31 }, (_, i) => dbrow(500 - i)); data[29].musinsa_review_id = data[0].musinsa_review_id;
  const result = await harness([ok(data)]).q.fetchWeeklyReviews(scope); assert.equal(result.rows.length, 29); assert.equal(result.fetchedRows, 30); assert.deepEqual(result.next, { date: data[29].review_date, id: data[29].id });
});
test('keyset continuation has a stable date and ID tie break, never OFFSET', async () => {
  const h = harness(), cursor = { date: '2024-03-04', id: id(200) }; await h.q.fetchWeeklyReviews(scope, { cursor }); assert.deepEqual(ops(h.calls[0]), [...BASE, ['or', `review_date.lt.${cursor.date},and(review_date.eq.${cursor.date},id.lt.${cursor.id})`]]);
});
for (const cursor of [{ date: '2024-02-27', id: id(200) }, { date: '2024-03-06', id: id(200) }, { date: '2024-3-04', id: id(200) }, { date: '2024-03-04', id: 'unsafe),id.gt.0' }, { date: '2024-02-30', id: id(200) }]) test(`reject cursor before constructing query ${JSON.stringify(cursor)}`, async () => { const h = harness(); await assert.rejects(h.q.fetchWeeklyReviews(scope, { cursor })); assert.equal(h.clients(), 0); });
test('linked evidence is capped at ten, within original cohort, and cannot paginate', async () => {
  const ids = Array.from({ length: 10 }, (_, i) => id(100 + i)), h = harness([ok(Array.from({ length: 10 }, (_, i) => dbrow(i)))]);
  const result = await h.q.fetchWeeklyReviews({ ...scope, product: PRODUCT, rating: 'low' }, { evidence: ids, cursor: { date: '2024-03-04', id: id(200) } });
  assert.deepEqual(ops(h.calls[0]), [...BASE.slice(0, -1), ['limit', 10], ['eq', 'product_id', PRODUCT], ['gte', 'rating', 1], ['lte', 'rating', 2], ['in', 'id', ids]]); assert.equal(result.next, null); assert.equal(result.rows.length, 10); assert.equal(h.calls.length, 1);
});
for (const evidence of [Array.from({ length: 11 }, (_, i) => id(100 + i)), [id(100), id(100)], ['bad']]) test(`invalid linked IDs do not reach Supabase (${evidence.length})`, async () => { const h = harness(); await assert.rejects(h.q.fetchWeeklyReviews(scope, { evidence })); assert.equal(h.clients(), 0); });
test('invalid scope is rejected locally; row mapping preserves provenance and explicit fallbacks', async () => {
  for (const s of [{ ...scope, brand: 'bad' }, { ...scope, product: 'bad' }, { ...scope, to: '2024-03-06' }, { ...scope, at: 'bad' }, { ...scope, rating: 'other' }]) { const h = harness(); await assert.rejects(h.q.fetchWeeklyReviews(s)); assert.equal(h.clients(), 0); }
  assert.deepEqual((await harness([ok([dbrow(1)])]).q.fetchWeeklyReviews(scope)).rows, [row()]);
  const result = (await harness([ok([dbrow(1, { musinsa_review_id: null, review_text: null, purchase_option: null, products: null })])]).q.fetchWeeklyReviews(scope)).rows[0];
  assert.equal(result.musinsa_review_id, ''); assert.equal(result.review_text, ''); assert.equal(result.purchase_option, null); assert.equal(result.product_name, '상품명 확인 불가'); assert.equal(result.brand_name, '브랜드명 확인 불가'); assert.equal(result.musinsa_no, '');
});
for (const [name, response] of [['error with empty', { data: [], error: {} }], ['error with stale rows', { data: [dbrow(1)], error: {} }], ['missing data', { data: null, error: null }], ['bad shape', { data: {}, error: null }], ['rejection', () => { throw Error('offline'); }]]) test(`review ${name} is unavailable rather than empty success`, async () => { const h = harness([response]); await assert.rejects(h.q.fetchWeeklyReviews(scope)); assert.equal(h.calls.length, 1); });
test('review cancellation forwards the original AbortSignal and never returns empty success', async () => {
  const controller = new AbortController(), h = harness(); await h.q.fetchWeeklyReviews(scope, { signal: controller.signal }); assert.deepEqual(ops(h.calls[0]), [...BASE, ['abortSignal', controller.signal]]); controller.abort(); await assert.rejects(harness().q.fetchWeeklyReviews(scope, { signal: controller.signal }), e => e.name === 'AbortError');
});
test('saved memo reads are exactly own user + brand + tag, latest ten, no author or Teams fanout', async () => {
  const rows = [{ id: id(900), body: 'Saved memo', created_at: scope.at }], h = harness([ok(rows)]); assert.deepEqual(await h.q.fetchWeeklyMemos(BRAND), rows); assert.deepEqual(h.authCalls, ['getUser']); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].table, 'user_notes');
  assert.deepEqual(h.calls[0].ops, [['select', 'id,body,created_at'], ['eq', 'user_id', USER], ['eq', 'entity_type', 'brand'], ['eq', 'entity_id', BRAND], ['contains', 'tags', [w.WEEKLY_MEMO_TAG]], ['order', 'created_at', { ascending: false }], ['limit', 10]]);
  assert.deepEqual(await harness().q.fetchWeeklyMemos(BRAND), []);
});
test('memo invalid brand and auth failures prevent table access; account mismatch never reads other-user notes', async () => {
  const invalid = harness(); await assert.rejects(invalid.q.fetchWeeklyMemos('bad')); assert.deepEqual(invalid.authCalls, []); assert.equal(invalid.calls.length, 0);
  for (const auth of [{ data: { user: null }, error: null }, { data: { user: { id: USER } }, error: {} }]) { const h = harness([], auth); await assert.rejects(h.q.fetchWeeklyMemos(BRAND), /로그인/); assert.equal(h.calls.length, 0); }
  const rejected = harness([], () => { throw Error('auth unavailable'); }); await assert.rejects(rejected.q.fetchWeeklyMemos(BRAND), /auth unavailable/); assert.equal(rejected.calls.length, 0);
  const changed = harness([]); await assert.rejects(changed.q.fetchWeeklyMemos(BRAND, undefined, id(999))); assert.equal(changed.calls.length, 0);
});
for (const [name, response] of [['error', { data: [], error: {} }], ['missing', { data: null, error: null }], ['bad shape', { data: {}, error: null }], ['rejection', () => { throw Error('offline'); }]]) test(`memo ${name} stays unavailable and distinct from login failure`, async () => { const h = harness([response]); await assert.rejects(h.q.fetchWeeklyMemos(BRAND), e => !/로그인/.test(e.message)); assert.equal(h.calls.length, 1); });
test('memo cancellation is forwarded and rejected', async () => { const controller = new AbortController(), h = harness(); await h.q.fetchWeeklyMemos(BRAND, controller.signal); assert.deepEqual(h.calls[0].ops.at(-1), ['abortSignal', controller.signal]); controller.abort(); await assert.rejects(harness().q.fetchWeeklyMemos(BRAND, controller.signal), e => e.name === 'AbortError'); });
test('query documentation preserves plan-index evidence and authenticated runtime release limitation', () => { const source = fs.readFileSync(path.join(__dirname, '../src/lib/queries-weekly-review.ts'), 'utf8'); assert.match(source, /products_brand_idx\/is_own_idx\s*->\s*reviews_product_date_idx/); assert.match(source, /underestimated/); assert.match(source, /authenticated RLS[\s\S]{0,100}release gate/); assert.match(source, /LIMIT alone would not prove the query safe/); });
test('draft serialization strips original prose/options without changing the serialized memo or scope', () => {
  const original = input(), before = JSON.stringify(original), raw = drafts.serializeWeeklyDraft(original), restored = drafts.restoreWeeklyDraft(raw);
  assert.equal(JSON.stringify(original), before); assert.deepEqual(restored.scope, original.scope); assert.equal(restored.evidence[0].review_text, ''); assert.equal(restored.evidence[0].purchase_option, null); assert.doesNotMatch(raw, /Original review 1|NAVY \/ M/); assert.equal(w.buildWeeklyMemo(restored), w.buildWeeklyMemo(original)); assert.notEqual(drafts.weeklyDraftKey(USER), drafts.weeklyDraftKey(id(4))); assert.throws(() => drafts.weeklyDraftKey('bad'));
});
test('draft restoration rejects malformed structure, oversized fields, identity/cohort mismatch, and invalid nonempty next date', () => {
  const good = JSON.parse(drafts.serializeWeeklyDraft(input()));
  for (const raw of ['not JSON', 'null', JSON.stringify({ ...good, version: 2 }), JSON.stringify({ ...good, scope: null }), JSON.stringify({ ...good, observation: 'x'.repeat(2001) }), JSON.stringify({ ...good, nextCheck: 1 }), JSON.stringify({ ...good, evidence: [null] }), JSON.stringify({ ...good, evidence: Array(11).fill(good.evidence[0]) }), JSON.stringify({ ...good, evidence: [{ ...good.evidence[0], id: 'bad' }] }), JSON.stringify({ ...good, evidence: [{ ...good.evidence[0], review_date: '2024-02-30' }] }), JSON.stringify({ ...good, evidence: [{ ...good.evidence[0], product_name: {} }] }), ' '.repeat(40001)]) assert.equal(drafts.restoreWeeklyDraft(raw), null);
  for (const nextDate of ['2024-02-30', 'not-a-date', '2024-2-29']) assert.equal(drafts.restoreWeeklyDraft(drafts.serializeWeeklyDraft(input({ nextDate }))), null);
  assert.ok(drafts.restoreWeeklyDraft(drafts.serializeWeeklyDraft(input({ observation: '', nextCheck: '', nextDate: '' }))));
});
test('content-addressed submission key remains stable after restore and differs by owner or edited body', async () => {
  const original = input(), body = w.buildWeeklyMemo(original), key = await drafts.weeklySubmissionId(USER, body);
  assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(await drafts.weeklySubmissionId(USER, w.buildWeeklyMemo(drafts.restoreWeeklyDraft(drafts.serializeWeeklyDraft(original)))), key);
  assert.notEqual(await drafts.weeklySubmissionId(id(4), body), key); assert.notEqual(await drafts.weeklySubmissionId(USER, `${body}\nedit`), key);
  await assert.rejects(drafts.weeklySubmissionId('bad', body)); await assert.rejects(drafts.weeklySubmissionId(USER, ''));
});
