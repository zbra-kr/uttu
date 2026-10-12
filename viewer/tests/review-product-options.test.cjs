const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), React = require('react'), Renderer = require('react-test-renderer');
const load = require('./helpers/load-source.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const page = fs.readFileSync(path.join(__dirname, '../src/app/(app)/reviews/page.tsx'), 'utf8');
const ast = ts.createSourceFile('reviews.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function mockQuery(products, error = null) {
  const dispatched = [], chains = [];
  const client = { from(table) {
    const calls = []; chains.push({ table, calls });
    const q = { then(resolve, reject) {
      dispatched.push(table);
      let data = table === 'products' ? products.filter(p => p.is_own) : [];
      const keyword = calls.find(c => c[0] === 'or')?.[1].match(/^name\.ilike\.%([\s\S]*)%,style_no/)[1];
      if (keyword) data = data.filter(p => ['name','style_no','erp_style_code'].some(k => p[k]?.toLowerCase().includes(keyword.toLowerCase())));
      data = [...data].sort((a,b) => b.review_count-a.review_count);
      const count = data.length, range = calls.find(c => c[0] === 'range');
      if (range) data = data.slice(range[1],range[2]+1);
      return Promise.resolve({data,error,count}).then(resolve,reject);
    }};
    for (const method of ['select','eq','order','range','or','in','limit']) q[method] = (...args) => { calls.push([method,...args]); return q; };
    return q;
  }};
  return { queries: load('src/lib/queries.ts', {'./supabase/client': {supabaseBrowser: () => client}}), dispatched, chains };
}
const products = Array.from({length:12}, (_,i) => ({ id:`p${i}`, musinsa_no:100+i, name:i===2?null:`Jacket ${i}`, brands:i===1?null:{id:'brand',name:'Brand'}, review_count:100-i, is_own:true, style_no:`ST${i}`, erp_style_code:`ERP${i}` }));
products.push({...products[0],id:'competitor',is_own:false,review_count:999});
const option = p => ({id:p.id,musinsa_no:p.musinsa_no,name:p.name,brand_name:p.brand_name});
test('actual query dispatch 2 → 1, snapshot 0, count 0; option parity through ten-row boundary', async () => {
  for (const keyword of ['', 'jacket', 'ST1', 'ERP3', 'absent', ' Jacket ']) {
    const old = mockQuery(products), next = mockQuery(products);
    const before = (await old.queries.fetchOwnProductsWithPrices({keyword,limit:10,offset:0})).rows;
    const after = await next.queries.fetchReviewProductOptions(keyword);
    assert.deepEqual(after, before.map(option));
    assert.equal(next.dispatched.length,1);
    assert.equal(next.dispatched.filter(t=>t==='ranking_snapshots').length,0);
    assert.equal(old.dispatched.length,before.length?2:1);
    assert.equal(next.chains[0].calls.filter(c=>c[0]==='select' && c[2]?.count).length,0);
    assert.deepEqual(next.chains[0].calls.find(c=>c[0]==='select'),['select','id, musinsa_no, name, brands(name)']);
    assert.deepEqual(next.chains[0].calls.find(c=>c[0]==='eq'),['eq','is_own',true]);
    assert.deepEqual(next.chains[0].calls.find(c=>c[0]==='order'),['order','review_count',{ascending:false}]);
    assert.deepEqual(next.chains[0].calls.find(c=>c[0]==='range'),['range',0,9]);
    for (const excluded of [new Set(),new Set(['p0','p9']),new Set(after.map(p=>p.id))])
      assert.deepEqual(after.filter(p=>!excluded.has(p.id)),before.filter(p=>!excluded.has(p.id)).map(option));
    if (!keyword) {assert.equal(after.length,10);assert.equal(after[1].brand_name,'—');assert.equal(after[2].name,'—');assert.ok(!after.some(p=>p.id==='p10'));}
  }
});
test('product query errors propagate and do not dispatch snapshots',async()=>{
  const error = Error('offline'), f=mockQuery(products,error);
  await assert.rejects(f.queries.fetchReviewProductOptions('Jacket'),e=>e===error);
  assert.deepEqual(f.dispatched,['products']);
});
function fixture(search, selected = []) {
  const timers=new Map(); let clock=0, id=0; const reads=[];
  const Empty=({children})=>React.createElement('div',{},children);
  const context={React,exports:{},require,console,Map,Set,
    lsRead:()=>({products:selected}),kstToday:()=> '2026-10-12',kstDaysAgo:()=> '2026-10-11',
    ALL_CATEGORY_CODES:new Set(), CATEGORY_ENTRIES:[], HEIGHT_MIN:150,HEIGHT_MAX:195,WEIGHT_MIN:45,WEIGHT_MAX:110,SATISFACTION_ATTRS:[],
    document:{addEventListener(){},removeEventListener(){}},localStorage:{setItem(){}},
    fetchOwnBrands:async()=>[],fetchReviews:async opts=>{reads.push(opts);return {rows:[],total:0}},
    fetchReviewProductOptions:search,PeriodFilter:Empty,RangeSlider:Empty,FilterBlock:Empty,CheckRow:Empty,IcX:Empty,IcArrowUR:Empty,NoteDrawer:Empty,ReviewCard:Empty,
    setTimeout(fn,delay){timers.set(++id,{fn,at:clock+delay});return id},clearTimeout(id){timers.delete(id)},
  };
  const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='RvBrowse').getText(ast);
  vm.runInNewContext(ts.transpileModule(fn+'\nexports.View=RvBrowse;', {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,context);
  return {View:context.exports.View,reads,async tick(ms){clock+=ms;await React.act(async()=>{for(const [id,t] of timers) if(t.at<=clock){timers.delete(id);t.fn()}})}};
}
const input=root=>root.root.findByProps({placeholder:'상품명/스타일코드 검색'});
const change=async(root,value)=>React.act(async()=>input(root).props.onChange({target:{value}}));
const choices=root=>root.root.findAll(n=>n.type==='div'&&n.props.className==='hover');
const content=root=>JSON.stringify(root.toJSON());
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
test('actual picker debounce, display, select id/name, clear and selected exclusion preserve semantics',async()=>{
  const f=fixture(mockQuery(products).queries.fetchReviewProductOptions,[['p0','Jacket 0']]);let root;
  try {
    await React.act(async()=>{root=Renderer.create(React.createElement(f.View))});
    await change(root,'ST');await f.tick(299);assert.equal(choices(root).length,0);await f.tick(1);
    assert.equal(choices(root).length,9);assert.match(content(root),/—.*no\./);assert.doesNotMatch(content(root),/no\.110/);
    await React.act(async()=>choices(root)[0].props.onMouseDown({preventDefault(){}}));
    assert.equal(input(root).props.value,'');assert.deepEqual(Array.from(f.reads.at(-1).productIds),['p0','p1']);
    await change(root,'ST');await f.tick(300);assert.equal(choices(root).length,8);
    const chip=root.root.findAllByType('span').find(n=>n.children.includes('Jacket 1')).parent.findAllByType('span').find(n=>n.props.onClick);
    assert.ok(chip);await React.act(async()=>chip.props.onClick());assert.deepEqual(Array.from(f.reads.at(-1).productIds),['p0']);
    await f.tick(300);assert.equal(choices(root).length,9);
    await change(root,'absent');await f.tick(300);assert.match(content(root),/결과 없음/);
    await change(root,'   ');await f.tick(300);assert.equal(choices(root).length,0);
  } finally {if(root) await React.act(async()=>root.unmount())}
});
test('late success/failure cannot overwrite newer search, clearing cancels and unmount prevents pending dispatch',async()=>{
  const pending=[]; const f=fixture(()=>{const d=deferred();pending.push(d);return d.promise});let root;
  try {
    await React.act(async()=>{root=Renderer.create(React.createElement(f.View))});
    await change(root,'old');await f.tick(300);await change(root,'new');await f.tick(300);
    await React.act(async()=>pending[1].resolve([{id:'new',name:'New',brand_name:'Brand',musinsa_no:'2'}]));
    await React.act(async()=>pending[0].resolve([{id:'old',name:'Old',brand_name:'Brand',musinsa_no:'1'}]));
    assert.match(content(root),/New/);assert.doesNotMatch(content(root),/Old/);
    await change(root,'failure');await f.tick(300);await React.act(async()=>pending[2].reject(Error('offline')));assert.doesNotMatch(content(root),/검색 중/);
    await change(root,'clear');await f.tick(300);await change(root,'');await React.act(async()=>pending[3].resolve([{id:'late',name:'Late'}]));
    await change(root,'pending');await React.act(async()=>root.unmount());root=null;await f.tick(300);assert.equal(pending.length,4);
  }finally{if(root)await React.act(async()=>root.unmount())}
});
test('obsolete failure cannot clear current loading and pending response after unmount is ignored',async()=>{
  const pending=[],f=fixture(()=>{const d=deferred();pending.push(d);return d.promise});let root;
  try {
    await React.act(async()=>{root=Renderer.create(React.createElement(f.View))});
    await change(root,'old');await f.tick(300);await change(root,'current');await f.tick(300);
    await React.act(async()=>pending[0].reject(Error('old failure')));assert.match(content(root),/검색 중/);
    await React.act(async()=>pending[1].resolve([]));assert.match(content(root),/결과 없음/);
    await change(root,'unmount');await f.tick(300);await React.act(async()=>root.unmount());root=null;
    await React.act(async()=>pending[2].resolve([{id:'late',name:'Late'}]));
  }finally{if(root)await React.act(async()=>root.unmount())}
});
