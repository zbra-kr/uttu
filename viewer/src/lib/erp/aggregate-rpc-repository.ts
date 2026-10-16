import 'server-only';
import { parseCentralScope,type CentralScope,type CentralState } from './central-sales-read';
import { INSIGHT_CACHE_DEFINITION,prepareInsightCache,type InsightCache } from './insight-cache-contract';
import { prepareAggregateGeneration,type AggregateGeneration } from './aggregate-generation';
import { refreshBrandAggregate,type AggregateRepository,type AggregateReader,type Timer } from './brand-aggregate-runtime';
import { supabaseServer } from '../supabase/server';
import { currentCentralActor } from './central-sales-runtime';
import { configuredCentralRequesterBinding } from './central-sales-composition';
import { validateRequesterIds } from './requester-allowlist';
export type AggregateReadRpcName='uttu_erp_aggregate_read_v1'|'uttu_erp_aggregate_status_v1';
export type AggregateWriteRpcName='uttu_erp_aggregate_publish_v1'|'uttu_erp_aggregate_refresh_v1';
type AggregateRpcName=AggregateReadRpcName|AggregateWriteRpcName;
type RpcResult=PromiseLike<{data:unknown;error:unknown}>;
interface AggregateRpcClient {rpc:(name:AggregateRpcName,args:Record<string,unknown>)=>RpcResult}
export interface AggregateReadRpcClient {rpc:(name:AggregateReadRpcName,args:Record<string,unknown>)=>RpcResult}
type AggregateAuthorize=(scope:CentralScope,operation:'read'|'write')=>Promise<string|null>;
function validatedScope(scope:CentralScope){if(parseCentralScope(scope).reason||scope.brand!=='CO'||scope.aggregate!=='daily'||(Date.parse(scope.to)-Date.parse(scope.from))/86400000!==13)throw Error('AGGREGATE_SCOPE_INVALID');return JSON.stringify([scope.brand,scope.from,scope.to,INSIGHT_CACHE_DEFINITION]);}
function normalizedSnapshot(raw:unknown,scope:CentralScope):InsightCache{
 try{
  if(!raw||typeof raw!=='object')throw Error();const v=raw as InsightCache;
  if(v.version!==1||v.definition!==INSIGHT_CACHE_DEFINITION||validatedScope(v.scope)!==validatedScope(scope)||v.sourceWatermark!==null)throw Error();
  const normalized=prepareInsightCache(v.sales as CentralState,v.observedAt);if(!normalized||validatedScope(normalized.scope)!==validatedScope(scope))throw Error();return normalized;
 }catch{throw Error('AGGREGATE_DB_SNAPSHOT_INVALID');}
}

