'use strict';
// Fresh reconstruction: real JSX and effect/handler execution through a local
// hook harness. SSR is not browser/layout verification or live database testing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./helpers/load-source.cjs');
const w = load('src/lib/weekly-review.ts');
const draftLib = load('src/lib/weekly-review-draft.ts');
const DIR = 'src/app/(app)/reviews/weekly/';
const css = fs.readFileSync(path.join(__dirname, '..', DIR, 'weekly-review.module.css'), 'utf8');
const styles = Object.fromEntries([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => [m[1], m[1]]));
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = id(1), B = id(2), PA = id(3), PB = id(4), UA = id(801), UB = id(802);
const BRANDS = [{ id: A, name: 'Brand Alpha' }, { id: B, name: 'Brand Beta' }];
const SCOPE = { brand: A, from: '2024-02-28', to: '2024-03-05', rating: 'all', product: null, at: '2024-03-06T00:00:00.000Z' };
const OTHER = { ...SCOPE, brand: B };
const row = (n = 1, changes = {}) => ({ id: id(100 + n), product_id: PA, musinsa_review_id: `source-${n}`, product_name: `Product ${n}`, musinsa_no: String(1000 + n), brand_name: 'Brand Alpha', rating: 2, review_text: `Original text ${n}`, review_date: '2024-03-04', created_at: '2024-03-05T23:00:00.000Z', purchase_option: 'NAVY / M', ...changes });
const page = (rows = [], next = null, fetchedRows = rows.length) => ({ rows, next, fetchedRows });
const cursor = (n = 1) => ({ date: row(n).review_date, id: row(n).id });
const draft = changes => ({ scope: SCOPE, brandName: 'Brand Alpha', evidence: [row()], observation: 'Read selected original carefully', nextCheck: 'Inspect the sample at the next meeting', nextDate: '2024-03-12', ...changes });
const event = () => ({ preventDefault() {} });
const textOf = node => node == null || typeof node === 'boolean' ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(textOf).join('') : textOf(node.props?.children);
function walk(node, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (Array.isArray(node)) { node.forEach(child => walk(child, result)); return result; }
  if (typeof node.type === 'function') return walk(node.type(node.props), result);
  result.push(node); walk(node.props?.children, result); return result;
}
function deferred(args = []) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { args, promise, resolve, reject }; }
function harness(href = w.weeklyHref(SCOPE), options = {}) {
  const originals = Object.fromEntries(['setTimeout', 'clearTimeout', 'window', 'document', 'sessionStorage', 'fetch'].map(key => [key, global[key]]));
  const hooks = [], effects = [], navigation = [], brands = [], reviews = [], memos = [], saves = [], timers = new Map();
  const storage = options.storage || new Map(), windowEvents = new Map(), documentEvents = new Map(), initialAuth = deferred();
  let hook = 0, dirty = true, tree, disposed = false, lateUpdates = 0, timerId = 0, authListener, unsubscribed = false, confirm = true, search = href.split('?')[1] || '';
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hookReact = { ...React,
    useState(initial) { const i = hook++; if (!(i in hooks)) hooks[i] = { value: typeof initial === 'function' ? initial() : initial }; return [hooks[i].value, next => { if (disposed) { lateUpdates++; return; } const value = typeof next === 'function' ? next(hooks[i].value) : next; if (!Object.is(value, hooks[i].value)) { hooks[i].value = value; dirty = true; } }]; },
    useRef(initial) { const i = hook++; if (!(i in hooks)) hooks[i] = { current: initial }; return hooks[i]; },
    useMemo(fn, deps) { const i = hook++; if (!hooks[i] || !same(hooks[i].deps, deps)) hooks[i] = { deps, value: fn() }; return hooks[i].value; },
    useEffect(fn, deps) { const i = hook++; if (!hooks[i] || !same(hooks[i].deps, deps)) { hooks[i] = { deps, cleanup: hooks[i]?.cleanup }; effects.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = fn(); }); } },
  };
  const events = map => ({ addEventListener: (name, fn) => map.set(name, fn), removeEventListener: (name, fn) => { if (map.get(name) === fn) map.delete(name); } });
  global.setTimeout = (callback, delay) => { const key = ++timerId; timers.set(key, { callback, delay }); return key; };
  global.clearTimeout = key => timers.delete(key);
  global.window = { location: new URL(href, 'https://uttu.test'), confirm: () => confirm, ...events(windowEvents) };
  global.document = events(documentEvents);
  const storageCheck = () => { if (options.storageUnavailable) throw Error('Storage disabled'); };
  global.sessionStorage = { getItem: key => { storageCheck(); return storage.get(key) ?? null; }, setItem: (key, value) => { storageCheck(); storage.set(key, value); }, removeItem: key => { storageCheck(); storage.delete(key); } };
  global.fetch = () => { throw Error('Network access is forbidden in these local tests'); };
  const record = (list, args) => { const request = deferred(args); list.push(request); return request.promise; };
  const mocks = {
    react: { __esModule: true, ...hookReact, default: hookReact },
    'next/navigation': { useRouter: () => ({ push: (url, config) => navigation.push({ href: url, options: config }) }), useSearchParams: () => new URLSearchParams(search) },
    'next/link': ({ children, scroll, ...props }) => React.createElement('a', props, children), './weekly-review.module.css': styles,
    '@/lib/supabase/client': { supabaseBrowser: () => ({ auth: { getUser: () => options.deferredAuth ? initialAuth.promise : Promise.resolve({ data: { user: { id: options.user || UA } }, error: null }), onAuthStateChange: fn => { authListener = fn; return { data: { subscription: { unsubscribe: () => { unsubscribed = true; } } } }; } } }) },
    '@/lib/queries': { fetchOwnBrands: (...args) => record(brands, args) },
    '@/lib/queries-weekly-review': { fetchWeeklyReviews: (...args) => record(reviews, args), fetchWeeklyMemos: (...args) => record(memos, args) },
    '@/lib/queries-me': { createNote: (...args) => record(saves, args) },
  };
  const { default: Workspace } = load(`${DIR}WeeklyReviewWorkspace.tsx`, mocks);
  const { default: EvidenceList } = load(`${DIR}WeeklyEvidenceList.tsx`, mocks);
  function render() { if (disposed) return tree; let loops = 0; do { assert.ok(++loops < 30, 'Effect render loop'); dirty = false; hook = 0; tree = Workspace(); while (effects.length) effects.shift()(); } while (dirty); return tree; }
  async function flush() { for (let i = 0; i < 16; i++) { await new Promise(resolve => setImmediate(resolve)); if (dirty && !disposed) render(); } }
  async function waitForSaves(count) { for (let attempt = 0; attempt < 200; attempt++) { await flush(); if (saves.length >= count) return; await new Promise(resolve => originals.setTimeout(resolve, 1)); } assert.fail(`Expected ${count} mocked saves after SHA-256; got ${saves.length}`); }
  function unmount() { if (disposed) return; for (const item of hooks) item?.cleanup?.(); disposed = true; }
  render();
  return { brands, reviews, memos, saves, navigation, timers, storage, windowEvents, documentEvents, initialAuth, EvidenceList, flush, waitForSaves,
    tree: render, nodes: () => walk(render()), html: () => renderToStaticMarkup(render()),
    find: (type, text) => walk(render()).find(node => node.type === type && (text instanceof RegExp ? text.test(textOf(node)) : textOf(node).includes(text))),
    commit(url) { search = url.split('?')[1] || ''; window.location = new URL(url, 'https://uttu.test'); dirty = true; render(); },
    auth(user) { authListener('SIGNED_IN', user ? { user: { id: user } } : null); render(); }, confirmation: value => { confirm = value; },
    fireTimeouts() { const list = [...timers.values()]; timers.clear(); list.forEach(timer => timer.callback()); },
    unmount, lateUpdates: () => lateUpdates, unsubscribed: () => unsubscribed,
    dispose() { unmount(); for (const [key, value] of Object.entries(originals)) { if (value === undefined) delete global[key]; else global[key] = value; } },
  };
}
async function readyBrands(h, rows = BRANDS) { h.brands.at(-1).resolve(rows); await h.flush(); }
async function readyReviews(h, rows = [row()], next = null) { h.reviews.at(-1).resolve(page(rows, next)); await h.flush(); }
const boxes = h => h.nodes().filter(node => node.type === 'input' && node.props.type === 'checkbox');
function control(h, label) { const node = h.nodes().find(n => n.type === 'label' && textOf(n).includes(label)); assert.ok(node, `Missing accessible label ${label}`); const c = walk(node).find(n => ['input', 'select', 'textarea'].includes(n.type)); assert.ok(c); return c; }
function change(h, label, value) { control(h, label).props.onChange({ target: { value } }); h.tree(); }
function select(h, index = 0) { assert.ok(boxes(h)[index]); boxes(h)[index].props.onChange(); h.tree(); }
const memoForm = h => h.nodes().find(node => node.type === 'form' && walk(node).some(n => n.type === 'textarea'));
function fill(h) { change(h, '읽고 확인한 관찰', 'Read selected original carefully'); change(h, '다음에 확인할 것', 'Inspect the sample at the next meeting'); change(h, '다음 확인일', '2024-03-12'); }
const nextButton = h => h.find('button', '다음 원문 최대 30건');

