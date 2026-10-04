const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), Renderer = require('react-test-renderer');
const load = require('./helpers/load-source.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.document = { activeElement: null };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture({ lateIdentity = false } = {}) {
  const brands = [], reviews = [], listeners = new Set(), identities = [];
  let user = 'account-a';
  const client = { auth: { onAuthStateChange(fn) { listeners.add(fn); return { data: { subscription: { unsubscribe() { listeners.delete(fn); } } } }; },
    getUser() { if (!lateIdentity) return Promise.resolve({ data: { user: user ? { id: user } : null } }); const d = deferred(); identities.push(d); return d.promise; } } };
  const Chips = ({ items, onChange }) => React.createElement('div', {}, items.map(item => React.createElement('button', { key: item.value, 'data-chip': item.value, onClick: () => onChange(item.value) }, item.label)));
  const View = load('src/app/(app)/reviews/MobileReviewsView.tsx', {
    '@/lib/queries': { fetchOwnBrands: signal => { const d = deferred(); brands.push({ ...d, signal }); return d.promise; }, fetchReviews: opts => { const d = deferred(); reviews.push({ ...d, opts }); return d.promise; }, normImgUrl: x => x },
    '@/lib/supabase/client': { supabaseBrowser: () => client },
    '@/components/mobile/MobileFilterChips': { __esModule: true, default: Chips },
    '@/components/mobile/MobileEmptyState': { __esModule: true, default: () => React.createElement('div', { 'data-empty': true }, 'empty') },
    '@/components/mobile/ReviewDetailSheet': { __esModule: true, default: ({ review }) => React.createElement('div', { 'data-detail': review.id }) },
  }).default;
  return { View, brands, reviews, identities, auth(id) { user = id; for (const fn of listeners) fn(id ? 'SIGNED_IN' : 'SIGNED_OUT', id ? { user: { id } } : null); } };
}
const row = id => ({ id: `review-${id}`, rating: 5, review_date: '2026-10-04', review_text: `Text ${id}`, product_name: 'Jacket', has_image: false, image_urls: [], helpful_count: 0 });
const buttons = root => root.root.findAllByType('button');
const clickText = async (root, label) => { const button = buttons(root).find(b => JSON.stringify(b.children).includes(label)); assert.ok(button, `button ${label}`); await React.act(async () => button.props.onClick({ currentTarget: {} })); };
const content = root => JSON.stringify(root.toJSON());
const countText = root => root.root.findAllByType('div').map(node => node.children.filter(x => typeof x === 'string').join('')).find(value => /^\d+개 표시 · 최근 조회 기준 \d+개 일치$/.test(value));

test('over 200 matches page through all rows, dedup overlap, and stop at the true total', async () => {
  const f = fixture(); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.View)); });
    await React.act(async () => f.brands[0].resolve([{ id: 'own', name: 'Own' }]));
    for (let page = 0; page < 5; page++) {
      const call = f.reviews[page]; assert.equal(call.opts.offset, page * 50); assert.equal(call.opts.limit, 50);
      const rows = Array.from({ length: page === 4 ? 1 : 50 }, (_, i) => row(page * 50 + i));
      if (page === 1) rows[0] = row(0);
      await React.act(async () => call.resolve({ rows, total: 201 }));
      if (page < 4) await clickText(root, '리뷰 더 보기');
    }
    assert.equal(countText(root), '200개 표시 · 최근 조회 기준 201개 일치');
    assert.match(content(root), /표시 리뷰 수와 최근 일치 건수가 다릅니다/);
    assert.doesNotMatch(content(root), /리뷰 더 보기/);
    assert.equal(f.reviews.length, 5);
  } finally { if (root) await React.act(async () => root.unmount()); }
});

test('load-more action stays mounted while pending, blocks repeated activation and becomes retry in place', async () => {
  const f = fixture(); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.View)); });
    await React.act(async () => f.brands[0].resolve([{ id: 'own', name: 'Own' }]));
    await React.act(async () => f.reviews[0].resolve({ rows: Array.from({ length: 50 }, (_, i) => row(i)), total: 51 }));
    const action = buttons(root).find(button => button.children.includes('리뷰 더 보기'));
    await clickText(root, '리뷰 더 보기');
    assert.equal(buttons(root).find(button => button.children.includes('리뷰 더 보기')), action);
    assert.equal(action.props['aria-disabled'], true);
    await React.act(async () => action.props.onClick({ currentTarget: {} }));
    assert.equal(f.reviews.length, 2);
    await React.act(async () => f.reviews[1].reject(Error('offline')));
    assert.equal(buttons(root).find(button => button.children.includes('다시 시도')), action);
    assert.equal(action.props['aria-disabled'], false);
  } finally { if (root) await React.act(async () => root.unmount()); }
});

