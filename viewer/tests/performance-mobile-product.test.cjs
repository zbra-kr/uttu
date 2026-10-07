const fs=require('fs'),path=require('path'),{AsyncLocalStorage}=require('async_hooks');
const root=path.resolve(__dirname,'..');
const load=require(path.join(root,'tests/helpers/load-source.cjs'));
const React=require(path.join(root,'node_modules/react')),Renderer=require(path.join(root,'node_modules/react-test-renderer'));
global.IS_REACT_ACT_ENVIRONMENT=true;global.fetch=()=>{throw Error('network forbidden')};
async function scenario(name,opts={}){
 let now=0,no='123',events=[],queue=[],seq=0,tree,unmounted=false;const als=new AsyncLocalStorage();
 const log=(kind,extra={})=>events.push({at:now,kind,...extra});
 const delays={fetchProductDetail:10,fetchProductHistories:100,fetchProductCategoryRanks:35,fetchReviews:50,fetchBodyStats:30,...opts.delays};
 function query(table,rpc,args){const ctx=als.getStore();let select='',filters={};const target={};const proxy=new Proxy(target,{get(_,key){if(key==='then')return(resolve,reject)=>{log(rpc?'rpc-dispatch':'table-dispatch',{helper:ctx.helper,product:ctx.product,table,select,filters,args});queue.push({at:now+(opts.productDelays?.[String(ctx.product)]?.[ctx.helper]??delays[ctx.helper]),id:seq++,run(){if(opts.fail===ctx.helper&&(!opts.failBOnly||String(ctx.product).includes('456'))&&(!opts.failAOnly||String(ctx.product).includes('123'))){log('transport-reject',{helper:ctx.helper});reject(Error('fixture transport'));return}let data=[];if(table==='products')data=opts.missing?null:{id:'uuid-'+ctx.product,musinsa_no:Number(ctx.product),name:'Fixture '+ctx.product,is_own:opts.own!==false&&!(opts.nonOwnB&&ctx.product==='456'),brands:{name:'Fixture brand'}};if(table==='reviews')data=[{id:'review-'+ctx.product,product_id:ctx.product,rating:5,review_text:'REVIEW-'+ctx.product,review_date:'2026-10-05',products:{name:'Review product '+ctx.product,musinsa_no:ctx.product.replace('uuid-','')}}];if(rpc)data=[{type:'height',bucket:'HEIGHT-'+ctx.product,avg_rating:4.5,cnt:11},{type:'weight',bucket:'WEIGHT-'+ctx.product,avg_rating:4,cnt:11}];if(table==='get_product_history_v1')data=require('./fixtures/product-history-weekly.json');if(select==='snapshot_date')data=[{snapshot_date:'2026-10-05'}];log('reader-response',{helper:ctx.helper,table});resolve({data,error:opts.sdkFail===ctx.helper?{message:'fixture SDK error'}:null,count:0})}})};return(...a)=>{if(key==='select')select=a[0];if(key==='eq')filters[a[0]]=a[1];return proxy}}});return proxy}
 const client={from:table=>query(table,false),rpc:(name,args)=>query(name,true,args)};
 const actual=load('src/lib/queries.ts',{'./supabase/client':{supabaseBrowser:()=>client}});
 const helpers={...actual};for(const helper of Object.keys(delays))helpers[helper]=(...args)=>{const product=typeof args[0]==='object'?args[0].productId:args[0];log('helper-start',{helper,product});return als.run({helper,product},()=>actual[helper](...args)).then(v=>{log('helper-end',{helper,product});return v})};
 const hidden={__esModule:true,default:()=>null};const component=load('src/app/(app)/product/MobileProductDetailView.tsx',{'react/jsx-runtime':require(path.join(root,'node_modules/react/jsx-runtime')),'react':{...React,useState(initial){const [value,set]=React.useState(initial);return[value,(next)=>{log('setter-attempt',{unmounted});set(next)}]}},'@/lib/queries':helpers,'next/navigation':{useSearchParams:()=>new URLSearchParams({no}),useRouter:()=>({push(){}})},'@/components/mobile/MobileEmptyState':hidden,'@/components/mobile/ReviewDetailSheet':{__esModule:true,default:({review,showProductButton})=>{log('sheet-props',{review,showProductButton});return React.createElement('sheet-fixture',{'data-review':review.id,'data-review-details':review,'data-show-product-button':showProductButton},'SHEET-'+review.id)}},'@/components/me/NoteDrawer':{...hidden,useSourceNoteDrawer:()=>({noteDrawerOpen:false,setNoteDrawerOpen(){}}),SourceNoteFallback:()=>null},recharts:Object.fromEntries(['LineChart','Line','XAxis','YAxis','ResponsiveContainer','Tooltip','ReferenceDot'].map(k=>[k,()=>null]))}).default;
 const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};
 const snapshot=()=>{const rendered=tree.toJSON();log('render',{sheetProps:rendered?tree.root.findAllByType('sheet-fixture')[0]?.props:null,unmounted,loading:rendered?.type==='div'&&rendered?.props?.style?.padding==='60px 0',text:JSON.stringify(rendered).includes('Fixture'),product123:JSON.stringify(rendered).includes('Fixture 123'),product456:JSON.stringify(rendered).includes('Fixture 456'),reviewA:JSON.stringify(rendered).includes('REVIEW-uuid-123'),reviewB:JSON.stringify(rendered).includes('REVIEW-uuid-456'),bodyA:JSON.stringify(rendered).includes('HEIGHT-uuid-123'),bodyB:JSON.stringify(rendered).includes('HEIGHT-uuid-456'),sheetA:JSON.stringify(rendered).includes('SHEET-review-uuid-123'),sheetB:JSON.stringify(rendered).includes('SHEET-review-uuid-456')})};
 await React.act(async()=>{tree=Renderer.create(React.createElement(component));await flush()});snapshot();
 if(opts.openAt!=null)queue.push({at:opts.openAt,id:seq++,run:()=>{const row=tree.root.findAll(n=>n.type==='div'&&n.props.onClick&&n.findAllByType('p').some(p=>p.children.includes(opts.openB?'REVIEW-uuid-456':'REVIEW-uuid-123')))[0];if(!row)throw Error('review row missing');row.props.onClick();log(opts.openB?'open-review-B':'open-review-A')}});
 if(opts.navigateAt!=null)queue.push({at:opts.navigateAt,id:seq++,run:async()=>{no='456';log('navigate');tree.update(React.createElement(component));}});
 if(opts.cancelAt!=null)queue.push({at:opts.cancelAt,id:seq++,run:()=>{unmounted=true;log('unmount');tree.unmount()}});
 while(queue.length){queue.sort((a,b)=>a.at-b.at||a.id-b.id);const e=queue.shift();now=e.at;await React.act(async()=>{await e.run();await flush()});snapshot()}
 await new Promise(resolve=>setImmediate(resolve));await React.act(async()=>{unmounted=true;tree.unmount()});
 const starts=events.filter(e=>e.kind==='helper-start'),reads=events.filter(e=>e.kind==='table-dispatch'),rpcs=events.filter(e=>e.kind==='rpc-dispatch');
 return{name,unit:'synthetic virtual milliseconds; not live latency',helperStarts:starts.length,tableReads:reads.length,rpcCalls:rpcs.length,readyAt:events.find(e=>e.kind==='render'&&!e.unmounted&&!e.loading)?.at,events};
}

