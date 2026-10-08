// Component/callback/effect regressions. Real browser layout and history are checked separately.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./helpers/load-source.cjs');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const TODAY = '2026-10-03';
const audiences = ['executive', 'staff', 'cs'];
const snapshot = date => ({ briefing_date: date, ...Object.fromEntries(audiences.map(audience => [audience, {
  audience, briefing_date: date, headline: `${audience} ${date}`, model: 'fixture',
  daily_brief: [], card_comments: {}, insights: [], insight_pages: [0, 1].map(idx => ({
    idx, title: `${audience} ${date} ${idx}`, body: '', article: 'fixture', key_metrics: [], link: '/ranking',
  })),
}])) });
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null;
  if (predicate(tree)) return tree;
  return React.Children.toArray(tree.props?.children).map(child => find(child, predicate)).find(Boolean) ?? null;
}
function harness(initialUrl, mobile = true, detail = false) {
  let url = new URL(initialUrl, 'https://uttu.test'), cursor = 0, dirty = true, tree;
  const hooks = [], effects = [], requests = [], pushes = [], history = [url.href];
  let historyIndex = 0;
  const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = { ...React,
    useState(initial) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[i].value, value => {
        const next = typeof value === 'function' ? value(hooks[i].value) : value;
        if (!Object.is(next, hooks[i].value)) { hooks[i].value = next; dirty = true; }
      }];
    },
    useRef(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = { value: { current: initial } }; return hooks[i].value; },
    useCallback(fn, deps) { const i = cursor++; if (!hooks[i] || !equal(hooks[i].deps, deps)) hooks[i] = { value: fn, deps }; return hooks[i].value; },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!hooks[i] || !equal(hooks[i].deps, deps)) {
        hooks[i] = { deps, cleanup: hooks[i]?.cleanup };
        effects.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = fn(); });
      }
    },
  };
  const push = (next, options) => {
    pushes.push({ next, options });
    url = new URL(next, url); history.splice(++historyIndex); history.push(url.href); dirty = true;
  };
  const mocks = {
    react: { __esModule: true, ...react, default: react },
    'next/navigation': { useSearchParams: () => new URLSearchParams(url.search), useRouter: () => ({ push, back() { if (historyIndex) { url = new URL(history[--historyIndex]); dirty = true; } } }) },
    '@/hooks/useViewport': { useIsMobile: () => mobile },
    '@/hooks/useKstToday': { useKstToday: () => TODAY },
    // This harness isolates existing URL/briefing navigation; the new source
    // reader's SDK ownership and responsive lifecycle have their own tests.
    '@/lib/cs-daily-review-context': { useCSDailyReviewState: () => null },
    '@/lib/queries-briefing': {
      kstToday: () => TODAY, fetchAvailableBriefingDates: () => Promise.resolve([TODAY, '2026-10-02']),
      fetchAllBriefings: date => new Promise(resolve => requests.push({ date, resolve })),
    },
    '@/lib/queries-kpi': { fetchBriefingKpiData: date => Promise.resolve({ date }) },
    '@/components/briefing/mobile/MobileTodayView': { __esModule: true, default: 'MobileTodayView' },
    '@/components/briefing/BriefingTabs': { __esModule: true, default: 'BriefingTabs' },
    '@/components/briefing/ExecutiveBriefingView': { __esModule: true, default: 'Executive' },
    '@/components/briefing/StaffBriefingView': { __esModule: true, default: 'Staff' },
    '@/components/briefing/CSBriefingView': { __esModule: true, default: 'CS' },
    './page.module.css': { __esModule: true, default: { detail: 'detail' } },
  };
  // Keep URL tests isolated from identity verification; exercise the actual read hook.
  mocks['@/hooks/useBriefingRead'] = { ...load('src/hooks/useBriefingRead.ts', mocks), useBriefingScope(context) {
    const current = react.useRef(context); current.current = context;
    const isCurrent = react.useCallback(key => current.current === key, []);
    return { key: context, isCurrent, authError: false, signedOut: false, retryAuth() {} };
  } };
  const Page = load(detail ? 'src/app/(app)/today/insight/page.tsx' : 'src/app/(app)/today/page.tsx', mocks).default;
  const Content = Page().props.children.type;
  function render(runEffects = true) {
    let loops = 0;
    do {
      if (++loops > 20) throw new Error('render loop');
      cursor = 0; dirty = false; tree = Content();
      if (runEffects) while (effects.length) effects.shift()();
    } while (dirty);
    return tree;
  }
  render(false);
  const initialTree = tree; // Before effects: the server/first-client viewport path.
  return {
    requests, pushes, initialTree, render,
    tabs: () => { render(); return mobile ? tree.props : find(tree, n => n.type === 'BriefingTabs').props; },
    commit(next) { url = new URL(next, url); dirty = true; render(); },
    viewport(next) { mobile = next; dirty = true; render(); },
    back() { if (historyIndex) { url = new URL(history[--historyIndex]); dirty = true; render(); } },
    forward() { if (historyIndex < history.length - 1) { url = new URL(history[++historyIndex]); dirty = true; render(); } },
    url: () => url,
    async flush() { for (let i = 0; i < 12; i++) { await Promise.resolve(); if (dirty) render(); } },
    dispose() { for (const hook of hooks) hook?.cleanup?.(); },
  };
}
for (const audience of audiences) test(`direct ${audience} URL survives first render, viewport switch, and delayed data`, async () => {
  const h = harness(`/today?tab=${audience}&date=2026-10-02`, false);
  try {
    assert.equal(find(h.initialTree, n => n.type === 'BriefingTabs').props.active, audience);
    h.viewport(true);
    assert.equal(h.tabs().activeTab, audience);
    assert.equal(h.tabs().activeDate, '2026-10-02');
    h.requests[0].resolve(snapshot('2026-10-02')); await h.flush();
    assert.equal(h.tabs().activeTab, audience);
    assert.equal(h.tabs().data[audience].headline, `${audience} 2026-10-02`);
    h.viewport(false); assert.equal(h.tabs().active, audience);
    h.viewport(true); assert.equal(h.tabs().activeTab, audience);
  } finally { h.dispose(); }
});
test('mobile audience and date callbacks preserve parameters, create history, and support Back/Forward/reload', () => {
  const h = harness('/today?date=2026-10-02&tab=cs&from=briefing');
  try {
    h.tabs().onTabSelect('staff');
    assert.equal(h.tabs().activeTab, 'staff');
    assert.equal(h.url().searchParams.get('tab'), 'staff');
    assert.equal(h.url().searchParams.get('date'), '2026-10-02');
    assert.equal(h.url().searchParams.get('from'), 'briefing');
    assert.deepEqual(h.pushes.at(-1).options, { scroll: false });
    h.tabs().onDateChange(TODAY);
    assert.equal(h.tabs().activeTab, 'staff'); assert.equal(h.tabs().activeDate, TODAY);
    h.back(); assert.equal(h.tabs().activeDate, '2026-10-02'); assert.equal(h.tabs().activeTab, 'staff');
    h.back(); assert.equal(h.tabs().activeTab, 'cs');
    h.forward(); assert.equal(h.tabs().activeTab, 'staff');
    const reload = harness(h.url().href);
    try { assert.equal(reload.tabs().activeTab, 'staff'); assert.equal(reload.tabs().activeDate, '2026-10-02'); } finally { reload.dispose(); }
    h.tabs().onTabSelect('executive'); assert.equal(h.url().searchParams.get('tab'), 'executive');
  } finally { h.dispose(); }
});
for (const query of ['', '?tab=invalid', '?tab=CS&date=not-a-date']) test(`missing/invalid URL defaults remain unchanged: ${query || '(empty)'}`, () => {
  const h = harness(`/today${query}`);
  try { assert.equal(h.tabs().activeTab, 'executive'); assert.equal(h.tabs().activeDate, TODAY); } finally { h.dispose(); }
});
test('future date and malformed date handling match the existing desktop contract', () => {
  const h = harness('/today?tab=cs&date=2099-01-01');
  try {
    assert.equal(h.tabs().isFuture, true); assert.equal(h.tabs().activeDate, '2099-01-01');
    h.commit('/today?tab=staff&date=2026-1-1');
    assert.equal(h.tabs().activeDate, TODAY); assert.equal(h.tabs().activeTab, 'staff');
  } finally { h.dispose(); }
});
test('an older date response cannot replace newer date data or reset the audience', async () => {
  const h = harness('/today?tab=cs&date=2026-10-02');
  try {
    h.render(); const old = h.requests[0];
    h.tabs().onDateChange(TODAY); h.render(); const current = h.requests[1];
    h.tabs().onTabSelect('staff'); h.render();
    current.resolve(snapshot(TODAY)); h.requests.at(-1).resolve(snapshot(TODAY)); await h.flush();
    old.resolve(snapshot('2026-10-02')); await h.flush();
    assert.equal(h.tabs().activeTab, 'staff'); assert.equal(h.tabs().data.briefing_date, TODAY);
    assert.equal(h.tabs().kpiData.date, TODAY); assert.equal(h.tabs().loading, false);
  } finally { h.dispose(); }
});
test('a stale response cannot clear the newer date loading state', async () => {
  const h = harness('/today?tab=cs&date=2026-10-02');
  try {
    h.render(); const old = h.requests[0]; h.tabs().onDateChange(TODAY); h.render();
    old.resolve(snapshot('2026-10-02')); await h.flush();
    assert.equal(h.tabs().loading, true); assert.equal(h.tabs().data, null);
  } finally { h.dispose(); }
});
test('MobileTodayView renders its controlled audience and forwards the supplied callback', () => {
  const View = load('src/components/briefing/mobile/MobileTodayView.tsx').default;
  const data = snapshot(TODAY), onTabSelect = () => {};
  for (const audience of audiences) {
    const props = { activeTab: audience, onTabSelect, data, kpiData: null, loading: false, activeDate: TODAY, availableDates: [TODAY], isFuture: false, onDateChange() {} };
    const tree = View(props); const tabs = tree.props.children[0];
    assert.equal(tabs.props.active, audience); assert.equal(tabs.props.onSelect, onTabSelect);
    const html = renderToStaticMarkup(React.createElement(View, props));
    assert.ok(html.includes(`${audience} ${TODAY}`));
    assert.match(html, audience === 'cs' ? /생성 당시 수집·조회된 표본/ : /ROI를 확인할 수 없습니다/);
  }
});
test('detail navigation keeps the newest audience/date/index when requests resolve out of order', async () => {
  const h = harness('/today/insight?date=2026-10-02&audience=cs&idx=0', true, true);
  try {
    h.render(); const old = h.requests[0];
    h.commit(`/today/insight?date=${TODAY}&audience=staff&idx=1`);
    assert.ok(find(h.render(), n => n.props?.children === '불러오는 중...'));
    h.requests[1].resolve(snapshot(TODAY)); await h.flush();
    old.resolve(snapshot('2026-10-02')); await h.flush();
    const content = find(h.render(), n => n.props?.page?.title);
    assert.equal(content.props.page.title, `staff ${TODAY} 1`);
    assert.equal(content.props.audience, 'staff'); assert.equal(content.props.date, TODAY);
  } finally { h.dispose(); }
});
test('detail adds safe-area-aware mobile clearance without changing tablet/desktop spacing or link target', () => {
  const css = read('src/app/(app)/today/insight/page.module.css');
  assert.match(css, /\.detail\s*\{\s*padding-bottom: 40px;/);
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(css, /padding-bottom: calc\(88px \+ env\(safe-area-inset-bottom, 0px\)\)/);
  const source = read('src/app/(app)/today/insight/page.tsx');
  assert.match(source, /className=\{styles.detail\}/); assert.doesNotMatch(source, /paddingBottom: 40/);
  assert.match(source, /href=\{page.link\}/); assert.match(source, /padding: '13px 0'/);
  // 56px button + 20px bottom offset + 12px separation, before shell padding.
  assert.ok(88 >= 56 + 20 + 12);
});
test('navigation regressions are wired into CI alongside evidence coverage', () => {
  assert.equal(JSON.parse(read('package.json')).scripts['test:briefing-navigation'], 'node --test tests/briefing-navigation.test.cjs tests/briefing-anomaly-date.test.cjs');
  const workflow = fs.readFileSync(path.join(__dirname, '../../.github/workflows/ci.yml'), 'utf8');
  assert.ok(workflow.includes('npm run test:briefing-navigation'));
  assert.ok(workflow.includes('npm run test:briefing-evidence'));
});