test('last-page completion moves focus only when the paging action retained focus', async () => {
  for (const tabAway of [false, true]) {
    const f = fixture(); let root, focusCalls = 0;
    const activeButton = {};
    try {
      await React.act(async () => { root = Renderer.create(React.createElement(f.View), { createNodeMock: node => node.props.role === 'status' ? { focus() { focusCalls++; } } : null }); });
      await React.act(async () => f.brands[0].resolve([{ id: 'own', name: 'Own' }]));
      await React.act(async () => f.reviews[0].resolve({ rows: Array.from({ length: 50 }, (_, i) => row(i)), total: 51 }));
      const action = buttons(root).find(button => button.props['aria-disabled'] === false);
      document.activeElement = activeButton;
      await React.act(async () => action.props.onClick({ currentTarget: activeButton }));
      if (tabAway) { document.activeElement = {}; await React.act(async () => action.props.onBlur()); }
      await React.act(async () => f.reviews[1].resolve({ rows: [row(50)], total: 51 }));
      assert.equal(focusCalls, tabAway ? 0 : 1);
    } finally { document.activeElement = null; if (root) await React.act(async () => root.unmount()); }
  }
});

test('same-batch account B event invalidates A brands before effect cleanup and prevents A-scoped reads', async () => {
  const f = fixture(); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.View)); });
    assert.equal(f.brands.length, 1);
    await React.act(async () => {
      f.auth('account-b');
      f.brands[0].resolve([{ id: 'a-only', name: 'Private A' }]);
      await Promise.resolve();
    });
    assert.doesNotMatch(content(root), /Private A/);
    assert.equal(f.reviews.length, 0);
    assert.equal(f.brands.length, 2);
  } finally { if (root) await React.act(async () => root.unmount()); }
});

test('same-batch account B event invalidates A review result; late getUser cannot undo SIGNED_OUT', async () => {
  const f = fixture(); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.View)); });
    await React.act(async () => f.brands[0].resolve([{ id: 'a-only', name: 'Private A' }]));
    await React.act(async () => {
      f.auth('account-b');
      f.reviews[0].resolve({ rows: [row('private-a')], total: 1 });
      await Promise.resolve();
    });
    assert.doesNotMatch(content(root), /Text private-a|Private A/);
    assert.equal(f.reviews.length, 1);
  } finally { if (root) await React.act(async () => root.unmount()); }
  const late = fixture({ lateIdentity: true }); let lateRoot;
  try {
    await React.act(async () => { lateRoot = Renderer.create(React.createElement(late.View)); });
    await React.act(async () => {
      late.auth(null);
      late.identities[0].resolve({ data: { user: { id: 'account-a' } } });
      await Promise.resolve();
    });
    assert.equal(late.brands.length, 0);
    assert.equal(late.reviews.length, 0);
    assert.match(content(lateRoot), /로그인 후 리뷰/);
  } finally { if (lateRoot) await React.act(async () => lateRoot.unmount()); }
});

test('251 distinct matches are reachable beyond the old cap; reselecting active chips preserves loaded rows', async () => {
  const f = fixture(); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.View)); });
    await React.act(async () => f.brands[0].resolve([{ id: 'own', name: 'Own' }]));
    for (let index = 0; index < 6; index++) {
      const call = f.reviews[index];
      assert.equal(call.opts.offset, index * 50);
      await React.act(async () => call.resolve({ rows: Array.from({ length: index === 5 ? 1 : 50 }, (_, i) => row(index * 50 + i)), total: 251 }));
      if (index < 5) await clickText(root, '리뷰 더 보기');
    }
    assert.equal(countText(root), '251개 표시 · 최근 조회 기준 251개 일치');
    assert.match(content(root), /Text 250/);
    assert.doesNotMatch(content(root), /리뷰 더 보기/);
    await React.act(async () => root.root.findByProps({ 'data-chip': 'all' }).props.onClick());
    await React.act(async () => root.root.findByProps({ 'data-chip': 'own' }).props.onClick());
    assert.equal(f.reviews.length, 6);
    assert.match(content(root), /Text 250/);
  } finally { if (root) await React.act(async () => root.unmount()); }
});

test('exact boundary and empty are truthful; delayed old filter and identity results are discarded', async () => {
  const f = fixture(); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.View)); });
    await React.act(async () => f.brands[0].resolve([{ id: 'own', name: 'Own' }]));
    await React.act(async () => root.root.findByProps({ 'data-chip': 'low' }).props.onClick());
    await React.act(async () => f.reviews[0].resolve({ rows: [row('old')], total: 1 }));
    assert.doesNotMatch(content(root), /Text old/);
    await React.act(async () => f.reviews[1].resolve({ rows: [], total: 0 }));
    assert.ok(root.root.findAllByProps({ 'data-empty': true }).length);
    await React.act(async () => f.auth(null));
    assert.doesNotMatch(content(root), /empty/);
    await React.act(async () => f.auth('account-b'));
    await React.act(async () => f.brands.at(-1).resolve([{ id: 'other', name: 'Other' }]));
    await React.act(async () => f.reviews.at(-1).resolve({ rows: Array.from({ length: 50 }, (_, i) => row(i)), total: 50 }));
    assert.doesNotMatch(content(root), /리뷰 더 보기/);
    assert.equal(countText(root), '50개 표시 · 최근 조회 기준 50개 일치');
  } finally { if (root) await React.act(async () => root.unmount()); }
});

