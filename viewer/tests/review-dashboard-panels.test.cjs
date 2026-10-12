const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), Renderer = require('react-test-renderer');
const load = require('./helpers/load-source.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture({ lateIdentity = false, initialAuthFailure = false } = {}) {
  const products = [], anomalies = [], stats = [], identities = [], listeners = new Set();
  let identityCalls=0;
  const client = { auth: { getUser() { identityCalls++; if(initialAuthFailure && identityCalls<=2)return Promise.resolve({data:{user:null},error:Error('offline')}); if (!lateIdentity) return Promise.resolve({ data: { user: { id: 'account-a' } } }); const d = deferred(); identities.push(d); return d.promise; },
    onAuthStateChange(fn) { listeners.add(fn); return { data: { subscription: { unsubscribe() { listeners.delete(fn); } } } }; } } };
  const Page = load('src/app/(app)/reviews/page.tsx', {
    'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/hooks/useResolvedViewport': { useResolvedViewport: () => 'desktop' }, '@/lib/supabase/client': { supabaseBrowser: () => client },
    '@/lib/queries': { CATEGORY_MAP: {}, fetchOwnProducts(limit, signal) { const d = deferred(); products.push({ ...d, limit, signal }); return d.promise; },
      fetchCsAnomalies(opts, signal) { const d = deferred(); anomalies.push({ ...d, opts, signal }); return d.promise; },
      fetchReviewStats(days, signal) { const d = deferred(); stats.push({ ...d, days, signal }); return d.promise; } },
    '@/lib/excel-export': {}, '@/components/ui/filters': {}, '@/components/ui/icons': { IcArrowUR: () => React.createElement('span'), IcX: () => null }, '@/components/me/NoteDrawer': { __esModule: true, default: () => null },
  }).default;
  return { Page, products, anomalies, stats, identities, listeners, get identityCalls(){return identityCalls;}, auth(id) { for (const fn of listeners) fn(id ? 'SIGNED_IN' : 'SIGNED_OUT', id ? { user: { id } } : null); } };
}
const product = name => ({ id: name, name, musinsa_no: 100000, brand_name: 'Fixture', review_count: 3, satisfaction_score: 4, style_no: null, erp_style_code: null });
const anomaly = name => ({ id: name, entity_name: name, entity_id: 'product', anomaly_type: 'review_rating_drop', severity: 'high', detection_date: '2026-10-04' });
const metric = total => ({ total, avgRating: total ? 4 : 0, lowCount: 0, ratingDist: [0, total, 0, 0, 0], imageCount: 0 });
const panel = (root, name) => root.root.findByProps({ 'data-dashboard-panel': name });
const action = (root, name) => panel(root, name).findAllByType('button').find(button => button.props['aria-label']);
const values = root => root.root.findAllByProps({ className: 'val' }).map(node => node.children.join(''));
function authHookFixture({syncThrow=false,initialEvent}={}) {
  const identities=[],products=[],anomalies=[],listeners=new Set();
  const f={ identities,products,anomalies,listeners,current:null };
  const client={auth:{getUser(){const d=deferred();identities.push(d);if(syncThrow&&identities.length===1)throw Error('synchronous offline');return d.promise;},
    onAuthStateChange(fn){listeners.add(fn);if(initialEvent!==undefined)fn(initialEvent?'SIGNED_IN':'SIGNED_OUT',initialEvent?{user:{id:initialEvent}}:null);return {data:{subscription:{unsubscribe(){listeners.delete(fn);}}}};}}};
  const {useReviewDashboardPanels}=load('src/hooks/useReviewDashboardPanels.ts',{
    '@/lib/supabase/client':{supabaseBrowser:()=>client},
    '@/lib/queries':{fetchOwnProducts(limit,signal){const d=deferred();products.push({...d,signal});return d.promise;},
      fetchCsAnomalies(opts,signal){const d=deferred();anomalies.push({...d,signal});return d.promise;}},
  });
  f.Harness=()=>{f.current=useReviewDashboardPanels();return null;};
  f.auth=id=>{for(const fn of listeners)fn(id?'SIGNED_IN':'SIGNED_OUT',id?{user:{id}}:null);};
  return f;
}

