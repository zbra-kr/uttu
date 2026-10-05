const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), Renderer = require('react-test-renderer');
const load = require('./helpers/load-source.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({ pending = false, identityFailure = false, identityPending = false, identityMissing = false, initialOwner = 'first-owner', shell = false } = {}) {
  let owner = initialOwner, mode = 'ready', active = true, date = '2026-10-05', root, state;
  const calls = [], listeners = new Set(); let resolveIdentity;
  const sdk = { auth: {
    getUser: () => { const response = { data: { user: owner ? { id: owner } : null }, error: identityMissing ? new (require('@supabase/supabase-js').AuthSessionMissingError)() : identityFailure ? Error('inert identity failure') : null }; return identityPending ? new Promise(resolve => { resolveIdentity = () => resolve(response); }) : Promise.resolve(response); },
    onAuthStateChange(fn) { listeners.add(fn); return { data: { subscription: { unsubscribe() { listeners.delete(fn); } } } }; },
  }, from(table) {
    const call = { table, ops: [], owner, settled: false };
    const query = new Proxy({}, { get(_, method) {
      if (method === 'then') return (yes, no) => { calls.push(call); return new Promise(resolve => {
        call.resolve = () => { call.settled = true; resolve(response(call)); };
        if (!pending) call.resolve();
      }).then(yes, no); };
      return (...args) => { call.ops.push([method, ...args]); if (method === 'abortSignal') call.signal = args[0]; return query; };
    } }); return query;
  } };
  function response(c) {
    if (mode === 'error') return { data: null, error: Error('inert failure'), count: null };
    if (mode === 'count-missing') return { data: [], error: null, count: null };
    if (mode === 'empty') return { data: [], error: null, count: 0 };
    const reviewDate = c.ops.find(x => x[0] === 'gte' && x[1] === 'review_date')[2];
    return { data: [{ id: c.owner, product_id: 'product', rating: 2, review_date: reviewDate, review_text: c.owner,
      products: { name: 'Fixture product', musinsa_no: '123', is_own: true, brands: { name: 'Fixture brand' } } }], error: null, count: 30 };
  }
  const mocks = { '@/lib/supabase/client': { supabaseBrowser: () => sdk }, './supabase/client': { supabaseBrowser: () => sdk } };
  mocks['@/lib/queries'] = { ...load('src/lib/queries.ts', mocks), fetchShellStats: async () => ({}) };
  const { useCSDailyReviewCheck } = load('src/hooks/useCSDailyReviewCheck.ts', mocks);
  let App, media, mediaListeners, saved;
  function Probe({ mobile }) { state = useCSDailyReviewCheck(active, date, '2026-10-05'); return React.createElement(mobile ? 'mobile-view' : 'desktop-view', null, state.status); }
  App = Probe;
  if (shell) {
    saved = { window: global.window, document: global.document };
    mediaListeners = new Set();
    media = { matches: false, addEventListener(_, fn) { mediaListeners.add(fn); }, removeEventListener(_, fn) { mediaListeners.delete(fn); } };
    global.window = { matchMedia: () => media, addEventListener() {}, removeEventListener() {} };
    global.document = { documentElement: { setAttribute() {}, style: { setProperty() {} } } };
    mocks['next/navigation'] = { usePathname: () => '/today', useSearchParams: () => new URLSearchParams({ tab: active ? 'cs' : 'executive', date }), useRouter: () => ({ push() {} }) };
    const context = load('src/lib/cs-daily-review-context.ts', mocks);
    mocks['@/lib/cs-daily-review-context'] = context;
    mocks['@/components/onboarding/OnboardingProvider'] = { useOnboarding: () => ({ active: false, step: 0 }) };
    for (const name of ['./Sidebar', './Topbar', './AiPanel', './CmdK']) mocks[name] = { __esModule: true, default: () => null };
    mocks['./MobileShell'] = { __esModule: true, default: ({ children }) => React.createElement('mobile-shell', null, children) };
    const Shell = load('src/components/shell/ShellClient.tsx', mocks).default;
    function Consumer() { state = context.useCSDailyReviewState() ?? { status: 'loading', result: null }; return React.createElement('source-view', null, state.status); }
    App = () => React.createElement(Shell, null, React.createElement(Consumer));
  }
  return { calls, listeners, get state() { return state; }, async mount() { await React.act(async () => { root = Renderer.create(React.createElement(App)); await tick(); }); },
    async update(values = {}) { if ('active' in values) active = values.active; if ('date' in values) date = values.date; await React.act(async () => { if (shell && 'mobile' in values) { media.matches = values.mobile; for (const fn of mediaListeners) fn({ matches: values.mobile }); } root.update(React.createElement(App, { mobile: values.mobile })); await tick(); }); },
    async auth(value) { owner = value; await React.act(async () => { for (const fn of listeners) fn(value ? 'SIGNED_IN' : 'SIGNED_OUT', value ? { user: { id: value } } : null); await tick(); }); },
    async initial(value) { await React.act(async () => { for (const fn of listeners) fn('INITIAL_SESSION', value ? { user: { id: value } } : null); await tick(); }); },
    async retry() { await React.act(async () => { state.retry(); await tick(); }); },
    async resolveIdentity() { await React.act(async () => { resolveIdentity(); await tick(); }); },
    async resolve() { await React.act(async () => { for (const c of calls.filter(c => !c.settled)) c.resolve(); await tick(); }); },
    mode(value) { mode = value; }, identityRecover() { identityFailure = false; identityPending = false; },
    async close() { if (root) await React.act(async () => root.unmount()); if (saved) for (const key of ['window', 'document']) { if (saved[key] === undefined) delete global[key]; else global[key] = saved[key]; } },
  };
}
test('actual query has one joined GET boundary with exact own/date/rating count, max20 and stable order', async () => {
  const f = fixture(); try {
    await f.mount(); assert.equal(f.calls.length, 1); const c = f.calls[0]; assert.equal(c.table, 'reviews');
    assert.deepEqual(c.ops.find(x => x[0] === 'range'), ['range', 0, 19]);
    assert.equal(c.ops.find(x => x[0] === 'select')[2].count, 'exact');
    assert.match(c.ops.find(x => x[0] === 'select')[1], /products!inner/);
    assert.deepEqual(c.ops.filter(x => ['gte', 'lte', 'eq'].includes(x[0])), [['gte', 'rating', 1], ['lte', 'rating', 2], ['eq', 'products.is_own', true], ['gte', 'review_date', '2026-10-04'], ['lte', 'review_date', '2026-10-04']]);
    assert.deepEqual(c.ops.filter(x => x[0] === 'order'), [['order', 'review_date', { ascending: false }], ['order', 'id', { ascending: false }]]);
    assert.ok(c.signal instanceof AbortSignal); assert.equal(f.state.result.total, 30);
    await f.update({ mobile: true }); await f.update({ mobile: false }); assert.equal(f.calls.length, 1);
    await f.update({ active: false }); assert.equal(f.state.result, null); assert.equal(c.signal.aborted, true);
    await f.update({ active: true }); assert.equal(f.calls.length, 2);
  } finally { await f.close(); } assert.equal(f.listeners.size, 0);
});
test('late date/owner results cannot restore old source text; signout and unmount cancel work', async () => {
  const f = fixture({ pending: true }); try {
    await f.mount(); assert.equal(f.state.status, 'loading'); await f.update({ date: '2026-10-04' });
    assert.equal(f.calls[0].signal.aborted, true); await f.auth('second-owner'); assert.equal(f.calls[1].signal.aborted, true);
    await f.resolve(); assert.equal(f.state.result.rows[0].review_text, 'second-owner'); assert.equal(f.state.reviewDate, '2026-10-03');
    await f.auth(null); assert.equal(f.state.status, 'signed-out'); assert.equal(f.state.result, null); assert.equal(f.calls.length, 3);
    await f.auth('third-owner'); assert.equal(f.calls.length, 4); await f.close(); assert.equal(f.calls[3].signal.aborted, true); await f.resolve();
  } finally { await f.close(); }
});
test('errors/count failures retry explicitly, empty stays distinct, invalid/future scopes never read', async () => {
  const f = fixture(); try {
    f.mode('count-missing'); await f.mount(); assert.equal(f.state.status, 'error');
    f.mode('error'); await f.retry(); assert.equal(f.state.status, 'error'); assert.equal(f.calls.length, 2);
    f.mode('empty'); await f.retry(); assert.equal(f.state.status, 'ready'); assert.equal(f.state.result.total, 0);
    for (const date of ['2026-02-30', '2026-10-06', 'bad', '']) { await f.update({ date }); assert.equal(f.state.status, 'invalid-date'); assert.equal(f.state.result, null); }
    assert.equal(f.calls.length, 3);
  } finally { await f.close(); }
});
test('identity failure permits SDK retry without reading reviews until identity is available', async () => {
  const f = fixture({ identityFailure: true }); try { await f.mount(); assert.equal(f.state.status, 'error'); assert.equal(f.calls.length, 0); f.identityRecover(); await f.retry(); assert.equal(f.state.status, 'ready'); assert.equal(f.calls.length, 1); } finally { await f.close(); }
});
test('actual Shell responsive reparenting preserves one route owner and excludes late prior-owner data', async () => {
  const f = fixture({ shell: true, pending: true }); try {
    await f.mount(); assert.equal(f.calls.length, 1);
    await f.update({ mobile: true }); await f.update({ mobile: false }); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].signal.aborted, false);
    await f.auth('replacement-owner'); assert.equal(f.calls.length, 2); assert.equal(f.calls[0].signal.aborted, true);
    await f.resolve(); assert.equal(f.state.result.rows[0].review_text, 'replacement-owner');
    await f.auth(null); assert.equal(f.state.status, 'signed-out'); assert.equal(f.state.result, null);
  } finally { await f.close(); } assert.equal(f.listeners.size, 0);
});
test('an SDK auth event wins a delayed getUser result from the prior owner', async () => {
  const f = fixture({ identityPending: true }); try {
    await f.mount(); assert.equal(f.state.status, 'loading'); assert.equal(f.calls.length, 0);
    await f.auth('event-owner'); assert.equal(f.calls.length, 1); assert.equal(f.state.result.rows[0].review_text, 'event-owner');
    await f.resolveIdentity(); assert.equal(f.calls.length, 1); assert.equal(f.state.result.rows[0].review_text, 'event-owner');
  } finally { await f.close(); }
});

