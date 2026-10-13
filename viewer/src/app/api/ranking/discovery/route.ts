import { supabaseServer } from '@/lib/supabase/server';
import { AggregateError } from '@/lib/ranking-discovery-aggregate';
import { parseDiscoveryApiRequest, queryDiscoveryApi, DiscoveryApiError } from '@/lib/ranking-discovery-api';
export const runtime='nodejs';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
async function bounded<T>(pending:PromiseLike<T>,signal:AbortSignal):Promise<T>{
 signal.throwIfAborted();let abort:()=>void=()=>{};
 try{return await Promise.race([Promise.resolve(pending),new Promise<never>((_,fail)=>{abort=()=>fail(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();})]);}
 finally{signal.removeEventListener('abort',abort);}
}
export async function POST(request:Request){
 const deadline=AbortSignal.timeout(10000),signal=AbortSignal.any([deadline,request.signal]);
 try{
  const client=await bounded(supabaseServer(),signal);const {data:{user},error}=await bounded(client.auth.getUser(),signal);
  if(error||!user)return json({error:'authentication-required'},401);
  const reader=request.body?.getReader();if(!reader)return json({error:'invalid-request'},400);
  const chunks:Uint8Array[]=[];let bytes=0;
  try{while(true){const{value,done}=await bounded(reader.read(),signal);if(done)break;bytes+=value.byteLength;
   if(bytes>8192){void reader.cancel().catch(()=>{});return json({error:'invalid-request'},413);}chunks.push(value);}}
  finally{if(signal.aborted)void reader.cancel().catch(()=>{});reader.releaseLock();}
  let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return json({error:'invalid-request'},400);}
  const input=parseDiscoveryApiRequest(body);
  return json(await bounded(queryDiscoveryApi(client,input,user.id,signal),signal));
 }catch(error){
  if(signal.aborted)return json({error:deadline.aborted?'aggregate-query-timeout':'request-cancelled'},deadline.aborted?504:499);
  if(error instanceof DiscoveryApiError)return json({error:error.code},error.status);
  if(error instanceof AggregateError){
   const mapped:Record<string,[string,number]>={'rpc-missing':['aggregate-function-unavailable',503],'rpc-denied':['aggregate-permission-denied',403],
    'rpc-timeout':['aggregate-query-timeout',504],'rpc-unavailable':['aggregate-unconnected',503], 'invalid-receipt':['invalid-receipt',502],'invalid-request':['invalid-request',400]};
   const[code,status]=mapped[error.code]??['aggregate-unconnected',503];return json({error:code},status);
  }
  return json({error:'aggregate-unconnected'},503);
 }
}
