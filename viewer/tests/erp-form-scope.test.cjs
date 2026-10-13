const test=require('node:test'),assert=require('node:assert/strict');
const SSR=require('react-dom/server'),load=require('./helpers/load-source.cjs');
const C=load('src/lib/erp/central-sales-read.ts'),I=load('src/lib/erp/inventory-read.ts');
const query={brand:'CO',from:'2026-10-01',to:'2026-10-10',inventoryStyles:'CO-SYN,CO-SYN2'};
function setup(){
 const calls={sales:[],inventory:[]};
 const page=load('src/app/(app)/erp-insights-review/page.tsx',{
  '@/components/erp-insights/ErpInsightsWorkspace':{__esModule:true,default:()=>null},
  '@/lib/erp/central-sales-runtime':{readConfiguredCurrentCentralSales:async p=>{calls.sales.push(p);const s=C.parseCentralScope(p);return C.centralState(s.scope?'unconnected':'request',s.scope,s.reason??'UNCONNECTED');}},
  '@/lib/erp/inventory-server':{readConfiguredInventory:async p=>{calls.inventory.push(p);const s=I.parseInventoryScope(p);return I.inventoryState(s.scope?'unconnected':'request',s.reason??'UNCONNECTED',s.scope);}},
 }).default;
 return {calls,render:async p=>SSR.renderToStaticMarkup(await page({searchParams:Promise.resolve(p)}))};
}
function submit(html,index,edits={}){
 const form=[...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)][index][1],data=new URLSearchParams();
 for(const [,tag] of form.matchAll(/<input\b([^>]*?)\/?\s*>/g)){const name=tag.match(/name="([^"]*)"/),value=tag.match(/value="([^"]*)"/);if(name)data.append(name[1],value?.[1]??'');}
 for(const [,name,body] of form.matchAll(/<select\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)){const selected=body.match(/<option\b([^>]*selected[^>]*)>([^<]*)<\/option>/);assert.ok(selected);data.append(name,selected[1].match(/value="([^"]*)"/)?.[1]??selected[2]);}
 for(const [key,value] of Object.entries(edits))data.set(key,value);
 return Object.fromEntries(data);
}
test('inventory submit retains sales dates, then sales submit retains inventory styles on actual page',async()=>{
 const s=setup(),first=await s.render(query),inventory=submit(first,1,{inventoryStyles:'CO-SYN2'});
 assert.deepEqual(inventory,{brand:'CO',from:query.from,to:query.to,inventoryStyles:'CO-SYN2'});
 const second=await s.render(inventory),sales=submit(second,0,{to:'2026-10-12'});
 assert.deepEqual(sales,{brand:'CO',from:query.from,to:'2026-10-12',inventoryStyles:'CO-SYN2'});
 await s.render(sales);assert.deepEqual(s.calls.sales.at(-1),{brand:'CO',from:query.from,to:'2026-10-12'});assert.deepEqual(s.calls.inventory.at(-1),{brand:'CO',styles:'CO-SYN2'});
});
test('brand submitted once, changed brand revalidated by both readers',async()=>{
 const s=setup(),html=await s.render(query),next=submit(html,1,{brand:'LE'});await s.render(next);
 assert.equal(s.calls.sales.at(-1).brand,'LE');assert.deepEqual(s.calls.inventory.at(-1),{brand:'LE',styles:query.inventoryStyles});
 for(const form of [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)])assert.equal((form[1].match(/name="brand"/g)||[]).length,1);
});
test('invalid arrays and identity or secret query fields are never carried',async()=>{
 const s=setup(),html=await s.render({...query,from:['2026-10-01'],inventoryStyles:['CO-SYN'],expectedRequesterId:'PRIVATE-ID',token:'PRIVATE-TOKEN',role:'admin'});
 assert.doesNotMatch(html,/type="hidden"|PRIVATE-ID|PRIVATE-TOKEN/);
 for(const i of [0,1])assert.deepEqual(Object.keys(submit(html,i)).sort(),i===0?['brand','from','to']:['brand','inventoryStyles']);
 const valid=await s.render({...query,expectedRequesterId:'PRIVATE-ID',token:'PRIVATE-TOKEN'});assert.doesNotMatch(valid,/PRIVATE-ID|PRIVATE-TOKEN/);
});
