import 'server-only';
import {parseCentralScope,centralState,type CentralScope,type CentralState} from './central-sales-read';
import {readCentralSales,type CentralActor,type CentralExecutor} from './central-sales-server';
export interface RequesterReviewContext {readonly kind:'requester-local-review'}
interface Pin {requesterId:string;role:CentralActor['role'];scope:CentralScope;expires:number;used:boolean}
const pins=new WeakMap<RequesterReviewContext,Pin>();
export interface RequesterReviewDependencies {currentActor():Promise<CentralActor|null>;executor:CentralExecutor|null;now?():number}
// Trusted local caller supplies the independently established task requester ID.
// Never call this using a requesterId/role from URL, body or the actor itself as a
// fallback. No public route/action is registered for context creation or use.
export async function prepareRequesterReview(input:unknown,expectedRequesterId:unknown,deps:RequesterReviewDependencies):Promise<RequesterReviewContext|null>{
  const parsed=parseCentralScope(input);
  if(!parsed.scope||typeof expectedRequesterId!=='string'||!expectedRequesterId)return null;
  let actor:CentralActor|null;try{actor=await deps.currentActor();}catch{return null;}
  if(!actor||actor.userId!==expectedRequesterId||(actor.role!=='admin'&&actor.role!=='viewer'))return null;
  const now=(deps.now??Date.now)();if(!Number.isFinite(now))return null;
  const context=Object.freeze({kind:'requester-local-review' as const});
  pins.set(context,{requesterId:expectedRequesterId,role:actor.role,scope:{...parsed.scope},expires:now+60000,used:false});
  return context;
}
export async function readRequesterLocalSales(input:unknown,context:RequesterReviewContext|null,deps:RequesterReviewDependencies):Promise<CentralState>{
  const parsed=parseCentralScope(input);if(parsed.reason)return centralState('request',null,parsed.reason);
  const q=parsed.scope!,pin=context&&pins.get(context);
  if(!pin)return centralState('withheld',q,'LOCAL_REQUESTER_REQUIRED');
  const now=(deps.now??Date.now)();
  if(pin.used||!Number.isFinite(now)||now>=pin.expires)return centralState('withheld',q,'LOCAL_REVIEW_EXPIRED');
  // Consume even on a scope/session mismatch. Context cannot be cloned/serialized
  // into a reusable grant and never changes persistent user/role permissions.
  pin.used=true;
  if(q.brand!==pin.scope.brand||q.from!==pin.scope.from||q.to!==pin.scope.to)return centralState('forbidden',q,'LOCAL_REQUESTER_MISMATCH');
  let actor:CentralActor|null;try{actor=await deps.currentActor();}catch{return centralState('error',q,'AUTH_READ_FAILED');}
  const afterAuth=(deps.now??Date.now)();
  if(!Number.isFinite(afterAuth)||afterAuth>=pin.expires)return centralState('withheld',q,'LOCAL_REVIEW_EXPIRED');
  if(!actor||actor.userId!==pin.requesterId||actor.role!==pin.role)return centralState('forbidden',q,'LOCAL_REQUESTER_MISMATCH');
  // Explicit human-authorized self review only: no invented brand entitlement.
  // General web runtime remains unchanged and has no requester context/executor.
  return readCentralSales(q,{currentActor:async()=>actor,grantFor:async()=>({kind:'allowed',principalId:actor!.userId,brand:q.brand,roles:[actor!.role as 'admin'|'viewer'],evidenceRef:'ephemeral-requester-self-review'}),executor:deps.executor});
}
