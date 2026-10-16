import { createHash } from 'node:crypto';
import { prepareInsightCache,type InsightCache } from './insight-cache-contract';
import type { CentralState } from './central-sales-read';
export function prepareAggregateGeneration(state:CentralState,observedAt:string){
 const snapshot=prepareInsightCache(state,observedAt);if(!snapshot||snapshot.scope.brand!=='CO'||(Date.parse(snapshot.scope.to)-Date.parse(snapshot.scope.from))/86400000!==13)throw Error('AGGREGATE_SCOPE_INVALID');
 const payload=JSON.stringify(snapshot),hash=createHash('sha256').update(payload).digest('hex');
 const scopeKey=JSON.stringify([snapshot.scope.brand,snapshot.scope.from,snapshot.scope.to,snapshot.definition]);
 return {runId:createHash('sha256').update(scopeKey+'|'+observedAt+'|'+hash).digest('hex'),scopeKey,hash,snapshot};
}
export type AggregateGeneration=ReturnType<typeof prepareAggregateGeneration>;
// Atomic repository boundary: implementation must call the single SQL publish transaction.
// No provider/client/credentials or scheduler is initialized here.
export async function publishPreparedGeneration(generation:AggregateGeneration,repository:{publishAtomic:(g:AggregateGeneration)=>Promise<'published'|'replayed'|'older'>}){
 const verified=prepareAggregateGeneration(generation.snapshot.sales as CentralState,generation.snapshot.observedAt);
 if(verified.hash!==generation.hash||verified.runId!==generation.runId||verified.scopeKey!==generation.scopeKey)throw Error('AGGREGATE_HASH_INVALID');
 return repository.publishAtomic(verified);
}
// Executable reference repository for synthetic transaction/idempotency/retention tests only.
export function memoryAggregateRepository(){
 const runs=new Map<string,AggregateGeneration>(),heads=new Map<string,string>();
 return {async publishAtomic(g:AggregateGeneration){if(runs.has(g.runId))return 'replayed' as const;runs.set(g.runId,structuredClone(g));const old=runs.get(heads.get(g.scopeKey)??'');const older=!!old&&Date.parse(old.snapshot.observedAt)>Date.parse(g.snapshot.observedAt);if(!older)heads.set(g.scopeKey,g.runId);const ordered=[...runs.values()].sort((a,b)=>Date.parse(b.snapshot.observedAt)-Date.parse(a.snapshot.observedAt));for(const x of ordered.slice(7)){if(heads.get(x.scopeKey)===x.runId)heads.delete(x.scopeKey);runs.delete(x.runId);};return older?'older' as const:'published' as const;},read(scopeKey:string):InsightCache|null{return structuredClone(runs.get(heads.get(scopeKey)??'')?.snapshot??null);},count(){return runs.size;}};
}
