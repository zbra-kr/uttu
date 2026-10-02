// Callback/effect lifecycle regression tests; not a DOM or browser substitute.
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-source.cjs');
const tour = load('src/lib/onboarding/tour.ts');
const { tourNavigationPath } = load('src/lib/onboarding/navigation.ts');

function harness(initialUrl = '/') {
  const originals = Object.fromEntries(['window', 'document', 'HTMLElement', 'requestAnimationFrame', 'sessionStorage', 'fetch'].map(k => [k, global[k]]));
  const originalNow = Date.now;
  const hooks = [], pendingEffects = [], requests = [], navigation = [];
  let cursor = 0, dirty = true, tree, now = 1000, authListener;
  const equalDeps = (a,b) => a && b && a.length === b.length && a.every((v,i) => Object.is(v,b[i]));
  const React = {
    createContext: () => ({ Provider: 'Provider' }),
    useContext: () => ({}),
    useState(value) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = { value: typeof value === 'function' ? value() : value };
      return [hooks[i].value, next => { const value = typeof next === 'function' ? next(hooks[i].value) : next; if (!Object.is(value,hooks[i].value)) { hooks[i].value=value; dirty=true; } }];
    },
    useRef(value) { const i=cursor++; if (!(i in hooks)) hooks[i]={current:value}; return hooks[i]; },
    useCallback(fn,deps) { const i=cursor++; if (!hooks[i] || !equalDeps(hooks[i].deps,deps)) hooks[i]={fn,deps}; return hooks[i].fn; },
    useEffect(fn,deps) { const i=cursor++; if (!hooks[i] || !equalDeps(hooks[i].deps,deps)) { const prev=hooks[i]; hooks[i]={deps,cleanup:prev?.cleanup}; pendingEffects.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup=fn(); }); } },
  };
  global.HTMLElement = class {};
  global.window = { location: new URL(initialUrl,'http://example.test'), innerWidth:1280, innerHeight:800, setTimeout:()=>1, addEventListener(){}, removeEventListener(){} };
  global.document = {activeElement:null,body:{},querySelector:()=>null};
  global.requestAnimationFrame = () => {};
  const storage=new Map();
  global.sessionStorage = {getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
  Date.now = () => now;
  global.fetch = (url,options={}) => new Promise(resolve => requests.push({url, method:options.method||'GET', body:options.body&&JSON.parse(options.body), done:false, resolve(state,ok=true,status=ok?200:503) {this.done=true;resolve({ok,status,json:async()=>state});}}));
  const router={replace:url=>navigation.push(url)};
  const client={auth:{getUser:()=>new Promise(()=>{}),onAuthStateChange:fn=>{authListener=fn;return {data:{subscription:{unsubscribe(){}}}}}}};
  const {default:Provider}=load('src/components/onboarding/OnboardingProvider.tsx',{
    react:{__esModule:true,default:React},
    'next/navigation':{usePathname:()=>window.location.pathname,useRouter:()=>router},
    '@/lib/supabase/client':{supabaseBrowser:()=>client},
    '@/lib/onboarding/tour':tour,
    './TourOverlay':{__esModule:true,default:'Overlay'},
  });
  function render() {
    let loops=0;
    do { if (++loops>20) throw new Error('Hook render loop'); dirty=false;cursor=0;tree=Provider({children:null});while(pendingEffects.length) pendingEffects.shift()(); } while(dirty);
    return tree;
  }
  async function flush() { for(let i=0;i<12;i++){await Promise.resolve();if(dirty)render();} }
  render();
  return {
    requests,navigation,flush,
    value:()=>render().props.value,
    overlay:()=>render().props.children.find(x=>x?.type==='Overlay'),
    tick:()=>{now+=301},
    signIn:id=>{authListener('SIGNED_IN',id?{user:{id}}:null);render();},
    commit:url=>{window.location=new URL(url,window.location.origin);dirty=true;render();},
    dispose(){for(const hook of hooks)hook?.cleanup?.();Date.now=originalNow;for(const[k,v]of Object.entries(originals)){if(v===undefined)delete global[k];else global[k]=v;}},
  };
}
const state=(userId,status='pending',step=0,eligible=true)=>({userId,status,step,eligible});
async function signedIn(h,id='account-a') {h.signIn(id);h.requests.at(-1).resolve(state(id));await h.flush();}
function next(h){h.tick();h.overlay().props.onNext();h.value();}

test('Back restores full origin query/hash after visiting memo route',async()=>{
  const h=harness('/product?no=123#details');
  try {await signedIn(h);next(h);next(h);h.commit('/ranking');h.tick();h.overlay().props.onBack();assert.equal(h.navigation.at(-1),'/product?no=123#details');}finally{h.dispose();}
});

test('Skip supersedes a memo navigation that has not committed yet',async()=>{
  const h=harness();
  try {await signedIn(h);next(h);next(h);assert.deepEqual(h.navigation,[tourNavigationPath('/ranking','/')]);h.overlay().props.onSkip();assert.deepEqual(h.navigation,[tourNavigationPath('/ranking','/'),'/']);assert.equal(h.value().active,false);}finally{h.dispose();}
});

test('Back supersedes a memo navigation even while the origin URL is still current',async()=>{
  const h=harness('/brand?id=4#notes');
  try {await signedIn(h);next(h);next(h);h.tick();h.overlay().props.onBack();assert.deepEqual(h.navigation,[tourNavigationPath('/ranking','/brand?id=4#notes'),'/brand?id=4#notes']);assert.equal(h.value().step,1);}finally{h.dispose();}
});

