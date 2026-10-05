const fs=require('fs'),path=require('path'),{AsyncLocalStorage}=require('async_hooks');
const root=path.resolve(__dirname,'..');
const load=require(path.join(root,'tests/helpers/load-source.cjs'));
const React=require(path.join(root,'node_modules/react')),Renderer=require(path.join(root,'node_modules/react-test-renderer'));
global.IS_REACT_ACT_ENVIRONMENT=true;global.fetch=()=>{throw Error('network forbidden')};
async function scenario(name,opts={}){
 let now=0,no='123',events=[],queue=[],seq=0,tree;const als=new AsyncLocalStorage();
 const log=(kind,extra={})=>events.push({at:now,kind,...extra});
 const delays={fetchProductDetail:10,fetchProductPriceHistory:100,fetchProductRankHistory:80,fetchProductCategoryRanks:35,fetchReviews:50,fetchBodyStats:30,...opts.delays};
 function query(table,rpc,args){const ctx=als.getStore();let select='',filters={};const target={};const proxy=new Proxy(target,{get(_,key){if(key==='then')return(resolve,reject)=>{log(rpc?'rpc-dispatch':'table-dispatch',{helper:ctx.helper,product:ctx.product,table,select,filters,args});queue.push({at:now+delays[ctx.helper],id:seq++,run(){if(opts.fail===ctx.helper){log('transport-reject',{helper:ctx.helper});reject(Error('fixture transport'));return}let data=[];if(table==='products')data=opts.missing?null:{id:'uuid-'+ctx.product,musinsa_no:Number(ctx.product),name:'Fixture '+ctx.product,is_own:opts.own!==false,brands:{name:'Fixture brand'}};if(select==='snapshot_date')data=[{snapshot_date:'2026-10-05'}];log('reader-response',{helper:ctx.helper,table});resolve({data,error:opts.sdkFail===ctx.helper?{message:'fixture SDK error'}:null,count:0})}})};return(...a)=>{if(key==='select')select=a[0];if(key==='eq')filters[a[0]]=a[1];return proxy}}});return proxy}
 const client={from:table=>query(table,false),rpc:(name,args)=>query(name,true,args)};
 const actual=load('src/lib/queries.ts',{'./supabase/client':{supabaseBrowser:()=>client}});
 const helpers={...actual};for(const helper of Object.keys(delays))helpers[helper]=(...args)=>{const product=typeof args[0]==='object'?args[0].productId:args[0];log('helper-start',{helper,product});return als.run({helper,product},()=>actual[helper](...args)).then(v=>{log('helper-end',{helper,product});return v})};
 const hidden={__esModule:true,default:()=>null};const component=load('src/app/(app)/product/MobileProductDetailView.tsx',{'@/lib/queries':helpers,'next/navigation':{useSearchParams:()=>new URLSearchParams({no}),useRouter:()=>({push(){}})},'@/components/mobile/MobileEmptyState':hidden,'@/components/mobile/ReviewDetailSheet':hidden,'@/components/me/NoteDrawer':{...hidden,useSourceNoteDrawer:()=>({noteDrawerOpen:false,setNoteDrawerOpen(){}}),SourceNoteFallback:()=>null},recharts:Object.fromEntries(['LineChart','Line','XAxis','YAxis','ResponsiveContainer','Tooltip','ReferenceDot'].map(k=>[k,()=>null]))}).default;
 const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};
 const snapshot=()=>{const rendered=tree.toJSON();log('render',{loading:rendered?.type==='div'&&rendered?.props?.style?.padding==='60px 0',text:JSON.stringify(rendered).includes('Fixture'),product123:JSON.stringify(rendered).includes('Fixture 123'),product456:JSON.stringify(rendered).includes('Fixture 456')})};
 await React.act(async()=>{tree=Renderer.create(React.createElement(component));await flush()});snapshot();
 if(opts.navigateAt!=null)queue.push({at:opts.navigateAt,id:seq++,run:async()=>{no='456';log('navigate');tree.update(React.createElement(component));}});
 if(opts.cancelAt!=null)queue.push({at:opts.cancelAt,id:seq++,run:()=>{log('unmount');tree.unmount()}});
 while(queue.length){queue.sort((a,b)=>a.at-b.at||a.id-b.id);const e=queue.shift();now=e.at;await React.act(async()=>{await e.run();await flush()});if(!opts.cancelAt||now<opts.cancelAt)snapshot()}
 await React.act(async()=>tree.unmount());
 const starts=events.filter(e=>e.kind==='helper-start'),reads=events.filter(e=>e.kind==='table-dispatch'),rpcs=events.filter(e=>e.kind==='rpc-dispatch');
 return{name,unit:'synthetic virtual milliseconds; not live latency',helperStarts:starts.length,tableReads:reads.length,rpcCalls:rpcs.length,readyAt:events.find(e=>e.kind==='render'&&!e.loading)?.at,events};
}

const test=require('node:test'),assert=require('node:assert/strict');
const cases=[
 ['own slow history',{},100,7,1,10],
 ['own slow detail',{delays:{fetchProductDetail:120}},170,7,1,120],
 ['non-own',{own:false},100,7,0,100],
 ['missing detail',{missing:true},100,6,0,null],
 ['early history failure',{fail:'fetchProductPriceHistory',delays:{fetchProductPriceHistory:5}},5,6,0,null],
 ['detail failure',{fail:'fetchProductDetail'},10,6,0,null],
 ['late history failure',{fail:'fetchProductPriceHistory'},100,7,1,10],
 ['review rejection',{fail:'fetchReviews'},100,7,1,10],
 ['body SDK degradation',{sdkFail:'fetchBodyStats'},100,7,1,10],
 ['review SDK error',{sdkFail:'fetchReviews'},100,7,1,10],
 ['body transport rejection',{fail:'fetchBodyStats'},100,7,1,10],
 ['cancel before identity',{cancelAt:5},undefined,6,0,null],
 ['cancel after extras',{cancelAt:20},undefined,7,1,10],
 ['navigate before identity',{navigateAt:5},105,13,1,15],
 ['navigate during extras',{navigateAt:20},120,14,2,10],
];
for(const[name,opts,ready,reads,rpcs,extraAt]of cases)test('MobileProduct actual reader waterfall: '+name,async()=>{
 const r=await scenario(name,opts);assert.equal(r.readyAt,ready);assert.equal(r.tableReads,reads);assert.equal(r.rpcCalls,rpcs);
 const reviews=r.events.filter(e=>e.kind==='helper-start'&&e.helper==='fetchReviews');assert.equal(reviews[0]?.at??null,extraAt);
 if(opts.navigateAt){assert.equal(r.events.some(e=>e.kind==='render'&&e.at>=opts.navigateAt&&e.product123),false);assert.equal(r.events.some(e=>e.kind==='render'&&e.product456),true)}
 if(opts.fail==='fetchReviews'||opts.fail==='fetchBodyStats'||opts.sdkFail)assert.equal(r.events.some(e=>e.kind==='render'&&!e.loading&&e.product123),true);
 if(opts.fail==='fetchProductDetail'||opts.fail==='fetchProductPriceHistory')assert.equal(r.events.some(e=>e.kind==='render'&&e.product123),false);
 if(opts.cancelAt)assert.equal(r.events.some(e=>e.kind==='render'&&e.at>=opts.cancelAt),false);
});
