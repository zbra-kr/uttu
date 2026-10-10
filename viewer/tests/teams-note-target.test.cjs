const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./helpers/load-source.cjs');
const uid = '11111111-1111-4111-8111-111111111111';
const targetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const entityId = '22222222-2222-4222-8222-222222222222';
const note = (id = targetId, entity_id = entityId) => ({ id, user_id: uid, entity_type: 'product', entity_id,
  body: '대상 메모', tags: [], mentioned_user_ids: [], created_at: '', updated_at: '', source_context: null });

function noteApi(row, { user = { id: uid }, error = null } = {}) {
  const filters = []; const tables = [];
  const client = { auth: { getUser: async () => ({ data: { user } }) }, from: table => {
    tables.push(table);
    const query = { select: () => query, eq: (key, value) => { filters.push([table, key, value]); return query; },
      maybeSingle: async () => ({ data: table === 'user_notes' ? row : { id: uid, display_name: '작성자' }, error }) };
    return query;
  } };
  return { ...load('src/lib/queries-me.ts', { './supabase/client': { supabaseBrowser: () => client } }), filters, tables };
}
test('exact target lookup is authenticated, RLS scoped and bound to both entity fields', async () => {
  const api = noteApi(note());
  assert.equal((await api.fetchNoteForEntity(targetId, 'product', entityId)).id, targetId);
  assert.deepEqual(api.filters.slice(0, 3), [
    ['user_notes', 'id', targetId], ['user_notes', 'entity_type', 'product'], ['user_notes', 'entity_id', entityId],
  ]);
  assert.deepEqual(api.tables, ['user_notes', 'profiles_public']);
});
for (const [label, row, opts] of [
  ['unreadable or deleted', null, {}], ['another entity ID', note(targetId, 'other'), {}],
  ['another entity type', { ...note(), entity_type: 'brand' }, {}],
  ['another memo', note(uid), {}], ['database failure', note(), { error: { message: 'denied' } }],
]) test(`exact target rejects ${label} without fetching profile`, async () => {
  const api = noteApi(row, opts);
  assert.equal(await api.fetchNoteForEntity(targetId, 'product', entityId), null);
  assert.deepEqual(api.tables, ['user_notes']);
});
test('malformed UUID and signed-out target queries never touch tables', async () => {
  const api = noteApi(note());
  assert.equal(await api.fetchNoteForEntity('https://evil.test/', 'product', entityId), null);
  assert.deepEqual(api.tables, []);
  const signedOut = noteApi(note(), { user: null });
  assert.equal(await signedOut.fetchNoteForEntity(targetId, 'product', entityId), null);
  assert.deepEqual(signedOut.tables, []);
});

// Small deterministic hook runtime: exercises effect cleanup and query navigation
// without a browser, network account, or sending Teams messages.
function runtime(query, queries = {}, options = {}) {
  const slots = []; let cursor = 0; let pending = []; let component; let props; let tree;
  const nodes = new Map(); const calls = { focus: 0, scroll: 0, replace: [] };
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const React = {
    useState(initial) { const i = cursor++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; },
    useRef(initial) { const i = cursor++; if (!slots[i]) slots[i] = { current: initial }; return slots[i]; },
    useEffect(effect, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) {
      const old = slots[i]; slots[i] = { deps, cleanup: old?.cleanup };
      pending.push(() => { old?.cleanup?.(); slots[i].cleanup = effect(); });
    } },
    useCallback(callback) { cursor++; return callback; },
  };
  let search = new URLSearchParams(query);
  const router = { replace: url => { calls.replace.push(url); search = new URLSearchParams(url.split('?')[1] ?? ''); } };
  const walk = (value, cb) => { if (!value || typeof value !== 'object') return; if (Array.isArray(value)) return value.forEach(v => walk(v, cb));
    cb(value); walk(value.props?.children, cb); };
  const lib = load(options.modulePath ?? 'src/components/me/NoteDrawer.tsx', {
    react: React, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'next/navigation': { useSearchParams: () => search, usePathname: () => '/product', useRouter: () => router },
    '@/lib/queries-me': { fetchNotesForEntity: async () => [], fetchNoteForEntity: async () => null, ...queries },
    '@/lib/supabase/client': { supabaseBrowser: () => ({ auth: { getUser: async () => ({ data: { user: { id: uid } } }) } }) },
    './MentionAutocomplete': () => null, '../ui/icons': { IcX: () => null }, '@/lib/format': { fmtDateTime: x => x },
    '@/lib/teams/mentions': { selectedMentionIds: () => [], moveMentionRanges: (_, __, ranges) => ranges },
    ...options.mocks,
  });
  const render = (nextComponent = component, nextProps = props) => {
    component = nextComponent; props = nextProps; cursor = 0; tree = component(props);
    walk(tree, value => { const ref = value.props?.ref; if (ref) {
      const id = value.props['data-note-id'] ?? 'textarea';
      if (!nodes.has(id)) nodes.set(id, { focus: () => calls.focus++, scrollIntoView: () => calls.scroll++ });
      ref.current = nodes.get(id);
    } });
    const effects = pending; pending = []; effects.forEach(effect => effect());
    return tree;
  };
  return { lib, calls, render, navigate: value => { search = new URLSearchParams(value); },
    async settle() { for (let i = 0; i < 5; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } },
    elements() { const elements = []; walk(tree, value => elements.push(value)); return elements; } };
}
function drawerProps(entity_id = entityId) { return { entity_type: 'product', entity_id, open: true, onClose: () => {} }; }
async function withFetch(run) { const old = global.fetch; global.fetch = async () => Response.json({ available: false });
  try { await run(); } finally { global.fetch = old; } }

