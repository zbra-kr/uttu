const test=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),Renderer=require('react-test-renderer'),SSR=require('react-dom/server');
const load=require('./helpers/load-source.cjs');
const path=require('node:path');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const main=['/','/today','/ranking','/matching','/promo','/reviews','/anomaly'];
const text=node=>typeof node==='string'?node:node.children.map(text).join('');
function fixture(pathname='/',role='viewer',server=false){
 let path=pathname;const pushes=[],calls=[],listeners=new Map();
 const browser={addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);}};
 const client={auth:{getUser:async()=>{calls.push('user');return{data:{user:{id:'fixture',email:'fixture@example.test'}}};},signOut:async()=>{}},from(){calls.push('profile');const q={select(){return q;},eq(){return q;},single:async()=>({data:{role,full_name:'Fixture',display_name:'Fixture'}})};return q;}};
 const hidden={__esModule:true,default:()=>null};
 const navigation={'next/navigation':{usePathname:()=>path,useRouter:()=>({push:p=>pushes.push(p),back:()=>pushes.push('back')})},'next/link':{__esModule:true,default:({children,...props})=>React.createElement('a',props,children)}};
 let searchReply=async()=>[];
 const mocks={...navigation,'../ui/icons':load('src/components/ui/icons.tsx'),'@/lib/supabase/client':{supabaseBrowser:()=>client},'@/components/onboarding/OnboardingProvider':{useOnboarding:()=>({active:false,step:0})},'./AiPanel':hidden,'../help/HelpButton':hidden,'../me/InboxList':hidden,
 '@/lib/queries-me':{fetchUnreadCount:async()=>{calls.push('unread');return 0;}},'@/lib/queries':{searchProducts:(...a)=>searchReply('product',...a),searchBrands:(...a)=>searchReply('brand',...a),searchCompanies:(...a)=>searchReply('company',...a)}};
 const component=name=>load(process.env.SHELL_NAVIGATION_BASELINE_DIR ? path.join(process.env.SHELL_NAVIGATION_BASELINE_DIR,name+'.tsx') : `src/components/shell/${name}.tsx`,mocks).default;
 return{component,path:p=>path=p,pushes,calls,listeners,browser,setSearch:fn=>searchReply=fn};
}
async function surface(name,path,run,role='viewer'){
 const saved={window:global.window,document:global.document};const f=fixture(path,role);
 global.window=f.browser;global.document={addEventListener(){},removeEventListener(){}};
 const Component=f.component(name);let root;
 let collapsed=false;
 const props=()=>name==='Sidebar'?{collapsed,onToggle(){},theme:'light'}:{shellStats:null,context:[],children:React.createElement('main',null,'Route contents')};
 const render=async()=>{await React.act(async()=>root.update(React.createElement(Component,props())));};
 const open=async()=>{if(name==='MobileShell')await React.act(async()=>root.root.findByProps({'aria-label':'메뉴 열기'}).props.onClick());};
 try{await React.act(async()=>{root=Renderer.create(React.createElement(Component,props()));});await open();await run({f,root,render,open,collapse:async()=>{collapsed=true;await render();},buttons:()=>root.root.findAllByType('button'),links:()=>root.root.findAllByType('a'),toggle:async label=>{await React.act(async()=>root.root.findAllByType('button').find(b=>b.props['aria-label']===label||text(b)===label).props.onClick({preventDefault(){}}));}});}finally{if(root)await React.act(async()=>root.unmount());for(const key of ['window','document']){if(saved[key]===undefined)delete global[key];else global[key]=saved[key];}}
}
for(const name of ['Sidebar','MobileShell']){
 test(`${name}: seven ordered primary links, folded references, and accessible portal children`,()=>surface(name,'/',async s=>{
  const paths=()=>s.links().map(a=>a.props.href);const ordered=paths().filter(p=>main.includes(p));assert.deepEqual(ordered.filter((p,i)=>ordered.indexOf(p)===i),main);
  assert.ok(paths().every(Boolean), 'disclosure must never become an empty URL link');
  assert.equal(paths().includes('/report'),false);assert.equal(paths().some(p=>p.startsWith('/admin')),false);
  const reference=s.buttons().find(b=>b.props['aria-label']==='시장 참고자료');assert.equal(reference.type,'button');assert.equal(reference.props.type,'button');assert.equal(reference.props['aria-expanded'],false);
  await s.toggle('시장 참고자료');assert.equal(s.buttons().find(b=>b.props['aria-label']==='시장 참고자료').props['aria-expanded'],true);assert.ok(paths().includes('/report'));
  await s.toggle('브랜드랭킹 하위 메뉴');assert.ok(paths().includes('/brand'));await s.toggle('회사목록 하위 메뉴');assert.ok(paths().includes('/company'));await s.toggle('상품랭킹 하위 메뉴');assert.ok(paths().includes('/product'));
  await s.toggle('시장 참고자료');assert.equal(paths().includes('/brand'),false);assert.equal(paths().includes('/company'),false);assert.ok(paths().includes('/product'));
  assert.equal(s.f.calls.filter(c=>c==='user').length,1);assert.equal(s.f.calls.filter(c=>c==='profile').length,1);
 }));
 test(`${name}: direct reference entry, navigation/back/forward and singular route boundaries`,()=>surface(name,'/brand',async s=>{
  assert.ok(s.links().some(a=>a.props.href==='/brand'));const active=()=>s.links().filter(a=>a.props.className?.includes('active')||a.props.style?.background==='var(--hs-soft)').map(a=>a.props.href);
  assert.ok(active().includes('/brand'));assert.equal(active().includes('/brand-ranking'),false);
  for(const path of ['/brand-ranking','/company','/companies','/brand']){s.f.path(path);await s.render();await s.open();assert.ok(active().includes(path),path);if(path==='/companies')assert.equal(active().includes('/company'),false);}
  if(name==='MobileShell'){await React.act(async()=>s.links().find(a=>a.props.href==='/brand').props.onClick());assert.equal(s.buttons().some(b=>b.props['aria-label']==='시장 참고자료'),false);await s.open();await s.toggle('메뉴 닫기');assert.equal(s.buttons().some(b=>b.props['aria-label']==='시장 참고자료'),false);}
  else{await s.collapse();assert.equal(s.root.root.findByType('aside').props.className.includes('collapsed'),true);await React.act(async()=>s.root.root.findByType('aside').props.onMouseEnter());assert.equal(s.root.root.findByType('aside').props.className.includes('peek'),true);assert.ok(s.links().some(a=>text(a)==='브랜드 검색'));await React.act(async()=>s.root.root.findByType('aside').props.onMouseLeave());assert.equal(s.root.root.findByType('aside').props.className.includes('collapsed'),true);}
 }));
 test(`${name}: admin group retains existing role gate without dead audit URL`,()=>surface(name,'/admin/users',async s=>{
  assert.ok(s.links().some(a=>a.props.href==='/admin/mapping'));assert.equal(s.links().some(a=>a.props.href==='/admin/audit'),false);
 },'admin'));
 test(`${name}: server and first client render agree across default and reference routes`,()=>{
  const server=fixture(null,'viewer',true).component(name);const baseline=SSR.renderToString(React.createElement(server,name==='Sidebar'?{collapsed:false,onToggle(){},theme:'light'}:{shellStats:null,context:[],children:'Route'}));
  for(const path of ['/','/report','/brand','/companies','/me']){const client=fixture(path).component(name);const html=SSR.renderToString(React.createElement(client,name==='Sidebar'?{collapsed:false,onToggle(){},theme:'light'}:{shellStats:null,context:[],children:'Route'}));assert.equal(html,baseline,path);}
 });
}
test('CmdK common pages include new public entry points, keep keyboard/profile navigation, and ignore late closed reads',async()=>{
 const saved=global.window;const f=fixture('/');global.window=f.browser;const Component=f.component('CmdK');let root,closed=0;
 const props=open=>({open,onClose:()=>closed++});
 try{await React.act(async()=>{root=Renderer.create(React.createElement(Component,props(true)));});
  const labels=()=>root.root.findAll(n=>n.props.className==='title').map(text);for(const label of ['오늘의매거진','심층리포트','추천판','자사매칭','상품 검색','브랜드 검색','회사 검색'])assert.ok(labels().includes(label));assert.equal(labels().includes('DART 매핑'),false);
  let resolveOld;f.setSearch(kind=>kind==='product'?new Promise(resolve=>resolveOld=resolve):Promise.resolve([]));
  await React.act(async()=>{root.root.findByType('input').props.onChange({target:{value:'OLD'}});await new Promise(r=>setTimeout(r,235));});
  await React.act(async()=>root.update(React.createElement(Component,props(false))));await React.act(async()=>root.update(React.createElement(Component,props(true))));
  await React.act(async()=>resolveOld([{musinsa_no:99,name:'OLD RESPONSE',brand_name:'Old',is_own:false}]));assert.equal(labels().includes('OLD RESPONSE'),false);assert.ok(labels().includes('추천판'));
  f.setSearch(async()=>[]);await React.act(async()=>{root.root.findByType('input').props.onChange({target:{value:'내 프로필'}});await new Promise(r=>setTimeout(r,235));});
  await React.act(async()=>root.root.findByType('input').props.onKeyDown({key:'Enter',preventDefault(){}}));assert.deepEqual(f.pushes,['/me']);assert.equal(closed,1);
  await React.act(async()=>root.update(React.createElement(Component,props(false))));await React.act(async()=>root.update(React.createElement(Component,props(true))));
  await React.act(async()=>root.root.findByType('input').props.onKeyDown({key:'ArrowDown',preventDefault(){}}));await React.act(async()=>root.root.findByType('input').props.onKeyDown({key:'Enter',preventDefault(){}}));assert.equal(f.pushes.at(-1),'/today');
  await React.act(async()=>{root.root.findByType('input').props.onChange({target:{value:'상품랭킹'}});await new Promise(r=>setTimeout(r,235));});
  await React.act(async()=>root.root.findByType('input').props.onKeyDown({key:'Enter',preventDefault(){}}));assert.equal(f.pushes.at(-1),'/ranking');
  assert.ok([...f.listeners.values()].some(set=>set.size===1));
 }finally{if(root)await React.act(async()=>root.unmount());assert.ok([...f.listeners.values()].every(set=>set.size===0));if(saved===undefined)delete global.window;else global.window=saved;}
});
