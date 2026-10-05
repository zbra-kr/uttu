const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), Renderer = require('react-test-renderer'), load = require('./helpers/load-source.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const tick = () => new Promise(resolve => setImmediate(resolve));
const query = (product = '123', date = '2026-10-05') => new URLSearchParams({ no: product, obs: 'ranking-v1', store: 'musinsa', date, category: '000', gender: 'A', age: 'AGE_BAND_ALL' }).toString();
function fixture({ pending = false, identityPending = false, identityFailure = false, shell = false } = {}) {
  let currentQuery = query(), today = '2026-10-05', owner = 'first-owner', mode = 'ready', root, state, identityReads = 0, resolveIdentity;
  const calls = [], listeners = new Set();
  const sdk = { auth: {
    getUser() { identityReads++; const response = { data: { user: owner ? { id: owner } : null }, error: identityFailure ? Error('inert identity failure') : null }; return identityPending ? new Promise(resolve => { resolveIdentity = () => resolve(response); }) : Promise.resolve(response); },
    onAuthStateChange(fn) { listeners.add(fn); return { data: { subscription: { unsubscribe() { listeners.delete(fn); } } } }; },
  }, from(table) {
    const call = { table, owner, ops: [], mode, settled: false };
    const proxy = new Proxy({}, { get(_, method) {
      if (method === 'then') return (yes, no) => { calls.push(call); return new Promise(resolve => { call.resolve = () => { call.settled = true; resolve(response(call)); }; if (!pending) call.resolve(); }).then(yes, no); };
      return (...args) => { call.ops.push([method, ...args]); if (method === 'abortSignal') call.signal = args[0]; return proxy; };
    } }); return proxy;
  } };
  function response(c) {
    if (c.mode === 'error') return { data: null, count: null, error: Error('inert query failure') };
    if (c.table === 'products') {
      const no = c.ops.find(x => x[0] === 'eq' && x[1] === 'musinsa_no')[2];
      const row = { id: 'product-' + no, musinsa_no: no, is_own: c.mode !== 'competitor' };
      if (c.mode === 'missing') return { data: [], error: null };
      if (c.mode === 'ambiguous') return { data: [row, row], error: null };
      if (c.mode === 'invalid-link') row.id = null;
      if (c.mode === 'wrong-number') row.musinsa_no = 999;
      return { data: [row], error: null };
    }
    const productId = c.ops.find(x => x[0] === 'eq' && x[1] === 'product_id')[2];
    const date = c.ops.find(x => x[0] === 'gte' && x[1] === 'review_date')[2];
    const row = { id: c.owner, product_id: c.mode === 'foreign-row' ? 'wrong-product' : productId, rating: 1, review_date: date, review_text: c.owner,
      products: { musinsa_no: productId.slice('product-'.length), name: 'Fixture', is_own: true, brands: { name: 'Fixture' } } };
    return { data: c.mode === 'empty' ? [] : [row], count: c.mode === 'count-missing' ? null : c.mode === 'empty' ? 0 : 30, error: null };
  }
  const mocks = { '@/lib/supabase/client': { supabaseBrowser: () => sdk }, './supabase/client': { supabaseBrowser: () => sdk } };
  const hook = load('src/hooks/useObservationReviews.ts', mocks).useObservationReviews;
  let App = () => { state = hook(currentQuery, today); return React.createElement('probe', null, state.status); }, media, mediaListeners, saved;
  if (shell) {
    saved = { window: global.window, document: global.document };
    mediaListeners = new Set(); media = { matches: false, addEventListener(_, fn) { mediaListeners.add(fn); }, removeEventListener(_, fn) { mediaListeners.delete(fn); } };
    global.window = { matchMedia: () => media, addEventListener() {}, removeEventListener() {} };
    global.document = { documentElement: { setAttribute() {}, style: { setProperty() {} } } };
    mocks['next/navigation'] = { usePathname: () => '/product', useSearchParams: () => new URLSearchParams(currentQuery), useRouter: () => ({ push() {} }) };
    const context = load('src/lib/observation-review-context.ts', mocks); mocks['@/lib/observation-review-context'] = context;
    mocks['@/components/report/DailyReportBoundary'] = mocks['@/components/briefing/CSDailyReviewBoundary'] = { __esModule: true, default: ({ children }) => children };
    mocks['@/components/onboarding/OnboardingProvider'] = { useOnboarding: () => ({ active: false, step: 0 }) };
    mocks['@/lib/queries'] = { ...load('src/lib/queries.ts', mocks), fetchShellStats: async () => ({}) };
    for (const name of ['./Sidebar', './Topbar', './AiPanel', './CmdK']) mocks[name] = { __esModule: true, default: () => null };
    mocks['./MobileShell'] = { __esModule: true, default: ({ children }) => React.createElement('mobile-shell', null, children) };
    const Shell = load('src/components/shell/ShellClient.tsx', mocks).default;
    function Consumer() { state = context.useObservationReviewState(); return React.createElement('source-view', null, state?.status); }
    App = () => React.createElement(Shell, null, React.createElement(Consumer));
  }
  return { calls, listeners, get state() { return state; }, get identityReads() { return identityReads; },
    async mount() { await React.act(async () => { root = Renderer.create(React.createElement(App)); await tick(); }); },
    async activate() { await React.act(async () => { state.activate(); await tick(); }); },
    async recent() { await React.act(async () => { state.recent(); await tick(); }); },
    async retry() { await React.act(async () => { state.retry(); await tick(); }); },
    async clock(value) { today = value; await React.act(async () => { root.update(React.createElement(App)); await tick(); }); },
    async update(nextQuery, mobile) { currentQuery = nextQuery; if (!root) return; await React.act(async () => { if (media && mobile !== undefined) { media.matches = mobile; for (const fn of mediaListeners) fn({ matches: mobile }); } root.update(React.createElement(App)); await tick(); }); },
    async auth(value, event) { if (!event) owner = value; await React.act(async () => { for (const fn of listeners) fn(event || (value ? 'SIGNED_IN' : 'SIGNED_OUT'), value ? { user: { id: value } } : null); await tick(); }); },
    async resolve() { await React.act(async () => { for (const c of calls.filter(c => !c.settled)) c.resolve(); await tick(); }); },
    async resolveIdentity() { await React.act(async () => { resolveIdentity(); await tick(); }); },
    mode(value) { mode = value; }, recoverIdentity() { identityFailure = false; identityPending = false; },
    async close() { if (root) await React.act(async () => root.unmount()); if (saved) for (const key of ['window', 'document']) { if (saved[key] === undefined) delete global[key]; else global[key] = saved[key]; } },
  };
}

test('explicit activation alone performs bounded product linkage and exact own/product/date/rating query', async () => {
  const f = fixture(); try {
    await f.mount(); assert.equal(f.state.status, 'recent'); assert.equal(f.identityReads, 0); assert.equal(f.calls.length, 0);
    await f.activate(); assert.equal(f.state.status, 'ready'); assert.equal(f.identityReads, 1); assert.equal(f.calls.length, 2);
    const identity = f.calls[0], source = f.calls[1];
    assert.deepEqual(identity.ops.find(x => x[0] === 'limit'), ['limit', 2]);
    assert.deepEqual(source.ops.filter(x => ['eq', 'gte', 'lte'].includes(x[0])), [['gte', 'rating', 1], ['lte', 'rating', 2], ['eq', 'product_id', 'product-123'], ['eq', 'products.is_own', true], ['gte', 'review_date', '2026-10-05'], ['lte', 'review_date', '2026-10-05']]);
    assert.deepEqual(source.ops.find(x => x[0] === 'range'), ['range', 0, 19]); assert.equal(source.ops.find(x => x[0] === 'select')[2].count, 'exact');
    assert.deepEqual(source.ops.filter(x => x[0] === 'order'), [['order', 'review_date', { ascending: false }], ['order', 'id', { ascending: false }]]);
    assert.ok(identity.signal instanceof AbortSignal); assert.ok(source.signal instanceof AbortSignal);
    assert.equal(f.state.result.total, 30); await f.auth('first-owner'); assert.equal(f.calls.length, 2);
    await f.recent(); assert.equal(f.state.result, null); assert.equal(source.signal.aborted, true); assert.equal(f.listeners.size, 0);
  } finally { await f.close(); }
});

test('current-product/no-date and malformed/future observation scopes never activate any new read', async () => {
  for (const value of ['no=123', 'no=123abc', query('0'), query('123', '2026-02-30'), query('123', '2026-10-06'), query().replace('store=musinsa', 'store=other'), query() + '&no=456']) {
    const f = fixture(); await f.update(value);
    try { await f.mount(); await f.activate(); assert.equal(f.state.available, false); assert.equal(f.calls.length, 0); assert.equal(f.identityReads, 0); } finally { await f.close(); }
  }
});

test('missing/ambiguous/invalid linkage and competitor classification never dispatch source reviews', async () => {
  for (const mode of ['missing', 'ambiguous', 'invalid-link', 'wrong-number', 'competitor']) {
    const f = fixture(); try { f.mode(mode); await f.mount(); await f.activate(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].table, 'products'); assert.equal(f.state.status, mode === 'competitor' ? 'competitor' : 'unavailable'); assert.equal(f.state.result, null); } finally { await f.close(); }
  }
});

