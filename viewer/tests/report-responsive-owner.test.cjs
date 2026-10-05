const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const load=require('./helpers/load-source.cjs');
// Reuse the existing actual-query fixture without registering its tests.
const fixturePath=path.join(__dirname,'report-combined-evidence.test.cjs');
const source=fs.readFileSync(fixturePath,'utf8');
const m=new Module(fixturePath,module);m.filename=fixturePath;m.paths=Module._nodeModulePaths(__dirname);
m._compile(source.slice(0,source.indexOf("test('combined hook"))+'\nmodule.exports={React,Renderer,fixture,pendingFor,response};',fixturePath);
const {React,Renderer,fixture,pendingFor,response}=m.exports;
const tables=['brand_ranking_snapshots','promotions','promotion_items','recommend_modules','recommend_items'];
async function setup(){
 const f=fixture(),hook=load('src/hooks/useDailyReport.ts',f.mocks),listeners=new Set();
 global.window={matchMedia:()=>({addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)})};
 const Scope=load('src/components/report/DailyReportScope.tsx',{'@/hooks/useDailyReport':hook}).default;
 let current,root;function Desktop(){current=hook.useDailyReport();return null}function Mobile(){current=hook.useDailyReport();return null}
 async function render(active=true,mobile=false){await React.act(async()=>{const tree=React.createElement(Scope,{active},active?React.createElement(mobile?Mobile:Desktop):null);if(root)root.update(tree);else root=Renderer.create(tree)});}
 await render();return {f,get current(){return current},render,async change(){await React.act(async()=>listeners.forEach(fn=>fn()))},async settle(failed){await React.act(async()=>tables.forEach(t=>pendingFor(f,t).at(-1).resolve(t===failed?{data:null,error:{message:'offline'}}:t==='brand_ranking_snapshots'?{data:[{snapshot_date:'2026-10-03',rank_position:2,brand_name:'Brand',brands:{is_own:true}}],error:null}:response(t))))},async close(){await React.act(async()=>root.unmount());delete global.window}};
}
test('responsive consumers share pending and settled actual requests, one auth owner and 15 reads',async()=>{const v=await setup();try{assert.equal(v.f.calls.length,15);await v.render(true,true);await v.render(true,false);assert.equal(v.f.calls.length,15);assert.equal(v.f.authCalls,1);assert.ok(v.f.calls.every(c=>!c.signal?.aborted));await v.settle();const data=v.current.data;await v.render(true,true);assert.deepEqual(v.current.data,data);assert.equal(v.f.calls.length,15)}finally{await v.close()}});
for(const failed of tables){test('partial '+failed+' survives responsive remount and retries only its source',async()=>{const v=await setup();try{await v.settle(failed);await v.render(true,true);assert.equal(v.f.calls.length,15);const key={'brand_ranking_snapshots':'retryBrand',promotions:'retryHeaders',promotion_items:'retryItems',recommend_modules:'retryRecommendModules',recommend_items:'retryRecommendItems'}[failed];await React.act(async()=>v.current[key]());assert.equal(v.f.calls.length,16);await v.render(true,false);await React.act(async()=>v.current[key]());assert.equal(v.f.calls.length,16);await v.settle();assert.equal(v.f.authCalls,1)}finally{await v.close()}})}
test('route exit aborts sources and reentry never reuses prior snapshot',async()=>{const v=await setup();try{const prior=v.f.calls.slice();await v.render(false);assert.ok(prior.every(c=>c.signal?.aborted));await v.settle();await v.render(true,true);assert.equal(v.f.calls.length,30);assert.equal(v.f.authCalls,2);assert.equal(v.current.headers.state,'loading');assert.equal(v.current.recommendModulesSource.state,'loading')}finally{await v.close()}});
test('account change/signout abort prior sources, repeated identity adds no reads',async()=>{const v=await setup();try{await React.act(async()=>v.f.auth('B'));assert.equal(v.f.calls.length,30);assert.ok(v.f.calls.slice(0,15).every(c=>c.signal?.aborted));await v.settle();await React.act(async()=>v.f.auth('B'));await v.render(true,true);assert.equal(v.f.calls.length,30);await React.act(async()=>v.f.auth(null));assert.equal(v.current.data,null);assert.equal(v.current.core.state,'signedout');await v.render(true,false);assert.equal(v.f.calls.length,30)}finally{await v.close()}});
test('expired settled reuse refreshes once; pending work survives expiry',async()=>{const now=Date.now;let clock=100000;Date.now=()=>clock;const v=await setup();try{clock+=61000;await v.change();await v.render(true,true);assert.equal(v.f.calls.length,15);await v.settle();clock+=59999;await v.change();assert.equal(v.f.calls.length,15);clock+=1;await v.change();await v.render(true,false);assert.equal(v.f.calls.length,30);assert.equal(v.f.authCalls,2);await v.change();assert.equal(v.f.calls.length,30)}finally{Date.now=now;await v.close()}});
test('source retry does not extend freshness of other sources',async()=>{const now=Date.now;let clock=100000;Date.now=()=>clock;const v=await setup();try{await v.settle('recommend_modules');clock+=59000;await React.act(async()=>v.current.retryRecommendModules());await v.settle();clock+=1001;await v.change();assert.equal(v.f.calls.length,31);assert.equal(v.f.authCalls,2)}finally{Date.now=now;await v.close()}});

