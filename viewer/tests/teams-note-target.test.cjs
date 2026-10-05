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
        '@/components/product/ProductReviewMode': { __esModule: true, default: ({ children }) => children },
        '@/lib/queries': { fetchProductDetail: info, fetchProductPriceHistory: empty, fetchProductRankHistory: empty,
          fetchProductCategoryRanks: async () => ({ rows: [], snapshot_date: '' }), fetchReviews: async () => ({ rows: [] }),
          fetchBrandInfo: info, fetchBrandStats: async () => ({ skuCount: 0 }), fetchBrandProducts: empty,
          fetchBrandRankHistory: empty, fetchBrandRankingDistribution: empty,
          fetchCompanyInfo: info, fetchCompanyBrands: empty, fetchCompanyFinancials: empty,
          fetchCompanyDisclosures: empty, fetchChildCompanies: empty, CATEGORY_MAP: {}, AGE_MAP: {} },
        '@/lib/queries-funding': { getFundingRounds: empty },
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
test('snapshot-only deleted products offer memo fallback without a nonfunctional composer', () => {
  const desktop = fs.readFileSync(path.join(__dirname, '../src/app/(app)/product/page.tsx'), 'utf8');
  const mobile = fs.readFileSync(path.join(__dirname, '../src/app/(app)/product/MobileProductDetailView.tsx'), 'utf8');
  assert.match(desktop, /!loading && !detail\?\.id[\s\S]*?<SourceNoteFallback/);
  assert.match(mobile, /!detail\.id && <SourceNoteFallback/);
  assert.match(mobile, /detail\.id && <NoteDrawer/);
  assert.match(mobile, /detail\.id && <button[^>]*[\s\S]*?>메모/);
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
