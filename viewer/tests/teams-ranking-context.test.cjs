const assert = require('node:assert/strict');
const { test } = require('node:test');
const load = require('./helpers/load-source.cjs');
const {
  validateRankingSourceContext: validate, rankingSourceFromEntity: legacy,
  rankingContextToSearchParams: serialize, rankingContextFromSearchParams: parse,
} = load('src/lib/notes/ranking-context.ts');

const entity = 'age=AGE_BAND_25&category=001&gender=F&period=7d';
const note = '33333333-3333-4333-8333-333333333333';
function context(patch = {}) {
  return { version: 1, kind: 'ranking', period: '7d', fromDate: '', toDate: '',
    selectedCategory: '001', gender: 'F', age: 'AGE_BAND_25', price: [2.5, 12],
    companies: ['회사 & 파트너'], brands: ['브랜드 / A', 'B+브랜드'], ownOnly: true, moverOnly: true,
    sort: 'reviews', sortDir: 'desc', page: 4, resolvedFromDate: '2026-09-25', resolvedToDate: '2026-10-01', ...patch };
}

test('complete context and Korean/special-character names round-trip with pinned dates', () => {
  const valid = validate(context(), entity);
  assert.ok(valid);
  const query = serialize(valid);
  assert.equal(query.get('context'), 'ranking-v1');
  query.set('notes', 'open'); query.set('note', note);
  assert.deepEqual(parse(query), valid);
  assert.equal(parse(query).period, '7d');
  assert.equal(parse(query).resolvedFromDate, '2026-09-25');
  assert.equal(parse(query).page, 4);
});

test('legacy only restores known fields with explicit partial marker and clean defaults', () => {
  const result = legacy(entity);
  assert.ok(result?.legacy);
  assert.deepEqual(result.price, [0, 50]);
  assert.deepEqual(result.brands, []);
  assert.deepEqual(result.companies, []);
  assert.equal(result.page, 1);
  assert.equal(result.ownOnly, false);
  assert.equal(result.resolvedFromDate, undefined);
  assert.equal(serialize(result).get('context'), 'ranking-legacy-v1');
  assert.deepEqual(parse(serialize(result)), result);
  assert.equal(legacy(entity.replace('period=7d', 'period=custom')), null);
});

for (const [label, patch] of [
  ['unknown version', { version: 2 }], ['unknown kind', { kind: 'product' }],
  ['unknown category', { selectedCategory: '999' }], ['unknown gender', { gender: 'X' }],
  ['unknown age', { age: 'all' }], ['unknown period', { period: 'forever' }],
  ['unknown sort', { sort: 'secret' }], ['unknown direction', { sortDir: 'up' }],
  ['non-boolean toggle', { ownOnly: 'true' }], ['non-integer page', { page: 1.5 }],
  ['zero page', { page: 0 }], ['oversized page', { page: 2197 }],
  ['negative price', { price: [-1, 50] }], ['empty price range', { price: [4, 4] }],
  ['infinite price', { price: [0, Infinity] }], ['wrong price shape', { price: [0, 5, 50] }],
  ['too many prices decimals', { price: [0.001, 50] }],
  ['missing list', { brands: undefined }], ['non-string name', { brands: [4] }],
  ['control character in name', { brands: ['A\nB'] }], ['long name', { brands: ['A'.repeat(101)] }],
  ['too many names', { brands: Array.from({ length: 21 }, (_, i) => 'B' + i) }],
  ['invalid calendar date', { resolvedFromDate: '2026-02-30' }],
  ['reversed dates', { resolvedFromDate: '2026-10-02' }],
  ['partial resolved range', { resolvedToDate: undefined }],
  ['period/range mismatch', { resolvedFromDate: '2026-09-01' }],
  ['arbitrary navigation property', { url: 'https://evil.example' }],
  ['invalid legacy flag', { legacy: false }], ['legacy with fabricated full filters', { legacy: true }],
]) test(`rejects ${label}`, () => assert.equal(validate(context(patch), entity), null));