test('initial null plus failed verification is retryable; repeated retry succeeds', async () => {
  const f = fixture({ identityPending: true, identityFailure: true }); try {
    await f.mount(); await f.initial(null); assert.equal(f.state.status, 'loading');
    await f.resolveIdentity(); assert.equal(f.state.status, 'error'); assert.equal(f.calls.length, 0);
    f.identityRecover(); await f.retry(); assert.equal(f.state.status, 'ready'); assert.equal(f.calls.length, 1);
    f.mode('error'); await f.retry(); assert.equal(f.state.status, 'error');
    f.mode('ready'); await f.retry(); assert.equal(f.state.status, 'ready'); assert.equal(f.calls.length, 3);
  } finally { await f.close(); } assert.equal(f.listeners.size, 0);
});

test('genuine missing session stays signed-out, including initial null', async () => {
  for (const identityMissing of [false, true]) {
    const f = fixture({ initialOwner: null, identityPending: true, identityMissing }); try {
      await f.mount(); await f.initial(null); await f.resolveIdentity();
      assert.equal(f.state.status, 'signed-out'); assert.equal(f.state.result, null); assert.equal(f.calls.length, 0);
    } finally { await f.close(); }
  }
});

test('explicit signout and newer owner override delayed failed verification and initial events', async () => {
  for (const owner of [null, 'replacement-owner']) {
    const f = fixture({ identityPending: true, identityFailure: true }); try {
      await f.mount(); await f.auth(owner); await f.initial('stale-local-owner'); await f.resolveIdentity();
      assert.equal(f.state.status, owner ? 'ready' : 'signed-out'); assert.equal(f.calls.length, owner ? 1 : 0);
      assert.equal(f.state.result?.rows[0].review_text ?? null, owner);
    } finally { await f.close(); }
  }
});

test('unmount before pending identity completes unsubscribes and never reads sources', async () => {
  const f = fixture({ identityPending: true }); await f.mount(); await f.close();
  await f.resolveIdentity(); assert.equal(f.listeners.size, 0); assert.equal(f.calls.length, 0);
});
