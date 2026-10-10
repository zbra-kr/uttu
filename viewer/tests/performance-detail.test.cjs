const { readSource } = require('./performance-source.cjs');
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require('typescript');
async function run(file, options={}) {
  const source=readSource(file);
  const start=source.indexOf('  React.useEffect(() => {\n    if (!selectedNo) return;');
  const end=source.indexOf('  }, [selectedNo]);',start)+'  }, [selectedNo]);'.length;
  assert.ok(start>=0&&end>start);
  const compiled=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  let now=0,events=[],calls=[],state=[],cleanup;
  const delays={detail:10,price:100,rank:80,category:70,reviews:50,body:30,...options.delays};
  const detail=options.empty?null:{id:'own-1',is_own:options.own!==false,name:'Fixture',musinsa_no:'123',brand_name:'Fixture'};
  const result={detail,price:[1],rank:[2],category:{rows:[3],snapshot_date:'2026-10-03'},reviews:{rows:[4]},body:{totalSampled:5}};
  const fn=name=>(...args)=>new Promise((resolve,reject)=>{
    calls.push({name,start:now,args});events.push({at:now+delays[name],run:()=>options.fail===name?reject(new Error(name)):resolve(result[name])});
  });
  const sandbox={React:{useEffect:f=>{cleanup=f()}},selectedNo:options.noSelection?'':'123',console:{error:e=>state.push(['error',e.message])},window:{dispatchEvent:()=>{}},CustomEvent:function(){},Promise,
    fetchProductHistories:async(...args)=>{const [price,rank]=await Promise.all([fn('price')(...args),fn('rank')(...args)]);return {price,rank};},fetchProductDetail:fn('detail'),fetchProductPriceHistory:fn('price'),fetchProductRankHistory:fn('rank'),fetchProductCategoryRanks:fn('category'),fetchReviews:fn('reviews'),fetchBodyStats:fn('body')};
  for(const name of ['StateProductNo','Loading','Detail','Reviews','RankHistory','CategoryRanks','CategoryRanksDate','PriceHistory','BodyStats'])sandbox['set'+name]=v=>state.push([name,v,now]);
  vm.runInNewContext(compiled,sandbox);
  if(options.cancelAt!==undefined)events.push({at:options.cancelAt,run:()=>cleanup()});
  while(events.length){events.sort((a,b)=>a.at-b.at);const e=events.shift();now=e.at;e.run();for(let i=0;i<20;i++)await Promise.resolve();}
  return JSON.parse(JSON.stringify({calls,state,ready:state.filter(x=>x[0]==='Loading'&&x[1]===false).at(0)?.[2]}));
}
const before='source/product-page.tsx',after='detail-candidate/product-page.tsx';
(async()=>{
 let total=0;const output=[];
 for(const [label,opts] of Object.entries({noSelection:{noSelection:true},own:{},external:{own:false},empty:{empty:true},detailFailure:{fail:'detail'},earlyHistoryFailure:{fail:'price',delays:{price:5}},priceFailure:{fail:'price'},reviewFailure:{fail:'reviews'},bodyFailure:{fail:'body'},earlyCancel:{cancelAt:5},lateCancel:{cancelAt:75}})){
  const a=await run(before,opts),b=await run(after,opts);
  const ancillary=state=>state.filter(x=>!(x[0]==='BodyStats'&&x[1]===null)).filter(x=>!['PriceHistory','RankHistory','CategoryRanks','CategoryRanksDate','Loading','StateProductNo'].includes(x[0])).map(x=>x.slice(0,2));
  if(!['earlyHistoryFailure','priceFailure','lateCancel'].includes(label))assert.deepEqual(ancillary(b.state),ancillary(a.state),label+' ancillary state/error parity');
  assert.ok(!b.calls.some(x=>['price','rank'].includes(x.name)),'history is owned by independent actual hook fixtures');
  if(['earlyHistoryFailure','priceFailure'].includes(label)){assert.ok(b.state.some(x=>x[0]==='Detail'&&x[1]));assert.ok(b.calls.some(x=>x.name==='reviews'));}
  if(opts.cancelAt!==undefined)assert.ok(!b.state.some(x=>x[2]>=opts.cancelAt));
  if(label==='own'){assert.equal(a.ready,150);assert.equal(b.ready,10);assert.equal(a.calls.find(x=>x.name==='reviews').start,100);assert.equal(b.calls.find(x=>x.name==='reviews').start,10);assert.deepEqual(b.calls.find(x=>x.name==='reviews').args,a.calls.find(x=>x.name==='reviews').args);}
  if(['noSelection','external','empty','detailFailure','earlyCancel'].includes(label))assert.ok(!b.calls.some(x=>x.name==='reviews'));
  output.push({scenario:label,beforeReady:a.ready??null,afterReady:b.ready??null,beforeRequests:a.calls.length,afterRequests:b.calls.length,ancillaryChecksPassed:true});total++;
 }
 console.log(JSON.stringify({classification:'Deterministic synthetic schedule in virtual milliseconds; NOT production latency. Query counts here are function calls, not HTTP requests.',passed:total,scenarios:output},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
