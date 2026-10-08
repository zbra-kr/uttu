const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), Renderer = require('react-test-renderer');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript'), load = require('./helpers/load-source.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const alert = (id, product = id) => ({ id, entity_id: product });
const product = id => ({ name: `product-${id}`, musinsa_no: id, brand_name: 'brand' });
const reviews = (id, total = 41) => ({ rows: [{ id, product_name: `product-${id}` }], total });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  const productReads = [], reviewReads = [], renders = [];
  const queries = { fetchProductBrief(id) { const d = deferred(); productReads.push({ id, ...d }); return d.promise; },
    fetchReviews(options) { const d = deferred(); reviewReads.push({ options, ...d }); return d.promise; } };
  const { useCsAnomalyReviews } = load('src/hooks/useCsAnomalyReviews.ts', { '@/lib/queries': queries });
  let current;
  function Probe({ selected = alert('A'), rating = 'all', page = 0 }) {
    current = useCsAnomalyReviews(selected, rating, page, 20); renders.push(current);
    return React.createElement('div', null, JSON.stringify({ product: current.product, reviews: current.reviews, total: current.total,
      productState: current.productState, reviewState: current.reviewState }));
  }
  return { productReads, reviewReads, renders, Probe, get current() { return current; } };
}
async function mount(f, props) { let root; await React.act(async () => { root = Renderer.create(React.createElement(f.Probe, props)); }); return root; }
async function update(root, f, props) { await React.act(async () => root.update(React.createElement(f.Probe, props))); }
async function unmount(root) { await React.act(async () => root.unmount()); }

test('A to B with A resolving last cannot overwrite product, link identity, reviews or total', async () => {
  const f = fixture(), root = await mount(f);
  try {
    await update(root, f, { selected: alert('B') });
    assert.equal(f.reviewReads[0].options.signal.aborted, true);
    await React.act(async () => { f.productReads[1].resolve(product('B')); f.reviewReads[1].resolve(reviews('B', 2)); });
    await React.act(async () => { f.productReads[0].resolve(product('A')); f.reviewReads[0].resolve(reviews('A', 100)); });
    assert.equal(f.current.product.musinsa_no, 'B'); assert.equal(f.current.reviews[0].id, 'B'); assert.equal(f.current.total, 2);
  } finally { await unmount(root); }
});
test('first B render immediately hides ready A, B failure cannot show A, retry clears errors', async () => {
  const f = fixture(), root = await mount(f);
  try {
    await React.act(async () => { f.productReads[0].resolve(product('A')); f.reviewReads[0].resolve(reviews('A')); });
    const begin = f.renders.length;
    await update(root, f, { selected: alert('B') });
    const first = f.renders[begin]; assert.equal(first.product, null); assert.deepEqual(first.reviews, []); assert.equal(first.total, null);
    assert.equal(first.reviewState, 'loading');
    await React.act(async () => { f.productReads[1].reject(Error('offline')); f.reviewReads[1].reject(Error('offline')); });
    assert.equal(f.current.productState, 'error'); assert.equal(f.current.reviewState, 'error'); assert.equal(f.current.total, null);
    await React.act(async () => { f.current.retryReviews(); });
    assert.equal(f.current.reviewState, 'loading'); assert.equal(f.productReads.length, 2);
    await React.act(async () => f.reviewReads[2].resolve(reviews('B', 1)));
    assert.equal(f.current.total, 1);
    await React.act(async () => f.current.retryProduct());
    assert.equal(f.current.productState, 'loading'); assert.equal(f.reviewReads.length, 3);
    await React.act(async () => f.productReads[2].resolve(product('B')));
    assert.equal(f.current.product.musinsa_no, 'B');
  } finally { await unmount(root); }
});
test('rating and page changes mask prior rows and keep exact page query scope without dates', async () => {
  const f = fixture(), root = await mount(f);
  try {
    await React.act(async () => f.reviewReads[0].resolve(reviews('A')));
    const start = f.renders.length;
    await update(root, f, { rating: 'low', page: 1 });
    assert.deepEqual(f.renders[start].reviews, []); assert.equal(f.renders[start].total, null);
    const options = f.reviewReads[1].options;
    assert.deepEqual({ ...options, signal: null }, { productId: 'A', ratingMin: 1, ratingMax: 2,
      sort: 'recent', limit: 20, offset: 20, signal: null, stableOrder: true, requireExactCount: true });
    assert.equal(f.productReads.length, 1);
    await update(root, f, { rating: 'hi', page: 2 });
    await React.act(async () => f.reviewReads[1].resolve(reviews('old-filter')));
    assert.deepEqual(f.current.reviews, []);
    assert.equal(f.reviewReads[2].options.ratingMin, 4); assert.equal(f.reviewReads[2].options.offset, 40);
    await React.act(async () => f.reviewReads[2].resolve(reviews('new-filter')));
    assert.equal(f.current.reviews[0].id, 'new-filter');
  } finally { await unmount(root); }
});
test('same product different alert and A to B to A never reuse old alert receipts', async () => {
  const f = fixture(), root = await mount(f, { selected: alert('A', 'same') });
  try {
    await React.act(async () => { f.productReads[0].resolve(product('same')); f.reviewReads[0].resolve(reviews('A')); });
    await update(root, f, { selected: alert('B', 'same') });
    assert.equal(f.current.product, null); assert.equal(f.current.total, null);
    await update(root, f, { selected: alert('A', 'same') });
    assert.equal(f.current.product, null); assert.deepEqual(f.current.reviews, []);
    await React.act(async () => { f.productReads[1].resolve(product('stale')); f.reviewReads[1].resolve(reviews('stale')); });
    assert.equal(f.current.product, null); assert.deepEqual(f.current.reviews, []);
    assert.equal(f.reviewReads.length, 3);
  } finally { await unmount(root); }
});
test('genuine empty success differs from failure and clearing selection aborts/hides evidence', async () => {
  const f = fixture(), root = await mount(f);
  try {
    await React.act(async () => { f.reviewReads[0].resolve({ rows: [], total: 0 }); f.productReads[0].resolve(null); });
    assert.equal(f.current.reviewState, 'ready'); assert.equal(f.current.total, 0); assert.equal(f.current.productState, 'error');
    await React.act(async () => f.current.retryReviews());
    await React.act(async () => f.reviewReads[1].reject(Error('unavailable')));
    assert.equal(f.current.reviewState, 'error'); assert.equal(f.current.total, null);
    await update(root, f, { selected: null });
    assert.equal(f.reviewReads[1].options.signal.aborted, true); assert.equal(f.current.reviewState, 'idle'); assert.equal(f.current.product, null);
  } finally { await unmount(root); }
});

