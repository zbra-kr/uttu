const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),postcss=require('postcss');
test('Shell narrow desktop rule preserves sidebar/content floor, mobile and ranking overrides',()=>{
 const css=postcss.parse(fs.readFileSync(path.join(__dirname,'../src/styles/app.css'),'utf8'));
 const rule=css.nodes.find(n=>n.type==='atrule'&&n.name==='media'&&n.params==='(min-width: 860px) and (max-width: 1099px)');assert.ok(rule);
 assert.equal(rule.nodes[0].selector,'.shell');assert.deepEqual(rule.nodes[0].nodes.map(n=>[n.prop,n.value]),[['min-width','0']]);
 for(const selector of ['.tb .bc','.tb .search']){const r=rule.nodes.find(n=>n.selector===selector);assert.deepEqual(r.nodes.map(n=>[n.prop,n.value]),[['flex','1'],['min-width','0'],['overflow','hidden']]);}
 for(const selector of ['.tb .bc .crumb','.tb .search .placeholder']){const r=rule.nodes.find(n=>n.selector===selector);assert.deepEqual(r.nodes.map(n=>[n.prop,n.value]),[['min-width','0'],['white-space','nowrap'],['overflow','hidden'],['text-overflow','ellipsis']]);}
 const shell=css.nodes.find(n=>n.type==='rule'&&n.selector==='.shell');assert.ok(shell.nodes.some(n=>n.prop==='grid-template-columns'&&n.value==='var(--sb-w) minmax(640px, 1fr)'));assert.ok(shell.nodes.some(n=>n.prop==='min-width'&&n.value==='1100px'));
 assert.ok(css.nodes.some(n=>n.type==='atrule'&&n.params==='(max-width: 767px)'&&n.nodes.some(r=>r.selector==='.shell'&&r.nodes.some(d=>d.prop==='display'&&d.value==='block'))));
 assert.ok(css.nodes.some(n=>n.selector==='.ranking-table-scroll'&&n.nodes.some(d=>d.prop==='overflow-x'&&d.value==='auto')));
});
test('Topbar preserves complete breadcrumb text in its navigation label and per-segment titles',()=>{
 const React=require('react'),SSR=require('react-dom/server'),load=require('./helpers/load-source.cjs');const crumbs=['Brand '+ 'Long'.repeat(50),'Category / segment','Product '+ 'Name'.repeat(80)];
 const Topbar=load('src/components/shell/Topbar.tsx',{'next/navigation':{useRouter:()=>({back(){}})},'@/lib/queries-me':{fetchUnreadCount:async()=>0},'../me/InboxList':()=>null,'../help/HelpButton':()=>null}).default;
 const html=SSR.renderToStaticMarkup(React.createElement(Topbar,{breadcrumb:crumbs,theme:'light',aipOpen:false,onTheme(){},onToggleAip(){},onOpenCmdk(){}}));
 assert.ok(html.includes('aria-label="'+crumbs.join(' / ')+'"'));for(const crumb of crumbs)assert.ok(html.includes('title="'+crumb+'"'));
});