const test=require('node:test'),assert=require('node:assert/strict');
const cases=[
 ['own slow history',{},70,5,2,10],
 ['own slow detail',{delays:{fetchProductDetail:120}},170,5,2,120],
 ['non-own',{own:false},70,5,1,70],
 ['missing detail',{missing:true},70,4,1,null],
 ['early history failure',{fail:'fetchProductHistories',delays:{fetchProductHistories:5}},70,5,2,10],
 ['detail failure',{fail:'fetchProductDetail'},10,4,1,null],
 ['late history failure',{fail:'fetchProductHistories'},70,5,2,10],
 ['review rejection',{fail:'fetchReviews'},70,5,2,10],
 ['body SDK degradation',{sdkFail:'fetchBodyStats'},70,5,2,10],
 ['review SDK error',{sdkFail:'fetchReviews'},70,5,2,10],
 ['body transport rejection',{fail:'fetchBodyStats'},70,5,2,10],
 ['cancel before identity',{cancelAt:5},undefined,4,1,null],
 ['cancel after extras',{cancelAt:20},undefined,5,2,10],
 ['navigate before identity',{navigateAt:5},75,9,3,15],
 ['navigate during extras',{navigateAt:20},90,10,4,10],
];
for(const[name,opts,ready,reads,rpcs,extraAt]of cases)test('MobileProduct actual reader waterfall: '+name,async()=>{
 const r=await scenario(name,opts);assert.equal(r.readyAt,ready);assert.equal(r.tableReads,reads);assert.equal(r.rpcCalls,rpcs);
 const reviews=r.events.filter(e=>e.kind==='helper-start'&&e.helper==='fetchReviews');assert.equal(reviews[0]?.at??null,extraAt);
 if(opts.navigateAt){assert.equal(r.events.some(e=>e.kind==='render'&&e.at>=opts.navigateAt&&e.product123),false);assert.equal(r.events.some(e=>e.kind==='render'&&e.product456),true)}
 if(opts.fail==='fetchReviews'||opts.fail==='fetchBodyStats'||opts.sdkFail)assert.equal(r.events.some(e=>e.kind==='render'&&!e.loading&&e.product123),true);
 if(opts.fail==='fetchProductDetail')assert.equal(r.events.some(e=>e.kind==='render'&&e.product123),false);
 if(opts.fail==='fetchProductHistories')assert.equal(r.events.some(e=>e.kind==='render'&&e.product123),true);
 if(opts.cancelAt)assert.equal(r.events.filter(e=>e.kind==='setter-attempt'&&e.unmounted).length,0);
});