test('empty is normal, foreign linkage rows excluded, unavailable exact count retryable', async () => {
  const f = fixture(); try {
    f.mode('empty'); await f.mount(); await f.activate(); assert.equal(f.state.result.total, 0);
    f.mode('foreign-row'); await f.retry(); assert.equal(f.state.result.rows.length, 0); assert.equal(f.state.result.excluded, 1);
    f.mode('count-missing'); await f.retry(); assert.equal(f.state.status, 'error'); f.mode('ready'); await f.retry(); assert.equal(f.state.status, 'ready');
  } finally { await f.close(); }
});

test('late metadata/source and product/date/mode changes cannot publish old results or auto-reactivate', async () => {
  const f = fixture({ pending: true }); try {
    await f.mount(); await f.activate(); assert.equal(f.calls.length, 1);
    await f.update(query('456')); assert.equal(f.state.status, 'recent'); await f.resolve(); assert.equal(f.calls.length, 1);
    await f.activate(); await f.resolve(); assert.equal(f.calls.length, 3); await f.update(query('456', '2026-10-04')); await f.resolve(); assert.equal(f.state.result, null); assert.equal(f.calls[2].signal.aborted, true);
    await f.activate(); await f.resolve(); await f.recent(); await f.resolve(); assert.equal(f.state.result, null); assert.equal(f.state.status, 'recent');
    await f.update(query('456')); assert.equal(f.state.active, false);
  } finally { await f.close(); }
});