test('a target older than the latest 50 is included, highlighted and focused once', () => withFetch(async () => {
  let exactCalls = 0;
  const recent = Array.from({ length: 50 }, (_, i) => note(`recent-${i}`));
  const rt = runtime(`no=42&notes=open&note=${targetId}`, { fetchNotesForEntity: async () => recent,
    fetchNoteForEntity: async (id, type, entity) => { exactCalls++; assert.deepEqual([id, type, entity], [targetId, 'product', entityId]); return note(); } });
  rt.render(rt.lib.default, drawerProps()); await rt.settle();
  assert.equal(exactCalls, 1);
  const cards = rt.elements().filter(el => el.props?.['data-note-id']);
  assert.equal(cards.length, 51);
  assert.equal(cards.find(el => el.props['data-note-id'] === targetId).props['data-note-target'], 'true');
  assert.equal(rt.calls.focus, 1); assert.equal(rt.calls.scroll, 1);
  await rt.settle(); assert.equal(rt.calls.focus, 1);
}));
test('target already present needs no second lookup; unavailable targets show one non-disclosing message', () => withFetch(async () => {
  const present = runtime(`note=${targetId}`, { fetchNotesForEntity: async () => [note()], fetchNoteForEntity: async () => assert.fail('no extra read') });
  present.render(present.lib.default, drawerProps()); await present.settle(); assert.equal(present.calls.focus, 1);
  const missing = runtime(`note=${targetId}`); missing.render(missing.lib.default, drawerProps()); await missing.settle();
  assert(missing.elements().some(el => el.props?.role === 'status' && /삭제되었거나 열람 권한/.test(el.props.children)));
  assert.equal(missing.calls.focus, 0);
}));
test('stale entity response cannot replace the newly navigated memo list', () => withFetch(async () => {
  let resolveOld;
  const rt = runtime(`note=${targetId}`, { fetchNotesForEntity: async (_, entity) => entity === entityId
    ? await new Promise(resolve => { resolveOld = resolve; }) : [note(targetId, 'new-entity')],
  });
  rt.render(rt.lib.default, drawerProps());
  rt.render(rt.lib.default, drawerProps('new-entity')); await rt.settle();
  resolveOld([note('stale-note')]); await rt.settle();
  const cards = rt.elements().filter(el => el.props?.['data-note-id']);
  assert.deepEqual(cards.map(el => el.props['data-note-id']), [targetId]);
}));
test('close clears only source note flags and Back/Forward query navigation reopens', () => {
  const rt = runtime(`no=42&notes=open&note=${targetId}&view=price`);
  const hook = () => rt.lib.useSourceNoteDrawer('42');
  rt.render(hook); assert.equal(rt.render().noteDrawerOpen, true);
  rt.render().setNoteDrawerOpen(false); rt.render();
  assert.equal(rt.render().noteDrawerOpen, false);
  assert.equal(rt.calls.replace[0], '/product?no=42&view=price');
  rt.render(); assert.equal(rt.render().noteDrawerOpen, false);
  rt.navigate(`no=42&notes=open&note=${targetId}`); rt.render();
  assert.equal(rt.render().noteDrawerOpen, true);
  rt.navigate('no=99'); rt.render(); assert.equal(rt.render().noteDrawerOpen, false);
});
test('desktop and mobile source detail pages all connect memo navigation and deleted-source fallback', () => {
  for (const [entity, mobile] of [['product', 'MobileProductDetailView'], ['brand', 'MobileBrandDetailView'], ['company', 'MobileCompanyDetailView']]) {
    for (const file of ['page.tsx', `${mobile}.tsx`]) {
      const source = fs.readFileSync(path.join(__dirname, `../src/app/(app)/${entity}/${file}`), 'utf8');
      assert.match(source, /useSourceNoteDrawer\(/);
      assert.match(source, /<NoteDrawer/);
      assert.match(source, /<SourceNoteFallback\s*\/>/);
    }
  }
});
test('source context migration is additive and does not change auth, RLS or dispatch state', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/01508_note_source_context.sql'), 'utf8').replace(/--[^\n]*/g, '');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS source_context jsonb/i);
  assert.match(sql, /source_context IS NULL/i);
  assert.match(sql, /jsonb_typeof\(source_context\) = 'object'/);
  assert.match(sql, /octet_length\(source_context::text\) <= 8192/);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|INSERT|GRANT|REVOKE|POLICY|TRIGGER|FUNCTION)\b/i);
});

