const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const Renderer = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const source = fs.readFileSync(path.join(__dirname, '../src/app/(app)/reviews/page.tsx'), 'utf8');
const ast = ts.createSourceFile('reviews.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = ast.statements.filter(n => ts.isFunctionDeclaration(n) && ['readReviewTab', 'ReviewsDesktopView'].includes(n.name?.text)).map(n => n.getText(ast)).join('\n');
function fixture(raw, throws = false) {
  let stored = raw;
  const storage = {getItem() {if (throws) throw Error('denied'); return stored;}, setItem(k,v) {if (throws) throw Error('denied'); stored=v;}};
  const context = {React, window:{}, localStorage:storage, exports:{}, require, RvDashboard:()=>React.createElement('div',{'data-view':'dash'}), RvBrowse:()=>React.createElement('div',{'data-view':'browse'}), RvProductBrowse:()=>React.createElement('div',{'data-view':'product-browse'}), RvAnomalyReviews:()=>React.createElement('div',{'data-view':'anomaly'})};
  vm.runInNewContext(ts.transpileModule(functions+'\nexports.View=ReviewsDesktopView;', {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,context);
  return {View:context.exports.View, value:()=>stored};
}
async function mount(f) {let root;await React.act(async()=>{root=Renderer.create(React.createElement(f.View));});return root;}
async function unmount(root) {await React.act(async()=>root.unmount());}
const view=root=>root.root.find(x=>x.props['data-view']).props['data-view'];
test('actual tab buttons write values that restore on remount',async()=>{
  for (const [index,tab] of ['dash','browse','product-browse','anomaly'].entries()) {
    const f=fixture(null);let root=await mount(f);
    await React.act(async()=>root.root.findAllByType('button')[index].props.onClick());
    assert.equal(view(root),tab);assert.equal(f.value(),JSON.stringify(tab));
    await unmount(root);root=await mount(f);assert.equal(view(root),tab);await unmount(root);
  }
});
test('legacy raw and JSON tabs restore; malformed or unknown storage falls back',async()=>{
  for(const tab of ['dash','browse','product-browse','anomaly']) for(const raw of [tab,JSON.stringify(tab)]) {const root=await mount(fixture(raw));assert.equal(view(root),tab);await unmount(root);}
  for(const raw of [null,'','broken','"unknown"','null','{}','[]','42']) {const root=await mount(fixture(raw));assert.equal(view(root),'dash');await unmount(root);}
});
test('storage access failures leave tabs usable',async()=>{
  const root=await mount(fixture(null,true));assert.equal(view(root),'dash');
  await React.act(async()=>root.root.findAllByType('button')[2].props.onClick());assert.equal(view(root),'product-browse');await unmount(root);
});
