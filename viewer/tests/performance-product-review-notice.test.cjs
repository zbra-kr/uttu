const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), Renderer = require('react-test-renderer');
const load = require('./helpers/load-source.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const query = 'no=123&obs=ranking-v1&store=musinsa&date=2026-10-05&category=000&gender=A&age=AGE_BAND_ALL';

for (const mobile of [false, true]) for (const own of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} actual product review notice and dated mode, ${own ? 'own' : 'competitor'}`, async () => {
    const notice = mobile ? '최근 리뷰는 이 상품에 연결된 저장 리뷰 일부입니다. 수집 범위나 완료 여부를 뜻하지 않습니다.' : '이 최근 리뷰 화면은 자사 상품 리뷰를 표시합니다.';
    const saved = { window: global.window, fetch: global.fetch, document: global.document };
    global.document = { activeElement: null };
    global.fetch = () => { throw Error('live network forbidden'); };
    global.window = { matchMedia: () => ({ matches: mobile, addEventListener() {}, removeEventListener() {} }), dispatchEvent() {} };
    const calls = [], hidden = { __esModule: true, default: () => null };
    let state = { query, available: true, active: false, status: 'recent', date: '2026-10-05', result: null,
      activate() { state = { ...state, active: true, status: 'ready', result: { rows: [], total: 0, excluded: 0 } }; },
      recent() { state = { ...state, active: false, status: 'recent', result: null }; }, retry() {} };
    const detail = { id: 'fixture-product', musinsa_no: 123, name: 'Fixture product', brand_name: 'Fixture brand', is_own: own,
      final_price: 1000, list_price: 1000, review_count: 0, rating: null, ranking_best_records: [], item_seasons: [], labels: [], colors: [], sizes: [] };
    const queries = { CATEGORY_MAP: {}, AGE_MAP: {} };
    for (const [name, result] of Object.entries({ fetchProductDetail: detail, fetchProductHistories: { price: [], rank: [] },
      fetchProductCategoryRanks: { rows: [], snapshot_date: '' }, fetchReviews: { rows: mobile && !own ? [{ id: 'fixture-review', rating: 5, review_date: '2026-10-05', review_text: 'Saved competitor review', image_urls: [], satisfactions: [] }] : [], total: mobile && !own ? 1 : 0 }, fetchBodyStats: null })) {
      queries[name] = async (...args) => { calls.push([name, ...args]); return result; };
    }
    const mocks = {
      '@/lib/queries': queries, '@/lib/observation-review-context': { useObservationReviewState: () => state },
      '@/lib/queries-me': { fetchNoteCountForEntity: async () => 0, logView: async () => {} },
      'next/navigation': { useSearchParams: () => new URLSearchParams(query), useRouter: () => ({ push() {} }) },
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
      assert.equal(text().includes(notice), !own);
      assert.ok(!text().includes('자사 상품만 수집') && !text().includes('리뷰 수집 대상이 아닙니다'));
      assert.ok(text().includes(own ? (mobile ? '최근 리뷰 (0건)' : '수집된 리뷰가 없습니다') : notice));
      assert.equal(text().includes('Saved competitor review'), mobile && !own);
      const before = JSON.stringify(calls);
      root.root.findAllByType('button').find(button => button.children.join('').includes('저장 리뷰 확인')).props.onClick({ currentTarget: {} });
      await React.act(async () => root.update(React.createElement(Component)));
      assert.ok(text().includes('2026-10-05') && text().includes('관측일의 저평점 저장 리뷰'));
      assert.ok(text().includes('최대 20건'));
      assert.ok(!text().includes(notice));
      assert.ok(!text().includes('Saved competitor review'));
      assert.equal(JSON.stringify(calls), before);
      state = { ...state, status: 'error', result: null };
      await React.act(async () => root.update(React.createElement(Component)));
      assert.ok(root.root.findAll(node => node.props.role === 'alert').length);
      root.root.findAllByType('button').find(button => button.children.join('') === '최근 리뷰로 돌아가기').props.onClick({ currentTarget: {} });
      await React.act(async () => root.update(React.createElement(Component)));
      assert.equal(text().includes(notice), !own);
      assert.equal(text().includes('Saved competitor review'), mobile && !own);
      assert.equal(JSON.stringify(calls), before);
      assert.equal(calls.filter(call => call[0] === 'fetchReviews').length, own || mobile ? 1 : 0);
    } finally {
      if (root) await React.act(async () => root.unmount());
      for (const key of ['window', 'fetch', 'document']) { if (saved[key] === undefined) delete global[key]; else global[key] = saved[key]; }
    }
  });
}
