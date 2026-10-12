const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), Renderer = require('react-test-renderer');
const load = require('./helpers/load-source.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const act = React.act;
const row = name => ({id:name, name, page:'ranking', filter_data:{name}, created_at:'2026-10-11'});
const text = root => JSON.stringify(root.toJSON());
function fixture() {
  const calls=[], listeners=new Set(), loaded=[];
  const query={fetchSavedFilters:(page,signal)=>new Promise((resolve,reject)=>calls.push({page,signal,resolve,reject})),saveFilter:async()=>({data:row('saved'),error:null}),overwriteFilter:async()=>({error:null}),deleteSavedFilter:async()=>({error:null})};
  const client={auth:{onAuthStateChange(fn){listeners.add(fn);return {data:{subscription:{unsubscribe(){listeners.delete(fn)}}}}}}};
  const Component=load('src/components/me/SavedFiltersDropdown.tsx',{'@/lib/queries-me':query,'@/lib/supabase/client':{supabaseBrowser:()=>client}}).default;
  const props=page=>({page,currentFilter:{new:true},onLoad:value=>loaded.push(value)});
  return {Component,calls,listeners,loaded,props,query};
}
const button=(root,label)=>root.root.findAllByType('button').find(b=>Array.isArray(b.props.children)?b.props.children.join('').startsWith(label):b.props.children===label);
async function click(root,label){await act(async()=>button(root,label).props.onClick());}
async function mount(f){let root;await act(async()=>{root=Renderer.create(React.createElement(f.Component,f.props('ranking')))});return root;}
global.document={addEventListener(){},removeEventListener(){}};
test('loading, failure, retry deduplication, closed/reopened pending menu and true empty',async()=>{
 const f=fixture(),root=await mount(f);
 try{
  await click(root,'불러오기');assert.match(text(root),/불러오는 중/);assert.doesNotMatch(text(root),/필터 없음/);
  await act(async()=>f.calls[0].reject(Error('offline')));assert.match(text(root),/불러오지 못했습니다/);assert.doesNotMatch(text(root),/필터 없음/);
  const retry=button(root,'다시 시도').props.onClick;await act(async()=>{retry();retry();retry()});assert.equal(f.calls.length,2);
  await click(root,'불러오기');await click(root,'불러오기');assert.equal(f.calls.length,2);assert.match(text(root),/불러오는 중/);
  await act(async()=>f.calls[1].resolve({status:'ready',filters:[]}));assert.match(text(root),/저장된 필터 없음/);assert.equal(button(root,'다시 시도'),undefined);
 }finally{await act(async()=>root.unmount())}
});
test('page A→B→A and old success/error cannot overwrite the new page',async()=>{
 const f=fixture(),root=await mount(f);try{
  await act(async()=>root.update(React.createElement(f.Component,f.props('promo'))));assert.ok(f.calls[0].signal.aborted);
  await act(async()=>root.update(React.createElement(f.Component,f.props('ranking'))));assert.ok(f.calls[1].signal.aborted);
  await click(root,'불러오기');await act(async()=>f.calls[2].resolve({status:'ready',filters:[row('new')]}));
  await act(async()=>{f.calls[0].resolve({status:'ready',filters:[row('old')]});f.calls[1].reject(Error('late'))});assert.match(text(root),/new/);assert.doesNotMatch(text(root),/old|불러오지 못했습니다/);
 }finally{await act(async()=>root.unmount())}
});
test('auth changes hide old rows; token refresh deduplicates; logout and unmount cancel reads',async()=>{
 const f=fixture(),root=await mount(f);let unmounted=false;
 const auth=async(id,event='SIGNED_IN')=>act(async()=>{for(const fn of f.listeners)fn(event,id?{user:{id}}:null)});
 try{
  await auth('A');assert.ok(f.calls[0].signal.aborted);await click(root,'불러오기');await act(async()=>f.calls[1].resolve({status:'ready',filters:[row('account-A')]}));
  await auth('A','TOKEN_REFRESHED');assert.equal(f.calls.length,2);await auth('B');assert.doesNotMatch(text(root),/account-A/);await click(root,'불러오기');
  await auth(null,'SIGNED_OUT');assert.ok(f.calls[2].signal.aborted);await click(root,'불러오기');assert.match(text(root),/로그인이 필요/);assert.doesNotMatch(text(root),/필터 없음/);
  await act(async()=>f.calls[2].resolve({status:'ready',filters:[row('late-B')]}));assert.doesNotMatch(text(root),/late-B/);
  await auth('C');const last=f.calls.at(-1);await act(async()=>root.unmount());unmounted=true;assert.ok(last.signal.aborted);assert.equal(f.listeners.size,0);await act(async()=>last.reject(Error('unmounted')));
 }finally{if(!unmounted)await act(async()=>root.unmount())}
});
test('selection, delete and save keep existing controls and policies',async()=>{
 const f=fixture(),root=await mount(f);try{
  await act(async()=>f.calls[0].resolve({status:'ready',filters:[row('one'),row('two')]}));await click(root,'불러오기');
  const selected=root.root.findAllByType('div').find(x=>x.props.onClick);await act(async()=>selected.props.onClick());assert.deepEqual(f.loaded,[{name:'one'}]);
  await click(root,'불러오기');let stopped=false;await act(async()=>root.root.findAllByType('button').find(x=>x.props.title==='삭제').props.onClick({stopPropagation(){stopped=true}}));assert.ok(stopped);assert.doesNotMatch(text(root),/"one"/);
  await click(root,'저장');await act(async()=>root.root.findByType('input').props.onChange({target:{value:'new'}}));await click(root,'확인');await click(root,'불러오기');assert.match(text(root),/saved/);
 }finally{await act(async()=>root.unmount())}
});
function queryFixture({user={id:'account'},authError=null,data=[],error=null,authReject=false}={}){
 const calls=[];const builder={};for(const name of ['select','eq','order','limit','abortSignal'])builder[name]=(...args)=>{calls.push([name,...args]);return builder};builder.then=(resolve,reject)=>Promise.resolve({data,error}).then(resolve,reject);
 const client={auth:{getUser:async()=>{if(authReject)throw Error('transport');return {data:{user},error:authError}}},from:table=>{calls.push(['from',table]);return builder}};
 return {calls,query:load('src/lib/queries-me.ts',{'./supabase/client':{supabaseBrowser:()=>client}})};
}
test('query propagates auth, transport and DB failures; anonymous and zero-row success differ; scope remains 20',async()=>{
 for(const config of [{authError:Error('auth')},{authReject:true},{error:Error('DB') }]){const f=queryFixture(config);await assert.rejects(f.query.fetchSavedFilters('ranking'));}
 const missing=queryFixture({user:null,authError:{name:'AuthSessionMissingError'}});assert.deepEqual(await missing.query.fetchSavedFilters('ranking'),{status:'signed-out'});
 const anonymous=queryFixture({user:null});assert.deepEqual(await anonymous.query.fetchSavedFilters('ranking'),{status:'signed-out'});assert.equal(anonymous.calls.length,0);
 const f=queryFixture();const controller=new AbortController();assert.deepEqual(await f.query.fetchSavedFilters('promo',controller.signal),{status:'ready',filters:[]});assert.deepEqual(f.calls.slice(0,6),[['from','user_saved_filters'],['select','id, page, name, filter_data, created_at'],['eq','user_id','account'],['eq','page','promo'],['order','created_at',{ascending:false}],['limit',20]]);assert.equal(f.calls[6][1],controller.signal);
 controller.abort();await assert.rejects(f.query.fetchSavedFilters('promo',controller.signal));
});

test('a slow read cannot discard a save made while loading',async()=>{
 const f=fixture(),root=await mount(f);try{
  await click(root,'저장');await act(async()=>root.root.findByType('input').props.onChange({target:{value:'new'}}));await click(root,'확인');
  await act(async()=>f.calls[0].resolve({status:'ready',filters:[row('previous')]}));await click(root,'불러오기');assert.match(text(root),/saved/);assert.match(text(root),/previous/);
 }finally{await act(async()=>root.unmount())}
});

test('duplicate-name overwrite and rejected delete retain existing policy',async()=>{
 const f=fixture(),root=await mount(f);try{
  await act(async()=>f.calls[0].resolve({status:'ready',filters:[row('one')]}));f.query.deleteSavedFilter=async()=>({error:'denied'});await click(root,'불러오기');await act(async()=>root.root.findAllByType('button').find(x=>x.props.title==='삭제').props.onClick({stopPropagation(){}}));assert.match(text(root),/one/);
  f.query.saveFilter=async()=>({data:null,error:'같은 이름의 필터가 이미 있습니다.'});await click(root,'저장');await act(async()=>root.root.findByType('input').props.onChange({target:{value:'one'}}));await click(root,'확인');assert.match(text(root),/덮어쓸까요/);await click(root,'덮어쓰기');await click(root,'불러오기');await act(async()=>root.root.findAllByType('div').find(x=>x.props.onClick).props.onClick());assert.deepEqual(f.loaded,[{new:true}]);
 }finally{await act(async()=>root.unmount())}
});
test('StrictMode cleanup cancels the first read; repeated failures can recover',async()=>{
 const f=fixture();let root;await act(async()=>{root=Renderer.create(React.createElement(React.StrictMode,null,React.createElement(f.Component,f.props('ranking'))))});try{
  assert.ok(f.calls[0].signal.aborted);const active=f.calls.at(-1);await click(root,'불러오기');await act(async()=>active.reject(Error('first failure')));await click(root,'다시 시도');await act(async()=>f.calls.at(-1).reject(Error('second failure')));assert.match(text(root),/불러오지 못했습니다/);await click(root,'다시 시도');await act(async()=>f.calls.at(-1).resolve({status:'ready',filters:[row('recovered')]}));await act(async()=>f.calls[0].resolve({status:'ready',filters:[row('stale')]}));assert.match(text(root),/recovered/);assert.doesNotMatch(text(root),/stale/);
 }finally{await act(async()=>root.unmount())}
});
