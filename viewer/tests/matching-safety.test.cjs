const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-source.cjs');
const own = {brand_id:'own-brand',category_code:'001',category_d2_code:'001004',category_path:'상의 > 티셔츠 > 긴팔'};
const ok = (data,count=Array.isArray(data)?data.length:null) => ({data,error:null,status:200,count});
const initial = [
  {competitor_product_id:'old-auto',status:'auto',score:70},
  {competitor_product_id:'a',status:'confirmed',score:null},
  {competitor_product_id:'b',status:'excluded',score:65},
  {competitor_product_id:'manual',status:'manual',score:null},
];
function harness({failStage, failure, tier=0, rows=initial, candidates, pool, source=own, ambiguousApply=false}={}) {
  let state = structuredClone(rows);
  const calls = [];
  let candidateReads = 0;
  const client = {from(table) {
    const ops = [];
    const query = new Proxy({}, {get(_, method) {
      if (method === 'then') return (resolve,reject) => Promise.resolve().then(() => {
        const mutation = ops.some(o => ['delete','insert','update','upsert'].includes(o[0]));
        let stage, result;
        const eq = key => ops.find(o => o[0]==='eq' && o[1]===key)?.[2];
        const range = ops.find(o => o[0]==='range');
        if (mutation) {
          stage = ops.some(o => o[0]==='insert') ? 'insert' : eq('status')==='excluded' ? 'reset' : 'delete';
          if (stage !== failStage || ambiguousApply) {
            if (stage==='insert') state.push(...structuredClone(ops.find(o=>o[0]==='insert')[1]));
            else state = state.filter(r=>r.status!==eq('status'));
          }
          result = {data:null,error:null,status:204};
        } else if (table==='competitor_brands') {
          stage = range?.[1] ? 'pool-page' : 'pool';
          result = ok((pool ?? [{brand_id:'pool-brand'}]).slice(range[1],range[2]+1),(pool ?? [{brand_id:'pool-brand'}]).length);
        } else if (table==='product_matches') {
          stage = range?.[1] ? 'existing-page' : 'existing';
          result = ok(state.slice(range[1],range[2]+1),state.length);
        } else if (ops.some(o=>o[0]==='single')) { stage='own'; result=ok(source); }
        else {
          const index = candidateReads++;
          stage = index%2===0 ? 'A' : 'B';
          result = ok(index < tier*2 ? [] : candidates?.[stage] ?? [{id:stage==='A'?'a':'b'}]);
        }
        calls.push({table,ops,stage,mutation});
        if (stage===failStage) {
          if (failure instanceof Error) throw failure;
          return failure;
        }
        return result;
      }).then(resolve,reject);
      return (...args) => {ops.push([method,...args]); return query;};
    }});
    return query;
  }};
  const queries = load('src/lib/queries.ts', {'./supabase/client':{supabaseBrowser:()=>client}});
  return {queries,calls,state:()=>state};
}
const malformed = [null,undefined,{}, {data:[],error:undefined},ok(null),ok({}),ok([null]),ok([{}]),
  {data:[],error:{message:'offline read failed'},status:500},new Error('offline transport failed')];
