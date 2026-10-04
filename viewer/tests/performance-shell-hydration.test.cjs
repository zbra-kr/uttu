const test=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),SSR=require('react-dom/server'),Renderer=require('react-test-renderer');
const{fixture}=require('./helpers/shell-hydration.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.document={documentElement:{setAttribute(){},style:{setProperty(){}},classList:{toggle(){},remove(){}}},addEventListener(){},removeEventListener(){}};
const element=f=>React.createElement(f.Shell,null,React.createElement('main',null,'Inert note route'));
const contexts=root=>root.root.findAll(x=>x.props.className==='aip-context').map(x=>x.findAll(x=>x.type==='span').map(x=>x.children.filter(c=>typeof c==='string').join('')).join('|'));
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve()};
const helpButton=root=>root.root.findAllByType('button').find(b=>b.props['data-tour-help']===true);
const helpDrawer=root=>root.root.find(x=>x.type?.name==='HelpDrawer');
test('actual /index server versus / first client and same-path help presentation match',()=>{
 for(const [serverPath,clientPath]of [['/index','/'],['/','/'],['/reviews','/reviews'],[null,'/']]){const server=fixture(true),client=fixture();server.setRoute(serverPath);client.setRoute(clientPath);const html=SSR.renderToString(element(server));assert.equal(SSR.renderToString(element(client)),html);assert.equal(server.guideRequests.length,0);assert.equal(client.guideRequests.length,0);}
});
test('generic server and first client shell match across routes, dates and timezone',()=>{
 const server=fixture(true);const html=SSR.renderToString(element(server));assert.match(html,/UTTU/);
 const savedTZ=process.env.TZ;
 try{for(const timezone of ['UTC','Asia/Seoul','America/Los_Angeles']){process.env.TZ=timezone;for(const route of ['/','/product','/me'])for(const date of ['2026-10-03T12:00:00Z','2026-10-03T15:01:00Z'])for(const open of [false,true])for(const mobile of [false,true]){const client=fixture();client.setRoute(route);client.setDate(date);client.setOpen(open);client.setMobile(mobile);assert.equal(SSR.renderToString(element(client)),html,`${timezone} ${route} ${date} open=${open} mobile=${mobile}`);}}}
 finally{if(savedTZ===undefined)delete process.env.TZ;else process.env.TZ=savedTZ;}
});
test('post-mount home and note navigation resolves context with real closed/open AiPanel',async()=>{
 for(const open of [false,true]){
  const f=fixture();f.setOpen(open);let root;
  await React.act(async()=>{root=Renderer.create(element(f));await Promise.resolve();});
  assert.ok(contexts(root).some(s=>s.includes('2026.10.04')));
  for(const route of ['/product','/me','/']){f.setRoute(route);await React.act(async()=>root.update(element(f)));const actual=contexts(root);assert.ok(actual.length);if(route==='/')assert.ok(actual.some(s=>s.includes('2026.10.04')));else assert.ok(actual.every(s=>!s.includes('2026.10.04')));}
  f.setDate('2026-10-04T15:01:00Z');await React.act(async()=>root.update(element(f)));assert.ok(contexts(root).some(s=>s.includes('2026.10.05')));
  await React.act(async()=>root.unmount());
 }
});
test('actual MobileShell mounts its mobile AiPanel',async()=>{
 const f=fixture();f.setMobile(true);let root;await React.act(async()=>{root=Renderer.create(element(f));await Promise.resolve();});assert.equal(root.root.findAll(x=>x.type?.name==='MobileShell').length,1);assert.equal(root.root.find(x=>x.type?.name==='AiPanel').props.mobileMode,true);await React.act(async()=>root.unmount());
});
test('real Topbar/HelpDrawer open, route cancellation, cache and closed-route lookup',async()=>{
 const f=fixture();f.setDeferGuide(true);let root;await React.act(async()=>{root=Renderer.create(element(f));await flush()});
 assert.equal(root.root.findAll(x=>x.type?.name==='Topbar').length,1);assert.equal(root.root.findAll(x=>x.type?.name==='HelpButton').length,1);assert.equal(helpDrawer(root).props.pagePath,'/');assert.deepEqual(f.guideRequests,[]);
 await React.act(async()=>{helpButton(root).props.onClick();await flush()});assert.equal(helpDrawer(root).props.open,true);assert.deepEqual(f.guideRequests,['/']);
 f.setRoute('/product');await React.act(async()=>{root.update(element(f));await flush()});assert.equal(helpDrawer(root).props.pagePath,'/product');assert.deepEqual(f.guideRequests,['/','/product']);
 await React.act(async()=>{f.resolveGuide('/',[{id:'old',title:'Stale home guide',slug:'old',content:{}}]);await flush()});assert.ok(!JSON.stringify(root.toJSON()).includes('Stale home guide'));
 await React.act(async()=>{f.resolveGuide('/product',[{id:'current',title:'Current product guide',slug:'product',content:{}}]);await flush()});assert.ok(JSON.stringify(root.toJSON()).includes('Current product guide'));
 await React.act(async()=>{helpDrawer(root).props.onClose();await flush()});assert.equal(helpDrawer(root).props.open,false);
 await React.act(async()=>{helpButton(root).props.onClick();await flush()});assert.deepEqual(f.guideRequests,['/','/product']);
 await React.act(async()=>{helpDrawer(root).props.onClose();f.setRoute('/me');root.update(element(f));await flush()});assert.equal(helpDrawer(root).props.pagePath,'/me');assert.deepEqual(f.guideRequests,['/','/product']);assert.ok(!JSON.stringify(root.toJSON()).includes('Current product guide'));
 await React.act(async()=>{helpButton(root).props.onClick();await flush()});assert.deepEqual(f.guideRequests,['/','/product','/me']);await React.act(async()=>root.unmount());await React.act(async()=>{f.resolveGuide('/me',[]);await flush()});
});
