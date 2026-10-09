const test=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const {create,act}=require('react-test-renderer');
const load=require('./helpers/load-source.cjs');
global.IS_REACT_ACT_ENVIRONMENT=true;
global.sessionStorage={getItem:()=>null,setItem:()=>{}};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const product=id=>({id,name:`own-${id}`,musinsa_no:id,review_count:0});
const match=id=>({id,competitor_product_id:id,competitor_name:`candidate-${id}`,competitor_brand:'brand',competitor_musinsa_no:id,competitor_review_count:0,status:'auto',score:100});
const content=node=>typeof node==='string'?node:Array.isArray(node)?node.map(content).join(''):node?.children?content(node.children):'';
async function setup(overrides={}, {selectInitial=true}={}) {
  const calls=[];
  const mock={CATEGORY_MAP:{},fetchOwnBrands:async()=>[],fetchCompetitorBrands:async()=>[],
    fetchOwnProductsWithPrices:async()=>({rows:[product('A'),product('B')],total:2}),
    fetchProductMatches:async id=>[match(id)],
    runAutoMatch:async id=>{calls.push(['auto',id]);return 1;},
    resetAndAutoMatch:async id=>{calls.push(['reset',id]);return 1;},
    setMatchStatus:async(...args)=>{calls.push(['status',...args]);},
    addManualMatch:async(...args)=>{calls.push(['manual',...args]);},
    searchCompetitorProducts:async()=>[],...overrides};
  let authListener;
  const auth={onAuthStateChange(listener){authListener=listener;queueMicrotask(()=>listener('INITIAL_SESSION',{user:{id:'account-1'}}));return {data:{subscription:{unsubscribe(){}}}};}};
  const {default:Page}=load('src/app/(app)/matching/page.tsx',{
    '@/hooks/useViewport':{useIsMobile:()=>false},'@/lib/queries':mock,
    '@/lib/supabase/client':{supabaseBrowser:()=>({auth})},
    'next/link':({children,...props})=>React.createElement('a',props,children),
  });
  let renderer;
  await act(async()=>{renderer=create(React.createElement(Page));});
  const button=text=>renderer.root.findAllByType('button').find(n=>content(n).includes(text));
  const select=async id=>{const row=renderer.root.findAllByType('div').find(n=>n.props.onClick&&content(n).includes(`own-${id}`));await act(async()=>{row.props.onClick();});};
  await act(async()=>{button('상품 매칭').props.onClick();});
  if(selectInitial)await select('A');
  return {renderer,calls,button,select,authChange:(session,event='SIGNED_IN')=>act(async()=>{authListener(event,session);}),text:()=>content(renderer.toJSON()),close:()=>act(async()=>renderer.unmount())};
}
test('same-tick double click and status change dispatch exactly one auto operation',async()=>{
  const pending=deferred();let count=0;
  const h=await setup({runAutoMatch:()=>{count++;return pending.promise;}});
  const run=h.button('자동 매칭 실행');
  const status=h.renderer.root.findAllByType('button').find(n=>n.props.title==='제외');
  await act(async()=>{run.props.onClick();run.props.onClick();status.props.onClick();});
  assert.equal(count,1);assert.equal(h.calls.length,0);
  assert.equal(h.button('실행 중').props.disabled,true);
  await act(async()=>pending.resolve(1));
  assert.match(h.text(),/1건 후보 생성 완료/);await h.close();
});
test('reset shares the synchronous lock and prevents double reset',async()=>{
  const pending=deferred();let count=0;
  const h=await setup({runAutoMatch:async()=>-2,resetAndAutoMatch:()=>{count++;return pending.promise;}});
  await act(async()=>{h.button('자동 매칭 실행').props.onClick();});
  const reset=h.button('초기화 후 재실행');
  await act(async()=>{reset.props.onClick();reset.props.onClick();});
  assert.equal(count,1);
  await act(async()=>pending.reject(new Error('reset failed')));
  assert.match(h.text(),/오류:/);assert.doesNotMatch(h.text(),/후보 생성 완료/);await h.close();
});
for (const reject of [false,true]) {
  test(`selection switch suppresses previous mutation ${reject?'failure':'success'} and stale message`,async()=>{
    const pending=deferred();const reads=[];
    const h=await setup({runAutoMatch:()=>pending.promise,fetchProductMatches:async id=>{reads.push(id);return [match(id)];}});
    await act(async()=>{h.button('자동 매칭 실행').props.onClick();});
    await h.select('B');
    await act(async()=>reject?pending.reject(new Error('old failure')):pending.resolve(2));
    assert.match(h.text(),/candidate-B/);assert.doesNotMatch(h.text(),/candidate-A|오류:|후보 생성 완료/);
    assert.deepEqual(reads,['A','B']);assert.equal(h.button('자동 매칭 실행').props.disabled,false);await h.close();
  });
}
test('A to B to A reconciles the outstanding A operation',async()=>{
  const pending=deferred();let reads=0;
  const h=await setup({runAutoMatch:()=>pending.promise,fetchProductMatches:async id=>{reads++;return [match(`${id}-${reads}`)];}});
  await act(async()=>{h.button('자동 매칭 실행').props.onClick();});await h.select('B');await h.select('A');
  await act(async()=>pending.resolve(9));
  assert.match(h.text(),/candidate-A-4/);assert.match(h.text(),/9건 후보 생성 완료/);assert.equal(reads,4);await h.close();
});
test('late selection read cannot replace current rows',async()=>{
  const pending=deferred();
  const h=await setup({fetchProductMatches:id=>id==='A'?pending.promise:Promise.resolve([match('B')])});
  await h.select('B');await act(async()=>pending.resolve([match('old-A')]));
  assert.match(h.text(),/candidate-B/);assert.doesNotMatch(h.text(),/candidate-old-A/);await h.close();
});
for (const stage of ['mutation','refresh','status','read']) {
  test(`${stage} failure is visible, preserves displayed rows when present, and does not retry`,async()=>{
    let runs=0,reads=0,statusCalls=0;
    const h=await setup({
      runAutoMatch:async()=>{runs++;if(stage==='mutation')throw new Error('failed');return 1;},
      fetchProductMatches:async id=>{reads++;if(stage==='read'||stage==='refresh'&&reads>1)throw new Error('read failed');return [match(id)];},
      setMatchStatus:async()=>{statusCalls++;throw new Error('status failed');},
    });
    if(stage==='status') await act(async()=>h.renderer.root.findAllByType('button').find(n=>n.props.title==='제외').props.onClick());
    else if(stage!=='read') await act(async()=>{h.button('자동 매칭 실행').props.onClick();});
    assert.match(h.text(),/오류:/);assert.doesNotMatch(h.text(),/후보 생성 완료/);
    assert.ok(h.renderer.root.findAll(n=>n.props.role==='alert').length>0);
    if(stage!=='read')assert.match(h.text(),/candidate-A/);
    assert.equal(runs,stage==='mutation'||stage==='refresh'?1:0);
    assert.equal(reads,stage==='read'?1:2);assert.equal(statusCalls,stage==='status'?1:0);await h.close();
  });
}
test('selection switch during refresh suppresses a late refreshed list and success message',async()=>{
  const pending=deferred();let reads=0;
  const h=await setup({fetchProductMatches:id=>++reads===2?pending.promise:Promise.resolve([match(id)])});
  await act(async()=>{h.button('자동 매칭 실행').props.onClick();});
  await h.select('B');await act(async()=>pending.resolve([match('stale-refresh-A')]));
  assert.match(h.text(),/candidate-B/);assert.doesNotMatch(h.text(),/stale-refresh-A|후보 생성 완료/);await h.close();
});
test('selection switch during status update cannot remove or change current product rows',async()=>{
  const pending=deferred();const h=await setup({setMatchStatus:()=>pending.promise});
  await act(async()=>{h.renderer.root.findAllByType('button').find(n=>n.props.title==='제외').props.onClick();});
  await h.select('B');await act(async()=>pending.resolve());assert.match(h.text(),/candidate-B/);await h.close();
});
test('manual addition shares lock, displays failure and does not retry',async()=>{
  const pending=deferred();let calls=0;
  const h=await setup({searchCompetitorProducts:async()=>[{id:'fresh',name:'manual-search',brand_name:'brand',musinsa_no:'123',review_count:0}],
    addManualMatch:()=>{calls++;return pending.promise;}});
  await act(async()=>h.renderer.root.findAllByType('input').find(n=>n.props.placeholder==='경쟁 상품 검색…').props.onChange({target:{value:'manual'}}));
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,350));});
  const add=h.button('추가');
  await act(async()=>{add.props.onClick();add.props.onClick();h.button('자동 매칭 실행').props.onClick();});
  assert.equal(calls,1);assert.equal(h.calls.length,0);
  await act(async()=>pending.reject(new Error('manual failure')));
  assert.match(h.text(),/오류:/);assert.match(h.text(),/candidate-A/);await h.close();
});
for (const failure of [false,true]) {
  test(`A→B→A ${failure?'partial failure':'success'} reconciles actual synthetic rows and error`,async()=>{
    const pending=deferred();let db=[match('old-A')];let reads=0;
    const h=await setup({runAutoMatch:()=>pending.promise,fetchProductMatches:async id=>{reads++;return id==='A'?structuredClone(db):[match('B')];}});
    await act(async()=>{h.button('자동 매칭 실행').props.onClick();});await h.select('B');await h.select('A');
    assert.match(h.text(),/candidate-old-A/);
    db=failure?[]:[match('new-A')];
    await act(async()=>failure?pending.reject(new Error('insert failed after delete')):pending.resolve(1));
    assert.doesNotMatch(h.text(),/candidate-old-A/);assert.equal(reads,4);
    if(failure)assert.match(h.text(),/오류:/);else {assert.match(h.text(),/candidate-new-A/);assert.match(h.text(),/1건 후보 생성 완료/);}
    await h.close();
  });
}
test('late A reselection read cannot override reconciliation after A mutation settles',async()=>{
  const mutation=deferred(),oldRead=deferred();let aReads=0;
  const h=await setup({runAutoMatch:()=>mutation.promise,fetchProductMatches:id=>id!=='A'?Promise.resolve([match('B')]):++aReads===2?oldRead.promise:Promise.resolve([match(aReads===1?'old-A':'new-A')])});
  await act(async()=>{h.button('자동 매칭 실행').props.onClick();});await h.select('B');await h.select('A');
  await act(async()=>mutation.resolve(1));await act(async()=>oldRead.resolve([match('stale-A')]));
  assert.match(h.text(),/candidate-new-A/);assert.doesNotMatch(h.text(),/candidate-stale-A/);await h.close();
});
for (const session of [null,{user:{id:'account-2'}}]) {
  test(`auth change ${session?'account swap':'signout'} suppresses outstanding mutation and read results`,async()=>{
    const pending=deferred();let reads=0;
    const h=await setup({runAutoMatch:()=>pending.promise,fetchProductMatches:async id=>{reads++;return [match(id)];}});
    await act(async()=>{h.button('자동 매칭 실행').props.onClick();});await h.authChange(session);
    await act(async()=>pending.resolve(1));
    assert.doesNotMatch(h.text(),/candidate-A|후보 생성 완료/);assert.equal(reads,1);await h.close();
  });
}
test('token refresh for the same identity does not invalidate reconciliation',async()=>{
  const pending=deferred();const h=await setup({runAutoMatch:()=>pending.promise});
  await act(async()=>{h.button('자동 매칭 실행').props.onClick();});await h.authChange({user:{id:'account-1'}});
  await act(async()=>pending.resolve(1));assert.match(h.text(),/1건 후보 생성 완료/);await h.close();
});
test('A→B→A during failed reconciliation retains the operation error without applying stale rows',async()=>{
  const pending=deferred();let reads=0;
  const h=await setup({runAutoMatch:async()=>{throw new Error('partial mutation failure');},fetchProductMatches:id=>++reads===2?pending.promise:Promise.resolve(id==='A'?[]:[match('B')])});
  await act(async()=>{h.button('자동 매칭 실행').props.onClick();});await h.select('B');await h.select('A');
  await act(async()=>pending.reject(new Error('refresh failed')));assert.match(h.text(),/오류:/);assert.doesNotMatch(h.text(),/candidate-A/);await h.close();
});
test('account switch reloads brands, products and total exactly once for the new epoch',async()=>{
  let actor='account-1';const products=[],brands=[];
  const h=await setup({fetchOwnBrands:async()=>{brands.push(actor);return [{id:actor,name:`brand-${actor}`}];},
    fetchOwnProductsWithPrices:async()=>{products.push(actor);return {rows:actor==='account-1'?[product('A'),product('B')]:[product('C')],total:actor==='account-1'?987:42};}});
  const before={products:products.length,brands:brands.length};actor='account-2';await h.authChange({user:{id:actor}});
  assert.equal(products.length,before.products+1);assert.equal(brands.length,before.brands+1);
  assert.match(h.text(),/brand-account-2/);assert.match(h.text(),/own-C/);assert.match(h.text(),/42개/);
  assert.doesNotMatch(h.text(),/brand-account-1|987개|own-A|candidate-A/);await h.close();
});
test('signout clears total and rows, signin reloads once, duplicate/token events do not reload',async()=>{
  let products=0,brands=0;
  const h=await setup({fetchOwnBrands:async()=>{brands++;return [{id:'brand',name:'epoch-brand'}];},
    fetchOwnProductsWithPrices:async()=>{products++;return {rows:[product('A'),product('B')],total:987};}});
  const start={products,brands};
  for(const event of ['TOKEN_REFRESHED','SIGNED_IN','INITIAL_SESSION','TOKEN_REFRESHED'])await h.authChange({user:{id:'account-1'}},event);
  assert.deepEqual({products,brands},start);
  await h.authChange(null,'SIGNED_OUT');await h.authChange(null,'SIGNED_OUT');
  assert.deepEqual({products,brands},start);assert.match(h.text(),/로그인 후/);assert.match(h.text(),/0개/);assert.doesNotMatch(h.text(),/987개|epoch-brand|own-A|candidate-A/);
  await h.authChange({user:{id:'account-1'}});assert.deepEqual({products,brands},{products:start.products+1,brands:start.brands+1});
  assert.match(h.text(),/own-A/);assert.match(h.text(),/987개/);assert.match(h.text(),/epoch-brand/);await h.close();
});
test('late prior-epoch brands and product lists cannot overwrite the new account',async()=>{
  const oldBrands=deferred(),oldProducts=deferred();let brandReads=0,productReads=0;
  const h=await setup({fetchOwnBrands:()=>++brandReads===2?oldBrands.promise:Promise.resolve([{id:'new',name:'brand-new-account'}]),
    fetchOwnProductsWithPrices:()=>++productReads===1?oldProducts.promise:Promise.resolve({rows:[product('C')],total:42})},{selectInitial:false});
  await h.authChange({user:{id:'account-2'}});
  await act(async()=>{oldProducts.resolve({rows:[product('A')],total:987});oldBrands.resolve([{id:'old',name:'brand-old-account'}]);});
  assert.match(h.text(),/own-C|brand-new-account/);assert.match(h.text(),/42개/);assert.doesNotMatch(h.text(),/own-A|987개|brand-old-account/);await h.close();
});
test('new account loading never shows previous total and clears loading when its list arrives',async()=>{
  const next=deferred();let reads=0;
  const h=await setup({fetchOwnProductsWithPrices:()=>++reads===1?Promise.resolve({rows:[product('A'),product('B')],total:987}):next.promise});
  await h.authChange({user:{id:'account-2'}});assert.doesNotMatch(h.text(),/987개|own-A/);assert.match(h.text(),/…/);
  await act(async()=>next.resolve({rows:[product('C')],total:42}));assert.match(h.text(),/own-C|42개/);assert.doesNotMatch(h.text(),/987개/);await h.close();
});
for(const stage of ['brands','products']) {
  test(`new epoch ${stage} loader failure is visible and does not retain prior account rows or total`,async()=>{
    let changed=false;
    const h=await setup({fetchOwnBrands:async()=>{if(changed&&stage==='brands')throw new Error('brand failure');return [{id:'brand',name:changed?'new-brand':'old-brand'}];},
      fetchOwnProductsWithPrices:async()=>{if(changed&&stage==='products')throw new Error('product failure');return {rows:changed?[product('C')]:[product('A'),product('B')],total:changed?42:987};}});
    changed=true;await h.authChange({user:{id:'account-2'}});
    assert.match(h.text(),/오류:/);assert.ok(h.renderer.root.findAll(n=>n.props.role==='alert').length);
    assert.doesNotMatch(h.text(),/old-brand|987개|own-A|candidate-A/);
    if(stage==='products')assert.match(h.text(),/0개/);else assert.match(h.text(),/42개/);await h.close();
  });
}
