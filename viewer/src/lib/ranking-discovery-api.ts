import 'server-only';
import { createHash } from 'node:crypto';
import { parseDiscoveryRequest, type DiscoveryScope } from './ranking-discovery';
import { readAggregateDiscovery, type AggregateReceipt, type AggregateRequest } from './ranking-discovery-aggregate';
import type { SupabaseClient } from '@supabase/supabase-js';

export class DiscoveryApiError extends Error { constructor(public code: 'invalid-request' | 'stale-cursor', public status: number) { super(code); } }
export type DiscoveryApiRequest = { version: 3; mode: 'products' | 'evidence'; scope: DiscoveryScope; cursor: string | null; productId: string | null };
export type DiscoveryApiResult = AggregateReceipt & { nextCursor: string | null };
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const invalid = (): never => { throw new DiscoveryApiError('invalid-request',400); };
export function parseDiscoveryApiRequest(value: unknown): DiscoveryApiRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const r=value as Record<string,unknown>;
  if(Object.keys(r).some(k=>!['version','mode','scope','cursor','productId'].includes(k)) || r.version!==3 || !['products','evidence'].includes(String(r.mode))) return invalid();
  let scope: DiscoveryScope;
  try { scope=parseDiscoveryRequest(r.scope).scope; } catch { return invalid(); }
  const cursor=r.cursor??null, productId=r.productId??null;
  if(cursor!==null && (typeof cursor!=='string'||!cursor.length||cursor.length>1024)) return invalid();
  if(r.mode==='products' ? productId!==null : !uuid(productId)) return invalid();
  return {version:3,mode:r.mode as 'products'|'evidence',scope,cursor:cursor as string|null,productId:productId as string|null};
}
const key=(q:DiscoveryApiRequest,user:string)=>createHash('sha256').update(JSON.stringify([q.scope,q.mode,q.productId,user])).digest('hex');
type Cursor={ version:3; key:string; after:string; total:number; observations:number; remaining:number };
/** Read-only scope/account-bound continuation, not an authentication token or snapshot. */
export async function queryDiscoveryApi(client:SupabaseClient,input:DiscoveryApiRequest,user:string,signal:AbortSignal):Promise<DiscoveryApiResult>{
  const q=parseDiscoveryApiRequest(input), binding=key(q,user);let cursor:Cursor|null=null;
  if(q.cursor){
    try{
      if(!/^[A-Za-z0-9_-]+$/.test(q.cursor)) return invalid();
      cursor=JSON.parse(Buffer.from(q.cursor,'base64url').toString('utf8'));
      if(!cursor||Object.keys(cursor).sort().join(',')!=='after,key,observations,remaining,total,version'||cursor.version!==3||cursor.key!==binding||!uuid(cursor.after)
        ||!Number.isSafeInteger(cursor.total)||cursor.total<0||!Number.isSafeInteger(cursor.observations)||cursor.observations<0
        ||!Number.isSafeInteger(cursor.remaining)||cursor.remaining<0||cursor.remaining>cursor.total)return invalid();
    }catch{return invalid();}
  }
  const request:AggregateRequest={scope:q.scope,productId:q.productId,after:q.mode==='products'?cursor?.after:null,
    evidenceAfter:q.mode==='evidence'?cursor?.after:null,limit:q.mode==='products'?q.scope.pageSize:100};
  const result=await readAggregateDiscovery(client,request,signal);
  const total=q.mode==='products'?result.totalProducts!:result.totalObservations!;
  const observations=q.mode==='products'?result.matchingObservations!:total;
  if(cursor&&(cursor.total!==total||cursor.observations!==observations||cursor.remaining!==result.remainingCount))throw new DiscoveryApiError('stale-cursor',409);
  const delivered=q.mode==='products'?result.products!.length:result.evidence!.length;
  const nextCursor=result.hasMore?Buffer.from(JSON.stringify({version:3,key:binding,after:result.nextId,total,observations,remaining:result.remainingCount-delivered})).toString('base64url'):null;
  return {...result,nextCursor};
}