for (const fn of ['runAutoMatch','resetAndAutoMatch']) {
  for (const stage of ['own','pool','A','B','existing']) {
    for (const [index,failure] of malformed.entries()) {
      test(`${fn}: ${stage} failure ${index} preserves every row and makes zero mutations`,async()=>{
        const h=harness({failStage:stage,failure});
        await assert.rejects(h.queries[fn]('own-product'));
        assert.deepEqual(h.state(),initial);
        assert.equal(h.calls.filter(c=>c.mutation).length,0);
        if (stage==='A'||stage==='B') assert.equal(h.calls.filter(c=>c.stage==='A'||c.stage==='B').length,2);
      });
    }
  }
  for (const stage of ['pool-page','existing-page']) {
    test(`${fn}: later ${stage} failure also makes zero mutations`,async()=>{
      const pool=Array.from({length:501},(_,i)=>({brand_id:`pool-${i}`}));
      const rows=Array.from({length:501},(_,i)=>({competitor_product_id:`existing-${i}`,status:'confirmed'}));
      const h=harness({pool,rows,failStage:stage,failure:ok(null)});
      await assert.rejects(h.queries[fn]('own-product'));
      assert.deepEqual(h.state(),rows); assert.ok(!h.calls.some(c=>c.mutation));
    });
  }
  for (const candidates of [{A:[{id:'same'}],B:[{id:'same'}]}, {A:[{id:'own-product'}],B:[]}]) {
    test(`${fn}: invalid replacement plan makes zero mutations`,async()=>{
      const h=harness({candidates}); await assert.rejects(h.queries[fn]('own-product'));
      assert.deepEqual(h.state(),initial); assert.ok(!h.calls.some(c=>c.mutation));
    });
  }
  test(`${fn}: normal empty tiers are distinct from failures`,async()=>{
    const h=harness({candidates:{A:[],B:[]}});
    assert.equal(await h.queries[fn]('own-product'),0);
    assert.equal(h.calls.filter(c=>['A','B'].includes(c.stage)).length,8);
    assert.deepEqual(h.state(),initial.filter(r=>r.status!=='auto' && !(fn==='resetAndAutoMatch'&&r.status==='excluded')));
    const firstMutation=h.calls.findIndex(c=>c.mutation);
    assert.equal(h.calls[firstMutation-1].stage,'existing');
  });
}
for (const [tier,scoreA,scoreB] of [[0,100,65],[1,90,60],[2,85,50],[3,70,35]]) {
  test(`normal tier ${tier}: priorities, scores and protected statuses survive`,async()=>{
    const h=harness({tier,candidates:{A:[{id:'fresh-a'},{id:'a'},{id:'manual'}],B:[{id:'fresh-b'},{id:'b'}]}});
    assert.equal(await h.queries.runAutoMatch('own-product'),2);
    assert.deepEqual(h.state().filter(r=>r.status!=='auto'),initial.filter(r=>r.status!=='auto'));
    assert.deepEqual(h.state().filter(r=>r.status==='auto').map(r=>[r.competitor_product_id,r.score]),[['fresh-a',scoreA],['fresh-b',scoreB]]);
    assert.equal(h.calls.filter(c=>['A','B'].includes(c.stage)).length,(tier+1)*2);
    assert.equal(h.calls.findIndex(c=>c.mutation),h.calls.findIndex(c=>c.stage==='existing')+1);
    const a=h.calls.find(c=>c.stage==='A'); const b=h.calls.find(c=>c.stage==='B');
    assert.ok(a.ops.some(o=>o[0]==='limit'&&o[1]===500));
    assert.ok(b.ops.some(o=>o[0]==='limit'&&o[1]===30));
    assert.ok(b.ops.some(o=>o[0]==='order'&&o[1]==='review_count'&&o[2].ascending===false));
  });
}
test('all protected candidates keep negative count and reset releases only exclusions',async()=>{
  const normal=harness(); assert.equal(await normal.queries.runAutoMatch('own-product'),-2);
  assert.deepEqual(normal.state(),initial.filter(r=>r.status!=='auto'));
  const reset=harness(); assert.equal(await reset.queries.resetAndAutoMatch('own-product'),1);
  assert.deepEqual(reset.state().filter(r=>r.status!=='auto'),initial.filter(r=>!['auto','excluded'].includes(r.status)));
  assert.deepEqual(reset.state().filter(r=>r.status==='auto').map(r=>r.competitor_product_id),['b']);
});
for (const fn of ['runAutoMatch','resetAndAutoMatch']) {
  for (const [label,opts] of [['empty pool',{pool:[]}],['no category',{source:{...own,category_code:null,category_d2_code:null,category_path:null}}]]) {
    test(`${fn}: ${label} is a successful no-op`,async()=>{
      const h=harness(opts); assert.equal(await h.queries[fn]('own-product'),0);
      assert.deepEqual(h.state(),initial);assert.ok(!h.calls.some(c=>c.mutation));
    });
  }
  for (const stage of fn==='runAutoMatch'?['delete','insert']:['reset','delete','insert']) {
    for (const [index,failure] of [null,{}, {error:null}, {data:null,error:null}, {data:null,error:null,status:0}, {data:{},error:null,status:200}, {data:null,error:{message:'mutation rejected'},status:400}, {data:null,error:null,status:500},new Error('transport ambiguous')].entries()) {
      test(`${fn}: ${stage} failure ${index} stops immediately without retry`,async()=>{
        const h=harness({failStage:stage,failure,candidates:{A:[{id:'fresh'}],B:[]}});
        await assert.rejects(h.queries[fn]('own-product'));
        assert.equal(h.calls.at(-1).stage,stage);
        assert.equal(h.calls.filter(c=>c.stage===stage).length,1);
        if (stage==='reset'||stage==='delete'&&fn==='runAutoMatch') assert.deepEqual(h.state(),initial);
        if (stage==='insert') assert.ok(!h.state().some(r=>r.status==='auto'));
      });
    }
    test(`${fn}: ambiguous ${stage} may apply, but is never retried or compensated`,async()=>{
      const h=harness({failStage:stage,failure:null,ambiguousApply:true,candidates:{A:[{id:'fresh'}],B:[]}});
      await assert.rejects(h.queries[fn]('own-product'));
      assert.equal(h.calls.at(-1).stage,stage);assert.equal(h.calls.filter(c=>c.stage===stage).length,1);
      assert.notDeepEqual(h.state(),initial);
    });
  }
}