for (const [kind, mobile, parameter] of [['product', 'MobileProductDetailView', 'no'], ['brand', 'MobileBrandDetailView', 'id'], ['company', 'MobileCompanyDetailView', 'id']]) {
  test(`mobile ${kind} clears previous source on a failed navigation`, async () => {
    const DrawerStub = () => null;
    const current = { id: entityId, musinsa_no: 42, name: 'Source A', corp_name: 'Source A', final_price: null, original_price: null, ranking_best_records: [], item_seasons: [], labels: [], colors: [], sizes: [] };
    const info = async id => { if (id === '42') return current; throw new Error('unavailable'); };
    const empty = async () => [];
    const rt = runtime(`${parameter}=42&note=${targetId}`, {}, {
      modulePath: `src/app/(app)/${kind}/${mobile}.tsx`,
      mocks: {
        '@/lib/observation-review-context': { useObservationReviewState: () => null },
        // This tiny runtime tests note navigation; shared read races use real React in product-category tests.
        '@/lib/use-product-category-ranks': { useProductCategoryRanks: () => ({ status: 'loading', data: null, retry() { assert.fail('unexpected category retry'); } }) },
        '@/components/product/ProductReviewMode': { __esModule: true, default: ({ children }) => children },
        '@/lib/queries': { fetchProductDetail: info, fetchProductHistories:async()=>({price:[],rank:[]}),fetchProductPriceHistory: empty, fetchProductRankHistory: empty,
          fetchProductCategoryRanks: async () => ({ rows: [], snapshot_date: '' }), fetchReviews: async () => ({ rows: [] }),
          fetchBrandInfo: info, fetchBrandStats: async () => ({ skuCount: 0 }), fetchBrandProducts: empty,
          fetchBrandRankHistory: empty, fetchBrandRankingDistribution: empty,
          fetchCompanyInfo: info, fetchCompanyBrands: empty, fetchCompanyFinancials: empty,
          fetchCompanyDisclosures: empty, fetchChildCompanies: empty, CATEGORY_MAP: {}, AGE_MAP: {} },
        '@/lib/queries-funding': { getFundingRounds: empty },
        '@/components/uttu/use-funding-rounds': { useFundingRounds: () => ({ rounds: [], loaded: true, loading: false, error: false, signedOut: false, refresh: empty, refreshAfterJob: empty }) },
        '@/components/me/NoteDrawer': { __esModule: true, default: DrawerStub,
          useSourceNoteDrawer: () => ({ noteDrawerOpen: true, setNoteDrawerOpen() {} }), SourceNoteFallback: () => null },
        '@/components/mobile/MobileEmptyState': () => null, '@/components/mobile/ReviewDetailSheet': () => null,
        '@/components/mobile/MobileFilterChips': () => null,
        '@/components/uttu/funding-collect-button': { FundingCollectButton: () => null },
        '@/components/uttu/funding-timeline': { FundingTimeline: () => null }, '@/components/uttu/funding-brief': { FundingBrief: () => null },
        recharts: {},
      },
    });
    rt.render(rt.lib.default, {}); await rt.settle();
    assert.equal(rt.elements().find(el => el.type === DrawerStub)?.props.entity_id, kind === 'product' ? entityId : '42');
    rt.navigate(`${parameter}=43&note=${targetId}`); rt.render(); await rt.settle();
    assert.equal(rt.elements().find(el => el.type === DrawerStub), undefined);
    assert(rt.elements().some(el => /정보를 찾을 수 없습니다/.test(el.props?.title)));
  });
}
for (const mobile of [false, true]) test(`${mobile ? 'mobile' : 'desktop'} loading and failed navigation preserve deleted-source fallback without a composer`, async () => {
  const React = require('react'), Renderer = require('react-test-renderer');
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const saved = { window: global.window, fetch: global.fetch, document: global.document, error: console.error };
  global.window = { matchMedia: () => ({ matches: mobile, addEventListener() {}, removeEventListener() {} }), dispatchEvent() {} };
  global.document = { activeElement: null };
  global.fetch = () => { throw Error('live network forbidden'); };
  const detailReads = new Map(), errors = [];
  console.error = error => errors.push(error);
  let query = 'no=42';
  const snapshot = { musinsa_no: 42, name: 'Saved snapshot', brand_name: 'Saved brand', is_own: false,
    final_price: 1000, list_price: 1000, review_count: 0, rating: null, ranking_best_records: [], item_seasons: [], labels: [], colors: [], sizes: [] };
  const hidden = { __esModule: true, default: () => null };
  const Fallback = () => React.createElement('aside', { 'data-source-fallback': true }, '기존 메모 확인');
  const Drawer = props => React.createElement('aside', { 'data-note-composer': props.entity_id });
  const Component = load(mobile ? 'src/app/(app)/product/MobileProductDetailView.tsx' : 'src/app/(app)/product/page.tsx', {
    '@/lib/queries': { CATEGORY_MAP: {}, AGE_MAP: {},
      fetchProductDetail: no => new Promise((resolve, reject) => detailReads.set(no, { resolve, reject })),
      fetchProductHistories: async () => ({ price: [], rank: [] }),
      fetchProductCategoryRanks: () => new Promise(() => {}), fetchReviews: async () => ({ rows: [], total: 0 }) },
    '@/lib/supabase/client': { supabaseBrowser: () => ({ auth: {
      getUser: async () => ({ data: { user: { id: uid } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) },
    '@/lib/queries-me': { fetchNoteCountForEntity: async () => 0, logView: async () => {} },
    '@/lib/observation-review-context': { useObservationReviewState: () => null },
    'next/navigation': { useSearchParams: () => new URLSearchParams(query), useRouter: () => ({ push() {} }) },
    'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/components/product/ProductObservationPanel': hidden,
    '@/components/me/BookmarkToggle': hidden, '@/components/mobile/ReviewDetailSheet': hidden,
    '@/components/me/NoteDrawer': { __esModule: true, default: Drawer, SourceNoteFallback: Fallback,
      useSourceNoteDrawer: () => ({ noteDrawerOpen: true, setNoteDrawerOpen() {} }) },
    recharts: Object.fromEntries(['LineChart', 'Line', 'XAxis', 'YAxis', 'Tooltip', 'ResponsiveContainer', 'ReferenceDot'].map(name => [name, () => null])),
  }).default;
  let root;
  const fallbackCount = () => root.root.findAll(node => node.type === 'aside' && node.props['data-source-fallback']).length;
  const composerCount = () => root.root.findAll(node => node.type === 'aside' && node.props['data-note-composer']).length;
  const memoControls = () => root.root.findAllByType('button').filter(button => /메모/.test(button.children.filter(child => typeof child === 'string').join(''))).length;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(Component)); });
    assert.equal(fallbackCount(), 0, 'pending identity must not look deleted');
    assert.equal(composerCount(), 0);
    await React.act(async () => detailReads.get('42').resolve({ ...snapshot, id: entityId }));
    assert.equal(composerCount(), 1, 'resolved source still connects its memo drawer');
    assert.equal(fallbackCount(), 0);
    assert.ok(memoControls() > 0);
    query = 'no=43';
    await React.act(async () => root.update(React.createElement(Component)));
    assert.equal(composerCount(), 0, 'old source cannot compose after navigation');
    assert.equal(fallbackCount(), 0, 'pending next identity must not look deleted');
    await React.act(async () => detailReads.get('43').resolve({ ...snapshot, musinsa_no: 43 }));
    assert.equal(fallbackCount(), 1, 'snapshot with no product ID still offers existing memo');
    assert.equal(composerCount(), 0);
    assert.equal(memoControls(), 0, 'snapshot cannot open a nonfunctional composer');
    assert.ok(JSON.stringify(root.toJSON()).includes('Saved snapshot'), 'category delay does not hide saved source');
    query = 'no=44';
    await React.act(async () => root.update(React.createElement(Component)));
    assert.equal(fallbackCount(), 0, 'previous fallback is hidden during next identity read');
    await React.act(async () => detailReads.get('44').reject(Error('source unavailable')));
    assert.equal(fallbackCount(), 1, 'failed detail still permits existing memo lookup');
    assert.equal(composerCount(), 0);
    assert.equal(memoControls(), 0);
    assert.ok(!JSON.stringify(root.toJSON()).includes('Saved snapshot'), 'failed navigation clears previous source');
    assert.equal(errors.filter(error => error instanceof Error && error.message === 'source unavailable').length, mobile ? 0 : 1);
  } finally {
    if (root) await React.act(async () => root.unmount());
    console.error = saved.error;
    for (const key of ['window', 'fetch', 'document']) { if (saved[key] === undefined) delete global[key]; else global[key] = saved[key]; }
  }
});
test('blocked source snapshot disables new-save control but leaves exact memo readable', () => withFetch(async () => {
  const rt = runtime(`note=${targetId}`, { fetchNotesForEntity: async () => [note()], createNote: () => assert.fail('must not save') });
  rt.render(rt.lib.default, { ...drawerProps(), saveBlockedReason: '화면 정보를 불러오는 중입니다.' }); await rt.settle();
  assert.equal(rt.calls.focus, 1);
  assert(rt.elements().some(el => el.props?.role === 'status' && el.props.children === '화면 정보를 불러오는 중입니다.'));
  const save = rt.elements().find(el => el.type === 'button' && el.props.children === '저장');
  assert.equal(save.props.disabled, true);
  await save.props.onClick();
}));

test('drawer retries share one submission ID only while source snapshot is unchanged', () => withFetch(async () => {
  const submissions = [];
  const rt = runtime('no=42', { createNote: async input => { submissions.push(input); return { data: null, error: 'uncertain' }; } });
  const context = { version: 1, kind: 'ranking', period: 'today', fromDate: '', toDate: '', selectedCategory: '000',
    gender: 'A', age: 'AGE_BAND_ALL', price: [0, 50], companies: [], brands: [], ownOnly: false,
    moverOnly: false, sort: 'rank', sortDir: 'asc', page: 1 };
  const props = { ...drawerProps(), sourceContext: context };
  rt.render(rt.lib.default, props); await rt.settle();
  const textarea = rt.elements().find(el => el.type === 'textarea' && el.props.placeholder);
  textarea.props.onChange({ target: { value: '새 메모', selectionStart: 4 } });
  rt.render();
  const save = () => rt.elements().find(el => el.type === 'button' && el.props.children === '저장').props.onClick();
  await save(); rt.render(); await save(); rt.render();
  assert.equal(submissions.length, 2);
  assert.equal(submissions[0].submission_id, submissions[1].submission_id);
  assert.deepEqual(submissions[0].source_context, context);
  rt.render(rt.lib.default, { ...props, sourceContext: { ...context, page: 2 } });
  await save();
  assert.equal(submissions.length, 3);
  assert.notEqual(submissions[1].submission_id, submissions[2].submission_id);
  assert.equal(submissions[2].source_context.page, 2);
}));
