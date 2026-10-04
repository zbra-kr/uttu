const test=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),SSR=require('react-dom/server'),Renderer=require('react-test-renderer');
const{fixture}=require('./helpers/shell-hydration.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.document={documentElement:{setAttribute(){},style:{setProperty(){}},classList:{toggle(){},remove(){}}},addEventListener(){},removeEventListener(){}};
const element=f=>React.createElement(f.Shell,null,React.createElement('main',null,'Inert note route'));
const contexts=root=>root.root.findAll(x=>x.props.className==='aip-context').map(x=>x.findAll(x=>x.type==='span').map(x=>x.children.filter(c=>typeof c==='string').join('')).join('|'));
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