test('owner change and signout clear source and ignore late prior-owner data', async () => {
  const f = fixture({ pending: true }); try {
    await f.mount(); await f.activate(); await f.resolve(); await f.resolve(); assert.equal(f.state.result.rows[0].review_text, 'first-owner');
    await f.auth('replacement-owner'); assert.equal(f.state.status, 'loading'); assert.equal(f.state.result, null);
    await f.resolve(); await f.resolve(); assert.equal(f.state.result.rows[0].review_text, 'replacement-owner');
    await f.auth(null); assert.equal(f.state.status, 'signed-out'); assert.equal(f.state.result, null); await f.resolve(); assert.equal(f.state.result, null);
  } finally { await f.close(); }
});

test('initial null plus verification failure retries, explicit auth events beat delayed lookup', async () => {
  const f = fixture({ identityPending: true, identityFailure: true }); try {
    await f.mount(); await f.activate(); await f.auth(null, 'INITIAL_SESSION'); await f.resolveIdentity(); assert.equal(f.state.status, 'error'); assert.equal(f.calls.length, 0);
    f.recoverIdentity(); await f.retry(); assert.equal(f.state.status, 'ready');
  } finally { await f.close(); }
  for (const owner of [null, 'new-owner']) {
    const g = fixture({ identityPending: true, identityFailure: true }); try {
      await g.mount(); await g.activate(); await g.auth(owner); await g.auth('stale-owner', 'INITIAL_SESSION'); await g.resolveIdentity(); assert.equal(g.state.status, owner ? 'ready' : 'signed-out'); assert.equal(g.state.result?.rows[0].review_text ?? null, owner);
    } finally { await g.close(); }
  }
});

