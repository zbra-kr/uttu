const test=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const {create,act}=require('react-test-renderer');
const load=require('./helpers/load-source.cjs');
global.IS_REACT_ACT_ENVIRONMENT=true;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const product=id=>({id,name:`Own-${id}`,musinsa_no:id,final_price:null});
const match=id=>({id,own_product_id:id,competitor_product_id:`c-${id}`,competitor_name:`Candidate-${id}`,competitor_brand:'brand',competitor_musinsa_no:id,score:100,status:'auto'});
const text=n=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):n?.children?text(n.children):'';
async function setup(overrides={},route=false,initialSession={user:{id:'account-1'}}){
  const calls=[],writes=[];let listener,unsubscribed=false;
  const auth={onAuthStateChange(cb){listener=cb;queueMicrotask(()=>{if(!unsubscribed)cb('INITIAL_SESSION',initialSession);});return {data:{subscription:{unsubscribe(){unsubscribed=true;}}}};}};
  const queries={CATEGORY_MAP:{},fetchOwnBrands:async()=>[{id:'brand-1',name:'Brand-1'},{id:'brand-2',name:'Brand-2'}],
    fetchOwnProductsWithPrices:async({brandIds})=>({rows:brandIds[0]==='brand-1'?[product('A'),product('B')]:[product('C')],total:2}),
    fetchProductMatches:async id=>[match(id)],...overrides};
  for(const name of ['fetchOwnBrands','fetchOwnProductsWithPrices','fetchProductMatches']){
    const run=queries[name];queries[name]=(...args)=>{calls.push([name,...args]);return run(...args);};
  }
  const {default:View}=load(route?'src/app/(app)/matching/page.tsx':'src/app/(app)/matching/MobileMatchingView.tsx',{
    react:{...React,useState(initial){const [value,set]=React.useState(initial);return [value,next=>{writes.push(next);set(next);}];}},
    '@/lib/queries':queries,'@/lib/supabase/client':{supabaseBrowser:()=>({auth})},
    '@/hooks/useViewport':{useIsMobile:()=>true},
    'next/link':({children,...props})=>React.createElement('a',props,children),
  });
  let renderer;await act(async()=>{renderer=create(React.createElement(View));});
  const button=label=>renderer.root.findAllByType('button').find(n=>text(n)===label);
  const select=async id=>{const row=renderer.root.findAllByType('div').find(n=>n.props.onClick&&text(n).includes(`Own-${id}`));assert.ok(row,`product ${id} is visible`);await act(async()=>{row.props.onClick();});};
  return {renderer,calls,writes,button,select,text:()=>text(renderer.toJSON()),
    back:()=>act(async()=>{button('✕').props.onClick();}),
    brand:id=>act(async()=>{button(`Brand-${id}`).props.onClick();}),
    auth:(session,event='SIGNED_IN')=>act(async()=>{assert.ok(listener);listener(event,session);}),
    close:()=>act(async()=>renderer.unmount()),isUnsubscribed:()=>unsubscribed,
  };
}
test('baseline safety: late A matching success never overwrites selected B',async()=>{
  const pending=deferred();const h=await setup({fetchProductMatches:id=>id==='A'?pending.promise:Promise.resolve([match('B')])});
  await h.select('A');await h.back();await h.select('B');await act(async()=>pending.resolve([match('A')]));
  assert.match(h.text(),/Own-B/);assert.match(h.text(),/Candidate-B/);assert.doesNotMatch(h.text(),/Candidate-A/);await h.close();
});
test('baseline safety: late Brand-1 products never overwrite selected Brand-2',async()=>{
  const pending=deferred();const h=await setup({fetchOwnProductsWithPrices:({brandIds})=>brandIds[0]==='brand-1'?pending.promise:Promise.resolve({rows:[product('C')],total:1})});
  await h.brand(2);await act(async()=>pending.resolve({rows:[product('A')],total:1}));
  assert.match(h.text(),/Own-C/);assert.doesNotMatch(h.text(),/Own-A/);await h.close();
});
test('baseline safety: matching rejection shows error rather than successful empty results',async()=>{
  const h=await setup({fetchProductMatches:async()=>{throw new Error('synthetic failed read');}});
  await h.select('B');assert.match(h.text(),/오류/);assert.doesNotMatch(h.text(),/매칭된 경쟁 상품이 없습니다/);
  assert.ok(h.button('다시 시도'));await h.close();
});
test('late A error and finally do not change B loading or error state',async()=>{
  const a=deferred(),b=deferred();const h=await setup({fetchProductMatches:id=>id==='A'?a.promise:b.promise});
  await h.select('A');await h.back();await h.select('B');await act(async()=>a.reject(new Error('late A')));
  assert.match(h.text(),/Own-B/);assert.match(h.text(),/매칭 경쟁 상품 …/);assert.doesNotMatch(h.text(),/오류|매칭된 경쟁 상품이 없습니다/);
  await act(async()=>b.resolve([match('B')]));assert.match(h.text(),/Candidate-B/);await h.close();
});
for(const rejected of [false,true]) {
  test(`A→B→A ignores the first A ${rejected?'error':'success'} even with the same product ID`,async()=>{
    const first=deferred();let reads=0;const latest={...match('A'),id:'new-A',competitor_name:'Candidate-New-A'};
    const h=await setup({fetchProductMatches:id=>id==='A'?(++reads===1?first.promise:Promise.resolve([latest])):Promise.resolve([match('B')])});
    await h.select('A');await h.back();await h.select('B');await h.back();await h.select('A');
    await act(async()=>rejected?first.reject(new Error('old A failed')):first.resolve([match('A')]));
    assert.match(h.text(),/Candidate-New-A/);assert.doesNotMatch(h.text(),/Candidate-A|오류/);assert.equal(reads,2);await h.close();
  });
}
test('brand transition clears selection and ignores the previous brand matching response',async()=>{
  const pending=deferred();const h=await setup({fetchProductMatches:id=>id==='A'?pending.promise:Promise.resolve([match('C')])});
  await h.select('A');await h.brand(2);await h.select('C');await act(async()=>pending.resolve([match('A')]));
  assert.match(h.text(),/Own-C/);assert.match(h.text(),/Candidate-C/);assert.doesNotMatch(h.text(),/Own-A|Candidate-A/);await h.close();
});
test('Brand-1→Brand-2→Brand-1 ignores the first Brand-1 list and stale finally',async()=>{
  const first=deferred(),latest=deferred();let reads=0;
  const h=await setup({fetchOwnProductsWithPrices:({brandIds})=>brandIds[0]==='brand-1'?(++reads===1?first.promise:latest.promise):Promise.resolve({rows:[product('C')],total:1})});
  await h.brand(2);await h.brand(1);await act(async()=>first.resolve({rows:[product('A')],total:1}));
  assert.match(h.text(),/불러오는 중/);assert.doesNotMatch(h.text(),/Own-A|Own-C|상품이 없습니다/);
  await act(async()=>latest.resolve({rows:[product('B')],total:1}));assert.match(h.text(),/Own-B/);assert.doesNotMatch(h.text(),/Own-A/);await h.close();
});
test('late previous brand product rejection cannot replace the current successful list',async()=>{
  const pending=deferred();const h=await setup({fetchOwnProductsWithPrices:({brandIds})=>brandIds[0]==='brand-1'?pending.promise:Promise.resolve({rows:[product('C')],total:1})});
  await h.brand(2);await act(async()=>pending.reject(new Error('old brand failed')));
  assert.match(h.text(),/Own-C/);assert.doesNotMatch(h.text(),/오류|상품이 없습니다/);await h.close();
});
for(const stage of ['brands','products','matches']) {
  test(`${stage} failure is explicit and manual retry reads the same current target once`,async()=>{
    let reads=0;
    const options=stage==='brands'?{fetchOwnBrands:async()=>{if(++reads===1)throw new Error('brands');return [{id:'brand-1',name:'Brand-1'}];}}
      :stage==='products'?{fetchOwnProductsWithPrices:async()=>{if(++reads===1)throw new Error('products');return {rows:[product('A')],total:1};}}
      :{fetchProductMatches:async id=>{if(++reads===1)throw new Error('matches');return [match(id)];}};
    const h=await setup(options);if(stage==='matches')await h.select('A');
    assert.match(h.text(),/오류/);assert.doesNotMatch(h.text(),/상품이 없습니다|매칭된 경쟁 상품이 없습니다/);
    assert.ok(h.renderer.root.findAll(n=>n.props.role==='alert').length);
    const retry=h.button('다시 시도');await act(async()=>{retry.props.onClick();retry.props.onClick();});
    assert.equal(reads,2);assert.doesNotMatch(h.text(),/오류/);
    assert.match(h.text(),stage==='matches'?/Candidate-A/:/Own-A/);await h.close();
  });
}
test('matching retry response is discarded after switching brand/product',async()=>{
  const retry=deferred();let reads=0;
  const h=await setup({fetchProductMatches:id=>id==='A'?(++reads===1?Promise.reject(new Error('first')):retry.promise):Promise.resolve([match('C')])});
  await h.select('A');await act(async()=>{h.button('다시 시도').props.onClick();});await h.brand(2);await h.select('C');
  await act(async()=>retry.resolve([match('A')]));assert.match(h.text(),/Candidate-C/);assert.doesNotMatch(h.text(),/Candidate-A|오류/);await h.close();
});
for(const stage of ['brands','products','matches']) {
  test(`${stage} normal empty result is distinct from loading/error`,async()=>{
    const h=await setup(stage==='brands'?{fetchOwnBrands:async()=>[]}:stage==='products'?{fetchOwnProductsWithPrices:async()=>({rows:[],total:0})}:{fetchProductMatches:async()=>[]});
    if(stage==='matches')await h.select('A');
    assert.match(h.text(),stage==='brands'?/자사 브랜드가 없습니다/:stage==='products'?/상품이 없습니다/:/매칭된 경쟁 상품이 없습니다/);
    assert.doesNotMatch(h.text(),/오류|불러오는 중/);assert.equal(h.button('다시 시도'),undefined);await h.close();
  });
}
for(const response of [null,{},[null],[{id:'bad',own_product_id:'different-product'}]]) {
  test('malformed or wrong-product matching response is an error, never an empty/other-target list',async()=>{
    const h=await setup({fetchProductMatches:async()=>response});await h.select('A');
    assert.match(h.text(),/오류|확인 불가/);assert.doesNotMatch(h.text(),/매칭된 경쟁 상품이 없습니다/);await h.close();
  });
}
for(const stage of ['brands','products','matches'])for(const rejection of [false,true]) {
  test(`unmount cancels ${stage} late ${rejection?'failure':'success'} and auth callback state writes`,async()=>{
    const pending=deferred();const h=await setup(stage==='brands'?{fetchOwnBrands:()=>pending.promise}:stage==='products'?{fetchOwnProductsWithPrices:()=>pending.promise}:{fetchProductMatches:()=>pending.promise});
    if(stage==='matches')await h.select('A');await h.close();assert.equal(h.isUnsubscribed(),true);const before=h.writes.length;
    await act(async()=>rejection?pending.reject(new Error('late unmounted')):pending.resolve(stage==='brands'?[{id:'brand-1',name:'Brand-1'}]:stage==='products'?{rows:[product('A')],total:1}:[match('A')]));
    await h.auth({user:{id:'account-2'}});assert.equal(h.writes.length,before,'no setters after unmount');
  });
}
test('account switch reloads brands/products and ignores old matching and product requests',async()=>{
  const old=deferred();let actor='account-1';
  const h=await setup({fetchOwnBrands:async()=>[{id:actor,name:`Brand-${actor}`}],
    fetchOwnProductsWithPrices:async()=>({rows:[product(actor==='account-1'?'A':'C')],total:1}),
    fetchProductMatches:id=>id==='A'?old.promise:Promise.resolve([match('C')])});
  await h.select('A');actor='account-2';await h.auth({user:{id:actor}});await h.select('C');
  await act(async()=>old.resolve([match('A')]));assert.match(h.text(),/Brand-account-2|Candidate-C/);assert.doesNotMatch(h.text(),/Brand-account-1|Own-A|Candidate-A/);
  assert.equal(h.calls.filter(c=>c[0]==='fetchOwnBrands').length,2);await h.close();
});
test('old account brands/products responses cannot choose a brand or overwrite new account rows',async()=>{
  const oldBrands=deferred();let reads=0;
  const h=await setup({fetchOwnBrands:()=>++reads===1?oldBrands.promise:Promise.resolve([{id:'brand-2',name:'Brand-2'}])});
  await h.auth({user:{id:'account-2'}});await act(async()=>oldBrands.resolve([{id:'brand-1',name:'Brand-1'}]));
  assert.match(h.text(),/Brand-2|Own-C/);assert.doesNotMatch(h.text(),/Brand-1|Own-A/);await h.close();
});
test('logout/signin reloads once; same-user token/duplicate events preserve the selected matches',async()=>{
  const h=await setup();await h.select('A');const before=h.calls.length;
  for(const event of ['TOKEN_REFRESHED','SIGNED_IN','INITIAL_SESSION','TOKEN_REFRESHED'])await h.auth({user:{id:'account-1'}},event);
  assert.equal(h.calls.length,before);assert.match(h.text(),/Candidate-A/);
  await h.auth(null,'SIGNED_OUT');await h.auth(null,'SIGNED_OUT');assert.match(h.text(),/로그인 후/);assert.doesNotMatch(h.text(),/Candidate-A|Own-A|Brand-1/);assert.equal(h.calls.length,before);
  await h.auth({user:{id:'account-1'}});assert.equal(h.calls.length,before+2);assert.match(h.text(),/Own-A|Brand-1/);assert.doesNotMatch(h.text(),/Candidate-A/);await h.close();
});
test('initial signed-out session makes no reads until signin',async()=>{
  const h=await setup({},false,null);assert.equal(h.calls.length,0);assert.match(h.text(),/로그인 후/);
  await h.auth({user:{id:'account-1'}});assert.equal(h.calls.length,2);assert.match(h.text(),/Own-A/);await h.close();
});
test('mobile viewport route executes the actual MobileMatchingView',async()=>{
  const h=await setup({},true);await h.select('B');assert.match(h.text(),/Own-B|Candidate-B/);assert.doesNotMatch(h.text(),/자동 매칭 실행|경쟁 브랜드 풀 구성/);await h.close();
});
for(const failed of [false,true]) {
  test(`old account product ${failed?'failure':'success'} cannot replace the new account list`,async()=>{
    const old=deferred();let reads=0;
    const h=await setup({fetchOwnProductsWithPrices:()=>++reads===1?old.promise:Promise.resolve({rows:[product('C')],total:1})});
    await h.auth({user:{id:'account-2'}});
    await act(async()=>failed?old.reject(new Error('old products failed')):old.resolve({rows:[product('A')],total:1}));
    assert.match(h.text(),/Own-C/);assert.doesNotMatch(h.text(),/Own-A|오류|불러오는 중/);await h.close();
  });
}
test('late matching error after account switch does not replace new selected product data',async()=>{
  const old=deferred();let reads=0;
  const h=await setup({fetchProductMatches:id=>++reads===1?old.promise:Promise.resolve([match(id)])});
  await h.select('A');await h.auth({user:{id:'account-2'}});await h.select('B');
  await act(async()=>old.reject(new Error('old user matching failure')));assert.match(h.text(),/Candidate-B/);assert.doesNotMatch(h.text(),/오류|Candidate-A/);await h.close();
});
test('callbacks retained from the old account cannot select or close a new account target',async()=>{
  const h=await setup();const oldSelect=h.renderer.root.findAllByType('div').find(n=>n.props.onClick&&text(n).includes('Own-A')).props.onClick;
  await h.select('A');const oldClose=h.button('✕').props.onClick;await h.auth({user:{id:'account-2'}});await h.select('B');
  const before=h.calls.length;await act(async()=>{oldClose();oldSelect();});
  assert.match(h.text(),/Own-B|Candidate-B/);assert.doesNotMatch(h.text(),/Candidate-A/);assert.equal(h.calls.length,before);await h.close();
});
