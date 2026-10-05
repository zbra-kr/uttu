const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const code = ts.transpileModule(read('src/components/briefing/BriefingEvidenceNote.tsx'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }}).outputText;
const moduleObject = { exports: {} };
new Function('require', 'module', 'exports', code)(require, moduleObject, moduleObject.exports);
const Note = moduleObject.exports.default;
test('CS notice explicitly bounds sample counts and does not assert population totals', () => {
 const html = renderToStaticMarkup(React.createElement(Note, { audience: 'cs' }));
 assert.match(html, /생성 당시 수집·조회된 표본/);
 assert.match(html, /전체 고객의 평가나 현재 리뷰 총수를 뜻하지 않습니다/);
 assert.doesNotMatch(html, /전원 5점|전체 리뷰 4건/);
});
for (const audience of ['staff', 'executive', 'unknown']) test(`${audience}: unsupported ROI and causal claims are explicitly qualified`, () => {
 const html = renderToStaticMarkup(React.createElement(Note, { audience }));
 assert.match(html, /랭킹·조회수 변화만으로 매출·수요 증가, 콘텐츠의 인과적 효과 또는 ROI를 확인할 수 없습니다/);
 assert.match(html, /본문의 단정적 표현도 검증된 결론으로 보지 마세요/);
});
test('legacy summaries and articles receive notice without metadata or text mutation', () => {
 for (const file of ['src/components/briefing/BriefingHeadline.tsx', 'src/components/briefing/mobile/MobileBriefingHeadline.tsx']) {
  const source=read(file);
  assert.match(source, /<BriefingEvidenceNote audience=\{briefing.audience\}/);
  assert.ok(source.indexOf('<BriefingEvidenceNote') < source.indexOf('{briefing.headline}'));
  assert.match(source, /\{briefing.headline\}/);
  assert.doesNotMatch(source, /\.replace\(|generated_at\s*[<>]/);
 }
 const detail=read('src/app/(app)/today/insight/page.tsx');
 assert.ok(detail.indexOf('<BriefingEvidenceNote') < detail.indexOf('{page.title}'));
 assert.match(detail, /page.article.split/);
 assert.match(detail, /href=\{page.link\}/);
 assert.match(detail, /관련 데이터 페이지/);
 assert.doesNotMatch(detail, /전체 데이터 보기/);
});
test('actual historical sample and ROI headlines render unchanged with visible qualification', () => {
 const load = require('./helpers/load-source.cjs');
 for (const file of ['src/components/briefing/BriefingHeadline.tsx', 'src/components/briefing/mobile/MobileBriefingHeadline.tsx']) {
  const Headline = load(file).default;
  for (const [audience, headline, qualification] of [
   ['cs', '어제 리뷰 4건 전원 5점', '생성 당시 수집·조회된 표본'],
   ['staff', '높은 ROI 확인', 'ROI를 확인할 수 없습니다'],
  ]) {
   const briefing = { audience, headline, briefing_date:'2026-10-03', model:'legacy', daily_brief:[], insights:[], card_comments:{} };
   const before = JSON.stringify(briefing);
   const html = renderToStaticMarkup(React.createElement(Headline, { briefing }));
   assert.ok(html.includes(headline)); // disclosure only, never claim repaired historical text
   assert.ok(html.indexOf(qualification) < html.indexOf(headline));
   assert.equal(JSON.stringify(briefing), before);
  }
 }
});
test('empty insight arrays render no fabricated insight on desktop or mobile', () => {
 const load = require('./helpers/load-source.cjs');
 for (const file of ['src/components/briefing/BriefingInsight.tsx', 'src/components/briefing/mobile/MobileBriefingInsight.tsx']) {
  const Insights = load(file).default;
  assert.equal(renderToStaticMarkup(React.createElement(Insights, { insights: [], briefingDate:'2026-10-03', audience:'cs' })), '');
 }
});
test('briefing regressions are wired into CI without dropping prior suites', () => {
 const pkg = JSON.parse(read('package.json'));
 assert.ok(pkg.scripts['test:briefing-evidence'].includes('tests/briefing-evidence.test.cjs'));
 assert.ok(pkg.scripts['test:briefing-evidence'].includes('tests/cs-daily-review-*.test.cjs'));
 const workflow = fs.readFileSync(path.join(root, '../.github/workflows/ci.yml'), 'utf8');
 assert.match(workflow, /npm run test:briefing-evidence/);
 for (const name of ['auth', 'teams', 'ai-session', 'ratings', 'matching', 'collection-status', 'weekly-reviews']) {
  assert.ok(pkg.scripts[`test:${name}`]);
  assert.ok(workflow.includes(`npm run test:${name}`));
 }
});
