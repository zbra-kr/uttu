import 'server-only';
import { parseCentralScope,type CentralScope } from './central-sales-read';
import { normalizeCentralDailyReceipt } from './central-daily-receipt';
import { prepareAggregateGeneration } from './aggregate-generation';
import { readProductCrosswalk,type CrosswalkEvidence,type ProductCandidate } from './product-crosswalk-read';
import { compareSalesMarket,type ComparedProduct } from './sales-market-comparison';
import type { SupabaseClient } from '@supabase/supabase-js';
interface ReadResult {data:unknown;error:unknown;count?:number|null}
export interface ExistingProductReadClient {readProducts:()=>Promise<ReadResult>;readMarket:(ids:readonly string[],dates:readonly string[])=>Promise<ReadResult>}
// Uses only an already constructed reader. No service client, env/key lookup, or privilege fallback.
export function createExistingProductReadClient(client:Pick<SupabaseClient,'from'>):ExistingProductReadClient{
 return {
  async readProducts(){const {data,error,count}=await client.from('products').select('id,musinsa_no,erp_style_code,is_own,brand_id',{count:'exact'}).eq('is_own',true).order('id',{ascending:true}).limit(201);return {data,error,count};},
  async readMarket(ids,dates){if(!ids.length||ids.length>10||new Set(ids).size!==ids.length||dates.length!==2)throw Error('MARKET_SCOPE_INVALID');const {data,error}=await client.from('ranking_snapshots').select('product_id,snapshot_date,rank_position,store_code,category_code,gender_filter,age_filter').in('product_id',[...ids]).in('snapshot_date',[...dates]).eq('store_code','musinsa').eq('category_code','000').eq('gender_filter','A').eq('age_filter','AGE_BAND_ALL').limit(21);return {data,error};},
 };
}
export interface AggregateReadInputs {
 authorizeRead:(scope:Readonly<CentralScope>)=>Promise<string|null>;
 readDaily:(scope:Readonly<CentralScope>)=>Promise<unknown>;
 readStyleDaily:(scope:Readonly<CentralScope>,styles:readonly string[])=>Promise<unknown>;
 products:ExistingProductReadClient|null;
 reviewedMappings:unknown;
 now:()=>number;
}
function obj(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v);}
function proofInput(raw:unknown):CrosswalkEvidence[]{
 if(!Array.isArray(raw)||raw.length>200||raw.some(e=>!obj(e)||!['productId','musinsaNo','style','brand','brandId','evidenceRef','version'].every(k=>typeof e[k]==='string'&&(e[k] as string).trim())||e.status!=='confirmed'||!['CO','LE','WA','CK','LK'].includes(e.brand as string)))throw Error('MAPPING_INPUT_INVALID');
 return structuredClone(raw);
}
async function loadProducts(client:ExistingProductReadClient|null){
 if(!client)return {candidates:[] as ProductCandidate[],complete:false};
 const {data,error,count}=await client.readProducts();
 if(error||!Array.isArray(data)||data.length>201||data.some(p=>!obj(p)||typeof p.id!=='string'||typeof p.musinsa_no!=='string'||typeof p.is_own!=='boolean'||!(p.erp_style_code===null||typeof p.erp_style_code==='string')||!(p.brand_id===null||typeof p.brand_id==='string')))throw Error('PRODUCT_READ_INVALID');
 return {candidates:data.map(({id,musinsa_no,erp_style_code,is_own,brand_id})=>({id,musinsa_no,erp_style_code,is_own,brand_id})) as ProductCandidate[],complete:typeof count==='number'&&Number.isSafeInteger(count)&&count===data.length&&count<=200};
}
// No publisher, refresh-status mutation, scheduler or client/key construction exists in this execution path.
export async function runAggregateSourceDryRun(input:unknown,observedAt:string,deps:AggregateReadInputs){
 const parsed=parseCentralScope(input);if(!parsed.scope||parsed.scope.brand!=='CO'||parsed.scope.aggregate!=='daily'||(Date.parse(parsed.scope.to)-Date.parse(parsed.scope.from))/86400000!==13)throw Error('SCOPE_INVALID');
 const scope=Object.freeze({...parsed.scope}),key=JSON.stringify(scope),proofs=proofInput(deps.reviewedMappings),now=deps.now();
 if(!Number.isFinite(now)||!Number.isFinite(Date.parse(observedAt))||Date.parse(observedAt)>now)throw Error('OBSERVATION_INVALID');
 const authorize=async()=>{const copy={...scope};const p=await deps.authorizeRead(copy);if(JSON.stringify(copy)!==key)throw Error('SCOPE_CHANGED');return p;};
 const pin=await authorize();if(!pin)throw Error('SOURCE_READ_UNCONFIGURED');
 const same=async()=>{if(await authorize()!==pin)throw Error('READ_IDENTITY_CHANGED');return pin;};
 const request={...scope},daily=structuredClone(await deps.readDaily(request));if(JSON.stringify(request)!==key)throw Error('SCOPE_CHANGED');await same();
 const state=normalizeCentralDailyReceipt(scope,daily),generation=prepareAggregateGeneration(state,observedAt);
 let candidates:ProductCandidate[]=[];let productComplete=false;
 const inspected=await readProductCrosswalk({authorize:same,load:async()=>{const p=await loadProducts(deps.products);candidates=p.candidates;productComplete=p.complete;return {...p,evidence:proofs};}});
 await same();
 const exclusions=[...inspected.excluded],eligible=inspected.accepted.filter(e=>{if(e.brand==='CO')return true;exclusions.push({productId:e.productId,reason:'BRAND_SCOPE_MISMATCH'});return false;});
 const selected=eligible.slice(0,10);for(const e of eligible.slice(10))exclusions.push({productId:e.productId,reason:'PILOT_LIMIT'});
 const compared:ComparedProduct[]=[];
 if(selected.length){
  const styles=selected.map(e=>e.style),requested={...scope};
  const raw=structuredClone(await deps.readStyleDaily(requested,[...styles]));if(JSON.stringify(requested)!==key)throw Error('SCOPE_CHANGED');await same();
  if(!obj(raw)||raw.complete!==true||!Array.isArray(raw.rows)||raw.rows.length>140||raw.rows.some(r=>!obj(r)||Object.keys(r).sort().join(',')!=='AMOUNT_ROWS,BRANDCD,SALEDT,SALES_VAT_EX,SOURCE_ROWS,STYLECD'||typeof r.STYLECD!=='string'||!styles.includes(r.STYLECD)))throw Error('STYLE_RECEIPT_INVALID');
  const midpoint=new Date(Date.parse(scope.from)+6*86400000).toISOString().slice(0,10),ids=selected.map(e=>e.productId);
  let market:Record<string,unknown>[]=[];let marketComplete=false;
  try{const {data,error}=await deps.products!.readMarket(ids,[midpoint,scope.to]);
   if(!error&&Array.isArray(data)&&data.length<=20&&data.every(r=>obj(r)&&ids.includes(r.product_id as string)&&[midpoint,scope.to].includes(r.snapshot_date as string)&&r.store_code==='musinsa'&&r.category_code==='000'&&r.gender_filter==='A'&&r.age_filter==='AGE_BAND_ALL'&&Number.isSafeInteger(r.rank_position)&&Number(r.rank_position)>0)){market=structuredClone(data);marketComplete=true;}
  }catch{/* missing/error ranks never become zero or a recommendation */}
  await same();
  for(const e of selected){
   const receipt={complete:true,rows:(raw.rows as Record<string,unknown>[]).filter(r=>r.STYLECD===e.style).map(r=>({BRANDCD:r.BRANDCD,SALEDT:r.SALEDT,SALES_VAT_EX:r.SALES_VAT_EX,SOURCE_ROWS:r.SOURCE_ROWS,AMOUNT_ROWS:r.AMOUNT_ROWS}))},s=normalizeCentralDailyReceipt(scope,receipt);
   const start=market.filter(r=>r.product_id===e.productId&&r.snapshot_date===midpoint),end=market.filter(r=>r.product_id===e.productId&&r.snapshot_date===scope.to);
   compared.push({brand:e.brand,style:e.style,productId:e.productId,mapping:{status:'confirmed',evidence:e.evidenceRef,version:e.version},sales:s.dailySummary?.rows.map(r=>({date:r.saleDate,amount:r.amount.approximateValue}))??[],salesComplete:s.kind==='summary',market:{productId:e.productId,from:midpoint,to:scope.to,startRank:start.length===1?start[0].rank_position as number:null,endRank:end.length===1?end[0].rank_position as number:null,scope:'musinsa/000/A/AGE_BAND_ALL',complete:marketComplete&&start.length===1&&end.length===1},salesFetchedAt:observedAt,marketFetchedAt:observedAt});
  }
 }
 await same();
 const comparison=compareSalesMarket(compared,scope.to,now);
 return {kind:'dry-run' as const,writes:0 as const,generation,mapping:{kind:inspected.kind,reason:'reason' in inspected?inspected.reason:null,productReadConnected:deps.products!==null,productReadComplete:productComplete,accepted:selected,excluded:exclusions,unmapped:exclusions.map(e=>({...e,product:candidates.find(p=>p.id===e.productId)??null}))},comparison,notes:['Caller-supplied reviewed mapping evidence is not inferred from product_matches or erp_style_code.','Fetched-at is execution observation, not certified upstream watermark. No absent day is filled with zero.']};
}
