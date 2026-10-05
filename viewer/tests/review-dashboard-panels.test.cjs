const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), Renderer = require('react-test-renderer');
const load = require('./helpers/load-source.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture({ lateIdentity = false } = {}) {
  const products = [], anomalies = [], stats = [], identities = [], listeners = new Set();
  const client = { auth: { getUser() { if (!lateIdentity) return Promise.resolve({ data: { user: { id: 'account-a' } } }); const d = deferred(); identities.push(d); return d.promise; },
    onAuthStateChange(fn) { listeners.add(fn); return { data: { subscription: { unsubscribe() { listeners.delete(fn); } } } }; } } };
  const Page = load('src/app/(app)/reviews/page.tsx', {
    'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/hooks/useResolvedViewport': { useResolvedViewport: () => 'desktop' }, '@/lib/supabase/client': { supabaseBrowser: () => client },
    '@/lib/queries': { CATEGORY_MAP: {}, fetchOwnProducts(limit, signal) { const d = deferred(); products.push({ ...d, limit, signal }); return d.promise; },
      fetchCsAnomalies(opts, signal) { const d = deferred(); anomalies.push({ ...d, opts, signal }); return d.promise; },
      fetchReviewStats(days, signal) { const d = deferred(); stats.push({ ...d, days, signal }); return d.promise; } },
    '@/lib/excel-export': {}, '@/components/ui/filters': {}, '@/components/ui/icons': { IcArrowUR: () => React.createElement('span'), IcX: () => null }, '@/components/me/NoteDrawer': { __esModule: true, default: () => null },
  }).default;
  return { Page, products, anomalies, stats, identities, listeners, auth(id) { for (const fn of listeners) fn(id ? 'SIGNED_IN' : 'SIGNED_OUT', id ? { user: { id } } : null); } };
}
const product = name => ({ id: name, name, musinsa_no: 100000, brand_name: 'Fixture', review_count: 3, satisfaction_score: 4, style_no: null, erp_style_code: null });
const anomaly = name => ({ id: name, entity_name: name, entity_id: 'product', anomaly_type: 'review_rating_drop', severity: 'high', detection_date: '2026-10-04' });
const metric = total => ({ total, avgRating: total ? 4 : 0, lowCount: 0, ratingDist: [0, total, 0, 0, 0], imageCount: 0 });
const panel = (root, name) => root.root.findByProps({ 'data-dashboard-panel': name });
const action = (root, name) => panel(root, name).findAllByType('button').find(button => button.props['aria-label']);
const values = root => root.root.findAllByProps({ className: 'val' }).map(node => node.children.join(''));
async function click(root, label) { const button = root.root.findAllByType('button').find(node => node.children.join('') === label); assert.ok(button); await React.act(async () => button.props.onClick()); }

test('partial panel failure is distinct from pending and genuine empty; CS retry is independent and keeps its action', async () => {
  const f = fixture(); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.Page)); });
    assert.equal(f.products[0].limit, 10); assert.deepEqual(f.anomalies[0].opts, { limit: 10 });
    assert.equal(panel(root, 'products').findByProps({ 'data-dashboard-panel-state': 'loading' }).type, 'div');
    assert.doesNotMatch(JSON.stringify(root.toJSON()), /자사 상품 없음|탐지된 이상 없음/);
    await React.act(async () => { f.products[0].resolve([]); f.anomalies[0].reject(Error('offline')); });
    assert.match(JSON.stringify(root.toJSON()), /자사 상품 없음/);
    assert.doesNotMatch(JSON.stringify(root.toJSON()), /탐지된 이상 없음/); assert.equal(values(root)[4], '—');
    const button = action(root, 'cs');
    await React.act(async () => button.props.onClick());
    assert.equal(action(root, 'cs'), button); assert.equal(button.props['aria-disabled'], true);
    await React.act(async () => button.props.onClick()); assert.equal(f.anomalies.length, 2); assert.equal(f.products.length, 1); assert.equal(f.stats.length, 1);
    await React.act(async () => f.anomalies[1].reject(Error('still offline')));
    assert.equal(action(root, 'cs'), button); assert.equal(button.props['aria-disabled'], false);
    await React.act(async () => button.props.onClick());
    await React.act(async () => f.anomalies[2].resolve([anomaly('CS current')]));
    assert.equal(action(root, 'cs'), button); assert.equal(values(root)[4], 'H:1 M:0');
    assert.match(JSON.stringify(root.toJSON()), /CS current/);
  } finally { if (root) await React.act(async () => root.unmount()); }
});

