const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), Renderer = require('react-test-renderer');
const load = require('./helpers/load-source.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture({ lateIdentity = false } = {}) {
  const calls = [], identities = [], listeners = new Set();
  const client = { auth: { onAuthStateChange(fn) { listeners.add(fn); return { data: { subscription: { unsubscribe() { listeners.delete(fn); } } } }; },
    getUser() { if (!lateIdentity) return Promise.resolve({ data: { user: { id: 'account-a' } } }); const d = deferred(); identities.push(d); return d.promise; } } };
  const Page = load('src/app/(app)/reviews/page.tsx', {
    'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/hooks/useResolvedViewport': { useResolvedViewport: () => 'desktop' },
    '@/lib/supabase/client': { supabaseBrowser: () => client },
    '@/lib/queries': { CATEGORY_MAP: {}, fetchOwnProducts: async () => [], fetchCsAnomalies: async () => [], fetchReviewStats(days, signal) { const d = deferred(); calls.push({ ...d, days, signal }); return d.promise; } },
    '@/lib/excel-export': {}, '@/components/ui/filters': {}, '@/components/ui/icons': {}, '@/components/me/NoteDrawer': { __esModule: true, default: () => null },
  }).default;
  return { Page, calls, identities, auth(id) { for (const fn of listeners) fn(id ? 'SIGNED_IN' : 'SIGNED_OUT', id ? { user: { id } } : null); } };
}
const stats = total => ({ total, avgRating: total ? 4 : 0, lowCount: 0, ratingDist: [0, total, 0, 0, 0], imageCount: 0 });
const text = root => JSON.stringify(root.toJSON());
const values = root => root.root.findAllByProps({ className: 'val' }).map(node => node.children.join(''));
async function click(root, label) { const button = root.root.findAllByType('button').find(node => node.children.join('') === label); assert.ok(button); await React.act(async () => button.props.onClick()); }
test('real desktop route renders error/retry distinctly from a successful zero-count dashboard', async () => {
  const f = fixture(); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.Page)); });
    assert.equal(f.calls[0].days, 30);
    await React.act(async () => f.calls[0].reject(Error('offline')));
    assert.equal(root.root.findAllByProps({ role: 'alert' }).length, 1);
    assert.doesNotMatch(values(root).slice(0, 4).join(','), /0/);
    await click(root, '다시 조회');
    assert.equal(f.calls[1].days, 30);
    assert.equal(root.root.findAllByProps({ role: 'alert' }).length, 0);
    await React.act(async () => f.calls[1].resolve(stats(0)));
    assert.equal(values(root)[0], '0');
    assert.equal(values(root)[1], '—');
    assert.equal(values(root)[2], '0');
    assert.equal(values(root)[3], '0');
    assert.match(text(root), /이 기간에 일치하는 리뷰가 없습니다/);
    assert.equal(root.root.findAllByProps({ role: 'alert' }).length, 0);
  } finally { if (root) await React.act(async () => root.unmount()); }
});
test('retry action remains mounted through pending, repeated error and success without duplicate reads', async () => {
  const f = fixture(); let root;
  const action = () => root.root.findAllByType('button').find(node => node.children.join('') === '다시 조회');
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.Page)); });
    await React.act(async () => f.calls[0].reject(Error('offline')));
    const button = action();
    await click(root, '다시 조회');
    assert.equal(action(), button); assert.equal(button.props['aria-disabled'], true);
    await click(root, '다시 조회'); assert.equal(f.calls.length, 2);
    await React.act(async () => f.calls[1].reject(Error('still offline')));
    assert.equal(action(), button); assert.equal(button.props['aria-disabled'], false);
    await click(root, '다시 조회');
    await React.act(async () => f.calls[2].resolve(stats(5)));
    assert.equal(action(), button); assert.equal(values(root)[1], '★ 4.00');
  } finally { if (root) await React.act(async () => root.unmount()); }
});

test('period changes clear values immediately and ignore delayed prior-period success or failure', async () => {
  const f = fixture(); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.Page)); });
    await React.act(async () => f.calls[0].resolve(stats(111)));
    assert.equal(values(root)[0], '111');
    await click(root, '7D');
    assert.notEqual(values(root)[0], '111'); assert.equal(f.calls[1].days, 7);
    await click(root, '30D');
    assert.equal(f.calls[1].signal.aborted, true);
    await React.act(async () => f.calls[1].resolve(stats(777)));
    assert.doesNotMatch(text(root), /777/);
    await React.act(async () => f.calls[2].resolve(stats(222)));
    assert.equal(values(root)[0], '222');
    await click(root, '7D'); await click(root, '30D');
    await React.act(async () => f.calls[3].reject(Error('late failure')));
    assert.equal(root.root.findAllByProps({ role: 'alert' }).length, 0);
    await React.act(async () => f.calls[4].reject(Error('current failure')));
    assert.equal(root.root.findAllByProps({ role: 'alert' }).length, 1);
    assert.notEqual(values(root)[0], '222');
  } finally { if (root) await React.act(async () => root.unmount()); }
});
test('same-batch identity changes abort stale metrics; sign-out and unmount cannot republish them', async () => {
  const f = fixture(); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.Page)); });
    await React.act(async () => { f.auth('account-b'); f.calls[0].resolve(stats(666)); await Promise.resolve(); });
    assert.equal(f.calls[0].signal.aborted, true); assert.doesNotMatch(text(root), /666/);
    await React.act(async () => f.calls[1].resolve(stats(333)));
    assert.equal(values(root)[0], '333');
    await React.act(async () => f.auth('account-b'));
    assert.equal(f.calls.length, 2);
    await React.act(async () => f.auth(null));
    assert.doesNotMatch(text(root), /333/); assert.match(text(root), /로그인 후 리뷰 통계/);
    await React.act(async () => f.auth('account-c'));
    const pending = f.calls[2]; await React.act(async () => root.unmount()); root = null;
    assert.equal(pending.signal.aborted, true);
    await React.act(async () => pending.resolve(stats(999)));
  } finally { if (root) await React.act(async () => root.unmount()); }
});
test('late getUser cannot override sign-out in the real dashboard', async () => {
  const f = fixture({ lateIdentity: true }); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.Page)); });
    await React.act(async () => { f.auth(null); f.identities[0].resolve({ data: { user: { id: 'account-a' } } }); await Promise.resolve(); });
    assert.equal(f.calls.length, 0); assert.match(text(root), /로그인 후 리뷰 통계/);
  } finally { if (root) await React.act(async () => root.unmount()); }
});
