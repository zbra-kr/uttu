// Offline SSR of actual components; no app shell/auth/provider, env, API or network.
const fs = require('node:fs'), path = require('node:path');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const load = require('../../tests/helpers/load-source.cjs');
const css = { __esModule: true, default: new Proxy({}, { get: (_, name) => 'erp-' + name }) };
const Workspace = load('src/components/erp-insights/ErpInsightsWorkspace.tsx', { './erp-insights.module.css': css }).default;
const { ERP_VIEWS, ERP_VIEW_IDS } = load('src/lib/erp-insight-workspace.ts');
const output = path.resolve(__dirname, 'rendered'); fs.mkdirSync(output, { recursive: true });
const moduleCss = fs.readFileSync('src/components/erp-insights/erp-insights.module.css', 'utf8')
  .replace(/:global\(([^)]+)\)/g, '$1').replace(/\.(workspace|header|tabs|filters|dates|note|title|description|status|metrics|question|basis|scroll|table)(?![\w-])/g, '.erp-$1');
const styles = fs.readFileSync('src/styles/tokens.css', 'utf8') + fs.readFileSync('src/styles/app.css', 'utf8') + moduleCss + '\nbody{height:auto!important;overflow:auto!important}';
const safe = value => value.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
function document(title, body) { return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${safe(title)}</title><style>${styles}</style></head><body><div style="padding:10px 20px;background:var(--smb);color:var(--smf);font-size:12px">로컬 정적 검토 · ERP 미연결 · 실제 API 호출 없음 · 버튼 동작은 React mock 회귀에서 검증</div>${body}</body></html>`; }
for (const view of ERP_VIEW_IDS) fs.writeFileSync(path.join(output, view+'.html'), document(ERP_VIEWS[view].title, renderToStaticMarkup(React.createElement(Workspace, { initialView: view }))));
for (const kind of ['loading','error','empty','withheld']) fs.writeFileSync(path.join(output, kind+'.html'), document(kind, renderToStaticMarkup(React.createElement(Workspace, { source: { kind } }))));
const nav = ERP_VIEW_IDS.map(id => `<a href="${id}.html">${safe(ERP_VIEWS[id].label)}</a>`).join(' · ');
const frames = ERP_VIEW_IDS.map(id => `<section><h2>${safe(ERP_VIEWS[id].label)} · 미연결 정적 렌더</h2><div style="display:flex;gap:16px;align-items:start;flex-wrap:wrap"><iframe title="${safe(ERP_VIEWS[id].label)} 데스크톱" src="${id}.html" style="width:1160px;max-width:100%;height:960px;border:1px solid var(--bs)"></iframe><iframe title="${safe(ERP_VIEWS[id].label)} 모바일" src="${id}.html" style="width:390px;max-width:100%;height:1600px;border:1px solid var(--bs)"></iframe></div></section>`).join('');
fs.writeFileSync(path.join(output,'index.html'),document('UTTU ERP 후보 로컬 검토', `<main style="padding:20px"><h1>UTTU 디자인 검토 · ERP 미연결</h1><p>${nav}</p><p>보존된 합성 fixture는 ../reference에만 있으며 이 렌더에는 숫자·개인정보를 포함하지 않습니다.</p>${frames}</main>`));
console.log('Offline actual-component renders: '+output);