function shellMocks(f, pathname, lazy) {
  global.window = { addEventListener(){}, removeEventListener(){}, matchMedia:()=>({addEventListener(){},removeEventListener(){}}) };
  const hidden = { __esModule:true, default:()=>null };
  return { ...f.mocks, react:{...React,lazy}, 'next/navigation':{usePathname:()=>pathname},
    '@/hooks/useViewport':{useIsMobile:()=>false}, '@/lib/queries':{fetchShellStats:async()=>({})},
    '@/components/onboarding/OnboardingProvider':{useOnboarding:()=>({active:false,step:0})},
    './Sidebar':hidden,'./Topbar':hidden,'./AiPanel':hidden,'./CmdK':hidden,'./MobileShell':hidden };
}
test('real Shell never imports or mounts the Report loader on non-Report routes',async()=>{
 for(const pathname of ['/','/ranking','/reviews','/product',null]) {
  const f=fixture();let imports=0;
  const mocks=shellMocks(f,pathname, factory=>React.lazy(()=>{imports++;return factory()}));
  const Shell=load('src/components/shell/ShellClient.tsx',mocks).default;
  let root;try {await React.act(async()=>{root=Renderer.create(React.createElement(Shell,null,'Other route'))});
   assert.equal(imports,0);assert.equal(f.authCalls,0);assert.equal(f.calls.length,0);
   assert.equal(root.root.findAll(x=>x.props.role==='status').length,0);
  } finally {await React.act(async()=>root?.unmount());delete global.window;}
 }
});
test('lazy Report owner gates children until code resolves and starts exactly one read owner',async()=>{
 const f=fixture(),hook=load('src/hooks/useDailyReport.ts',f.mocks);let resolve,imports=0,mounts=0;
 const code=new Promise(r=>resolve=r);
 const mocks=shellMocks(f,'/report',()=>React.lazy(()=>{imports++;return code}));
 const Scope=load('src/components/report/DailyReportScope.tsx',{'@/hooks/useDailyReport':hook}).default;
 const Shell=load('src/components/shell/ShellClient.tsx',mocks).default;
 function Probe(){hook.useDailyReport();React.useEffect(()=>{mounts++},[]);return null}
 let root;try {await React.act(async()=>{root=Renderer.create(React.createElement(Shell,null,React.createElement(Probe)))});
  assert.equal(imports,1);assert.equal(mounts,0);assert.equal(f.calls.length,0);assert.equal(f.authCalls,0);
  assert.equal(root.root.findAll(x=>x.props.role==='status').length,1);
  await React.act(async()=>resolve({default:Scope}));
  assert.equal(imports,1);assert.equal(mounts,1);assert.equal(f.authCalls,1);assert.equal(f.calls.length,15);
  await React.act(async()=>root.update(React.createElement(Shell,null,React.createElement(Probe))));
  assert.equal(imports,1);assert.equal(mounts,1);assert.equal(f.calls.length,15);
 } finally {await React.act(async()=>root?.unmount());delete global.window;}
});