test('custom ranges accept real dates and reject missing, conflicting or unbounded dates', () => {
  const custom = context({ period: 'custom', fromDate: '2026-09-03', toDate: '2026-09-08',
    resolvedFromDate: '2026-09-03', resolvedToDate: '2026-09-08' });
  assert.ok(validate(custom));
  assert.ok(validate({ ...custom, toDate: '' }));
  assert.equal(validate({ ...custom, resolvedToDate: '2026-09-09' }), null);
  assert.equal(validate({ ...custom, fromDate: '', toDate: '', resolvedFromDate: undefined, resolvedToDate: undefined }), null);
  assert.equal(validate({ ...custom, fromDate: '2020-01-01', toDate: '2026-09-08', resolvedFromDate: '2020-01-01' }), null);
  const today = context({ period: 'today', resolvedFromDate: '2026-10-01' });
  assert.ok(validate(today));
  assert.equal(validate({ ...today, resolvedFromDate: '2026-09-30' }), null);
});

test('source context cannot silently move the memo into another entity group', () => {
  assert.equal(validate(context(), entity.replace('gender=F', 'gender=M')), null);
  assert.equal(validate(context(), entity + '&redirect=https://evil.example'), null);
  assert.equal(legacy(entity + '&period=today'), null);
  assert.equal(legacy(entity.replace('category=001', 'category=https://evil.example')), null);
  assert.equal(legacy('x'.repeat(257)), null);
});

test('URL parsing rejects ambiguous, missing, malformed, unknown and oversized query inputs', () => {
  for (const mutate of [
    q => q.append('period', 'today'), q => q.set('redirect', 'https://evil.example'),
    q => q.set('context', 'ranking-v2'), q => q.delete('fromDate'),
    q => q.set('priceMin', ''), q => q.set('page', '1e2'), q => q.set('page', '-1'),
    q => q.set('ownOnly', 'true'), q => q.set('notes', 'closed'), q => q.set('note', '//evil.example'),
  ]) {
    const query = serialize(context()); mutate(query); assert.equal(parse(query), null, query.toString());
  }
  assert.equal(parse(new URLSearchParams('brand=' + 'x'.repeat(6001))), null);
  assert.equal(parse(new URLSearchParams(entity)), null);
});

test('query length is bounded instead of silently truncating saved names', () => {
  const value = context({ companies: Array.from({ length: 20 }, (_, i) => '회'.repeat(95) + i),
    brands: Array.from({ length: 20 }, (_, i) => '브'.repeat(95) + i) });
  assert.equal(validate(value), null);
  assert.throws(() => serialize(value), /Invalid ranking/);
  assert.ok(serialize(context()).toString().length < 5000);
});

test('duplicates are canonically deduplicated without changing named filters', () => {
  const value = context({ brands: ['B', 'A', 'B'], companies: ['Z', 'Z'] });
  assert.deepEqual(validate(value).brands, ['A', 'B']);
  assert.deepEqual(parse(serialize(value)).companies, ['Z']);
});