for (const response of [null, {}, ok(null), ok([{}]), ok([{id:'m',status:'auto'}]), {data:[],error:{message:'failed'},status:500}]) {
  test('match list rejects a malformed or failed read instead of showing successful empty results',async()=>{
    const query = new Proxy({}, {get:(_,method)=>method==='then'?(resolve,reject)=>Promise.resolve(response).then(resolve,reject):()=>query});
    const queries=load('src/lib/queries.ts',{'./supabase/client':{supabaseBrowser:()=>({from:()=>query})}});
    await assert.rejects(queries.fetchProductMatches('own-product'));
  });
}
for (const fn of ['runAutoMatch','resetAndAutoMatch']) {
  test(`${fn}: empty category strings preserve the successful no-op`,async()=>{
    const h=harness({source:{...own,category_code:'',category_d2_code:'',category_path:''}});
    assert.equal(await h.queries[fn]('own-product'),0);assert.deepEqual(h.state(),initial);assert.ok(!h.calls.some(c=>c.mutation));
  });
}
for (const fn of ['runAutoMatch','resetAndAutoMatch']) {
  for (const tier of [1,2,3]) for (const stage of ['A','B']) {
    test(`${fn}: failed candidate read prevents fallback after ${tier} normal empty tiers`,async()=>{
      // Fail only the chosen later tier, letting preceding tiers report genuine empty arrays.
      const results=[ok(own),ok([{brand_id:'pool'}]),...Array.from({length:tier*2},()=>ok([])),
        stage==='A'?{data:null,error:{message:'failed'},status:500}:ok([]),
        stage==='B'?{data:null,error:{message:'failed'},status:500}:ok([])];
      const calls=[];
      const client={from(table){const ops=[];const query=new Proxy({}, {get:(_,method)=>method==='then'?(resolve,reject)=>{
        calls.push({table,ops}); assert.ok(results.length,'must not fall back or mutate');
        return Promise.resolve(results.shift()).then(resolve,reject);
      }:(...args)=>{ops.push([method,...args]);return query;}});return query;}};
      const queries=load('src/lib/queries.ts',{'./supabase/client':{supabaseBrowser:()=>client}});
      await assert.rejects(queries[fn]('own-product'));
      assert.equal(results.length,0);assert.equal(calls.length,2+(tier+1)*2);
      assert.ok(!calls.some(c=>c.ops.some(o=>['delete','insert'].includes(o[0]))));
    });
  }
}
test('existing statuses beyond 1000 rows remain protected and old auto candidates can be regenerated',async()=>{
  const rows=Array.from({length:1001},(_,i)=>({competitor_product_id:`protected-${i}`,status:'confirmed',score:null}));
  rows.push({competitor_product_id:'old',status:'auto',score:70});
  const h=harness({rows,candidates:{A:[{id:'protected-1000'},{id:'old'}],B:[]}});
  assert.equal(await h.queries.runAutoMatch('own-product'),1);
  assert.deepEqual(h.state().filter(r=>r.status==='confirmed'),rows.slice(0,1001));
  assert.equal(h.state().find(r=>r.competitor_product_id==='old').score,100);
  assert.equal(h.calls.filter(c=>c.stage.startsWith('existing')).length,3);
});
test('reset succeeded then auto-delete failed: report failure and do not claim exclusion rollback',async()=>{
  const h=harness({failStage:'delete',failure:{data:null,error:{message:'delete failed'},status:400}});
  await assert.rejects(h.queries.resetAndAutoMatch('own-product'));
  assert.deepEqual(h.state(),initial.filter(r=>r.status!=='excluded'));
  assert.equal(h.calls.at(-1).stage,'delete');
});