// Expose only this internal component in a transient test module; production route exports stay unchanged.
function loadView(hook) {
  const filename = path.resolve(__dirname, '../src/app/(app)/reviews/page.tsx');
  const source = fs.readFileSync(filename, 'utf8') + '\nexport { RvAnomalyReviews };';
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename });
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = mod.require.bind(mod);
  const mocks = { '@/components/ui/icons': { IcArrowUR: () => React.createElement('svg') }, react: React, '@/hooks/useCsAnomalyReviews': { useCsAnomalyReviews: () => hook },
    '@/lib/queries': { CATEGORY_MAP: {}, fetchCsAnomalies: async () => [] } };
  mod.require = id => Object.hasOwn(mocks, id) ? mocks[id] :
    id.startsWith('@/') || id.startsWith('./') || id.startsWith('next/') ? {} : original(id);
  mod._compile(outputText, filename); return mod.exports.RvAnomalyReviews;
}
test('real alert panel renders error/retry, zero and current product link distinctly', async () => {
  const selected = { ...alert('B'), entity_name: 'B', severity: 'high', anomaly_type: 'review_negative_surge', detection_date: '2026-10-07', description: 'alert B' };
  const base = { product: null, reviews: [], total: null, productState: 'error', reviewState: 'error', retryProduct() {}, retryReviews() {} };
  const original = React.useState;
  for (const state of ['error', 'ready', 'loading']) {
    const states = [[], '', false, selected, 0, 'all', null];
    React.useState = () => [states.shift(), () => {}];
    try {
      const View = loadView({ ...base, reviewState: state, total: state === 'ready' ? 0 : null });
      const html = require('react-dom/server').renderToStaticMarkup(React.createElement(View));
      assert.equal(states.length, 0); assert.match(html, /현재 저장된 상품 리뷰/); assert.match(html, /스냅샷이 아닙니다/);
      assert.equal(html.includes('리뷰 다시 조회'), state === 'error');
      assert.equal(html.includes('현재 조건에 일치하는 저장 리뷰가 없습니다'), state === 'ready');
      assert.doesNotMatch(html, /href="\/product\?no=/);
    } finally { React.useState = original; }
  }
});

test('real header links only the current ready product', () => {
  const selected = { ...alert('B'), entity_name: 'B', severity: 'high', anomaly_type: 'review_negative_surge', detection_date: '2026-10-07', description: 'alert B' };
  const states = [[], '', false, selected, 0, 'all', null], original = React.useState;
  React.useState = () => [states.shift(), () => {}];
  try {
    const View = loadView({ product: product('B'), reviews: [], total: 0, productState: 'ready', reviewState: 'ready', retryProduct() {}, retryReviews() {} });
    const html = require('react-dom/server').renderToStaticMarkup(React.createElement(View));
    assert.match(html, /href="\/product\?no=B"/); assert.doesNotMatch(html, /href="\/product\?no=A"/); assert.equal(states.length, 0);
  } finally { React.useState = original; }
});
