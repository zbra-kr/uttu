import { parseCentralScope,type CentralScope,type CentralState } from './central-sales-read';
import { readConfiguredCurrentCentralSales } from './central-sales-runtime';
import { readInsightCache,type InsightCache,type InsightCacheResult } from './insight-cache-contract';
import { prepareAggregateGeneration,publishPreparedGeneration,type AggregateGeneration } from './aggregate-generation';
export type AggregatePhase='cache_read'|'cache_validation'|'render'|'upstream_request';
export interface AggregateMetric {phase:AggregatePhase;elapsedMs:number;outcome:'ok'|'failed'}
export interface Timer {now:()=>number;emit:(metric:AggregateMetric)=>void}
export async function measureAggregate<T>(phase:AggregatePhase,timer:Timer,action:()=>Promise<T>):Promise<T>{const start=timer.now();let outcome:AggregateMetric['outcome']='failed';try{const value=await action();outcome='ok';return value;}finally{try{timer.emit({phase,elapsedMs:Math.max(0,timer.now()-start),outcome});}catch{/* instrumentation cannot change business result */}}}
export interface AggregateReader {load:(scope:CentralScope)=>Promise<InsightCache|null>;lastGood:(scope:CentralScope)=>Promise<InsightCache|null>;refreshStatus:(scope:CentralScope)=>Promise<'pending'|'failed'|'ok'|'unknown'>}
export interface AggregatePublisher {publishAtomic:(g:AggregateGeneration)=>Promise<'published'|'replayed'|'older'>;recordRefresh:(scope:CentralScope,status:'pending'|'failed'|'ok')=>Promise<void>}
export interface AggregateRepository extends AggregateReader,AggregatePublisher {}
// Actual existing server-read boundary is used only by explicitly invoked refresh.
// UI reads never initialize upstream or mutate repository/schedules.
export async function refreshBrandAggregate(input:unknown,observedAt:string,repository:AggregatePublisher,timer:Timer,source=readConfiguredCurrentCentralSales){
 const parsed=parseCentralScope(input);if(!parsed.scope)throw Error('AGGREGATE_SCOPE_INVALID');
 await repository.recordRefresh(parsed.scope,'pending');
 try{
  const state=await measureAggregate('upstream_request',timer,()=>source(input));
  const generation=prepareAggregateGeneration(state,observedAt),published=await publishPreparedGeneration(generation,repository);
  if(published!=='older')await repository.recordRefresh(parsed.scope,'ok');
  return published;
 }catch(error){await repository.recordRefresh(parsed.scope,'failed');throw error;}
}
export async function readBrandAggregate(input:unknown,deps:{repository:AggregateReader;authorize:()=>Promise<string|null>;now:number;timer:Timer}):Promise<InsightCacheResult>{
 const q=parseCentralScope(input);if(!q.scope||q.scope.brand!=='CO'||q.scope.aggregate!=='daily')return {kind:'withheld',reason:'INVALID'};
 const before=await deps.authorize();if(!before)return {kind:'withheld',reason:'ACCESS'};
 let fallback=false,cache:InsightCache|null;
 try{cache=await measureAggregate('cache_read',deps.timer,()=>deps.repository.load(q.scope!));}
 catch{fallback=true;try{cache=await measureAggregate('cache_read',deps.timer,()=>deps.repository.lastGood(q.scope!));}catch{return {kind:'withheld',reason:'MISS'};}}
 try{const status=await deps.repository.refreshStatus(q.scope);if(status==='failed'||status==='pending')fallback=true;}catch{fallback=true;}
 let authCalls=0;
 return measureAggregate('cache_validation',deps.timer,()=>readInsightCache(q.scope!,{authorize:async()=>++authCalls===1?before:deps.authorize(),now:deps.now,maxAgeMs:3600000,load:async()=>cache,refreshFailed:fallback}));
}
// Measures the actual render callback supplied by the page/SSR boundary; no DOM timing claim.
export function renderBrandAggregate<T>(result:InsightCacheResult,timer:Timer,render:(state:CentralState|null,result:InsightCacheResult)=>Promise<T>){return measureAggregate('render',timer,()=>render(result.kind==='withheld'?null:result.snapshot.sales as CentralState,result));}
