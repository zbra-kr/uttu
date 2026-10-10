const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const load = require('./helpers/load-source.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
global.sessionStorage = { getItem: () => null, setItem: () => {} };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const row = id => ({ id: `relation-${id}`, own_brand_id: id, brand_id: `competitor-${id}`, brand_name: `pool-${id}`, added_at: '2026-10-10' });
const brand = id => ({ id, name: `brand-${id}` });
const result = id => ({ id, name: `search-${id}` });
const content = n => typeof n === 'string' ? n : Array.isArray(n) ? n.map(content).join('') : n?.children ? content(n.children) : '';
async function setup(overrides = {}, options = {}) {
  const calls = [], reads = [], searches = [];
  let listener;
  const setters = [];
  const trackedReact = { ...React, useState(initial) { const [value, setter] = React.useState(initial); return [value, (...args) => { setters.push(args); setter(...args); }]; } };
  const queries = { CATEGORY_MAP: {}, fetchOwnBrands: async () => [brand('A'), brand('B')],
    fetchCompetitorBrands: async id => { reads.push(id); return [row(id)]; },
    searchBrandsForPool: async kw => { searches.push(kw); return [result(kw)]; },
    addCompetitorBrand: async (...args) => { calls.push(['add', ...args]); },
    removeCompetitorBrand: async (...args) => { calls.push(['remove', ...args]); }, ...overrides };
  const auth = { onAuthStateChange(cb) { listener = cb; queueMicrotask(() => cb('INITIAL_SESSION', { user: { id: 'account-1' } })); return { data: { subscription: { unsubscribe() {} } } }; } };
  const { default: Page } = load('src/app/(app)/matching/page.tsx', {
    ...(options.trackSetters ? { react: trackedReact } : {}),
    '@/hooks/useViewport': { useIsMobile: () => false }, '@/lib/queries': queries,
    '@/lib/supabase/client': { supabaseBrowser: () => ({ auth }) },
    'next/link': ({ children, ...props }) => React.createElement('a', props, children),
  });
  let renderer;
  await act(async () => { renderer = create(options.strict ? React.createElement(React.StrictMode, null, React.createElement(Page)) : React.createElement(Page)); });
  const button = text => renderer.root.findAllByType('button').find(n => content(n) === text);
  const select = id => act(async () => { button(`brand-${id}`).props.onClick(); });
  const keyword = kw => act(async () => { renderer.root.findByProps({ placeholder: '브랜드 검색…' }).props.onChange({ target: { value: kw } }); });
  const debounce = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 330)); });
  return { renderer, calls, reads, searches, setters, button, select, keyword, debounce,
    text: () => content(renderer.toJSON()), close: () => act(async () => renderer.unmount()),
    auth: (session, event = 'SIGNED_IN') => act(async () => listener(event, session)),
    remove: () => renderer.root.findAllByType('button').find(n => n.props.title === '풀에서 제거') };
}
test('late A pool cannot overwrite B or expose relation-A removal', async () => {
  const pending = deferred();
  const h = await setup({ fetchCompetitorBrands: id => id === 'A' ? pending.promise : Promise.resolve([row('B')]) });
  try {
    await h.select('B'); await act(async () => pending.resolve([row('A')]));
    assert.match(h.text(), /pool-B/); assert.doesNotMatch(h.text(), /pool-A/);
    await act(async () => h.remove().props.onClick());
    assert.deepEqual(h.calls, [['remove', 'relation-B']]);
  } finally { await h.close(); }
});
test('B failure clears A rows and shows failure rather than normal empty', async () => {
  const h = await setup({ fetchCompetitorBrands: async id => { if (id === 'B') throw new Error('private failure'); return [row(id)]; } });
  try {
    await h.select('B'); assert.doesNotMatch(h.text(), /pool-A|private failure|등록된 경쟁 브랜드가 없습니다/);
    assert.ok(h.renderer.root.findAllByProps({ role: 'alert' }).length); assert.equal(h.remove(), undefined);
  } finally { await h.close(); }
});
test('late old search cannot overwrite new results', async () => {
  const pending = deferred();
  const h = await setup({ searchBrandsForPool: kw => kw === 'old' ? pending.promise : Promise.resolve([result('new')]) });
  try {
    await h.keyword('old'); await h.debounce(); await h.keyword('new'); await h.debounce();
    await act(async () => pending.resolve([result('old')]));
    assert.match(h.text(), /search-new/); assert.doesNotMatch(h.text(), /search-old/);
  } finally { await h.close(); }
});
for (const fail of [false, true]) {
  test(`A→B→A ignores old pool ${fail ? 'failure' : 'success'} including count and retained remove`, async () => {
    const old = deferred(), fresh = deferred(); let a = 0;
    const h = await setup({ fetchCompetitorBrands: id => id === 'B' ? Promise.resolve([row('B')]) : ++a === 1 ? old.promise : fresh.promise });
    try {
      await h.select('B'); const staleRemove = h.remove().props.onClick;
      await h.select('A'); assert.doesNotMatch(h.text(), /pool-B|1개/); assert.equal(h.remove(), undefined);
      await act(async () => staleRemove()); assert.deepEqual(h.calls, []);
      await act(async () => fail ? old.reject(new Error('old error')) : old.resolve([row('A-old')]));
      assert.match(h.text(), /불러오는 중/); assert.doesNotMatch(h.text(), /pool-A-old|1개|불러오지 못/);
      await act(async () => fresh.resolve([row('A')])); assert.match(h.text(), /pool-A/);
      await act(async () => h.remove().props.onClick()); assert.deepEqual(h.calls, [['remove', 'relation-A']]);
    } finally { await h.close(); }
  });
  test(`keyword change invalidates late ${fail ? 'error' : 'success'} before debounce`, async () => {
    const old = deferred();
    const h = await setup({ searchBrandsForPool: kw => kw === 'old' ? old.promise : Promise.resolve([result(kw)]) });
    try {
      await h.keyword('old'); await h.debounce(); await h.keyword('new');
      await act(async () => fail ? old.reject(new Error('old error')) : old.resolve([result('old')]));
      assert.match(h.text(), /검색 중/); assert.doesNotMatch(h.text(), /search-old|불러오지 못/);
      await h.debounce(); assert.match(h.text(), /search-new/);
    } finally { await h.close(); }
  });
  test(`clearing search suppresses pending ${fail ? 'error' : 'success'} and loading`, async () => {
    const old = deferred(); const h = await setup({ searchBrandsForPool: () => old.promise });
    try {
      await h.keyword('old'); await h.debounce(); await h.keyword('');
      await act(async () => fail ? old.reject(new Error('old')) : old.resolve([result('old')]));
      assert.doesNotMatch(h.text(), /search-old|검색 중|불러오지 못|해당하는 브랜드/);
    } finally { await h.close(); }
  });
}
test('rendered A row is removed synchronously on B selection and retained A remove cannot dispatch', async () => {
  const b = deferred(); const h = await setup({ fetchCompetitorBrands: id => id === 'A' ? Promise.resolve([row('A')]) : b.promise });
  try {
    const oldRemove = h.remove().props.onClick;
    await act(async () => { h.button('brand-B').props.onClick(); oldRemove(); });
    assert.deepEqual(h.calls, []); assert.equal(h.remove(), undefined); assert.doesNotMatch(h.text(), /pool-A|1개/);
    await act(async () => b.resolve([])); assert.match(h.text(), /등록된 경쟁 브랜드가 없습니다/); assert.match(h.text(), /0개/);
  } finally { await h.close(); }
});
test('same-tick B→A switch starts fresh A read; selecting current A does not erase it', async () => {
  const h = await setup();
  try {
    await act(async () => { h.button('brand-B').props.onClick(); h.button('brand-A').props.onClick(); });
    assert.match(h.text(), /pool-A/); assert.deepEqual(h.reads, ['A', 'A']);
    await h.select('A'); assert.match(h.text(), /pool-A/); assert.deepEqual(h.reads, ['A', 'A']);
  } finally { await h.close(); }
});
test('retained search add cannot dispatch after keyword change or brand change', async () => {
  const h = await setup();
  try {
    await h.keyword('old'); await h.debounce(); const oldAdd = h.button(' 추가').props.onClick;
    await act(async () => { h.renderer.root.findByProps({ placeholder: '브랜드 검색…' }).props.onChange({ target: { value: 'new' } }); oldAdd(); });
    assert.deepEqual(h.calls, []); assert.doesNotMatch(h.text(), /search-old/);
    await h.debounce(); const newAdd = h.button(' 추가').props.onClick;
    await act(async () => { h.button('brand-B').props.onClick(); newAdd(); });
    assert.deepEqual(h.calls, []); assert.doesNotMatch(h.text(), /search-new/);
  } finally { await h.close(); }
});
for (const stage of ['brands', 'pool', 'search']) {
  test(`${stage} failure is explicit, sanitized, never retried automatically; current-target retry succeeds`, async () => {
    let attempts = 0; const seen = [];
    const read = async arg => { attempts++; seen.push(arg); if (attempts === 1) throw new Error('secret-detail'); return stage === 'brands' ? [brand('A'), brand('B')] : stage === 'pool' ? [row(arg)] : [result(arg)]; };
    const h = await setup({ [stage === 'brands' ? 'fetchOwnBrands' : stage === 'pool' ? 'fetchCompetitorBrands' : 'searchBrandsForPool']: read });
    try {
      if (stage === 'search') { await h.keyword('new'); await h.debounce(); }
      assert.equal(attempts, 1); assert.ok(h.renderer.root.findAllByProps({ role: 'alert' }).length);
      assert.doesNotMatch(h.text(), /secret-detail|등록된 경쟁 브랜드가 없습니다|해당하는 브랜드가 없습니다/);
      const label = { brands: '자사 브랜드 다시 시도', pool: '풀 다시 시도', search: '검색 다시 시도' }[stage];
      await act(async () => h.button(label).props.onClick()); if (stage === 'search') await h.debounce();
      assert.equal(attempts, 2); assert.equal(h.renderer.root.findAllByProps({ role: 'alert' }).length, 0);
      assert.match(h.text(), stage === 'search' ? /search-new/ : /pool-A/);
      if (stage !== 'brands') assert.deepEqual(seen, stage === 'pool' ? ['A', 'A'] : ['new', 'new']);
    } finally { await h.close(); }
  });
  for (const invalid of [null, {}, [null], stage === 'pool' ? [row('wrong')] : [{ id: 'bad' }]]) {
    test(`${stage} invalid response ${JSON.stringify(invalid)} is failure, not empty`, async () => {
      const h = await setup({ [stage === 'brands' ? 'fetchOwnBrands' : stage === 'pool' ? 'fetchCompetitorBrands' : 'searchBrandsForPool']: async () => invalid });
      try {
        if (stage === 'search') { await h.keyword('invalid'); await h.debounce(); }
        assert.ok(h.renderer.root.findAllByProps({ role: 'alert' }).length); if (stage !== 'search') assert.equal(h.remove(), undefined);
        assert.doesNotMatch(h.text(), /등록된 경쟁 브랜드가 없습니다|해당하는 브랜드가 없습니다/);
      } finally { await h.close(); }
    });
  }
}
for (const action of ['add', 'remove']) {
  for (const fail of [false, true]) {
    test(`${action} completion ${fail ? 'failure' : 'success'} after B switch never reads A or changes B`, async () => {
      const pending = deferred(); const calls = [], reads = [];
      const h = await setup({ fetchCompetitorBrands: async id => { reads.push(id); return [row(id)]; },
        [action === 'add' ? 'addCompetitorBrand' : 'removeCompetitorBrand']: (...args) => { calls.push(args); return pending.promise; } });
      try {
        let click;
        if (action === 'add') { await h.keyword('new'); await h.debounce(); click = h.button(' 추가').props.onClick; } else click = h.remove().props.onClick;
        await act(async () => { click(); click(); }); assert.equal(calls.length, 1);
        await h.select('B'); assert.match(h.text(), /pool-B/); assert.doesNotMatch(h.text(), /pool-A/);
        await act(async () => fail ? pending.reject(new Error('private-action')) : pending.resolve());
        assert.deepEqual(reads, ['A', 'B']); assert.match(h.text(), /pool-B/); assert.doesNotMatch(h.text(), /pool-A|못했습니다|private-action/);
        assert.equal(h.remove().props.disabled, false);
      } finally { await h.close(); }
    });
  }
  test(`${action} completion on current A refreshes A and a failed refresh exposes retry without mutation replay`, async () => {
    let reads = 0, writes = 0;
    const h = await setup({ fetchCompetitorBrands: async id => { if (++reads === 2) throw new Error('refresh'); return [row(id)]; },
      [action === 'add' ? 'addCompetitorBrand' : 'removeCompetitorBrand']: async () => { writes++; } });
    try {
      if (action === 'add') { await h.keyword('new'); await h.debounce(); }
      await act(async () => { (action === 'add' ? h.button(' 추가') : h.remove()).props.onClick(); });
      assert.equal(writes, 1); assert.equal(reads, 2); assert.equal(h.remove(), undefined); assert.doesNotMatch(h.text(), /pool-A|1개/);
      assert.ok(h.renderer.root.findAllByProps({ role: 'alert' }).length);
      await act(async () => h.button('풀 다시 시도').props.onClick()); assert.equal(writes, 1); assert.equal(reads, 3); assert.match(h.text(), /pool-A/);
    } finally { await h.close(); }
  });
  test(`${action} success during A→B→A reconciles fresh A and invalidates pending reselection read`, async () => {
    const mutation = deferred(), oldRead = deferred(); let a = 0;
    const h = await setup({ fetchCompetitorBrands: id => id === 'B' ? Promise.resolve([row('B')]) : ++a === 2 ? oldRead.promise : Promise.resolve([row('A')]),
      [action === 'add' ? 'addCompetitorBrand' : 'removeCompetitorBrand']: () => mutation.promise });
    try {
      if (action === 'add') { await h.keyword('new'); await h.debounce(); }
      await act(async () => { (action === 'add' ? h.button(' 추가') : h.remove()).props.onClick(); });
      await h.select('B'); await h.select('A'); assert.doesNotMatch(h.text(), /pool-B|1개/);
      await act(async () => mutation.resolve()); assert.equal(a, 3); assert.match(h.text(), /pool-A/);
      await act(async () => oldRead.resolve([row('A-stale')])); assert.doesNotMatch(h.text(), /pool-A-stale/);
    } finally { await h.close(); }
  });
  test(`${action} failure on current target shows sanitized action error without retrying write`, async () => {
    let writes = 0; const h = await setup({ [action === 'add' ? 'addCompetitorBrand' : 'removeCompetitorBrand']: async () => { writes++; throw new Error('secret-action'); } });
    try {
      if (action === 'add') { await h.keyword('new'); await h.debounce(); }
      await act(async () => { (action === 'add' ? h.button(' 추가') : h.remove()).props.onClick(); });
      assert.equal(writes, 1); assert.match(h.text(), /못했습니다/); assert.doesNotMatch(h.text(), /secret-action/); assert.match(h.text(), /pool-A/);
    } finally { await h.close(); }
  });
}
for (const stage of ['brands', 'pool', 'search', 'add', 'remove', 'refresh']) {
  for (const fail of [false, true]) {
    test(`account A→B→A fences old ${stage} ${fail ? 'failure' : 'success'} and retained handlers`, async () => {
      const old = deferred(); let actor = 'old', reads = 0, brands = 0, writes = 0;
      const h = await setup({
        fetchOwnBrands: () => stage === 'brands' && ++brands === 1 ? old.promise : Promise.resolve([brand('A'), brand('B')]),
        fetchCompetitorBrands: () => (stage === 'pool' && ++reads === 1) || (stage === 'refresh' && ++reads === 2) ? old.promise : Promise.resolve([{ ...row('A'), brand_name: `pool-${actor}` }]),
        searchBrandsForPool: () => stage === 'search' ? old.promise : Promise.resolve([result('new')]),
        addCompetitorBrand: () => { writes++; return stage === 'add' ? old.promise : Promise.resolve(); },
        removeCompetitorBrand: () => { writes++; return stage === 'remove' ? old.promise : Promise.resolve(); },
      });
      try {
        let retained;
        if (['search', 'add'].includes(stage)) { await h.keyword('new'); await h.debounce(); }
        if (stage === 'add') { retained = h.button(' 추가').props.onClick; await act(async () => { retained(); }); }
        if (['remove', 'refresh'].includes(stage)) { retained = h.remove().props.onClick; await act(async () => { retained(); }); }
        actor = 'other'; await h.auth({ user: { id: 'account-2' } });
        assert.doesNotMatch(h.text(), /pool-old|search-new/);
        actor = 'current'; await h.auth({ user: { id: 'account-1' } });
        assert.match(h.text(), /pool-current/);
        if (retained) await act(async () => { retained(); });
        const before = writes;
        await act(async () => fail ? old.reject(new Error('stale-secret')) : old.resolve(stage === 'brands' ? [brand('stale')] : stage === 'search' ? [result('stale')] : stage === 'pool' || stage === 'refresh' ? [row('A-stale')] : undefined));
        assert.equal(writes, before); assert.match(h.text(), /pool-current/);
        assert.doesNotMatch(h.text(), /stale|pool-old|pool-other|못했습니다|search-new/);
        assert.equal(h.remove().props.disabled, false);
      } finally { await h.close(); }
    });
  }
}
test('signout clears brand, pool, count and search; signin reloads once; duplicate identity events do not reload', async () => {
  let brands = 0; const h = await setup({ fetchOwnBrands: async () => { brands++; return [brand('A'), brand('B')]; } });
  try {
    await h.keyword('new'); await h.debounce(); const remove = h.remove().props.onClick, add = h.button(' 추가').props.onClick;
    for (const event of ['TOKEN_REFRESHED', 'SIGNED_IN', 'INITIAL_SESSION']) await h.auth({ user: { id: 'account-1' } }, event);
    assert.equal(brands, 1); assert.deepEqual(h.reads, ['A']);
    await h.auth(null, 'SIGNED_OUT'); await act(async () => { remove(); add(); });
    assert.deepEqual(h.calls, []); assert.doesNotMatch(h.text(), /brand-A|pool-A|search-new|1개/); assert.match(h.text(), /로그인 후/);
    assert.equal(h.renderer.root.findByProps({ placeholder: '브랜드 검색…' }).props.disabled, true);
    await h.auth(null, 'SIGNED_OUT'); assert.equal(brands, 1);
    await h.auth({ user: { id: 'account-1' } }); assert.equal(brands, 2); assert.match(h.text(), /pool-A/);
  } finally { await h.close(); }
});
for (const stage of ['brands', 'pool', 'search', 'add', 'remove', 'refresh']) {
  for (const fail of [false, true]) {
    test(`unmount during ${stage} ${fail ? 'failure' : 'success'} performs zero setters and no followup reads`, async () => {
      const pending = deferred(); let reads = 0;
      const h = await setup({ fetchOwnBrands: () => stage === 'brands' ? pending.promise : Promise.resolve([brand('A')]),
        fetchCompetitorBrands: () => { reads++; return stage === 'pool' || stage === 'refresh' && reads === 2 ? pending.promise : Promise.resolve([row('A')]); },
        searchBrandsForPool: () => stage === 'search' ? pending.promise : Promise.resolve([result('new')]),
        addCompetitorBrand: () => pending.promise, removeCompetitorBrand: () => stage === 'refresh' ? Promise.resolve() : pending.promise,
      }, { trackSetters: true });
      if (['search', 'add'].includes(stage)) { await h.keyword('new'); await h.debounce(); }
      if (stage === 'add') await act(async () => { h.button(' 추가').props.onClick(); });
      if (['remove', 'refresh'].includes(stage)) await act(async () => { h.remove().props.onClick(); });
      await h.close(); const setters = h.setters.length, count = reads;
      await act(async () => fail ? pending.reject(new Error('late')) : pending.resolve(stage === 'brands' ? [brand('A')] : stage === 'search' ? [result('new')] : ['pool', 'refresh'].includes(stage) ? [row('A')] : undefined));
      assert.equal(h.setters.length, setters); assert.equal(reads, count);
    });
  }
}
test('tab close cancels debounce and late pool/search completion; reopening uses new BrandPool scope', async () => {
  const pool = deferred(), search = deferred(); let reads = 0, searches = 0;
  const h = await setup({ fetchCompetitorBrands: () => ++reads === 1 ? pool.promise : Promise.resolve([row('A')]),
    searchBrandsForPool: () => { searches++; return search.promise; }, fetchOwnProductsWithPrices: async () => ({ rows: [], total: 0 }), fetchProductMatches: async () => [] });
  try {
    await h.keyword('old'); await h.debounce();
    await act(async () => h.button('상품 매칭').props.onClick());
    await act(async () => { pool.resolve([row('A-old')]); search.reject(new Error('old search')); });
    await act(async () => h.button('경쟁 브랜드 풀').props.onClick());
    assert.match(h.text(), /pool-A/); assert.doesNotMatch(h.text(), /pool-A-old|old search|못했습니다/);
    await h.keyword('never'); await act(async () => h.button('상품 매칭').props.onClick()); await h.debounce();
    assert.equal(searches, 1);
  } finally { await h.close(); }
});
test('StrictMode effect replay loads usable current pool and supports brand switch', async () => {
  const h = await setup({}, { strict: true });
  try { assert.match(h.text(), /pool-A/); await h.select('B'); assert.match(h.text(), /pool-B/); assert.doesNotMatch(h.text(), /pool-A/); }
  finally { await h.close(); }
});
test('stale pool/search retry handlers cannot restart a different brand or keyword', async () => {
  const pools = [], searches = [];
  const h = await setup({ fetchCompetitorBrands: async id => { pools.push(id); if (id === 'A') throw new Error('pool'); return [row(id)]; },
    searchBrandsForPool: async kw => { searches.push(kw); if (kw === 'old') throw new Error('search'); return [result(kw)]; } });
  try {
    const poolRetry = h.button('풀 다시 시도').props.onClick;
    await h.keyword('old'); await h.debounce(); const searchRetry = h.button('검색 다시 시도').props.onClick;
    await h.keyword('new'); await act(async () => searchRetry()); await h.debounce();
    assert.deepEqual(searches, ['old', 'new']);
    await h.select('B'); await act(async () => { poolRetry(); searchRetry(); });
    assert.deepEqual(pools, ['A', 'B']); assert.deepEqual(searches, ['old', 'new']); assert.match(h.text(), /pool-B/);
  } finally { await h.close(); }
});
test('normal empty search is distinct from failure and never dispatches an action', async () => {
  const h = await setup({ fetchCompetitorBrands: async () => [], searchBrandsForPool: async () => [] });
  try { await h.keyword('none'); await h.debounce(); assert.match(h.text(), /등록된 경쟁 브랜드가 없습니다/); assert.match(h.text(), /해당하는 브랜드가 없습니다/); assert.equal(h.renderer.root.findAllByProps({ role: 'alert' }).length, 0); assert.deepEqual(h.calls, []); }
  finally { await h.close(); }
});
test('single pending A addition cannot schedule an A refresh after B selection', async () => {
  const pending = deferred(), reads = [], writes = [];
  const h = await setup({ fetchCompetitorBrands: async id => { reads.push(id); return [row(id)]; },
    addCompetitorBrand: (...args) => { writes.push(args); return pending.promise; } });
  try {
    await h.keyword('new'); await h.debounce();
    await act(async () => { h.button(' 추가').props.onClick(); });
    await h.select('B'); await act(async () => pending.resolve());
    assert.deepEqual(writes, [['A', 'new']]); assert.deepEqual(reads, ['A', 'B']);
    assert.match(h.text(), /pool-B/); assert.doesNotMatch(h.text(), /pool-A/);
  } finally { await h.close(); }
});
for (const action of ['add', 'remove']) {
  for (const fail of [false, true]) {
    test(`${action} late refresh ${fail ? 'failure' : 'success'} cannot change selected B`, async () => {
      const refresh = deferred(); let aReads = 0;
      const h = await setup({ fetchCompetitorBrands: id => id === 'A' && ++aReads === 2 ? refresh.promise : Promise.resolve([row(id)]) });
      try {
        if (action === 'add') { await h.keyword('new'); await h.debounce(); }
        await act(async () => { (action === 'add' ? h.button(' 추가') : h.remove()).props.onClick(); });
        assert.equal(h.remove(), undefined); assert.doesNotMatch(h.text(), /pool-A|1개/);
        await h.select('B');
        await act(async () => fail ? refresh.reject(new Error('stale refresh')) : refresh.resolve([row('A')]));
        assert.match(h.text(), /pool-B/); assert.doesNotMatch(h.text(), /pool-A|못했습니다/);
        assert.equal(h.remove().props.disabled, false);
        await act(async () => h.remove().props.onClick());
        assert.deepEqual(h.calls.at(-1), ['remove', 'relation-B']);
      } finally { await h.close(); }
    });
  }
  test(`${action} successful current-target refresh reflects authoritative rows and count`, async () => {
    let rows = [row('A')];
    const h = await setup({ fetchCompetitorBrands: async () => structuredClone(rows),
      addCompetitorBrand: async (own, competitor) => { assert.equal(own, 'A'); assert.equal(competitor, 'new'); rows.push({ ...row('A-new'), own_brand_id: 'A' }); },
      removeCompetitorBrand: async relation => { rows = rows.filter(r => r.id !== relation); } });
    try {
      if (action === 'add') { await h.keyword('new'); await h.debounce(); }
      await act(async () => { (action === 'add' ? h.button(' 추가') : h.remove()).props.onClick(); });
      if (action === 'add') { assert.match(h.text(), /pool-A-new/); assert.match(h.text(), /2개/); }
      else { assert.doesNotMatch(h.text(), /pool-A/); assert.match(h.text(), /0개|등록된 경쟁 브랜드가 없습니다/); assert.equal(h.remove(), undefined); }
    } finally { await h.close(); }
  });
}
test('late old search failure after new success preserves new results and no error', async () => {
  const old = deferred(); const h = await setup({ searchBrandsForPool: kw => kw === 'old' ? old.promise : Promise.resolve([result('new')]) });
  try {
    await h.keyword('old'); await h.debounce(); await h.keyword('new'); await h.debounce();
    await act(async () => old.reject(new Error('old error')));
    assert.match(h.text(), /search-new/); assert.doesNotMatch(h.text(), /못했습니다|old error/);
  } finally { await h.close(); }
});
test('old account action completion cannot unlock or refresh new account pending action', async () => {
  const old = deferred(), fresh = deferred(); let actor = 'old', calls = 0, reads = 0;
  const h = await setup({ fetchCompetitorBrands: async () => { reads++; return [row('A')]; },
    removeCompetitorBrand: () => { calls++; return actor === 'old' ? old.promise : fresh.promise; } });
  try {
    await act(async () => { h.remove().props.onClick(); }); actor = 'fresh'; await h.auth({ user: { id: 'account-2' } });
    await act(async () => { h.remove().props.onClick(); }); assert.equal(calls, 2);
    const count = reads; await act(async () => old.resolve()); assert.equal(reads, count); assert.equal(h.remove().props.disabled, true);
    await act(async () => h.remove().props.onClick()); assert.equal(calls, 2);
    await act(async () => fresh.resolve()); assert.equal(reads, count + 1); assert.equal(h.remove().props.disabled, false);
  } finally { await h.close(); }
});
test('same-tick clear and retype restarts same keyword without exposing previous results', async () => {
  const h = await setup();
  try {
    await h.keyword('new'); await h.debounce();
    const input = h.renderer.root.findByProps({ placeholder: '브랜드 검색…' });
    await act(async () => { input.props.onChange({ target: { value: '' } }); input.props.onChange({ target: { value: 'new' } }); });
    assert.doesNotMatch(h.text(), /search-new/); assert.match(h.text(), /검색 중/);
    await h.debounce(); assert.match(h.text(), /search-new/); assert.deepEqual(h.searches, ['new', 'new']);
  } finally { await h.close(); }
});
for (const fail of [false, true]) {
  test(`brand switch invalidates pending search ${fail ? 'failure' : 'success'} even with same keyword`, async () => {
    const pending = deferred(); let searches = 0;
    const h = await setup({ searchBrandsForPool: () => ++searches === 1 ? pending.promise : Promise.resolve([result('B-result')]) });
    try {
      await h.keyword('same'); await h.debounce(); await h.select('B');
      assert.doesNotMatch(h.text(), /search-|검색 중/);
      await h.keyword('same'); await h.debounce();
      await act(async () => fail ? pending.reject(new Error('old A')) : pending.resolve([result('A-result')]));
      assert.match(h.text(), /pool-B|search-B-result/); assert.doesNotMatch(h.text(), /search-A-result|못했습니다|old A/);
      await act(async () => h.button(' 추가').props.onClick()); assert.deepEqual(h.calls, [['add', 'B', 'B-result']]);
    } finally { await h.close(); }
  });
}