for (const failure of ['sdk-error','exception','sync-exception']) {
  test(`auth confirmation ${failure} is retryable and shared recovery loads each panel once`,async()=>{
    const f=authHookFixture({syncThrow:failure==='sync-exception'});let root;
    try {
      await React.act(async()=>{root=Renderer.create(React.createElement(f.Harness));});
      await React.act(async()=>{if(failure==='sdk-error')f.identities[0].resolve({data:{user:null},error:Error('offline')});else if(failure==='exception')f.identities[0].reject(Error('offline'));});
      const failedStates=[f.current.ownProducts.state,f.current.csAnomalies.state];
      assert.equal(f.products.length,0);assert.equal(f.anomalies.length,0);
      await React.act(async()=>{f.current.ownProducts.retry();f.current.csAnomalies.retry();f.current.ownProducts.retry();});
      assert.deepEqual({failedStates,identityCalls:f.identities.length},{failedStates:['autherror','autherror'],identityCalls:2});assert.equal(f.current.ownProducts.state,'loading');
      await React.act(async()=>f.identities[1].resolve({data:{user:{id:'account-a'}},error:null}));
      assert.equal(f.products.length,1);assert.equal(f.anomalies.length,1);
      await React.act(async()=>{f.products[0].resolve([product('Recovered A')]);f.anomalies[0].resolve([anomaly('Recovered CS')]);});
      assert.equal(f.current.ownProducts.rows[0].name,'Recovered A');assert.equal(f.current.csAnomalies.rows[0].entity_name,'Recovered CS');
    } finally {if(root)await React.act(async()=>root.unmount());}
  });
}

for(const initialEvent of ['account-a',null])test(`synchronous initial auth event ${initialEvent??'signedout'} remains authoritative`,async()=>{
  const f=authHookFixture({initialEvent});let root;
  try{
    await React.act(async()=>{root=Renderer.create(React.createElement(f.Harness));});
    assert.equal(f.identities.length,0);assert.equal(f.products.length,initialEvent?1:0);assert.equal(f.anomalies.length,initialEvent?1:0);
    assert.equal(f.current.ownProducts.state,initialEvent?'loading':'signedout');
  }finally{if(root)await React.act(async()=>root.unmount());}
});

test('unmounted auth recovery cannot load panels or retain subscription',async()=>{
  const f=authHookFixture();let root;
  await React.act(async()=>{root=Renderer.create(React.createElement(f.Harness));});
  await React.act(async()=>f.identities[0].reject(Error('offline')));
  await React.act(async()=>f.current.ownProducts.retry());
  await React.act(async()=>root.unmount());
  await React.act(async()=>f.identities[1].resolve({data:{user:{id:'late-account'}},error:null}));
  assert.equal(f.listeners.size,0);assert.equal(f.products.length,0);assert.equal(f.anomalies.length,0);
});

test('actual dashboard auth-error action is enabled and recovers both panels with one shared lookup',async()=>{
  const f=fixture({initialAuthFailure:true});let root;
  try {
    await React.act(async()=>{root=Renderer.create(React.createElement(f.Page));});
    for(const name of ['products','cs']){
      assert.equal(panel(root,name).findByProps({'data-dashboard-panel-state':'autherror'}).type,'div');
      assert.equal(action(root,name).props['aria-disabled'],false);
      assert.match(JSON.stringify(panel(root,name).toJSON?.()??panel(root,name).findByProps({role:'alert'}).children),/로그인 상태를 확인하지 못했습니다/);
    }
    assert.equal(f.products.length,0);assert.equal(f.anomalies.length,0);
    await React.act(async()=>{action(root,'products').props.onClick();action(root,'cs').props.onClick();});
    assert.equal(f.identityCalls,3);assert.equal(f.products.length,1);assert.equal(f.anomalies.length,1);
  } finally {if(root)await React.act(async()=>root.unmount());}
});

for (const signedout of ['verified-null','event-during-recovery']) {
  test(`genuine signedout ${signedout} never starts either reader or resurrects a late lookup`,async()=>{
    const f=authHookFixture();let root;
    try {
      await React.act(async()=>{root=Renderer.create(React.createElement(f.Harness));});
      if(signedout==='verified-null')await React.act(async()=>f.identities[0].resolve({data:{user:null},error:null}));
      else {
        await React.act(async()=>f.identities[0].reject(Error('offline')));
        await React.act(async()=>f.current.csAnomalies.retry());
        await React.act(async()=>{f.auth(null);f.identities[1].resolve({data:{user:{id:'late-a'}},error:null});});
      }
      assert.equal(f.current.ownProducts.state,'signedout');assert.equal(f.current.csAnomalies.state,'signedout');
      const calls=f.identities.length;
      await React.act(async()=>{f.current.ownProducts.retry();f.current.csAnomalies.retry();});
      assert.equal(f.identities.length,calls);assert.equal(f.products.length,0);assert.equal(f.anomalies.length,0);
    } finally {if(root)await React.act(async()=>root.unmount());}
  });
}

