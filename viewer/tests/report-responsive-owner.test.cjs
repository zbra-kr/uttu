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
 const f=fixture(),context=load('src/lib/report-owner-context.ts'),listeners=new Set();
 f.mocks['@/lib/report-owner-context']=context;
 const hook=load('src/hooks/useDailyReport.ts',f.mocks);
 global.window={matchMedia:()=>({addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)})};
 const Owner=load('src/components/report/DailyReportScope.tsx',{'@/hooks/useDailyReport':hook}).default;
 const Scope=load('src/components/report/DailyReportBoundary.tsx',{'@/lib/report-owner-context':context,'./DailyReportScope':{__esModule:true,default:Owner}}).default;
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
  global.document = { documentElement: { setAttribute(){}, style:{setProperty(){}} } };
  global.window = { addEventListener(){}, removeEventListener(){}, matchMedia:()=>({addEventListener(){},removeEventListener(){}}) };
  const hidden = { __esModule:true, default:()=>null };
  return { ...f.mocks, react:{...React,lazy}, 'next/navigation':{usePathname:()=>pathname,useSearchParams:()=>new URLSearchParams()},
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
  } finally {await React.act(async()=>root?.unmount());delete global.window;delete global.document;}
 }
});
test('stable Shell preserves stats, chrome state and navigation while owner code is pending across entry/exit',async()=>{
 const f=fixture(),context=load('src/lib/report-owner-context.ts');f.mocks['@/lib/report-owner-context']=context;
 const hook=load('src/hooks/useDailyReport.ts',f.mocks);let resolve,imports=0,stats=0,chromeMounts=0,chromeUnmounts=0,path='/',sidebar,topbar;
 const code=new Promise(r=>resolve=r);
 const mocks=shellMocks(f,path,()=>React.lazy(()=>{imports++;return code}));
 mocks['next/navigation']={usePathname:()=>path,useSearchParams:()=>new URLSearchParams()};mocks['@/lib/report-owner-context']=context;
 mocks['@/lib/queries']={fetchShellStats:async()=>{stats++;return {}}};
 mocks['./Sidebar']={__esModule:true,default:props=>{sidebar=props;React.useEffect(()=>{chromeMounts++;return()=>chromeUnmounts++},[]);return React.createElement('nav',null,'Navigation')}};
 mocks['./Topbar']={__esModule:true,default:props=>{topbar=props;return null}};
 const Owner=load('src/components/report/DailyReportScope.tsx',{'@/hooks/useDailyReport':hook}).default;
 const Shell=load('src/components/shell/ShellClient.tsx',mocks).default;
 let current;function Content(){const owner=React.useContext(context.ReportOwnerContext);current=owner.report;return React.createElement('div',null,path==='/report'&&!owner.report?'Report pending':'Content')}
 let root;async function render(next){path=next;await React.act(async()=>{const el=React.createElement(Shell,null,React.createElement(Content));if(root)root.update(el);else root=Renderer.create(el)})}
 function stable(){assert.equal(stats,1);assert.equal(chromeMounts,1);assert.equal(chromeUnmounts,0);assert.equal(sidebar.collapsed,true);assert.equal(topbar.theme,'dark');assert.equal(topbar.aipOpen,true);assert.equal(root.root.findAllByType('nav').length,1)}
 try{await render('/');await React.act(async()=>{sidebar.onToggle();topbar.onTheme('dark');topbar.onToggleAip()});stable();
  await render('/report');stable();assert.equal(imports,1);assert.equal(f.calls.length,0);assert.equal(f.authCalls,0);assert.equal(current,null);
  await render('/reviews');stable();await React.act(async()=>resolve({default:Owner}));stable();assert.equal(f.calls.length,0);
  await render('/report');stable();assert.equal(imports,1);assert.equal(f.authCalls,1);assert.equal(f.calls.length,15);
  await render('/product');stable();assert.equal(current,null);assert.ok(f.calls.every(c=>c.signal?.aborted));
  await render('/report');stable();assert.equal(f.authCalls,2);assert.equal(f.calls.length,30);
 }finally{await React.act(async()=>root?.unmount());delete global.window;delete global.document;}
});

test('retained Report consumer cannot start standalone reads while managed route is inactive',async()=>{
 const f=fixture(),context=load('src/lib/report-owner-context.ts');f.mocks['@/lib/report-owner-context']=context;
 const hook=load('src/hooks/useDailyReport.ts',f.mocks),Owner=load('src/components/report/DailyReportScope.tsx',{'@/hooks/useDailyReport':hook}).default;
 const Boundary=load('src/components/report/DailyReportBoundary.tsx',{'@/lib/report-owner-context':context,'./DailyReportScope':{__esModule:true,default:Owner}}).default;
 global.window={matchMedia:()=>({addEventListener(){},removeEventListener(){}})};
 let current,root;function Probe(){current=hook.useDailyReport();return null}
 async function render(active){await React.act(async()=>{const tree=React.createElement(Boundary,{active},React.createElement(Probe));if(root)root.update(tree);else root=Renderer.create(tree)})}
 try{await render(false);assert.equal(f.authCalls,0);assert.equal(f.calls.length,0);assert.equal(current.data,null);
  await render(true);assert.equal(f.authCalls,1);assert.equal(f.calls.length,15);
  await render(false);assert.equal(f.authCalls,1);assert.equal(f.calls.length,15);assert.equal(current.data,null);assert.ok(f.calls.every(c=>c.signal?.aborted));
 }finally{await React.act(async()=>root?.unmount());delete global.window}
});
