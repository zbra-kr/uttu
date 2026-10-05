const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), SSR = require('react-dom/server'), Renderer = require('react-test-renderer');
const load = require('./helpers/load-source.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function fixture(mobile, initialQuery = 'no=123') {
  let query = initialQuery; const calls = [], listeners = new Set();
  const media = { matches: mobile, addEventListener(_, fn) { listeners.add(fn); }, removeEventListener(_, fn) { listeners.delete(fn); } };
  const queries = { CATEGORY_MAP: {}, AGE_MAP: {} };
  for (const name of ['fetchProductDetail', 'fetchProductPriceHistory', 'fetchProductRankHistory', 'fetchProductCategoryRanks']) {
    queries[name] = async no => { calls.push([name, no]); return name === 'fetchProductDetail' ? null : name === 'fetchProductCategoryRanks' ? { rows: [], snapshot_date: '' } : []; };
  }
  function Mobile() { React.useEffect(() => { calls.push(['mobile-mount', query]); }, []); return React.createElement('main', null, 'Mobile product'); }
  const hidden = { __esModule: true, default: () => null };
  const Page = load('src/app/(app)/product/page.tsx', {
    './MobileProductDetailView': { __esModule: true, default: Mobile },
    '@/components/product/ProductObservationPanel': { __esModule: true, default: ({ query }) => React.createElement('aside', null, query) },
    '@/components/product/ProductReviewMode': { __esModule: true, default: ({ children }) => children },
    '@/components/me/BookmarkToggle': hidden,
    '@/components/me/NoteDrawer': { ...hidden, SourceNoteFallback: () => null, useSourceNoteDrawer: () => ({ noteDrawerOpen: false, setNoteDrawerOpen() {} }) },
    '@/lib/queries': queries, '@/lib/queries-me': { fetchNoteCountForEntity: async () => 0, logView: async () => {} },
    'next/navigation': { useSearchParams: () => new URLSearchParams(query), useRouter: () => ({ push() {} }) },
    'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
    recharts: Object.fromEntries(['LineChart', 'Line', 'XAxis', 'YAxis', 'Tooltip', 'ResponsiveContainer', 'ReferenceDot'].map(name => [name, () => null])),
  }).default;
  return { Page, calls, media, listeners, resize(value) { media.matches = value; for (const fn of listeners) fn({ matches: value }); }, query(value) { query = value; } };
}
test('product SSR and first client render are viewport-neutral with no readers', () => {
  const saved = global.window;
  try {
    const desktop = fixture(false), mobile = fixture(true); delete global.window;
    const html = SSR.renderToString(React.createElement(desktop.Page));
    global.window = { matchMedia: () => mobile.media };
    assert.equal(SSR.renderToString(React.createElement(mobile.Page)), html);
    assert.match(html, /role="status"/); assert.match(html, /상품 화면을 준비하는 중/);
    assert.deepEqual(desktop.calls, []); assert.deepEqual(mobile.calls, []);
  } finally { if (saved === undefined) delete global.window; else global.window = saved; }
});
test('cold mobile skips desktop reads and both resize directions retain existing mounts', async () => {
  const saved = global.window, f = fixture(true); global.window = { matchMedia: () => f.media, dispatchEvent() {} }; let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.Page)); });
    assert.deepEqual(f.calls, [['mobile-mount', 'no=123']]);
    await React.act(async () => f.resize(false));
    for (const name of ['fetchProductDetail', 'fetchProductPriceHistory', 'fetchProductRankHistory', 'fetchProductCategoryRanks']) assert.equal(f.calls.filter(c => c[0] === name).length, 1);
    await React.act(async () => f.resize(true)); assert.equal(f.calls.filter(c => c[0] === 'mobile-mount').length, 2);
    assert.equal(f.calls.filter(c => c[0] === 'fetchProductDetail').length, 1);
  } finally { if (root) await React.act(async () => root.unmount()); assert.equal(f.listeners.size, 0); if (saved === undefined) delete global.window; else global.window = saved; }
});
test('cold desktop acquires each actual first-wave reader exactly once', async () => {
  const saved = global.window, f = fixture(false); global.window = { matchMedia: () => f.media, dispatchEvent() {} }; let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.Page)); });
    assert.deepEqual(f.calls.map(c => c[0]), ['fetchProductDetail', 'fetchProductPriceHistory', 'fetchProductRankHistory', 'fetchProductCategoryRanks']);
    assert.ok(JSON.stringify(root.toJSON()).includes('상품 정보를 찾을 수 없습니다'));
  } finally { if (root) await React.act(async () => root.unmount()); if (saved === undefined) delete global.window; else global.window = saved; }
});
test('malformed observations never fall through, while current-product and no-product routes keep their behavior', async () => {
  const saved = global.window;
  try {
    for (const mobile of [true, false]) {
      const invalid = 'no=123abc&obs=ranking-v1&store=musinsa&date=2026-10-05&category=000&gender=A&age=AGE_BAND_ALL';
      const f = fixture(mobile, invalid); global.window = { matchMedia: () => f.media, dispatchEvent() {} }; let root;
      try {
        await React.act(async () => { root = Renderer.create(React.createElement(f.Page)); }); assert.deepEqual(f.calls, []);
        f.query(''); await React.act(async () => root.update(React.createElement(f.Page)));
        assert.equal(f.calls.filter(c => c[0] === 'fetchProductDetail').length, 0);
        f.query('no=123'); await React.act(async () => root.update(React.createElement(f.Page)));
        assert.equal(f.calls.filter(c => c[0] === 'fetchProductDetail').length, mobile ? 0 : 1);
      } finally { if (root) await React.act(async () => root.unmount()); }
    }
  } finally { if (saved === undefined) delete global.window; else global.window = saved; }
});
