const { readSource } = require('./performance-source.cjs');
// Independent source-only edge checks. No React/Next/Supabase runtime, network, or timing benchmark.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); await new Promise(setImmediate); };
function effect(file, marker, endMarker) {
  const source = readSource(file);
  const start = source.indexOf(marker), end = source.indexOf(endMarker, start) + endMarker.length;
  assert.ok(start >= 0 && end > start);
  return ts.transpileModule(source.slice(start, end), {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
}
const detailCode = file => effect(file, '  React.useEffect(() => {\n    if (!selectedNo) return;', '  }, [selectedNo]);');
async function detail(file, configs, navigationAt) {
  let now = 0, events = [], calls = [], writes = [], cleanup;
  const defaults = {detail:10,price:100,rank:80,category:70,reviews:50,body:30};
  const mount = (id, options = {}) => {
    const delays = {...defaults, ...options.delays};
    const values = {detail:{id,is_own:true,name:id,musinsa_no:id,brand_name:id}, price:[id], rank:[id], category:{rows:[id],snapshot_date:id}, reviews:{rows:[id]}, body:{totalSampled:1}, ...options.values};
    const fn = name => (...args) => {
      calls.push({id,name,args,at:now});
      const fail = (options.fail || []).includes(name);
      if (delays[name] === 0) return fail ? Promise.reject(Error(name)) : Promise.resolve(values[name]);
      return new Promise((resolve,reject) => events.push({at:now+delays[name], run:()=>fail?reject(Error(name)):resolve(values[name])}));
    };
    const box = {React:{useEffect:f=>{cleanup=f();}},selectedNo:id,Promise, console:{error:e=>writes.push({id,key:'Error',value:e.message,at:now})},window:{dispatchEvent:event=>writes.push({id,key:'Event',value:event.type,at:now})},CustomEvent:function(type){this.type=type},fetchProductHistories:async(...args)=>{const [price,rank]=await Promise.all([fn('price')(...args),fn('rank')(...args)]);return {price,rank};},fetchProductDetail:fn('detail'),fetchProductPriceHistory:fn('price'),fetchProductRankHistory:fn('rank'),fetchProductCategoryRanks:fn('category'),fetchReviews:fn('reviews'),fetchBodyStats:fn('body')};
    for (const key of ['StateProductNo','Loading','Detail','Reviews','RankHistory','CategoryRanks','CategoryRanksDate','PriceHistory','BodyStats']) box['set'+key] = value => writes.push({id,key,value,at:now});
    vm.runInNewContext(detailCode(file),box);
  };
  mount('A',configs[0]);
  if(navigationAt !== undefined) events.push({at:navigationAt,run:()=>{cleanup();mount('B',configs[1]);}});
  await flush();
  while(events.length){events.sort((a,b)=>a.at-b.at);const event=events.shift();now=event.at;event.run();await flush();}
  return JSON.parse(JSON.stringify({calls,writes}));
}
(async () => {
  const before='source/product-page.tsx',after='detail-candidate/product-page.tsx',checks=[];
  const ancillary=w=>w.filter(x=>!(x.key==='BodyStats'&&x.value===null)).filter(x=>!['PriceHistory','RankHistory','CategoryRanks','CategoryRanksDate','Loading','StateProductNo'].includes(x.key)).map(({at,...x})=>x);
  // Rejections occur before first-wave completion, with real Node turn boundaries.
  for (const fail of [['reviews'],['body'],['reviews','body']]) {
    const opts={fail,delays:{reviews:0,body:0}};
    const a=await detail(before,[opts]), b=await detail(after,[opts]);
    assert.deepEqual(ancillary(b.writes),ancillary(a.writes));
    checks.push({case:'immediate rejection '+fail.join('+'),ancillaryStateAndEventParity:true});
  }
  // History transport is independent; product identity/extras remain usable.
  const opts={fail:['price'],delays:{price:1,detail:10}};
  const b=await detail(after,[opts]);assert.equal(b.calls.length,3);
  assert.ok(b.calls.some(x=>x.name==='reviews'));assert.ok(b.writes.some(x=>x.key==='Detail'&&x.value));
  assert.ok(!b.calls.some(x=>['price','rank'].includes(x.name)));
  checks.push({case:'independent history panel cannot suppress product context',ancillaryReadersPreserved:true});
  // Navigate after first-wave publication while old extras remain pending; B wins.
  const nav = await detail(after,[{delays:{price:15,rank:15,category:15,reviews:100,body:100}},{delays:{detail:0,price:0,rank:0,category:0,reviews:0,body:0}}],20);
  assert.ok(!nav.writes.some(x=>x.id==='A'&&x.at>=20));
  assert.equal(nav.writes.filter(x=>x.key==='Detail').at(-1).value.id,'B');
  assert.equal(nav.writes.filter(x=>x.key==='Reviews').at(-1).value[0],'B');
  checks.push({case:'A to B navigation after first-wave publication',noStaleAWritesOrEvents:true});
  // Non-throwing empty/partial helper outputs still flow to the existing UI boundary.
  const partial = {values:{price:[],rank:[],category:{rows:[],snapshot_date:''},reviews:{rows:[]},body:{byHeight:[],byWeight:[],totalSampled:0}}};
  const pa=await detail(before,[partial]),pb=await detail(after,[partial]);
  assert.deepEqual(ancillary(pb.writes),ancillary(pa.writes));
  assert.deepEqual(pb.calls.map(({at,...x})=>x),pa.calls.filter(x=>!['price','rank','category'].includes(x.name)).map(({at,...x})=>x));
  checks.push({case:'empty ancillary/history responses',ancillaryStateEventAndArgumentParity:true});
  console.log(JSON.stringify({classification:'Independent VM source checks; no framework runtime/typecheck, browser, or production latency verification',passed:checks.length,checks},null,2));
})().catch(error=>{console.error(error);process.exitCode=1});
