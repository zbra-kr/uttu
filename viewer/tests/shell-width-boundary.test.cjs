const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),postcss=require('postcss');
test('Shell narrow desktop rule preserves sidebar/content floor, mobile and ranking overrides',()=>{
 const css=postcss.parse(fs.readFileSync(path.join(__dirname,'../src/styles/app.css'),'utf8'));
 const rule=css.nodes.find(n=>n.type==='atrule'&&n.name==='media'&&n.params==='(min-width: 860px) and (max-width: 1099px)');assert.ok(rule);
 assert.equal(rule.nodes.length,1);assert.equal(rule.nodes[0].selector,'.shell');assert.deepEqual(rule.nodes[0].nodes.map(n=>[n.prop,n.value]),[['min-width','0']]);
 const shell=css.nodes.find(n=>n.type==='rule'&&n.selector==='.shell');assert.ok(shell.nodes.some(n=>n.prop==='grid-template-columns'&&n.value==='var(--sb-w) minmax(640px, 1fr)'));assert.ok(shell.nodes.some(n=>n.prop==='min-width'&&n.value==='1100px'));
 assert.ok(css.nodes.some(n=>n.type==='atrule'&&n.params==='(max-width: 767px)'&&n.nodes.some(r=>r.selector==='.shell'&&r.nodes.some(d=>d.prop==='display'&&d.value==='block'))));
 assert.ok(css.nodes.some(n=>n.selector==='.ranking-table-scroll'&&n.nodes.some(d=>d.prop==='overflow-x'&&d.value==='auto')));
});
