const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const React = require('react'), Renderer = require('react-test-renderer');
const load = require('./helpers/load-source.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const css = { __esModule: true, default: new Proxy({}, { get: (_, name) => 'erp-' + name }) };
const mocks = { './erp-insights.module.css': css };
const model = load('src/lib/erp-insight-workspace.ts');
const Workspace = load('src/components/erp-insights/ErpInsightsWorkspace.tsx', mocks).default;
const request = { brand: 'CO', from: '2026-10-04', to: '2026-10-10', year: '2026', season: 'FW' };

test('valid calendar periods and seasons keep unknown distinct from zero', () => {
  assert.equal(model.requestReason(request), null);
  for (const change of [{ from: '2026-02-30' }, { from: '2026-10-11' }, { year: '26' }, { brand: 'CK-CO' }, { season: 'ALL' }]) assert.equal(model.requestReason({ ...request, ...change }), 'REQUEST_INVALID');
  assert.equal(model.requestReason({ ...request, from: '' }), 'REQUEST_REQUIRED');
  assert.equal(model.requestReason({ ...request, brand: 'CK' }), null);
  assert.equal(model.requestReason({ ...request, brand: 'LK' }), null);
});
test('null/malformed request and unknown view are safe review states instead of crashes', async () => {
  for (const input of [null, undefined, [], {}, { ...request, from: 123 }]) assert.equal(model.requestReason(input), 'REQUEST_INVALID');
  await mounted({ initialView: 'unexpected' }, root => assert.equal(root.root.findAllByProps({ role: 'tabpanel' })[0].props.id, 'erp-panel-planning'));
});
test('numeric ready data unsupported; safe reason allowlist omits raw private data', () => {
  for (const input of [null, undefined, { kind: 'ready', value: 120, rows: ['PRIVATE_SENTINEL'] }, { kind: 'error', codes: ['PRIVATE_SENTINEL', 'READ_FAILED'], raw: 'PRIVATE_SENTINEL' }]) {
    const value = model.resolveErpWorkspace(input, request);
    assert.equal(value.value, null); assert.deepEqual(value.rows, []); assert.equal(value.executable, false);
    assert.doesNotMatch(JSON.stringify(value), /PRIVATE_SENTINEL/);
    assert.equal(value.kind, 'error');
  }
});
test('all declared read states keep KPI key VAT period scope gates explicit', () => {
  for (const kind of ['unconnected', 'loading', 'error', 'empty', 'withheld']) {
    const value = model.resolveErpWorkspace({ kind }, request);
    assert.equal(value.kind, kind); assert.equal(value.value, null); assert.match(value.title, /판단 보류/);
    for (const code of ['KPI_UNVERIFIED','KEY_UNVERIFIED','VAT_UNRECONCILED','PERIOD_UNVERIFIED','SCOPE_UNVERIFIED']) assert.ok(value.codes.includes(code));
  }
});
async function mounted(props, action) {
  let root;
  try { await React.act(async () => { root = Renderer.create(React.createElement(Workspace, props), { createNodeMock: () => ({ focus() {} }) }); }); await action(root); }
  finally { await React.act(async () => root?.unmount()); }
}
test('all five actual React views render portal fields as unavailable and no synthetic rows', async () => {
  for (const initialView of model.ERP_VIEW_IDS) await mounted({ initialView }, root => {
    const text = JSON.stringify(root.toJSON());
    assert.match(text, /ERP 연결 미완료/); assert.match(text, /미확인/); assert.match(text, /실제 ERP 검증/);
    assert.doesNotMatch(text, /FIXTURE-|예시 A|120|210|품질 리뷰 우선 확인/);
    const headers = root.root.findAllByType('th'); assert.equal(headers.length, model.ERP_VIEWS[initialView].columns.length);
    for (const th of headers) assert.equal(th.props.scope, 'col');
    assert.equal(root.root.findAllByProps({ role: 'tabpanel' }).length, 1);
    assert.equal(root.root.findAllByProps({ 'aria-selected': true }).length, 1);
  });
});
test('loading empty error and withheld render distinctly without raw error text', async () => {
  for (const [kind, phrase] of [['loading','연결 상태 확인 중'],['empty','검증된 자료 없음'],['error','자료 확인 실패'],['withheld','데이터 계약 확인 필요']]) await mounted({ source: { kind, codes: ['PRIVATE_SENTINEL'] } }, root => {
    const text = JSON.stringify(root.toJSON()); assert.match(text, new RegExp(phrase)); assert.doesNotMatch(text, /PRIVATE_SENTINEL/);
  });
});
test('tabs support arrow Home End selection, preserve one visible panel and brand separation', async () => {
  await mounted({}, async root => {
    const tab = () => root.root.findAllByProps({ role: 'tab' });
    await React.act(async () => tab()[0].props.onKeyDown({ key: 'End', preventDefault() {} }));
    assert.equal(root.root.findAllByProps({ role: 'tabpanel' })[0].props.id, 'erp-panel-quality');
    await React.act(async () => tab()[4].props.onKeyDown({ key: 'Home', preventDefault() {} }));
    await React.act(async () => tab()[0].props.onKeyDown({ key: 'ArrowRight', preventDefault() {} }));
    assert.equal(root.root.findAllByProps({ role: 'tabpanel' })[0].props.id, 'erp-panel-sales');
    const texts = root.root.findAllByType('button').map(b => JSON.stringify(b.props.children));
    assert.ok(texts.some(s => s.includes('커버낫 키즈'))); assert.ok(texts.some(s => s.includes('리 키즈')));
  });
});
test('date labels and invalid feedback survive tab changes without data reads', async () => {
  await mounted({}, async root => {
    const dates = root.root.findAllByProps({ type: 'date' }); assert.equal(dates.length, 2);
    await React.act(async () => dates[0].props.onChange({ target: { value: '2026-10-11' } }));
    await React.act(async () => dates[1].props.onChange({ target: { value: '2026-10-10' } }));
    await React.act(async () => root.root.findAllByProps({ inputMode: 'numeric' })[0].props.onChange({ target: { value: '2026' } }));
    assert.equal(root.root.findAllByProps({ type: 'date' })[0].props['aria-invalid'], true);
    assert.match(JSON.stringify(root.toJSON()), /REQUEST_INVALID/);
    await React.act(async () => root.root.findAllByProps({ role: 'tab' })[2].props.onClick());
    assert.equal(root.root.findAllByProps({ type: 'date' })[0].props.value, '2026-10-11');
  });
});
test('review route has no fixture API SDK import or new navigation mutation', () => {
  const route = fs.readFileSync('src/app/(app)/erp-insights-review/page.tsx', 'utf8');
  const ui = fs.readFileSync('src/components/erp-insights/ErpInsightsWorkspace.tsx', 'utf8');
  const state = fs.readFileSync('src/lib/erp-insight-workspace.ts', 'utf8');
  assert.doesNotMatch(route + ui + state, /fetch\(|supabase|process\.env|\.\/dev\/|dev\/erp-insights|FIXTURE-/);
  assert.match(ui, /MobileEmptyState/); assert.match(ui, /FilterBlock/); assert.match(ui, /BriefingEvidenceNote/);
  assert.match(ui, /role="status"/); assert.match(ui, /role="region"/); assert.match(ui, /aria-describedby/);
});
