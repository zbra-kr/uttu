const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const Renderer = require('react-test-renderer');
const load = require('./helpers/load-source.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const base = { product: '6796676', store: 'musinsa', date: '2026-10-05', category: '000', gender: 'A', age: 'AGE_BAND_ALL' };
const { productObservationHref } = load('src/lib/product-observation-context.ts');
const { rankingContextToSearchParams } = load('src/lib/notes/ranking-context.ts');
const query = new URL(productObservationHref(base), 'https://local.invalid').search.slice(1);
const row = { product: base.product, date: base.date, rank: 8, name: 'Observed jacket', brand: 'Observed brand', price: 39000, discount: 20, own: null };
const Link = ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children);

function fixture({ lateIdentity = false } = {}) {
  const calls = [];
  const listeners = new Set();
  const identityCalls = [];
  const client = { auth: {
    onAuthStateChange(fn) { listeners.add(fn); return { data: { subscription: { unsubscribe() { listeners.delete(fn); } } } }; },
    getUser() { return lateIdentity ? new Promise(resolve => identityCalls.push(resolve)) : Promise.resolve({ data: { user: { id: 'account-a' } } }); },
  } };
  const Panel = load('src/components/product/ProductObservationPanel.tsx', {
    'next/link': { __esModule: true, default: Link },
    '@/lib/supabase/client': { supabaseBrowser: () => client },
    '@/lib/queries-product-observation': { fetchProductObservation: (context, signal) => new Promise(resolve => calls.push({ context, signal, resolve })) },
  }).default;
  return { Panel, calls, identityCalls, auth(event, id) { for (const fn of [...listeners]) fn(event, id ? { user: { id } } : null); } };
}

test('real observation panel loads an exact context and keeps unknown ownership unknown', async () => {
  const { Panel, calls } = fixture(); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(Panel, { query })); });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].context, base);
    assert.match(JSON.stringify(root.toJSON()), /role\":\"status/);
    await React.act(async () => calls[0].resolve({ status: 'ready', row }));
    const html = JSON.stringify(root.toJSON());
    assert.match(html, /Observed jacket/);
    assert.match(html, /39,000/);
    assert.match(html, /미확인/);
    assert.match(html, /현재 상품 레코드의 자사 분류/);
    assert.match(html, /관측일 당시 분류는 확인되지 않습니다/);
  } finally { if (root) await React.act(async () => root.unmount()); }
});

test('invalid context never reads; missing, ambiguous, capped and error remain distinct', async () => {
  const { Panel, calls } = fixture(); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(Panel, { query: 'no=6796676&obs=ranking-v1' })); });
    assert.equal(calls.length, 0);
    assert.equal(root.root.findAllByProps({ role: 'alert' }).length, 1);
    for (const status of ['missing', 'ambiguous', 'capped', 'error']) {
      await React.act(async () => root.update(React.createElement(Panel, { query: `${query}&back=%2Franking%3Fcontext%3Dranking-v1&unused=${status}` })));
      assert.equal(calls.length, ['missing', 'ambiguous', 'capped', 'error'].indexOf(status));
      await React.act(async () => root.update(React.createElement(Panel, { query })));
      const call = calls.at(-1);
      await React.act(async () => call.resolve({ status }));
      assert.match(JSON.stringify(root.toJSON()), status === 'error' ? /role\":\"alert/ : /role\":\"status/);
      await React.act(async () => root.update(React.createElement(Panel, { query: 'no=6796676' })));
    }
    assert.equal(root.toJSON(), null);
  } finally { if (root) await React.act(async () => root.unmount()); }
});

test('source note return survives the rendered Product panel', async () => {
  const scope = { version: 1, kind: 'ranking', period: 'today', fromDate: '', toDate: '', selectedCategory: '000', gender: 'A', age: 'AGE_BAND_ALL', price: [0, 50], companies: [], brands: [], ownOnly: false, moverOnly: false, sort: 'rank', sortDir: 'asc', page: 1, resolvedFromDate: base.date, resolvedToDate: base.date };
  const source = rankingContextToSearchParams(scope);
  source.set('notes', 'open'); source.set('note', '33333333-3333-4333-8333-333333333333');
  const back = `/ranking?${source}`;
  const observedQuery = new URL(productObservationHref({ ...base, back }), 'https://local.invalid').search.slice(1);
  const { Panel, calls } = fixture(); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(Panel, { query: observedQuery })); });
    assert.equal(calls.length, 1);
    assert.equal(root.root.findByType('a').props.href, back);
  } finally { if (root) await React.act(async () => root.unmount()); }
});

test('same-URL account change clears settled observation; sign-out clears it and stops reads', async () => {
  const f = fixture(); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.Panel, { query })); });
    assert.equal(f.calls.length, 1);
    await React.act(async () => f.calls[0].resolve({ status: 'ready', row: { ...row, name: 'Account A observation' } }));
    assert.match(JSON.stringify(root.toJSON()), /Account A observation/);
    await React.act(async () => f.auth('SIGNED_IN', 'account-b'));
    assert.equal(f.calls.length, 2);
    assert.doesNotMatch(JSON.stringify(root.toJSON()), /Account A observation/);
    await React.act(async () => f.calls[1].resolve({ status: 'ready', row: { ...row, name: 'Account B observation' } }));
    assert.match(JSON.stringify(root.toJSON()), /Account B observation/);
    await React.act(async () => f.auth('SIGNED_OUT', null));
    assert.doesNotMatch(JSON.stringify(root.toJSON()), /Account B observation/);
    assert.equal(f.calls.length, 2);
  } finally { if (root) await React.act(async () => root.unmount()); }
});

test('late account A result and late getUser cannot republish after same-URL sign-out or account B', async () => {
  const f = fixture({ lateIdentity: true }); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.Panel, { query })); });
    assert.equal(f.calls.length, 0);
    await React.act(async () => f.auth('SIGNED_IN', 'account-a'));
    assert.equal(f.calls.length, 1);
    const old = f.calls[0];
    await React.act(async () => f.auth('SIGNED_OUT', null));
    assert.equal(old.signal.aborted, true);
    await React.act(async () => old.resolve({ status: 'ready', row: { ...row, name: 'Stale account A' } }));
    await React.act(async () => f.identityCalls[0]({ data: { user: { id: 'account-a' } } }));
    assert.equal(f.calls.length, 1);
    assert.doesNotMatch(JSON.stringify(root.toJSON()), /Stale account A/);
    await React.act(async () => f.auth('SIGNED_IN', 'account-b'));
    assert.equal(f.calls.length, 2);
    await React.act(async () => f.calls[1].resolve({ status: 'ready', row: { ...row, name: 'Account B only' } }));
    assert.match(JSON.stringify(root.toJSON()), /Account B only/);
    assert.doesNotMatch(JSON.stringify(root.toJSON()), /Stale account A/);
  } finally { if (root) await React.act(async () => root.unmount()); }
});