test('account event supersedes auth recovery; account switch and repeated panel refresh discard earlier account rows',async()=>{
  const f=authHookFixture();let root;
  try {
    await React.act(async()=>{root=Renderer.create(React.createElement(f.Harness));});
    await React.act(async()=>f.identities[0].reject(Error('offline')));
    await React.act(async()=>{f.current.ownProducts.retry();f.current.csAnomalies.retry();});
    await React.act(async()=>{f.auth('account-a');f.identities[1].resolve({data:{user:{id:'stale-account'}},error:null});});
    assert.equal(f.products.length,1);assert.equal(f.anomalies.length,1);
    await React.act(async()=>{f.auth('account-b');f.products[0].resolve([product('PRIVATE A')]);f.anomalies[0].resolve([anomaly('PRIVATE A')]);});
    assert.equal(f.products[0].signal.aborted,true);assert.equal(f.anomalies[0].signal.aborted,true);
    assert.deepEqual(f.current.ownProducts.rows,[]);assert.deepEqual(f.current.csAnomalies.rows,[]);
    await React.act(async()=>{f.products[1].resolve([product('B')]);f.anomalies[1].resolve([anomaly('B')]);});
    await React.act(async()=>{f.current.ownProducts.retry();f.current.ownProducts.retry();f.current.csAnomalies.retry();});
    assert.deepEqual(f.current.ownProducts.rows,[]);assert.deepEqual(f.current.csAnomalies.rows,[]);
    await React.act(async()=>{f.auth('account-c');f.products[2].resolve([product('PRIVATE B')]);f.anomalies[2].resolve([anomaly('PRIVATE B')]);});
    assert.equal(f.products[2].signal.aborted,true);assert.equal(f.anomalies[2].signal.aborted,true);
    assert.deepEqual(f.current.ownProducts.rows,[]);assert.deepEqual(f.current.csAnomalies.rows,[]);
    await React.act(async()=>{f.products[3].resolve([product('C')]);f.anomalies[3].resolve([anomaly('C')]);});
    assert.equal(f.current.ownProducts.rows[0].name,'C');assert.equal(f.current.csAnomalies.rows[0].entity_name,'C');
  } finally {if(root)await React.act(async()=>root.unmount());}
});
async function click(root, label) { const button = root.root.findAllByType('button').find(node => node.children.join('') === label); assert.ok(button); await React.act(async () => button.props.onClick()); }

test('partial panel failure is distinct from pending and genuine empty; CS retry is independent and keeps its action', async () => {
  const f = fixture(); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.Page)); });
    assert.equal(f.products[0].limit, 10); assert.deepEqual(f.anomalies[0].opts, { limit: 10 });
    assert.equal(panel(root, 'products').findByProps({ 'data-dashboard-panel-state': 'loading' }).type, 'div');
    assert.doesNotMatch(JSON.stringify(root.toJSON()), /자사 상품 없음|탐지된 이상 없음/);
    await React.act(async () => { f.products[0].resolve([]); f.anomalies[0].reject(Error('offline')); });
    assert.match(JSON.stringify(root.toJSON()), /자사 상품 없음/);
    assert.doesNotMatch(JSON.stringify(root.toJSON()), /탐지된 이상 없음/); assert.equal(values(root)[4], '—');
    const button = action(root, 'cs');
    await React.act(async () => button.props.onClick());
    assert.equal(action(root, 'cs'), button); assert.equal(button.props['aria-disabled'], true);
    await React.act(async () => button.props.onClick()); assert.equal(f.anomalies.length, 2); assert.equal(f.products.length, 1); assert.equal(f.stats.length, 1);
    await React.act(async () => f.anomalies[1].reject(Error('still offline')));
    assert.equal(action(root, 'cs'), button); assert.equal(button.props['aria-disabled'], false);
    await React.act(async () => button.props.onClick());
    await React.act(async () => f.anomalies[2].resolve([anomaly('CS current')]));
    assert.equal(action(root, 'cs'), button); assert.equal(values(root)[4], 'H:1 M:0');
    assert.match(JSON.stringify(root.toJSON()), /CS current/);
  } finally { if (root) await React.act(async () => root.unmount()); }
});

