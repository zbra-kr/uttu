const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const SSR = require('react-dom/server');
const Renderer = require('react-test-renderer');
const loadSource = require('./helpers/load-source.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function fixture(mobile) {
  const calls = [];
  const listeners = new Set();
  const media = { matches: mobile, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
  const queries = {};
  for (const name of ['fetchCollectionStats', 'fetchOwnBrandBreakdown', 'fetchAnomalySignals', 'fetchActivePromotions', 'fetchLatestRanking', 'fetchTopBrandRanking']) {
    queries[name] = async () => { calls.push(name); return []; };
  }
  queries.fetchReviewStats = async () => { calls.push('fetchReviewStats'); return { total: 0, avgRating: 0, lowCount: 0, ratingDist: [0, 0, 0, 0, 0] }; };
  queries.fetchActiveJobs = async () => { calls.push('fetchActiveJobs'); return { state: 'available', jobs: [], limit: 100 }; };
  const channel = { on() { return this; }, subscribe() { return this; } };
  function MobileHome() {
    React.useEffect(() => { calls.push('mobile-mount'); }, []);
    return React.createElement('main', null, 'Mobile fixture');
  }
  const Home = loadSource('src/app/(app)/page.tsx', {
    './MobileHomeView': { __esModule: true, default: MobileHome },
    '@/lib/queries': queries,
    '@/lib/supabase/client': { supabaseBrowser: () => ({ auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) }, channel: () => channel, removeChannel() {} }) },
    'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
    'next/navigation': { useRouter: () => ({ push() {} }) },
  }).default;
  return { Home, calls, media, resize(value) { media.matches = value; for (const fn of listeners) fn({ matches: value }); }, listeners };
}

test('home SSR stays viewport-neutral and performs no readers', () => {
  const saved = globalThis.window;
  try {
    const desktop = fixture(false), mobile = fixture(true);
    delete globalThis.window;
    const html = SSR.renderToString(React.createElement(desktop.Home));
    globalThis.window = { matchMedia: () => mobile.media };
    assert.equal(SSR.renderToString(React.createElement(mobile.Home)), html);
    assert.match(html, /role="status"/);
    assert.deepEqual(desktop.calls, []);
    assert.deepEqual(mobile.calls, []);
  } finally { globalThis.window = saved; }
});

test('cold mobile skips actual desktop readers; viewport transitions still mount each view once', async () => {
  const saved = globalThis.window;
  const f = fixture(true);
  globalThis.window = { matchMedia: () => f.media };
  let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.Home)); });
    assert.deepEqual(f.calls, ['mobile-mount']);
    await React.act(async () => { f.resize(false); });
    for (const name of ['fetchCollectionStats', 'fetchOwnBrandBreakdown', 'fetchActiveJobs', 'fetchLatestRanking']) assert.equal(f.calls.filter(x => x === name).length, 1, name);
    await React.act(async () => { f.resize(true); });
    assert.equal(f.calls.filter(x => x === 'mobile-mount').length, 2);
    assert.equal(f.calls.filter(x => x === 'fetchCollectionStats').length, 1);
  } finally {
    if (root) await React.act(async () => root.unmount());
    assert.equal(f.listeners.size, 0);
    globalThis.window = saved;
  }
});

test('cold desktop retains one acquisition of each actual desktop reader', async () => {
  const saved = globalThis.window;
  const f = fixture(false);
  globalThis.window = { matchMedia: () => f.media };
  let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.Home)); });
    assert.equal(f.calls.includes('mobile-mount'), false);
    assert.equal(f.calls.length, 8);
    assert.equal(new Set(f.calls).size, 8);
  } finally {
    if (root) await React.act(async () => root.unmount());
    globalThis.window = saved;
  }
});
