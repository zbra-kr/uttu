import { auditDailySalesAmount } from './daily-sales-amount-audit';
import { centralAmountDisplay,centralDisplayTotal } from './central-sales-display';
import { parseCentralScope,type CentralState,type CentralScope } from './central-sales-read';
export const INSIGHT_CACHE_DEFINITION='central-vat-ex-transfer-ex-float-null-audit-v1';
export interface InsightCache {version:1;definition:typeof INSIGHT_CACHE_DEFINITION;scope:CentralScope;observedAt:string;sourceWatermark:null;sales:Pick<CentralState,'kind'|'scope'|'reasons'|'rows'|'total'|'dailySummary'|'groupsObserved'|'value'|'executable'>}
// Reuses reviewed server-normalized daily DTO, never turns raw rows/partial reads into totals.
export function prepareInsightCache(state:CentralState,observedAt:string):InsightCache|null {try{return validateSnapshot(state,observedAt);}catch{return null;}}
function validateSnapshot(state:CentralState,observedAt:string):InsightCache|null {
 if(state.kind!=='summary'||!state.scope||state.scope.aggregate!=='daily'||!state.dailySummary||!Number.isFinite(Date.parse(observedAt)))return null;
 if(parseCentralScope(state.scope).reason||state.dailySummary.rows.length>31)return null;
 const dates=new Set<string>();
 for(const row of state.dailySummary.rows){if(row.brand!==state.scope.brand||row.saleDate<state.scope.from||row.saleDate>state.scope.to||parseCentralScope({brand:row.brand,from:row.saleDate,to:row.saleDate}).reason||dates.has(row.saleDate))return null;dates.add(row.saleDate);}
 const equal=(a:object,b:object)=>Object.entries(a).every(([k,v])=>Object.hasOwn(b,k)&&(b as Record<string,unknown>)[k]===v);
 for(const row of state.dailySummary.rows){
  const audit=auditDailySalesAmount(row.audit.sourceRows,row.audit.amountRows,row.amount.sourceValue);if(!audit||!equal(audit,row.audit))return null;
  const parsed=centralAmountDisplay(row.amount.sourceValue),amount=!audit.complete&&parsed.sourceValue!==null?{...parsed,approximateValue:null,millionsText:null,reason:'SOURCE_NULL_ROWS'}:parsed;
  if(!equal(amount,row.amount))return null;
 }
 if(!equal(centralDisplayTotal(state.dailySummary.rows),state.dailySummary.total))return null;
 const {kind,scope,reasons,rows,total,dailySummary,groupsObserved,value,executable}=state;
 return structuredClone({version:1,definition:INSIGHT_CACHE_DEFINITION,scope,observedAt,sourceWatermark:null,sales:{kind,scope,reasons,rows,total,dailySummary,groupsObserved,value,executable}});
}
export type InsightCacheResult={kind:'fresh'|'stale';snapshot:InsightCache;refreshFailed:boolean}|{kind:'withheld';reason:'ACCESS'|'MISS'|'INVALID'|'EXPIRED'};
export async function readInsightCache(scope:CentralScope,deps:{authorize:()=>Promise<string|null>;load:()=>Promise<InsightCache|null>;now:number;maxAgeMs:number;refreshFailed?:boolean}):Promise<InsightCacheResult>{
 const before=await deps.authorize();if(!before)return {kind:'withheld',reason:'ACCESS'};
 let cache:InsightCache|null;try{cache=await deps.load();}catch{return {kind:'withheld',reason:'MISS'};}
 const after=await deps.authorize();if(after!==before)return {kind:'withheld',reason:'ACCESS'};
 if(!cache)return {kind:'withheld',reason:'MISS'};
 if(!cache.scope||!cache.sales||!cache.sales.scope||!['brand','from','to','aggregate'].every(k=>cache.sales.scope![k as keyof CentralScope]===scope[k as keyof CentralScope]))return {kind:'withheld',reason:'INVALID'};
 if(cache.version!==1||cache.definition!==INSIGHT_CACHE_DEFINITION||!['brand','from','to','aggregate'].every(k=>cache.scope[k as keyof CentralScope]===scope[k as keyof CentralScope])||!prepareInsightCache(cache.sales as CentralState,cache.observedAt))return {kind:'withheld',reason:'INVALID'};
 const age=deps.now-Date.parse(cache.observedAt);if(!Number.isFinite(age)||age<0||age>7*86400000||!Number.isFinite(deps.maxAgeMs)||deps.maxAgeMs<1||deps.maxAgeMs>86400000)return {kind:'withheld',reason:'EXPIRED'};
 return {kind:age>deps.maxAgeMs||deps.refreshFailed?'stale':'fresh',snapshot:prepareInsightCache(cache.sales as CentralState,cache.observedAt)!,refreshFailed:deps.refreshFailed===true};
}