test('own-product failure/retry leaves successful CS empty intact and clears prior product rows on refresh', async () => {
  const f = fixture(); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.Page)); });
    await React.act(async () => { f.products[0].reject(Error('offline')); f.anomalies[0].resolve([]); });
    assert.match(JSON.stringify(root.toJSON()), /탐지된 이상 없음/); assert.doesNotMatch(JSON.stringify(root.toJSON()), /자사 상품 없음/);
    const button = action(root, 'products'); await React.act(async () => button.props.onClick());
    await React.act(async () => f.products[1].resolve([product('Product current')]));
    assert.equal(f.anomalies.length, 1); assert.match(JSON.stringify(root.toJSON()), /Product current/);
    await React.act(async () => button.props.onClick());
    assert.doesNotMatch(JSON.stringify(root.toJSON()), /Product current/);
    await React.act(async () => f.products[2].resolve([]));
    assert.match(JSON.stringify(root.toJSON()), /자사 상품 없음/); assert.equal(action(root, 'products'), button);
  } finally { if (root) await React.act(async () => root.unmount()); }
});

test('same-batch account change aborts both A reads; repeated identity does not refetch and sign-out clears both panels', async () => {
  const f = fixture(); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.Page)); });
    await React.act(async () => { f.auth('account-b'); f.products[0].resolve([product('Private A product')]); f.anomalies[0].resolve([anomaly('Private A anomaly')]); await Promise.resolve(); });
    assert.equal(f.products[0].signal.aborted, true); assert.equal(f.anomalies[0].signal.aborted, true);
    assert.doesNotMatch(JSON.stringify(root.toJSON()), /Private A/);
    await React.act(async () => { f.products[1].resolve([product('B product')]); f.anomalies[1].resolve([anomaly('B anomaly')]); });
    await React.act(async () => f.auth('account-b')); assert.equal(f.products.length, 2); assert.equal(f.anomalies.length, 2);
    await React.act(async () => f.auth(null)); assert.doesNotMatch(JSON.stringify(root.toJSON()), /B product|B anomaly/); assert.equal(values(root)[4], '—');
    await React.act(async () => f.auth('account-c'));
    const p = f.products[2], a = f.anomalies[2]; await React.act(async () => root.unmount()); root = null;
    assert.equal(p.signal.aborted, true); assert.equal(a.signal.aborted, true); assert.equal(f.listeners.size, 0);
    await React.act(async () => { p.resolve([product('Late C')]); a.reject(Error('late')); });
  } finally { if (root) await React.act(async () => root.unmount()); }
});

test('late getUser cannot undo SIGNED_OUT or start either panel read', async () => {
  const f = fixture({ lateIdentity: true }); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.Page)); });
    await React.act(async () => { f.auth(null); f.identities.forEach(d => d.resolve({ data: { user: { id: 'account-a' } } })); await Promise.resolve(); });
    assert.equal(f.products.length, 0); assert.equal(f.anomalies.length, 0); assert.equal(f.stats.length, 0);
    assert.equal(panel(root, 'products').findAllByProps({ role: 'status' }).length, 1);
  } finally { if (root) await React.act(async () => root.unmount()); }
});

test('statistics period switches discard old metrics without refetching either fixed-query panel', async () => {
  const f = fixture(); let root;
  try {
    await React.act(async () => { root = Renderer.create(React.createElement(f.Page)); });
    await click(root, '7D'); await click(root, '30D');
    await React.act(async () => { f.stats[1].resolve(metric(777)); f.products[0].resolve([product('Fixed-query product')]); f.anomalies[0].resolve([]); });
    assert.equal(f.products.length, 1); assert.equal(f.anomalies.length, 1); assert.doesNotMatch(JSON.stringify(root.toJSON()), /777/);
    assert.match(JSON.stringify(root.toJSON()), /Fixed-query product/); assert.equal(values(root)[4], 'H:0 M:0');
    await React.act(async () => f.stats[2].resolve(metric(222))); assert.equal(values(root)[0], '222');
    await click(root, '7D'); await React.act(async () => f.stats[3].reject(Error('current period failed')));
    assert.equal(values(root)[4], 'H:0 M:0'); assert.equal(f.products.length, 1); assert.equal(f.anomalies.length, 1);
  } finally { if (root) await React.act(async () => root.unmount()); }
});