for(const failure of [null,'fetchReviews','fetchBodyStats'])test('MobileProduct preserves populated B and its sheet after awaited A extras '+(failure??'resolve'),async()=>{
 const r=await scenario('awaited A extras',{navigateAt:150,openAt:305,openB:true,fail:failure,failAOnly:true,productDelays:{'uuid-123':{fetchReviews:300,fetchBodyStats:300}}});
 for(const [product,start] of [['uuid-123',10],['uuid-456',160]])for(const helper of ['fetchReviews','fetchBodyStats']){
  const calls=r.events.filter(e=>e.kind==='helper-start'&&e.helper===helper&&e.product===product);assert.equal(calls.length,1);assert.equal(calls[0].at,start);
  const dispatch=r.events.filter(e=>['table-dispatch','rpc-dispatch'].includes(e.kind)&&e.helper===helper&&e.product===product);assert.equal(dispatch.length,1);assert.equal(dispatch[0].at,start);
  if(helper==='fetchReviews')assert.equal(dispatch[0].filters.product_id,product);else assert.equal(dispatch[0].args.p_product_id,product);
 }
 const afterSheet=r.events.filter(e=>e.kind==='render'&&e.at>=305&&!e.unmounted);assert.ok(afterSheet.length>=2);
 for(const e of afterSheet){assert.equal(e.product456,true);assert.equal(e.reviewB,true);assert.equal(e.bodyB,true);assert.equal(e.sheetB,true);assert.equal(e.reviewA,false);assert.equal(e.bodyA,false);assert.equal(e.sheetA,false);assert.deepEqual(e.sheetProps['data-review-details'],afterSheet[0].sheetProps['data-review-details']);assert.equal(e.sheetProps['data-review-details'].product_id,'uuid-456');assert.equal(e.sheetProps['data-show-product-button'],false)}
 const sheets=r.events.filter(e=>e.kind==='sheet-props'&&e.at>=305);assert.ok(sheets.length>=1);for(const sheet of sheets){assert.deepEqual(sheet.review,sheets[0].review);assert.equal(sheet.review.product_id,'uuid-456');assert.equal(sheet.review.review_text,'REVIEW-uuid-456');assert.equal(sheet.showProductButton,false)}
 assert.equal(r.events.filter(e=>e.kind==='setter-attempt'&&e.at>305).length,0);
 assert.ok(r.events.some(e=>['reader-response','transport-reject'].includes(e.kind)&&e.at===310&&['fetchReviews','fetchBodyStats'].includes(e.helper)));
});
test('MobileProduct unmount after initial wave observes late extras rejection without setters',async()=>{
 const r=await scenario('unmount awaiting A extras',{cancelAt:120,fail:'fetchReviews',productDelays:{'uuid-123':{fetchReviews:300,fetchBodyStats:300}}});
 assert.ok(r.events.some(e=>e.kind==='setter-attempt'&&e.at===70&&!e.unmounted));
 assert.ok(r.events.some(e=>e.kind==='transport-reject'&&e.at===310));
 assert.equal(r.events.filter(e=>e.kind==='setter-attempt'&&e.unmounted).length,0);
 for(const helper of ['fetchReviews','fetchBodyStats']){const start=r.events.find(e=>e.kind==='helper-start'&&e.helper===helper);assert.equal(start.product,'uuid-123');assert.equal(start.at,10)}
});