function object(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function exact(value:Record<string,unknown>,keys:string[]){return Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));}
// No default authorization: caller must supply reviewed requester/session capability checks.
function createAggregateRpcRepository(client:AggregateRpcClient,authorize:AggregateAuthorize):AggregateRepository{
 async function call(scope:CentralScope,operation:'read'|'write',name:AggregateRpcName,extra:Record<string,unknown>,fields:string[]){
  validatedScope(scope);const pin=await authorize(scope,operation);if(!pin)throw Error('AGGREGATE_ACCESS_DENIED');
  let response;try{response=await client.rpc(name,{p_from:scope.from,p_to:scope.to,...extra});}catch{throw Error('AGGREGATE_RPC_FAILED');}
  if(await authorize(scope,operation)!==pin)throw Error('AGGREGATE_SESSION_CHANGED');
  if(!response||response.error!==null)throw Error('AGGREGATE_RPC_FAILED');
  const r=response.data;
  if(!object(r)||!exact(r,['version','scope',...fields])||r.version!==1||!object(r.scope)||!exact(r.scope,['brand','from','to','aggregate'])||validatedScope(r.scope as unknown as CentralScope)!==validatedScope(scope))throw Error('AGGREGATE_RPC_RESPONSE_INVALID');
  return r;
 }
 async function load(scope:CentralScope){const r=await call(scope,'read','uttu_erp_aggregate_read_v1',{},['status','snapshot']);if(r.status!=='ok')throw Error('AGGREGATE_RPC_RESPONSE_INVALID');return r.snapshot===null?null:normalizedSnapshot(r.snapshot,scope);}
 return {load,lastGood:load,
  async publishAtomic(g){const check=prepareAggregateGeneration(g.snapshot.sales as CentralState,g.snapshot.observedAt);if(check.hash!==g.hash||check.runId!==g.runId||check.scopeKey!==g.scopeKey)throw Error('AGGREGATE_HASH_INVALID');const r=await call(check.snapshot.scope,'write','uttu_erp_aggregate_publish_v1',{p_run:check.runId,p_hash:check.hash,p_snapshot:check.snapshot,p_payload:JSON.stringify(check.snapshot)},['status']);if(typeof r.status!=='string'||!['published','replayed','older'].includes(r.status))throw Error('AGGREGATE_RPC_RESPONSE_INVALID');return r.status as 'published'|'replayed'|'older';},
  async recordRefresh(scope,status){if(!['pending','failed','ok'].includes(status))throw Error('AGGREGATE_STATUS_INVALID');const r=await call(scope,'write','uttu_erp_aggregate_refresh_v1',{p_status:status},['status','refreshStatus']);if(r.status!=='recorded'||r.refreshStatus!==status)throw Error('AGGREGATE_RPC_ACK_INVALID');},
  async refreshStatus(scope){const r=await call(scope,'read','uttu_erp_aggregate_status_v1',{},['status','refreshStatus']);if(r.status!=='ok'||typeof r.refreshStatus!=='string'||!['pending','failed','ok','unknown'].includes(r.refreshStatus))throw Error('AGGREGATE_RPC_RESPONSE_INVALID');return r.refreshStatus as 'pending'|'failed'|'ok'|'unknown';},
 };
}
export type AggregateReadAuthorize=(scope:CentralScope)=>Promise<string|null>;
// Frozen projection, not an interface-only cast: no write methods or underlying client escape.
export function createAggregateRpcReader(client:AggregateReadRpcClient,authorize:AggregateReadAuthorize):AggregateReader{
 const guarded:AggregateRpcClient={rpc:(name,args)=>{
  if(name!=='uttu_erp_aggregate_read_v1'&&name!=='uttu_erp_aggregate_status_v1')throw Error('AGGREGATE_READ_ONLY');
  return client.rpc(name,args);
 }};
 const repository=createAggregateRpcRepository(guarded,async(scope,operation)=>operation==='read'?authorize(scope):null);
 return Object.freeze({load:repository.load,lastGood:repository.lastGood,refreshStatus:repository.refreshStatus});
}
// Existing cookie getUser/own-profile role + independently configured requester pin, never requireAdmin as publication authority.
// No callback override and no service client. No page/action/cron invokes this factory here.
export async function createSsrAggregateRpcRepository():Promise<AggregateReader>{
 const started=Date.now();
 const authorize:AggregateReadAuthorize=async()=>{try{
  const now=Date.now();if(!Number.isFinite(now)||now<started||now-started>=60000)return null;
  const binding=configuredCentralRequesterBinding();if(!binding)return null;
  const allowed=binding.expectedRequesterIds===undefined?validateRequesterIds([binding.expectedRequesterId]):validateRequesterIds(binding.expectedRequesterIds);
  if(!allowed||!allowed.includes(binding.expectedRequesterId))return null;
  const actor=await currentCentralActor();
  return actor&&allowed.includes(actor.userId)&&(actor.role==='admin'||actor.role==='viewer')?actor.userId+':'+actor.role:null;
 }catch{return null;}};
 return createAggregateRpcReader(await supabaseServer(),authorize);
}
export interface InjectedWorkerTransport {
 readonly kind:'injected-worker';rpc:(name:AggregateWriteRpcName,args:Record<string,unknown>)=>RpcResult;
}
// This is an injection contract, not an implemented/authenticated production capability.
// No factory here grants it from a role, cookie, request body, stored hash or existing key.
export interface InjectedTrustedSourceCapability {
 readonly kind:'trusted-erp-source-publisher';
 authorize:(scope:Readonly<CentralScope>,operation:'publish'|'refresh-status')=>Promise<string|null>;
 readSource:(scope:Readonly<CentralScope>)=>Promise<CentralState>;
}
export interface WorkerAggregatePublisher {
 refresh:(input:unknown,observedAt:string,timer:Timer)=>Promise<'published'|'replayed'|'older'>;
}
// Only fixed source -> audited generation -> fixed RPCs. No public publish(snapshot)/recordRefresh(status) escape hatch.
// No production transport/capability is constructed or enabled; absent dependencies deny before any I/O.
export function createInjectedWorkerAggregatePublisher(deps:{transport:InjectedWorkerTransport|null;capability:InjectedTrustedSourceCapability|null}={transport:null,capability:null}):WorkerAggregatePublisher{
 return Object.freeze({async refresh(input:unknown,observedAt:string,timer:Timer){
  const parsed=parseCentralScope(input);if(!parsed.scope)throw Error('AGGREGATE_SCOPE_INVALID');validatedScope(parsed.scope);
  const scope=Object.freeze({...parsed.scope}),originalKey=validatedScope(scope),transport=deps.transport,capability=deps.capability;
  if(!transport||transport.kind!=='injected-worker'||typeof transport.rpc!=='function'||!capability||capability.kind!=='trusted-erp-source-publisher'||typeof capability.authorize!=='function'||typeof capability.readSource!=='function')throw Error('AGGREGATE_PUBLISHER_UNCONFIGURED');
  const authorizeOriginal=async(operation:'publish'|'refresh-status')=>{
   const copy={...scope};const pin=await capability.authorize(copy,operation);
   if(validatedScope(copy)!==originalKey)throw Error('AGGREGATE_SCOPE_CHANGED');
   return pin;
  };
  const initial=await authorizeOriginal('publish');
  if(!initial||await authorizeOriginal('refresh-status')!==initial)throw Error('AGGREGATE_PUBLISHER_DENIED');
  const same=async()=>await authorizeOriginal('publish')===initial&&await authorizeOriginal('refresh-status')===initial?initial:null;
  const guarded:AggregateRpcClient={rpc:(name,args)=>{
   if(name!=='uttu_erp_aggregate_publish_v1'&&name!=='uttu_erp_aggregate_refresh_v1')throw Error('AGGREGATE_WORKER_WRITE_ONLY');
   if(args.p_from!==scope.from||args.p_to!==scope.to)throw Error('AGGREGATE_SCOPE_CHANGED');
   if(name==='uttu_erp_aggregate_publish_v1'&&(!object(args.p_snapshot)||!object(args.p_snapshot.scope)||validatedScope(args.p_snapshot.scope as unknown as CentralScope)!==originalKey))throw Error('AGGREGATE_SCOPE_CHANGED');
   const bound=structuredClone(args);
   if(object(bound.p_snapshot)&&object(bound.p_snapshot.scope)){Object.freeze(bound.p_snapshot.scope);Object.freeze(bound.p_snapshot);}
   return transport.rpc(name,Object.freeze(bound));
  }};
  const repository=createAggregateRpcRepository(guarded,async(writeScope,operation)=>{
   if(operation!=='write'||validatedScope(writeScope)!==originalKey)return null;
   const pin=await same();return validatedScope(writeScope)===originalKey?pin:null;
  });
  return refreshBrandAggregate({...scope},observedAt,repository,timer,async()=>{
   if(!await same())throw Error('AGGREGATE_PUBLISHER_CHANGED');
   const request={...scope};
   // Detach the returned DTO before another authorization await can expose a retained source reference.
   const state=structuredClone(await capability.readSource(request));
   if(validatedScope(request)!==originalKey||!state.scope||validatedScope(state.scope)!==originalKey)throw Error('AGGREGATE_SCOPE_CHANGED');
   if(!await same())throw Error('AGGREGATE_PUBLISHER_CHANGED');
   if(validatedScope(state.scope)!==originalKey)throw Error('AGGREGATE_SCOPE_CHANGED');
   return state;
  });
 }});
}