test('actual Shell resize preserves mode and exact query budget; unmount cancels', async () => {
  const f = fixture({ shell: true, pending: true }); try {
    await f.mount(); assert.equal(f.calls.length, 0); await f.activate(); await f.resolve(); await f.resolve(); assert.equal(f.calls.length, 2);
    await f.update(query(), true); await f.update(query(), false); assert.equal(f.calls.length, 2); assert.equal(f.identityReads, 1); assert.equal(f.state.status, 'ready');
    await f.retry(); assert.equal(f.calls.length, 3); await f.close(); assert.equal(f.calls[2].signal.aborted, true); await f.resolve(); assert.equal(f.listeners.size, 0);
  } finally { await f.close(); }
});

test('actual existing-section switch clears raw expansions and retains named retry focus without stealing focus', async () => {
  const saved = global.document; let root, focused, retries = 0, activations = 0, recent = 0, mounts = 0;
  const button = {}, outside = {}, region = { focus() { focused = region; global.document.activeElement = region; } };
  let value = { query: query(), available: true, active: false, status: 'recent', result: null, date: '2026-10-05', activate() { activations++; }, recent() { recent++; }, retry() { retries++; } };
  const Panel = load('src/components/product/ProductReviewMode.tsx', { '@/lib/observation-review-context': { useObservationReviewState: () => value } }).default;
  const detail = { id: 'product-123', musinsa_no: 123, is_own: true };
  const app = () => React.createElement(Panel, { query: query(), detail }, React.createElement('p', null, 'Existing recent reviews'));
  global.document = { activeElement: button };
  try {
    await React.act(async () => { root = Renderer.create(app(), { createNodeMock(node) { if (node.type === 'section') { mounts++; return region; } return null; } }); });
    root.root.findByType('button').props.onClick({ currentTarget: button }); assert.equal(activations, 1); assert.equal(focused, region);
    value = { ...value, active: true, status: 'ready', result: { rows: [{ id: 'old', rating: 1, review_date: '2026-10-05', review_text: 'Old raw text' }], total: 1, excluded: 0 } };
    await React.act(async () => root.update(app())); assert.equal(root.root.findAllByType('details').length, 1);
    for (const status of ['loading', 'signed-out', 'error']) { value = { ...value, status, result: null }; await React.act(async () => root.update(app())); assert.equal(root.root.findAllByType('details').length, 0); assert.ok(!JSON.stringify(root.toJSON()).includes('Old raw text')); }
    const retry = root.root.findAllByType('button').at(-1); retry.props.onClick({ currentTarget: button }); assert.equal(retries, 1); assert.equal(focused, region);
    value = { ...value, status: 'loading' }; await React.act(async () => root.update(app())); assert.equal(mounts, 1); assert.equal(global.document.activeElement, region);
    value = { ...value, status: 'error' }; await React.act(async () => root.update(app())); global.document.activeElement = outside; focused = outside;
    root.root.findAllByType('button').at(-1).props.onClick({ currentTarget: button }); assert.equal(focused, outside);
    root.root.findAllByType('button')[0].props.onClick({ currentTarget: button }); assert.equal(recent, 1);
    value = { ...value, active: false, status: 'recent', result: null }; await React.act(async () => root.update(app())); assert.ok(JSON.stringify(root.toJSON()).includes('Existing recent reviews'));
  } finally { if (root) await React.act(async () => root.unmount()); if (saved === undefined) delete global.document; else global.document = saved; }
});

test('section never offers activation for competitor/mismatched identity or current-product routes', () => {
  const SSR = require('react-dom/server');
  for (const [currentQuery, own, number] of [[query(), false, 123], [query(), true, 456], ['no=123', true, 123]]) {
    const value = { query: currentQuery, available: currentQuery === query(), active: false, status: 'recent' };
    const Panel = load('src/components/product/ProductReviewMode.tsx', { '@/lib/observation-review-context': { useObservationReviewState: () => value } }).default;
    const html = SSR.renderToStaticMarkup(React.createElement(Panel, { query: currentQuery, detail: { is_own: own, musinsa_no: number } }, 'Existing recent reviews'));
    assert.ok(html.includes('Existing recent reviews')); assert.ok(!html.includes('관측일 1–2점 저장 리뷰 확인'));
  }
});

test('fixed observed date does not trigger another read when today advances', async () => {
  const f = fixture(); try { await f.mount(); await f.activate(); await f.clock('2026-10-06'); assert.equal(f.state.status, 'ready'); assert.equal(f.calls.length, 2); assert.equal(f.identityReads, 1); } finally { await f.close(); }
});
