const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), Renderer = require('react-test-renderer');
const load = require('./helpers/load-source.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const query = 'no=123&obs=ranking-v1&store=musinsa&date=2026-10-05&category=000&gender=A&age=AGE_BAND_ALL';

for (const mobile of [false, true]) for (const own of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} product displays before delayed category, failure and retry, ${own ? 'own' : 'competitor'}`, async () => {
    const saved = { window: global.window, fetch: global.fetch, document: global.document };
    global.document = { activeElement: null };
    global.fetch = () => { throw Error('live network forbidden'); };
    global.window = { matchMedia: () => ({ matches: mobile, addEventListener() {}, removeEventListener() {} }), dispatchEvent() {} };
    let currentQuery = query;
    const calls = [], hidden = { __esModule: true, default: () => null };
    let rejectCategory;
    let pending = new Promise((resolve,reject) => { rejectCategory=reject; });
    let state = null;
    const detail = { id: 'fixture-product', musinsa_no: 123, name: 'Fixture product', brand_name: 'Fixture brand', is_own: own,
      final_price: 1000, list_price: 1000, review_count: 0, rating: null, ranking_best_records: [], item_seasons: [], labels: [], colors: [], sizes: [] };
    const queries = { CATEGORY_MAP: {}, AGE_MAP: {} };
    for (const [name, result] of Object.entries({ fetchProductDetail: detail, fetchProductHistories: { price: [], rank: [] },
      fetchProductCategoryRanks: { rows: [], snapshot_date: '' }, fetchReviews: { rows: mobile && !own ? [{ id: 'fixture-review', rating: 5, review_date: '2026-10-05', review_text: 'Saved competitor review', image_urls: [], satisfactions: [] }] : [], total: mobile && !own ? 1 : 0 }, fetchBodyStats: null })) {
      queries[name] = async (...args) => { calls.push([name, ...args]); return result; };
    }
    queries.fetchProductCategoryRanks = (...args) => { calls.push(['category', ...args]); return pending; };
    const mocks = {
      '@/lib/supabase/client': { supabaseBrowser: () => ({ auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getUser: async () => ({ data: { user: { id: 'fixture-user' } } }) } }) }, '@/lib/queries': queries, '@/lib/observation-review-context': { useObservationReviewState: () => state },
      '@/lib/queries-me': { fetchNoteCountForEntity: async () => 0, logView: async () => {} },
      'next/navigation': { useSearchParams: () => new URLSearchParams(currentQuery), useRouter: () => ({ push() {} }) },
      'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
      '@/components/product/ProductObservationPanel': hidden,
      '@/components/me/BookmarkToggle': hidden, '@/components/mobile/ReviewDetailSheet': hidden,
      '@/components/me/NoteDrawer': { ...hidden, SourceNoteFallback: () => null, useSourceNoteDrawer: () => ({ noteDrawerOpen: false, setNoteDrawerOpen() {} }) },
      recharts: Object.fromEntries(['LineChart', 'Line', 'XAxis', 'YAxis', 'Tooltip', 'ResponsiveContainer', 'ReferenceDot'].map(name => [name, () => null])),
    };
    const Component = load(mobile ? 'src/app/(app)/product/MobileProductDetailView.tsx' : 'src/app/(app)/product/page.tsx', mocks).default;
    let root;
    try {
      await React.act(async () => { root = Renderer.create(React.createElement(Component)); });
      const text = () => JSON.stringify(root.toJSON());
      assert.ok(text().includes('Fixture product'));
      assert.ok(text().includes('1,000'));
      assert.ok(text().includes('카테고리 현황을 불러오는 중'));
      await React.act(async () => rejectCategory(Error('category failed')));
      assert.ok(text().includes('Fixture product') && text().includes('1,000'));
      assert.ok(text().includes('카테고리 현황을 불러오지 못했습니다'));
      pending = Promise.resolve({ rows: [], snapshot_date: '' });
      await React.act(async () => root.root.findAllByType('button').find(b => b.children.join('') === '다시 시도').props.onClick());
      assert.ok(text().includes('저장된 카테고리 진입 기록이 없습니다'));
      assert.ok(text().includes('Fixture product') && text().includes('1,000'));
      let resolveDetailB;
      queries.fetchProductDetail = () => new Promise(resolve => { resolveDetailB = resolve; });
      pending = new Promise(() => {});
      currentQuery = 'no=456';
      await React.act(async () => root.update(React.createElement(Component)));
      assert.ok(!text().includes('Fixture product'));
      assert.ok(!text().includes('저장된 카테고리 진입 기록이 없습니다'));
      await React.act(async () => resolveDetailB({ ...detail, id: 'product-B', musinsa_no: 456, name: 'Product B', final_price: 2000 }));
      assert.ok(text().includes('Product B') && text().includes('2,000'));
      assert.ok(text().includes('카테고리 현황을 불러오는 중'));

    } finally {
      if (root) await React.act(async () => root.unmount());
      for (const key of ['window', 'fetch', 'document']) { if (saved[key] === undefined) delete global[key]; else global[key] = saved[key]; }
    }
  });
}