function renderRanking(query, mobile, savedFilters) {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  let drawer;
  const Page = load('src/app/(app)/ranking/page.tsx', {
    'next/navigation': { useRouter: () => ({ push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(query) },
    // These assertions inspect the resolved view; performance mount tests cover the pending SSR/client gate.
    '@/hooks/useResolvedViewport': { useResolvedViewport: () => mobile ? 'mobile' : 'desktop' },
    '@/lib/queries': { CATEGORY_MAP: { '000': '전체', '001': '상의' }, AGE_MAP: { AGE_BAND_25: '25~30세' } },
    '@/lib/queries-me': { fetchNoteCountForEntity: async () => 0, logView: async () => {} },
    '@/components/me/SavedFiltersDropdown': { __esModule: true, default: () => null },
    '@/components/me/NoteDrawer': { __esModule: true,
      default: props => { drawer = props; return React.createElement('div', { 'data-note-drawer': props.entity_id }); },
      useSourceNoteDrawer: () => ({ noteDrawerOpen: true, setNoteDrawerOpen() {} }) },
  }).default;
  const previous = global.localStorage;
  if (savedFilters) global.localStorage = { getItem: key => key === 'uttu-ranking-filters' ? JSON.stringify(savedFilters) : null };
  try {
    const html = renderToStaticMarkup(React.createElement(Page));
    return { html, drawer };
  } finally { global.localStorage = previous; }
}

test('desktop source render restores all saved filters, pinned dates and original memo entity', () => {
  const query = serialize(context()); query.set('note', note);
  const previous = global.localStorage;
  global.localStorage = { getItem() { throw new Error('A source link must not read personal filters'); } };
  try {
    const { html, drawer } = renderRanking(query, false);
    assert.equal(drawer.entity_id, entity);
    assert.deepEqual(drawer.sourceContext, validate(context()));
    assert.equal(drawer.open, true);
    assert.match(html, /회사 &amp; 파트너/);
    assert.match(html, /B\+브랜드/);
    assert.match(html, /2026-09-25/);
    assert.match(html, /2026-10-01/);
  } finally { global.localStorage = previous; }
});

test('mobile source render retains full filters and exact memo drawer in a one-column layout', () => {
  const query = serialize(context()); query.set('notes', 'open'); query.set('note', note);
  const { html, drawer } = renderRanking(query, true);
  assert.deepEqual(drawer.sourceContext, validate(context()));
  assert.equal(drawer.entity_id, entity);
  assert.match(html, /grid-template-columns:minmax\(0, 1fr\)/);
  assert.match(html, /overflow-x:auto/);
  assert.match(html, /브랜드 \/ A/);
});

test('legacy links visibly disclose incomplete historical context', () => {
  const { html, drawer } = renderRanking(serialize(legacy(entity)), true);
  assert.match(html, /상세 필터와 기준 날짜는 저장되지 않아/);
  assert.equal(drawer.entity_id, entity);
});

test('new today memo cannot silently save partial context before snapshot date is known', () => {
  const { drawer } = renderRanking('', false, { period: 'today', companies: ['회사'], brands: ['브랜드'], price: [3, 10] });
  assert.equal(drawer.sourceContext, undefined);
  assert.match(drawer.saveBlockedReason, /기준 날짜를 확인하는 중/);
});

test('oversized current selections block memo save instead of discarding source context', () => {
  const { drawer } = renderRanking('', false, { period: '7d', companies: [],
    brands: Array.from({ length: 21 }, (_, i) => '브랜드' + i), price: [3, 10] });
  assert.equal(drawer.sourceContext, undefined);
  assert.match(drawer.saveBlockedReason, /20개 이하/);
});

test('valid pinned full context does not block memo save', () => {
  const { drawer } = renderRanking(serialize(context()), false);
  assert.ok(drawer.sourceContext);
  assert.equal(drawer.saveBlockedReason, undefined);
});

test('relative dates remain exactly seven KST calendar days throughout the day', () => {
  const OriginalDate = global.Date;
  try {
    for (const [now, from, to] of [
      ['2026-10-02T00:00:00Z', '2026-09-26', '2026-10-02'],
      ['2026-10-02T08:00:00Z', '2026-09-26', '2026-10-02'],
      ['2026-10-02T18:00:00Z', '2026-09-27', '2026-10-03'],
    ]) {
      global.Date = class extends OriginalDate {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return OriginalDate.parse(now); }
      };
      const { drawer } = renderRanking('', false, { period: '7d', companies: [], brands: [], price: [0, 50] });
      assert.equal(drawer.saveBlockedReason, undefined, now);
      assert.equal(drawer.sourceContext.resolvedFromDate, from, now);
      assert.equal(drawer.sourceContext.resolvedToDate, to, now);
    }
  } finally { global.Date = OriginalDate; }
});
