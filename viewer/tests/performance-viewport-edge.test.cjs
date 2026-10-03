const { readSource } = require('./performance-source.cjs');
// Independent assertions built on the frozen primary suite's fixture factory.
// This imports only its fixture definition, not its test cases. Production files are never edited.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const path = require('node:path');
const fixturePath = path.join(__dirname, 'performance-viewport.test.cjs');
const fixtureSource = fs.readFileSync(fixturePath, 'utf8');
const fixtureHash = crypto.createHash('sha256').update(fixtureSource).digest('hex');
let fixturePrefix = fixtureSource.slice(0, fixtureSource.indexOf('\n(async()=>{'));
assert.ok(fixturePrefix.includes('function createFixture('));
// Expose the actual-module loader and make browser globals absent for server-only tests.
fixturePrefix = fixturePrefix.replace("tab='dash'){", "tab='dash', server=false){");
fixturePrefix = fixturePrefix.replace('window:browser,document:', 'window:server?undefined:browser,document:');
fixturePrefix = fixturePrefix.replace('document:{addEventListener(){}', 'document:server?undefined:{addEventListener(){}');
fixturePrefix = fixturePrefix.replace('},localStorage,URLSearchParams', '},localStorage:server?undefined:localStorage,URLSearchParams');
fixturePrefix = fixturePrefix.replace('return{page,helpers,', 'return{load,browser,page,helpers,');
const fixtureModule = new Module(fixturePath, module);
fixtureModule.filename = fixturePath;
fixtureModule.paths = Module._nodeModulePaths(__dirname);
fixtureModule._compile(fixturePrefix + '\nmodule.exports={createFixture,mount,unmount,flush,React,Renderer,SSR};', fixturePath);
const { createFixture, mount, unmount, flush, React, Renderer, SSR } = fixtureModule.exports;
const { act } = Renderer;
const plain = value => JSON.parse(JSON.stringify(value));
const helperLedger = fixture => plain(fixture.helpers).map(x => ({ ...x, args: x.args.map(arg => { if (!arg || typeof arg !== 'object') return arg; const { signal, ...rest } = arg; return rest; }) }));
const dispatchLedger = fixture => plain(fixture.requests).map(x => ({ ...x, ops: x.ops.filter(op => op[0] !== 'abortSignal') }));
const beforeResolve = fixture => fixture.effects.slice(0, fixture.effects.indexOf('resolve-viewport'));
const rankingHelpers = fixture => fixture.helpers.filter(call => call.name === 'fetchLatestRanking');
const desktop = root => root.root.find(instance => instance.type.name === 'RankingDesktopView');
const results = [];
async function update(root, fixture, search) {
  fixture.setSearch(search);
  await act(async () => {
    root.update(React.createElement(React.Fragment, null, React.createElement(fixture.page)));
    await flush();
  });
}
async function withPair(route, mobile, search, tab, operation) {
  const baseline = createFixture('source', mobile, route, search, tab);
  const candidate = createFixture('viewport-candidate', mobile, route, search, tab);
  const a = await mount(baseline);
  const b = await mount(candidate);
  try { await operation(baseline, candidate, a, b); }
  finally { await unmount(a); await unmount(b); }
}
(async () => {
  for (const route of ['ranking', 'reviews']) {
    const server = createFixture('viewport-candidate', false, route, '', 'dash', true);
    const serverHTML = SSR.renderToString(React.createElement(server.page));
    const client = createFixture('viewport-candidate', true, route);
    const firstClientHTML = SSR.renderToString(React.createElement(client.page));
    assert.equal(serverHTML, firstClientHTML);
    assert.equal(server.helpers.length, 0);
    assert.equal(server.effects.length, 0);
    assert.equal((serverHTML.match(/role="status"/g) || []).length, 1);
    assert.match(serverHTML, /aria-live="polite"/);
    if (route === 'reviews') assert.match(serverHTML, /href="\/reviews\/weekly"/);
    results.push({ case: `${route}: browser-global-free SSR equals initial render markup`, classification: 'HTML parity only; not hydrateRoot or Next streaming hydration' });
  }

  for (const route of ['ranking', 'reviews']) {
    const fixture = createFixture('viewport-candidate', true, route);
    await act(async () => {
      const root = Renderer.create(React.createElement(fixture.page));
      root.unmount();
      await flush();
    });
    assert.deepEqual(fixture.effects, []);
    assert.deepEqual(fixture.helpers, []);
    assert.deepEqual(fixture.requests, []);
    assert.equal(fixture.listeners.size, 0);
    results.push({ case: `${route}: unmount before initial passive effects performs no viewport read, helper, or dispatch` });
  }

  await withPair('ranking', true, '', 'dash', async (a, b) => {
    assert.equal(a.rankingRequests(), 94);
    assert.equal(b.rankingRequests(), 3);
    assert.deepEqual(beforeResolve(a), ['fetch:fetchBrandOptions', 'fetch:fetchCompanyOptions', 'fetch:fetchLatestRanking']);
    assert.deepEqual(beforeResolve(b), []);
    results.push({ case: 'mobile 90-day child effects precede parent viewport resolution only in baseline', baselineEffects: a.effects, candidateEffects: b.effects, baselineRankingDispatches: 94, candidateRankingDispatches: 3 });
  });

  for (const mobile of [true, false]) {
    const a = createFixture('source', mobile);
    const b = createFixture('viewport-candidate', mobile);
    for (const fixture of [a, b]) fixture.storage.set('uttu-ranking-filters', JSON.stringify({ period: 'today' }));
    const ar = await mount(a), br = await mount(b);
    try {
      assert.equal(a.rankingRequests(), mobile ? 6 : 3);
      assert.equal(b.rankingRequests(), 3);
      if (!mobile) {
        assert.deepEqual(helperLedger(a), helperLedger(b));
        assert.deepEqual(dispatchLedger(a), dispatchLedger(b));
      }
      results.push({ case: `persisted latest-day ranking ${mobile ? 'mobile' : 'desktop'}`, baselineRankingDispatches: a.rankingRequests(), candidateRankingDispatches: b.rankingRequests() });
    } finally { await unmount(ar); await unmount(br); }
  }

  await withPair('ranking', false, '', 'dash', async (a, b) => {
    assert.deepEqual(helperLedger(a), helperLedger(b));
    assert.deepEqual(dispatchLedger(a), dispatchLedger(b));
    assert.equal(b.rankingRequests(), 91);
    results.push({ case: 'desktop 90-day helper arguments and dispatch operations unchanged', rankingDispatches: 91 });
  });

  for (const tab of ['dash', 'browse', 'product-browse', 'anomaly']) {
    await withPair('reviews', false, '', tab, async (a, b, ar, br) => {
      assert.deepEqual(helperLedger(a), helperLedger(b));
      assert.deepEqual(dispatchLedger(a), dispatchLedger(b));
      assert.deepEqual(plain(ar.toJSON()), plain(br.toJSON()));
      results.push({ case: `desktop reviews ${tab}: helper/dispatch/serialized settled host-tree parity`, queryDispatches: b.requests.length });
    });
  }

  const helperFixture = createFixture('viewport-candidate', true);
  const contextModule = helperFixture.load('source/ranking-context.ts');
  const contextA = { version: 1, kind: 'ranking', period: 'custom', fromDate: '2026-09-29', toDate: '2026-10-01', selectedCategory: '001', gender: 'F', age: 'AGE_BAND_25', price: [1, 20], companies: ['Example company'], brands: ['Fixture'], ownOnly: true, moverOnly: true, sort: 'rating', sortDir: 'desc', page: 3, resolvedFromDate: '2026-09-29', resolvedToDate: '2026-10-01' };
  const queryA = contextModule.rankingContextToSearchParams(contextA).toString();
  const noteId = '11111111-1111-4111-8111-111111111111';
  for (const search of [queryA, `${queryA}&note=${noteId}`, `${queryA}&notes=open`]) {
    await withPair('ranking', true, search, 'dash', async (a, b, ar, br) => {
      assert.deepEqual(plain(desktop(br).props.sourceContext), plain(contextModule.validateRankingSourceContext(contextA)));
      assert.equal(desktop(br).props.compact, true);
      assert.equal(desktop(br).props.sourceLink, true);
      assert.equal(br.root.findAll(x => x.type.name === 'MobileRankingView').length, 0);
      assert.equal(b.rankingRequests(), 4);
      assert.deepEqual(helperLedger(a), helperLedger(b));
      assert.deepEqual(dispatchLedger(a), dispatchLedger(b));
      assert.equal(b.storage.get('uttu-ranking-filters'), JSON.stringify({ period: '90d' }));
      results.push({ case: `modern valid source context ${search.includes('&note=') ? 'note id' : search.includes('&notes=') ? 'notes open' : 'plain'}`, compactDesktop: true, exactContextAndDispatchParity: true, preservedPersonalFilters: true });
    });
  }

  const nav = createFixture('viewport-candidate', true, 'ranking', `${queryA}&notes=open`);
  const nr = await mount(nav);
  try {
    const initial = desktop(nr);
    const initialFetches = rankingHelpers(nav).length;
    for (const query of [queryA, `${queryA}&notes=open`, queryA, `${queryA}&note=${noteId}`]) {
      await update(nr, nav, query);
      assert.equal(rankingHelpers(nav).length, initialFetches);
      assert.equal(desktop(nr), initial);
    }
    const contextB = { ...contextA, selectedCategory: '002', fromDate: '2026-09-28', toDate: '2026-09-30', resolvedFromDate: '2026-09-28', resolvedToDate: '2026-09-30' };
    await update(nr, nav, contextModule.rankingContextToSearchParams(contextB).toString());
    assert.notEqual(desktop(nr), initial);
    assert.equal(rankingHelpers(nav).length, initialFetches + 1);
    assert.equal(rankingHelpers(nav).at(-1).args[0].categoryCode, '002');
    await update(nr, nav, queryA);
    assert.equal(rankingHelpers(nav).length, initialFetches + 2);
    assert.equal(rankingHelpers(nav).at(-1).args[0].categoryCode, '001');
    results.push({ case: 'source query A → note-only changes → B → A preserves/remounts correct subtree', noteOnlyExtraHelpers: 0, sourceSwitchExtraHelpers: 2, caveat: 'programmatic search params only; note drawer and browser history are not exercised' });
  } finally { await unmount(nr); }

  for (const route of ['ranking', 'reviews']) {
    const fixture = createFixture('viewport-candidate', true, route);
    const mediaQueries = [], additions = [], removals = [];
    const match = fixture.browser.matchMedia;
    fixture.browser.matchMedia = query => { mediaQueries.push(query); return match(query); };
    const add = fixture.media.addEventListener, remove = fixture.media.removeEventListener;
    fixture.media.addEventListener = (name, handler) => { additions.push({ name, handler }); return add(name, handler); };
    fixture.media.removeEventListener = (name, handler) => { removals.push({ name, handler }); return remove(name, handler); };
    const root = await mount(fixture);
    try {
      assert.equal(fixture.listeners.size, 1);
      const originalListener = [...fixture.listeners][0];
      const initialHelpers = fixture.helpers.length;
      await act(async () => { fixture.change(true); await flush(); });
      assert.equal(fixture.helpers.length, initialHelpers);
      await act(async () => { fixture.change(false); await flush(); });
      assert.equal([...fixture.listeners][0], originalListener);
      assert.equal(root.root.findAll(x => x.type.name === (route === 'ranking' ? 'MobileRankingView' : 'MobileReviewsView')).length, 0);
      await act(async () => { fixture.change(true); await flush(); });
      assert.equal([...fixture.listeners][0], originalListener);
      assert.equal(root.root.findAll(x => x.type.name === (route === 'ranking' ? 'MobileRankingView' : 'MobileReviewsView')).length, 1);
      if (route === 'reviews') assert.equal(root.root.findAll(x => x.type === 'a' && x.props.href === '/reviews/weekly').length, 1);
      results.push({ case: `${route}: no-op media event and actual branch switch retain one listener`, listenerCount: fixture.listeners.size });
    } finally { await unmount(root); }
    assert.equal(fixture.listeners.size, 0);
    assert.deepEqual(mediaQueries, ['(max-width: 767px)']);
    assert.equal(additions.length, 1);
    assert.equal(removals.length, 1);
    assert.equal(additions[0].name, 'change');
    assert.equal(removals[0].name, 'change');
    assert.equal(removals[0].handler, additions[0].handler);
  }

  const compact = createFixture('viewport-candidate', true, 'ranking', queryA);
  const cr = await mount(compact);
  try {
    const view = desktop(cr), count = rankingHelpers(compact).length;
    await act(async () => { compact.change(false); await flush(); });
    assert.equal(desktop(cr), view);
    assert.equal(desktop(cr).props.compact, false);
    await act(async () => { compact.change(true); await flush(); });
    assert.equal(desktop(cr), view);
    assert.equal(desktop(cr).props.compact, true);
    assert.equal(rankingHelpers(compact).length, count);
    results.push({ case: 'source-linked desktop remains mounted across responsive compact changes', extraRankingHelpers: 0 });
  } finally { await unmount(cr); }

  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(fixturePath)).digest('hex'), fixtureHash, 'fixture changed while review was running');
  console.log(JSON.stringify({ classification: 'Independent additional assertions using original real-React fixture factory; no browser, network, SQL, hydration or wall-time evidence', fixtureSHA256: fixtureHash, passed: results.length, results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