test('own-product failure/retry leaves successful CS empty intact and clears prior product rows on refresh', async () => {
  const f = fixture(); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.Page)); });
    await React.act(async () => { f.products[0].reject(Error('offline')); f.anomalies[0].resolve([]); });
    assert.match(JSON.stringify(root.toJSON()), /탐지된 이상 없음/); assert.doesNotMatch(JSON.stringify(root.toJSON()), /자사 상품 없음/);
    const button = action(root, 'products'); await React.act(async () => button.props.onClick());
    await React.act(async () => f.products[1].resolve([product('Product current')]));
    assert.equal(f.anomalies.length, 1); assert.match(JSON.stringify(root.toJSON()), /Product current/);
    await React.act(async () => button.props.onClick());
    assert.doesNotMatch(JSON.stringify(root.toJSON()), /Product current/);
    await React.act(async () => f.products[2].resolve([]));
    assert.match(JSON.stringify(root.toJSON()), /자사 상품 없음/); assert.equal(action(root, 'products'), button);
  } finally { if (root) await React.act(async () => root.unmount()); }
});

test('same-batch account change aborts both A reads; repeated identity does not refetch and sign-out clears both panels', async () => {
  const f = fixture(); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.Page)); });
    await React.act(async () => { f.auth('account-b'); f.products[0].resolve([product('Private A product')]); f.anomalies[0].resolve([anomaly('Private A anomaly')]); await Promise.resolve(); });
    assert.equal(f.products[0].signal.aborted, true); assert.equal(f.anomalies[0].signal.aborted, true);
    assert.doesNotMatch(JSON.stringify(root.toJSON()), /Private A/);
    await React.act(async () => { f.products[1].resolve([product('B product')]); f.anomalies[1].resolve([anomaly('B anomaly')]); });
    await React.act(async () => f.auth('account-b')); assert.equal(f.products.length, 2); assert.equal(f.anomalies.length, 2);
    await React.act(async () => f.auth(null)); assert.doesNotMatch(JSON.stringify(root.toJSON()), /B product|B anomaly/); assert.equal(values(root)[4], '—');
    await React.act(async () => f.auth('account-c'));
    const p = f.products[2], a = f.anomalies[2]; await React.act(async () => root.unmount()); root = null;
    assert.equal(p.signal.aborted, true); assert.equal(a.signal.aborted, true); assert.equal(f.listeners.size, 0);
    await React.act(async () => { p.resolve([product('Late C')]); a.reject(Error('late')); });
  } finally { if (root) await React.act(async () => root.unmount()); }
});

test('late getUser cannot undo SIGNED_OUT or start either panel read', async () => {
  const f = fixture({ lateIdentity: true }); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.Page)); });
    await React.act(async () => { f.auth(null); f.identities.forEach(d => d.resolve({ data: { user: { id: 'account-a' } } })); await Promise.resolve(); });
    assert.equal(f.products.length, 0); assert.equal(f.anomalies.length, 0); assert.equal(f.stats.length, 0);
    assert.equal(panel(root, 'products').findAllByProps({ role: 'status' }).length, 1);
  } finally { if (root) await React.act(async () => root.unmount()); }
});

test('statistics period switches discard old metrics without refetching either fixed-query panel', async () => {
  const f = fixture(); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.Page)); });
    await click(root, '7D'); await click(root, '30D');
    await React.act(async () => { f.stats[1].resolve(metric(777)); f.products[0].resolve([product('Fixed-query product')]); f.anomalies[0].resolve([]); });
    assert.equal(f.products.length, 1); assert.equal(f.anomalies.length, 1); assert.doesNotMatch(JSON.stringify(root.toJSON()), /777/);
    assert.match(JSON.stringify(root.toJSON()), /Fixed-query product/); assert.equal(values(root)[4], 'H:0 M:0');
    await React.act(async () => f.stats[2].resolve(metric(222))); assert.equal(values(root)[0], '222');
    await click(root, '7D'); await React.act(async () => f.stats[3].reject(Error('current period failed')));
    assert.equal(values(root)[4], 'H:0 M:0'); assert.equal(f.products.length, 1); assert.equal(f.anomalies.length, 1);
  } finally { if (root) await React.act(async () => root.unmount()); }
});