test('next-page failure retains verified rows and retries same offset; empty inconsistency does not claim completion', async () => {
  const f = fixture(); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.View)); });
    await React.act(async () => f.brands[0].resolve([{ id: 'own', name: 'Own' }]));
    await React.act(async () => f.reviews[0].resolve({ rows: Array.from({ length: 50 }, (_, i) => row(i)), total: 51 }));
    await clickText(root, '리뷰 더 보기');
    await React.act(async () => f.reviews[1].reject(Error('offline')));
    assert.match(content(root), /Text 0/);
    assert.equal(root.root.findAllByProps({ role: 'alert' }).length, 1);
    await clickText(root, '다시 시도');
    assert.equal(f.reviews[2].opts.offset, 50);
    await React.act(async () => f.reviews[2].resolve({ rows: [], total: 51 }));
    assert.equal(root.root.findAllByProps({ role: 'alert' }).length, 1);
    await clickText(root, '다시 시도');
    await React.act(async () => f.reviews[3].resolve({ rows: [row(50)], total: 51 }));
    assert.equal(countText(root), '51개 표시 · 최근 조회 기준 51개 일치');
    assert.equal(root.root.findAllByProps({ role: 'alert' }).length, 0);
  } finally { if (root) await React.act(async () => root.unmount()); }
});

test('late account results cannot reappear after account switch, sign-out or unmount; same account event keeps pages', async () => {
  const f = fixture(); let root;
  await React.act(async () => { root = Renderer.create(React.createElement(f.View)); });
  try {
    await React.act(async () => f.brands[0].resolve([{ id: 'own', name: 'Own' }]));
    const old = f.reviews[0];
    await React.act(async () => f.auth('account-b'));
    assert.equal(old.opts.signal.aborted, true);
    await React.act(async () => old.resolve({ rows: [row('account-a')], total: 1 }));
    assert.doesNotMatch(content(root), /Text account-a/);
    await React.act(async () => f.brands[1].resolve([{ id: 'other', name: 'Other' }]));
    await React.act(async () => f.reviews[1].resolve({ rows: [row('account-b')], total: 1 }));
    assert.match(content(root), /Text account-b/);
    await React.act(async () => f.auth('account-b'));
    assert.equal(f.brands.length, 2);
    assert.equal(f.reviews.length, 2);
    await React.act(async () => f.auth(null));
    assert.doesNotMatch(content(root), /Text account-b/);
    assert.match(content(root), /로그인 후 리뷰/);
    await React.act(async () => f.auth('account-c'));
    const brandRead = f.brands.at(-1);
    await React.act(async () => root.unmount()); root = null;
    assert.equal(brandRead.signal.aborted, true);
    await React.act(async () => brandRead.resolve([{ id: 'late', name: 'Late' }]));
    assert.equal(f.reviews.length, 2);
  } finally { if (root) await React.act(async () => root.unmount()); }
});

test('empty brands settle; failed initial reads retry; refreshing starts at offset zero', async () => {
  const f = fixture(); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.View)); });
    await React.act(async () => f.brands[0].reject(Error('offline')));
    assert.equal(root.root.findAllByProps({ role: 'alert' }).length, 1);
    await clickText(root, '다시 시도');
    await React.act(async () => f.brands[1].resolve([]));
    assert.equal(root.root.findAllByProps({ 'data-empty': true }).length, 1);
    assert.equal(f.reviews.length, 0);
    await React.act(async () => f.auth('account-b'));
    await React.act(async () => f.brands[2].resolve([{ id: 'own', name: 'Own' }]));
    await React.act(async () => f.reviews[0].reject(Error('offline')));
    await clickText(root, '다시 시도');
    await React.act(async () => f.reviews[1].resolve({ rows: [row('valid')], total: 1 }));
    await clickText(root, '처음부터 새로 조회');
    assert.equal(f.reviews[2].opts.offset, 0);
    assert.doesNotMatch(content(root), /Text valid/);
    await React.act(async () => f.reviews[2].resolve({ rows: [], total: 0 }));
    assert.equal(root.root.findAllByProps({ 'data-empty': true }).length, 1);
  } finally { if (root) await React.act(async () => root.unmount()); }
});