test('initial brand loading, error, retry, and empty brands are explicit and never query fallback reviews', async () => {
  const h = harness('/reviews/weekly'); try { assert.match(h.html(), /브랜드 하나로 시작하세요|자사 브랜드를 불러오는 중/); assert.equal(control(h, '자사 브랜드').props.disabled, true); assert.equal(h.reviews.length, 0); h.brands[0].reject(Error('offline')); await h.flush(); assert.match(h.html(), /role="alert"[^>]*>브랜드를 불러오지 못했습니다/); h.find('button', '다시 시도').props.onClick(); h.tree(); assert.equal(h.brands.length, 2); await readyBrands(h, []); assert.match(h.html(), /조회 가능한 자사 브랜드가 없습니다/); assert.doesNotMatch(h.html(), /자사 브랜드를 불러오는 중/); assert.equal(h.reviews.length, 0); } finally { h.dispose(); }
});
test('malformed context and unavailable own brand never substitute another brand', async () => {
  for (const url of ['/reviews/weekly?brand=bad', w.weeklyHref({ ...SCOPE, brand: id(999) })]) { const h = harness(url); try { await readyBrands(h); assert.match(h.html(), /role="alert"/); assert.equal(h.reviews.length, 0); assert.doesNotMatch(h.html(), /불러온 원문 0건/); } finally { h.dispose(); } }
});
test('review loading and unavailable never become zero; same-scope retry can produce a genuine empty', async () => {
  const h = harness(); try { await readyBrands(h); assert.match(h.html(), /aria-busy="true"/); assert.match(h.html(), /작성일이 확인된 원문을 불러오는 중/); assert.doesNotMatch(h.html(), /불러온 원문 0건|이 범위에서 저장된 원문을 찾지 못했습니다/); h.reviews[0].reject(Error('offline')); await h.flush(); assert.match(h.html(), /0건으로 판단하지 마세요/); assert.doesNotMatch(h.html(), /불러온 원문 0건|이 범위에서 저장된 원문을 찾지 못했습니다/); h.find('button', '같은 범위로 다시 시도').props.onClick(); h.tree(); assert.deepEqual(h.reviews[1].args[0], SCOPE); await readyReviews(h, []); assert.match(h.html(), /불러온 원문 0건/); assert.match(h.html(), /이 범위에서 저장된 원문을 찾지 못했습니다/); assert.match(h.html(), /문제가 없거나 수집이 완료됐다는 뜻은 아닙니다/); } finally { h.dispose(); }
});
test('memo loading, error, and successful empty are separate with same-brand retry', async () => {
  const h = harness(); try { await readyBrands(h); assert.match(h.html(), /이전 검토를 불러오는 중/); assert.doesNotMatch(h.html(), /아직 이 브랜드의 상품 개선 검토 메모가 없습니다/); h.memos[0].reject(Error('offline')); await h.flush(); assert.match(h.html(), /메모가 없는 것은 아닙니다/); assert.doesNotMatch(h.html(), /아직 이 브랜드의 상품 개선 검토 메모가 없습니다/); h.find('button', '메모 다시 조회').props.onClick(); h.tree(); assert.equal(h.memos[1].args[0], A); h.memos[1].resolve([]); await h.flush(); assert.match(h.html(), /아직 이 브랜드의 상품 개선 검토 메모가 없습니다/); } finally { h.dispose(); }
});
test('linked missing originals are disclosed without replacement or ordinary-empty claims', async () => {
  const ids = [row().id, row(2).id], h = harness(w.weeklyHref(SCOPE, ids)); try { await readyBrands(h); assert.deepEqual(h.reviews[0].args[1].evidence, ids); assert.doesNotMatch(h.html(), /연결된 근거 2건을/); await readyReviews(h, [row()]); assert.match(h.html(), /연결된 근거 1건을 이 범위에서 확인할 수 없습니다/); assert.match(h.html(), /다른 원문으로 대체하지 않습니다/); assert.doesNotMatch(h.html(), /이 범위에서 저장된 원문을 찾지 못했습니다/); assert.equal(nextButton(h), undefined); assert.equal(h.find('a', '같은 범위의 원문 목록').props.href, w.weeklyHref(SCOPE)); } finally { h.dispose(); }
});
test('actual scope labels and evidence list carry KST dates, brand/product, provenance, and semantic controls', async () => {
  const scope = { ...SCOPE, product: PA, rating: 'low' }, h = harness(w.weeklyHref(scope)); try { await readyBrands(h); await readyReviews(h); const html = h.html(); for (const re of [/Brand Alpha · 이번 검토의 원문/, /작성 2024-02-28 ~ 2024-03-05 \(KST\) · 1~2점만 · 선택 상품만/, /선택 상품: Product 1/, /조회 기준 2024-03-06 09:00 KST/, /수집 완전성·원천 전체 리뷰 수는 확인되지 않았습니다/, /aria-labelledby="weekly-scope-heading"/, /id="weekly-scope-heading"/, /aria-labelledby="weekly-evidence-heading"/, /aria-label="작성일이 확인된 리뷰 원문"/, /aria-label="Product 1, 2024-03-04 리뷰를 검토 근거로 선택"/, /구매 옵션: NAVY \/ M/, /원천 리뷰 ID source-1/, /행 저장 2024-03-06 08:00 KST/]) assert.match(html, re); assert.equal(h.find('a', '같은 기간의 브랜드 원문').props.href, w.weeklyHref({ ...scope, product: null })); assert.equal(h.find('a', '이 원문 링크').props.href, w.weeklyHref(scope, [row().id])); assert.equal(h.find('a', '이 상품으로 좁혀 보기'), undefined); for (const label of ['자사 브랜드', '작성 시작일 (KST)', '작성 종료일 (KST)', '별점 범위']) assert.ok(control(h, label)); } finally { h.dispose(); }
});
test('actual EvidenceList escapes source prose, displays missing-source fallback, and gates external URLs', () => {
  const h = harness('/reviews/weekly'); try { const rows = [row(1, { review_text: '<script>alert(1)</script>', musinsa_no: 'javascript:alert(1)' }), row(2, { review_text: '', musinsa_review_id: '', purchase_option: null })]; const tree = React.createElement(h.EvidenceList, { rows, scope: SCOPE, selectedIds: [rows[0].id], selectionBlocked: true, onToggle() {} }), html = renderToStaticMarkup(tree), nodes = walk(tree); assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/); assert.doesNotMatch(html, /<script|href="javascript:/); assert.match(html, /원문 내용이 비어 있습니다/); assert.match(html, /원천 리뷰 ID 확인 불가/); const inputs = nodes.filter(n => n.type === 'input'); assert.equal(inputs[0].props.checked, true); assert.ok(inputs.every(n => n.props.disabled)); const links = nodes.filter(n => n.type === 'a' && n.props.target === '_blank'); assert.equal(links.length, 1); assert.equal(links[0].props.rel, 'noopener noreferrer'); assert.equal(links[0].props.href, 'https://www.musinsa.com/products/1002'); assert.equal(nodes.find(n => n.type === 'a' && textOf(n) === '이 상품으로 좁혀 보기').props.href, w.weeklyHref({ ...SCOPE, product: PA })); } finally { h.dispose(); }
});
test('saved memo links reconstruct only valid original same-app evidence and expose full-note links separately', async () => {
  const h = harness(); try { await readyBrands(h); h.memos[0].resolve([{ id: id(501), body: w.buildWeeklyMemo(draft()), created_at: SCOPE.at }, { id: id(502), body: `${w.WEEKLY_MEMO_HEADER}\n관찰: Legacy\n근거 보기: https://evil.example`, created_at: SCOPE.at }]); await h.flush(); const links = h.nodes().filter(n => n.type === 'a' && textOf(n) === '당시 근거 다시 보기'); assert.equal(links.length, 1); assert.equal(links[0].props.href, w.weeklyHref(SCOPE, [row().id])); assert.equal(h.nodes().filter(n => n.type === 'a' && textOf(n) === '저장한 메모').length, 2); assert.match(h.html(), /다음 확인일: 2024-03-12/); assert.doesNotMatch(h.html(), /href="https:\/\/evil.example/); } finally { h.dispose(); }
});
test('A→B navigation cancels A requests and late A reviews or memos cannot overwrite B', async () => {
  const h = harness(); try { await readyBrands(h); const a = h.reviews[0], ma = h.memos[0]; h.commit(w.weeklyHref(OTHER)); assert.equal(a.args[1].signal.aborted, true); assert.equal(ma.args[1].aborted, true); h.reviews[1].resolve(page([row(2, { review_text: 'New B original', brand_name: 'Brand Beta' })])); h.memos[1].resolve([{ id: id(502), body: '관찰: New B memo', created_at: SCOPE.at }]); await h.flush(); a.resolve(page([row(1, { review_text: 'Stale A original' })])); ma.resolve([{ id: id(501), body: '관찰: Stale A memo', created_at: SCOPE.at }]); await h.flush(); assert.match(h.html(), /New B original/); assert.match(h.html(), /New B memo/); assert.doesNotMatch(h.html(), /Stale A original|Stale A memo/); assert.equal(control(h, '자사 브랜드').props.value, B); } finally { h.dispose(); }
});
test('unmount aborts initial reviews/memos, clears timers, unsubscribes auth, and ignores late responses', async () => {
  const h = harness(); try { await readyBrands(h); const request = h.reviews[0], memo = h.memos[0]; h.unmount(); assert.equal(request.args[1].signal.aborted, true); assert.equal(memo.args[1].aborted, true); assert.equal(h.timers.size, 0); assert.equal(h.unsubscribed(), true); request.resolve(page([row()])); memo.resolve([]); await h.flush(); assert.equal(h.lateUpdates(), 0); } finally { h.dispose(); }
});
test('double next clicks issue one request; appended sources deduplicate without claiming whole-brand totals', async () => {
  const h = harness(); try { await readyBrands(h); await readyReviews(h, [row()], cursor()); const click = nextButton(h).props.onClick, first = click(), second = click(); assert.equal(h.reviews.length, 2); h.tree(); assert.equal(nextButton(h).props.disabled, true); assert.match(h.html(), /다음 원문을 불러오는 중/); assert.deepEqual(h.reviews[1].args[1].cursor, cursor()); h.reviews[1].resolve(page([row(2, { musinsa_review_id: row().musinsa_review_id }), row(3)], null, 2)); await Promise.all([first, second]); await h.flush(); assert.match(h.html(), /불러온 원문 2건 \(저장 행 3개에서 원천 ID 중복 제외\)/); assert.equal(boxes(h).length, 2); assert.match(h.html(), /원천 수집 완료를 뜻하지는 않습니다/); } finally { h.dispose(); }
});
test('navigation during pagination aborts old controller and refuses late old-brand rows', async () => {
  const h = harness(); try { await readyBrands(h); await readyReviews(h, [row()], cursor()); const loading = nextButton(h).props.onClick(); h.tree(); const request = h.reviews[1]; h.commit(w.weeklyHref(OTHER)); assert.equal(request.args[1].signal.aborted, true); h.reviews[2].resolve(page([row(3, { review_text: 'Only B survives' })])); await h.flush(); request.resolve(page([row(2, { review_text: 'Stale pagination A' })])); await loading; await h.flush(); assert.match(h.html(), /Only B survives/); assert.doesNotMatch(h.html(), /Stale pagination A|Original text 1/); } finally { h.dispose(); }
});
for (const cached of [false, true]) test(`pagination cleanup on unmount, including restored cache=${cached}`, async () => {
  const h = harness(); try { await readyBrands(h); await readyReviews(h, [row()], cursor()); if (cached) { h.commit(w.weeklyHref(SCOPE, [row().id])); await readyReviews(h); h.commit(w.weeklyHref(SCOPE)); await h.flush(); } const loading = nextButton(h).props.onClick(); h.tree(); const request = h.reviews.at(-1); h.unmount(); assert.equal(request.args[1].signal.aborted, true); assert.equal(h.timers.size, 0); request.resolve(page([row(2)])); await loading; await h.flush(); assert.equal(h.lateUpdates(), 0); } finally { h.dispose(); }
});
test('failed next page preserves earlier evidence and retries the same cursor', async () => {
  const h = harness(); try { await readyBrands(h); await readyReviews(h, [row()], cursor()); const first = nextButton(h).props.onClick(); h.tree(); h.reviews[1].reject(Error('offline')); await first; await h.flush(); assert.match(h.html(), /이미 불러온 원문만 표시 중이며 나머지는 확인되지 않았습니다/); assert.match(h.html(), /Original text 1/); assert.doesNotMatch(h.html(), /이 범위에서 저장된 원문을 찾지 못했습니다/); h.find('button', '같은 범위로 다시 시도').props.onClick(); h.tree(); assert.deepEqual(h.reviews[2].args[1].cursor, cursor()); h.reviews[2].resolve(page([row(2)])); await h.flush(); assert.equal(boxes(h).length, 2); } finally { h.dispose(); }
});
test('old-scope draft survives changed brand/date/product, blocks mixed evidence, and saves original context', async () => {
  const h = harness(); try { await readyBrands(h); await readyReviews(h); select(h); fill(h); const original = w.weeklyHref(SCOPE, [row().id]); h.commit(w.weeklyHref({ ...OTHER, from: '2024-03-01', product: PB })); await readyReviews(h, [row(2, { product_id: PB, brand_name: 'Brand Beta' })]); assert.match(h.html(), /화면 범위가 바뀌어도 작성 중인 메모는 위 범위로 유지됩니다/); assert.equal(control(h, '읽고 확인한 관찰').props.value, 'Read selected original carefully'); assert.equal(h.find('a', '선택한 근거만 다시 보기').props.href, original); assert.equal(boxes(h)[0].props.disabled, true); boxes(h)[0].props.onChange(); h.tree(); assert.match(h.html(), /선택한 근거 1건 \/ 최대 10건/); const saving = memoForm(h).props.onSubmit(event()); await h.waitForSaves(1); assert.equal(h.saves[0].args[0].entity_id, A); assert.equal(w.weeklyMemoHref(h.saves[0].args[0].body), original); h.saves[0].resolve({ data: { id: id(900) }, error: null }); await saving; await h.flush(); assert.match(h.html(), /Brand Alpha 검토 메모를 저장했습니다/); assert.equal(boxes(h)[0].props.disabled, false); } finally { h.dispose(); }
});
test('selection cap, accessible removal, cancelled discard, and confirmed discard execute real callbacks', async () => {
  const h = harness(); try { await readyBrands(h); await readyReviews(h, Array.from({ length: 11 }, (_, i) => row(i + 1))); for (let i = 0; i < 10; i++) select(h, i); select(h, 10); assert.match(h.html(), /메모 한 개에는 최대 10개의 원문/); assert.match(h.html(), /선택한 근거 10건 \/ 최대 10건/); h.nodes().find(n => n.type === 'button' && n.props['aria-label'] === 'Product 1 근거 선택 해제').props.onClick(); h.tree(); select(h, 10); assert.match(h.html(), /선택한 근거 10건 \/ 최대 10건/); fill(h); h.confirmation(false); h.find('button', '작성 내용 비우기').props.onClick(); h.tree(); assert.ok(memoForm(h)); h.confirmation(true); h.find('button', '작성 내용 비우기').props.onClick(); h.tree(); assert.equal(memoForm(h), undefined); assert.equal(h.storage.has(draftLib.weeklyDraftKey(UA)), false); assert.equal(h.saves.length, 0); } finally { h.dispose(); }
});
test('save is single-flight; uncertain retry reuses ID and sends no mentions or Teams', async () => {
  const h = harness(); try { await readyBrands(h); await readyReviews(h); select(h); fill(h); const submit = memoForm(h).props.onSubmit, first = submit(event()), duplicate = submit(event()); await h.waitForSaves(1); assert.equal(h.saves.length, 1); const sent = h.saves[0].args[0]; assert.equal(sent.expected_user_id, UA); assert.equal(sent.entity_type, 'brand'); assert.equal(sent.entity_id, A); assert.deepEqual(sent.tags, [w.WEEKLY_MEMO_TAG]); assert.deepEqual(sent.mentioned_user_ids, []); assert.equal(sent.send_teams, false); assert.ok(w.isWeeklyId(sent.submission_id)); assert.equal(control(h, '읽고 확인한 관찰').props.disabled, true); assert.equal(boxes(h)[0].props.disabled, true); h.saves[0].resolve({ data: null, error: 'uncertain' }); await Promise.all([first, duplicate]); await h.flush(); assert.match(h.html(), /같은 내용으로 재시도하면 중복 저장을 방지합니다/); assert.equal(control(h, '읽고 확인한 관찰').props.value, 'Read selected original carefully'); const retry = memoForm(h).props.onSubmit(event()); await h.waitForSaves(2); assert.deepEqual(h.saves[1].args[0], sent); h.saves[1].resolve({ data: { id: id(900) }, error: null }); await retry; await h.flush(); assert.equal(memoForm(h), undefined); assert.equal(h.find('a', '저장된 메모 보기').props.href, `/me/notes/${id(900)}?view=memo`); assert.equal(h.memos.length, 2); assert.equal(h.storage.has(draftLib.weeklyDraftKey(UA)), false); assert.equal(h.windowEvents.has('beforeunload'), false); } finally { h.dispose(); }
});
test('editing a draft after uncertain save changes its content-addressed ID', async () => {
  const h = harness(); try { await readyBrands(h); await readyReviews(h); select(h); fill(h); const first = memoForm(h).props.onSubmit(event()); await h.waitForSaves(1); h.saves[0].reject(Error('connection lost')); await first; await h.flush(); const old = h.saves[0].args[0].submission_id; change(h, '읽고 확인한 관찰', 'Updated observation'); const second = memoForm(h).props.onSubmit(event()); await h.waitForSaves(2); assert.notEqual(h.saves[1].args[0].submission_id, old); h.saves[1].resolve({ data: { id: id(901) }, error: null }); await second; await h.flush(); } finally { h.dispose(); }
});
test('unmount during saving suppresses state updates and does not repeat a mutation', async () => {
  const h = harness(); try { await readyBrands(h); await readyReviews(h); select(h); fill(h); const saving = memoForm(h).props.onSubmit(event()); await h.waitForSaves(1); h.unmount(); h.saves[0].resolve({ data: { id: id(900) }, error: null }); await saving; await h.flush(); assert.equal(h.lateUpdates(), 0); assert.equal(h.saves.length, 1); assert.equal(h.memos.length, 1); } finally { h.dispose(); }
});
test('same-tab re-entry restores original-account draft, strips raw review prose, and reinstalls unload warning', async () => {
  const storage = new Map(), first = harness(w.weeklyHref(SCOPE), { storage }); try { await readyBrands(first); await readyReviews(first); select(first); fill(first); const raw = storage.get(draftLib.weeklyDraftKey(UA)); assert.ok(raw); assert.doesNotMatch(raw, /Original text 1|NAVY \/ M/); let prevented = false; const e = { preventDefault: () => { prevented = true; }, returnValue: 'unset' }; first.windowEvents.get('beforeunload')(e); assert.equal(prevented, true); assert.equal(e.returnValue, ''); } finally { first.dispose(); }
  const back = harness(w.weeklyHref(OTHER), { storage }); try { await readyBrands(back); await readyReviews(back, [row(2)]); assert.equal(control(back, '읽고 확인한 관찰').props.value, 'Read selected original carefully'); assert.equal(back.find('a', '선택한 근거만 다시 보기').props.href, w.weeklyHref(SCOPE, [row().id])); assert.equal(boxes(back)[0].props.disabled, true); assert.ok(back.windowEvents.has('beforeunload')); back.find('button', '작성 내용 비우기').props.onClick(); back.tree(); assert.equal(storage.has(draftLib.weeklyDraftKey(UA)), false); assert.equal(back.windowEvents.has('beforeunload'), false); } finally { back.dispose(); }
});
test('foreign-user draft is never restored for current user; malformed current storage is removed', async () => {
  const foreign = draftLib.serializeWeeklyDraft(draft({ observation: 'Only account B owns this' })), storage = new Map([[draftLib.weeklyDraftKey(UB), foreign], [draftLib.weeklyDraftKey(UA), 'broken JSON']]), h = harness(w.weeklyHref(SCOPE), { storage }); try { await readyBrands(h); await readyReviews(h); assert.equal(memoForm(h), undefined); assert.doesNotMatch(h.html(), /Only account B owns this/); assert.equal(storage.has(draftLib.weeklyDraftKey(UA)), false); assert.equal(storage.get(draftLib.weeklyDraftKey(UB)), foreign); h.auth(UB); await h.flush(); assert.equal(control(h, '읽고 확인한 관찰').props.value, 'Only account B owns this'); h.auth(null); await h.flush(); assert.equal(memoForm(h), undefined); assert.equal(boxes(h)[0].props.disabled, true); } finally { h.dispose(); }
});
test('account switch during save cannot clear next-user draft or expose old-user success', async () => {
  const stored = draftLib.serializeWeeklyDraft(draft({ observation: 'Account B private draft' })), h = harness(w.weeklyHref(SCOPE), { storage: new Map([[draftLib.weeklyDraftKey(UB), stored]]) }); try { await readyBrands(h); await readyReviews(h); select(h); fill(h); const saving = memoForm(h).props.onSubmit(event()); await h.waitForSaves(1); assert.equal(h.saves[0].args[0].expected_user_id, UA); h.auth(UB); await h.flush(); assert.equal(control(h, '읽고 확인한 관찰').props.value, 'Account B private draft'); h.saves[0].resolve({ data: { id: id(900) }, error: null }); await saving; await h.flush(); assert.equal(control(h, '읽고 확인한 관찰').props.value, 'Account B private draft'); assert.doesNotMatch(h.html(), /검토 메모를 저장했습니다/); assert.deepEqual(JSON.parse(h.storage.get(draftLib.weeklyDraftKey(UB))), JSON.parse(stored)); } finally { h.dispose(); }
});
for (const outcome of ['fulfill', 'reject']) test(`stale initial auth ${outcome} cannot undo a newer authenticated account`, async () => {
  const h = harness(w.weeklyHref(SCOPE), { deferredAuth: true, storage: new Map([[draftLib.weeklyDraftKey(UB), draftLib.serializeWeeklyDraft(draft({ observation: 'New B draft' }))]]) }); try { h.auth(UB); await readyBrands(h); await readyReviews(h); assert.equal(control(h, '읽고 확인한 관찰').props.value, 'New B draft'); if (outcome === 'fulfill') h.initialAuth.resolve({ data: { user: { id: UA } }, error: null }); else h.initialAuth.reject(Error('old offline request')); await h.flush(); assert.equal(control(h, '읽고 확인한 관찰').props.value, 'New B draft'); assert.equal(boxes(h)[0].props.disabled, false); } finally { h.dispose(); }
});
test('same-brand account change cancels old own-memo request and refuses late private results', async () => {
  const h = harness(); try { await readyBrands(h); const old = h.memos[0]; assert.equal(old.args[2], UA); h.auth(UB); await h.flush(); assert.equal(old.args[1].aborted, true); assert.equal(h.memos.length, 2); assert.equal(h.memos[1].args[2], UB); h.memos[1].resolve([{ id: id(502), body: '관찰: Account B own memo', created_at: SCOPE.at }]); await h.flush(); old.resolve([{ id: id(501), body: '관찰: Account A private memo', created_at: SCOPE.at }]); await h.flush(); assert.match(h.html(), /Account B own memo/); assert.doesNotMatch(h.html(), /Account A private memo/); } finally { h.dispose(); }
});
test('unavailable storage warns and permits cancelling navigation outside this weekly workspace', async () => {
  const h = harness(w.weeklyHref(SCOPE), { storageUnavailable: true }); try { await readyBrands(h); await readyReviews(h); select(h); fill(h); assert.match(h.html(), /임시 보관을 사용할 수 없습니다/); assert.ok(h.windowEvents.has('beforeunload')); h.confirmation(false); let prevented = false, stopped = false; const click = { button: 0, defaultPrevented: false, target: { closest: () => ({ getAttribute: () => '/reviews' }) }, preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } }; h.documentEvents.get('click')(click); assert.equal(prevented, true); assert.equal(stopped, true); prevented = false; stopped = false; click.target.closest = () => ({ getAttribute: () => w.weeklyHref(OTHER) }); h.documentEvents.get('click')(click); assert.equal(prevented, false); assert.equal(stopped, false); } finally { h.dispose(); }
});
test('real createNote expected-user guard refuses changed account before table or notification access', async () => {
  let tables = 0; const { createNote } = load('src/lib/queries-me.ts', { './supabase/client': { supabaseBrowser: () => ({ auth: { getUser: async () => ({ data: { user: { id: UB } }, error: null }) }, from() { tables++; throw Error('Must not mutate switched account'); } }) } }); const result = await createNote({ body: 'Original account draft', expected_user_id: UA, entity_type: 'brand', entity_id: A, tags: [w.WEEKLY_MEMO_TAG], mentioned_user_ids: [], send_teams: false }); assert.equal(result.data, null); assert.match(result.error, /로그인 계정이 변경/); assert.equal(tables, 0);
});
test('drilling into evidence and Back retains loaded pages and immutable cutoff', async () => {
  const h = harness(); try { await readyBrands(h); await readyReviews(h, [row()], cursor()); const loading = nextButton(h).props.onClick(); h.tree(); h.reviews[1].resolve(page([row(2)], cursor(2))); await loading; await h.flush(); h.commit(w.weeklyHref(SCOPE, [row().id])); await readyReviews(h); assert.equal(boxes(h).length, 1); const count = h.reviews.length; h.commit(w.weeklyHref(SCOPE)); await h.flush(); assert.equal(h.reviews.length, count); assert.equal(boxes(h).length, 2); assert.match(h.html(), /불러온 원문 2건/); assert.match(h.html(), /조회 기준 2024-03-06 09:00 KST/); assert.ok(nextButton(h)); } finally { h.dispose(); }
});
test('pagination caps at ten pages and labels the cap as non-total', async () => {
  const h = harness(); try { await readyBrands(h); await readyReviews(h, [row()], cursor()); for (let i = 2; i <= 10; i++) { const loading = nextButton(h).props.onClick(); h.tree(); h.reviews.at(-1).resolve(page([row(i)], cursor(i))); await loading; await h.flush(); } assert.equal(h.reviews.length, 10); assert.equal(nextButton(h), undefined); assert.match(h.html(), /10페이지에 도달했습니다. 전체 집계가 아닙니다/); } finally { h.dispose(); }
});
test('refresh computes a new cutoff and closed week at click time across KST midnight', async () => {
  const DateOriginal = global.Date; let now = DateOriginal.parse('2026-10-03T14:59:59.999Z'); global.Date = class extends DateOriginal { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }; const h = harness(); try { await readyBrands(h); await readyReviews(h); const refresh = h.find('button', '최근 7일로 새로 조회').props.onClick; now = DateOriginal.parse('2026-10-03T15:00:01.000Z'); refresh(); const p = new URLSearchParams(h.navigation.at(-1).href.split('?')[1]); assert.equal(p.get('at'), '2026-10-03T15:00:01.000Z'); assert.equal(p.get('from'), '2026-09-27'); assert.equal(p.get('to'), '2026-10-03'); } finally { h.dispose(); global.Date = DateOriginal; }
});
test('applying date/rating preserves selected product until brand changes', async () => {
  const h = harness(w.weeklyHref({ ...SCOPE, product: PA })); try { await readyBrands(h); await readyReviews(h); change(h, '별점 범위', 'low'); change(h, '작성 시작일 (KST)', '2024-03-01'); h.nodes().find(n => n.type === 'form' && !walk(n).some(c => c.type === 'textarea')).props.onSubmit(event()); let p = new URLSearchParams(h.navigation.at(-1).href.split('?')[1]); assert.equal(p.get('product'), PA); assert.equal(p.get('rating'), 'low'); assert.equal(p.get('from'), '2024-03-01'); change(h, '자사 브랜드', B); p = new URLSearchParams(h.navigation.at(-1).href.split('?')[1]); assert.equal(p.get('brand'), B); assert.equal(p.has('product'), false); } finally { h.dispose(); }
});
test('responsive CSS provides mobile columns, wrapping, visible focus, and touch targets', () => {
  assert.match(css, /@media\s*\(max-width:\s*820px\)[\s\S]*?\.layout\s*\{\s*grid-template-columns:\s*1fr/); assert.match(css, /@media\s*\(max-width:\s*420px\)[\s\S]*?\.field\s*\{\s*min-width:\s*100%/); assert.match(css, /\.review\s*\{[^}]*white-space:\s*pre-wrap/); assert.match(css, /overflow-wrap:\s*anywhere/); assert.match(css, /:focus-visible[^}]*outline:\s*3px/); assert.match(css, /\.choice\s*\{[^}]*min-height:\s*44px/); assert.match(css, /\.filters\s*\{[^}]*flex-wrap:\s*wrap/); assert.doesNotMatch(css, /position:\s*fixed/);
});

test('exact 8000ms deadlines abort review and memo reads and render unavailable rather than zero', async () => {
  const h = harness();
  try {
    await readyBrands(h);
    assert.equal(h.timers.size, 2);
    assert.deepEqual([...h.timers.values()].map(timer => timer.delay), [8000, 8000]);
    const review = h.reviews[0], memo = h.memos[0];
    const reviewSignal = review.args[1].signal, memoSignal = memo.args[1];
    // Controlled query adapters reject on AbortSignal exactly as the real read adapter does.
    reviewSignal.addEventListener('abort', () => review.reject(reviewSignal.reason), { once: true });
    memoSignal.addEventListener('abort', () => memo.reject(memoSignal.reason), { once: true });
    assert.equal(reviewSignal.aborted, false); assert.equal(memoSignal.aborted, false);
    h.fireTimeouts();
    assert.equal(reviewSignal.aborted, true); assert.equal(memoSignal.aborted, true);
    await h.flush();
    assert.equal(h.timers.size, 0);
    assert.match(h.html(), /0건으로 판단하지 마세요/);
    assert.match(h.html(), /메모가 없는 것은 아닙니다/);
    assert.doesNotMatch(h.html(), /불러온 원문 0건|이 범위에서 저장된 원문을 찾지 못했습니다|아직 이 브랜드의 상품 개선 검토 메모가 없습니다/);
    assert.equal(h.reviews.length, 1); assert.equal(h.memos.length, 1);
  } finally { h.dispose(); }
});

test('cached-list pagination is cancelled on scope navigation and cannot append late old-scope evidence', async () => {
  const h = harness();
  try {
    await readyBrands(h); await readyReviews(h, [row()], cursor());
    h.commit(w.weeklyHref(SCOPE, [row().id])); await readyReviews(h);
    const beforeBack = h.reviews.length;
    h.commit(w.weeklyHref(SCOPE)); await h.flush();
    assert.equal(h.reviews.length, beforeBack, 'Back must actually restore the cached list');
    const loading = nextButton(h).props.onClick(); h.tree();
    const oldPage = h.reviews.at(-1);
    assert.deepEqual(oldPage.args[1].cursor, cursor());
    h.commit(w.weeklyHref(OTHER));
    const newScope = h.reviews.at(-1);
    assert.notEqual(newScope, oldPage);
    assert.equal(oldPage.args[1].signal.aborted, true);
    assert.equal(newScope.args[1].signal.aborted, false);
    assert.deepEqual(newScope.args[0], OTHER);
    newScope.resolve(page([row(3, { brand_name: 'Brand Beta', review_text: 'Fresh B after cached pagination' })]));
    await h.flush();
    oldPage.resolve(page([row(2, { review_text: 'Cached A late page' })]));
    await loading; await h.flush();
    assert.match(h.html(), /Fresh B after cached pagination/);
    assert.doesNotMatch(h.html(), /Cached A late page|Original text 1/);
    assert.equal(boxes(h).length, 1);
    assert.equal(control(h, '자사 브랜드').props.value, B);
  } finally { h.dispose(); }
});