test('a delayed old-account GET cannot start a tour for the new account',async()=>{
  const h=harness();
  try {h.signIn('account-a');const a=h.requests[0];h.signIn('account-b');const b=h.requests[1];a.resolve(state('account-a'));await h.flush();assert.equal(h.value().active,false);b.resolve(state('account-b','legacy',0,false));await h.flush();assert.equal(h.value().active,false);}finally{h.dispose();}
});

test('manual replay wins over a delayed automatic-start GET',async()=>{
  const h=harness();
  try {h.signIn('account-a');const read=h.requests[0];h.value().replay();next(h);assert.equal(h.value().step,1);read.resolve(state('account-a'));await h.flush();assert.equal(h.value().step,1);assert.equal(h.value().active,true);}finally{h.dispose();}
});

test('queued progress writes from an old account are discarded after account change',async()=>{
  const h=harness();
  try {await signedIn(h);next(h);await h.flush();const first=h.requests.find(r=>r.method==='PATCH');next(h);h.signIn('account-b');first.resolve(state('account-a','pending',1));await h.flush();assert.equal(h.requests.filter(r=>r.method==='PATCH').length,1);h.requests.find(r=>r.method==='GET'&&!r.done).resolve(state('account-b','legacy',0,false));await h.flush();assert.equal(h.value().active,false);}finally{h.dispose();}
});

test('completion stays last in the ordered mutation queue',async()=>{
  const h=harness();
  try {await signedIn(h);for(let i=0;i<6;i++)next(h);await h.flush();for(let i=0;i<6;i++){const req=h.requests.find(r=>r.method==='PATCH'&&!r.done);assert.ok(req);req.resolve(state('account-a',req.body.status,req.body.step));await h.flush();}const bodies=h.requests.filter(r=>r.method==='PATCH').map(r=>r.body);assert.deepEqual(bodies.at(-1),{status:'completed',step:5});assert.equal(bodies.length,6);assert.equal(h.value().active,false);}finally{h.dispose();}
});


test('mandatory Teams setup response prevents auto-start and ignores supplied redirect URL',async()=>{
  const h=harness('/product?no=123#details');
  try {h.signIn('account-a');h.requests[0].resolve({error:'teams_setup_required',setup_url:'https://evil.test'},false,428);await h.flush();assert.equal(h.value().active,false);const url=new URL(h.navigation.at(-1),'https://uttu.test');assert.equal(url.pathname,'/setup/teams');assert.equal(url.searchParams.get('next'),'/product?no=123#details');h.value().replay();assert.equal(h.value().active,false);}finally{h.dispose();}
});

test('revoked Teams setup interrupts an active tour without terminal writes or queued progress',async()=>{
  const h=harness('/brand?id=4#notes');
  try {await signedIn(h);next(h);await h.flush();const first=h.requests.find(r=>r.method==='PATCH');next(h);h.commit('/ranking');first.resolve({error:'teams_setup_required'},false,428);await h.flush();assert.equal(h.value().active,false);assert.equal(h.requests.filter(r=>r.method==='PATCH').length,1);const url=new URL(h.navigation.at(-1),'https://uttu.test');assert.equal(url.pathname,'/setup/teams');assert.equal(url.searchParams.get('next'),'/brand?id=4#notes');assert.ok(!h.requests.some(r=>r.body?.status==='completed'||r.body?.status==='skipped'));}finally{h.dispose();}
});


test('late setup requirement after Skip retains original deep link rather than the intermediate ranking route',async()=>{
  const h=harness('/product?no=123#details');
  try {await signedIn(h);next(h);await h.flush();const first=h.requests.find(r=>r.method==='PATCH');next(h);h.commit('/ranking');h.overlay().props.onSkip();assert.equal(h.navigation.at(-1),'/product?no=123#details');first.resolve({error:'teams_setup_required'},false,428);await h.flush();assert.equal(new URL(h.navigation.at(-1),'https://uttu.test').searchParams.get('next'),'/product?no=123#details');}finally{h.dispose();}
});

test('setup interruption does not leak to another verified account',async()=>{
  const h=harness('/product?no=123');
  try {h.signIn('account-a');h.requests[0].resolve({error:'teams_setup_required'},false,428);await h.flush();assert.equal(h.value().active,false);h.signIn('account-b');h.requests.find(r=>r.method==='GET'&&!r.done).resolve(state('account-b'));await h.flush();assert.equal(h.value().active,true);next(h);await h.flush();assert.equal(h.requests.filter(r=>r.method==='PATCH').length,1);}finally{h.dispose();}
});


test('reload of a guided page keeps the original return destination',async()=>{
  const h=harness(tourNavigationPath('/ranking','/product?no=123#details'));
  try {h.signIn('account-a');h.requests[0].resolve(state('account-a','pending',3));await h.flush();h.overlay().props.onSkip();assert.equal(h.navigation.at(-1),'/product?no=123#details');}finally{h.dispose();}
});


for (const action of ['skip','back']) test(`same-path pending tour navigation is superseded by ${action} without losing ranking filters`,async()=>{
  const original='/ranking?period=today&category=001&gender=F&age=AGE_BAND_20';
  const h=harness(original);
  try {await signedIn(h);next(h);next(h);assert.equal(h.navigation.at(-1),tourNavigationPath('/ranking',original));h.tick();if(action==='skip')h.overlay().props.onSkip();else h.overlay().props.onBack();assert.equal(h.navigation.at(-1),original);if(action==='skip')assert.equal(h.value().active,false);else assert.equal(h.value().step,1);}finally{h.dispose();}
});
