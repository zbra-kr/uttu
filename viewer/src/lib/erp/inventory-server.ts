import 'server-only';
import { currentCentralActor } from './central-sales-runtime';
import { configuredCentralRequesterBinding } from './central-sales-composition';
import type { CentralActor } from './central-sales-server';
import type { RequesterRestBinding } from './requester-sales-rest';
import { createInventoryRestProvider,type InventoryProvider } from './inventory-rest';
import { parseInventoryScope,inventoryState,type InventoryScope,type InventoryState } from './inventory-read';
import { abortable } from './central-sales-rest';
interface Context {readonly kind:'inventory-self-review'}
const pins=new WeakMap<Context,{id:string;role:CentralActor['role'];scope:InventoryScope;expires:number;used:boolean}>();
export interface InventoryDependencies {currentActor():Promise<CentralActor|null>;provider:InventoryProvider|null;now?():number}
export async function prepareInventoryReview(scope:InventoryScope,expectedRequesterId:string,deps:InventoryDependencies):Promise<Context|null>{
  const captured={brand:scope.brand,styles:[...scope.styles]};
  if(parseInventoryScope({brand:captured.brand,styles:captured.styles.join(',')}).reason||typeof expectedRequesterId!=='string'||!expectedRequesterId)return null;
  try{const actor=await deps.currentActor();const now=(deps.now??Date.now)();if(!actor||actor.userId!==expectedRequesterId||(actor.role!=='admin'&&actor.role!=='viewer')||!Number.isFinite(now))return null;
    const context=Object.freeze({kind:'inventory-self-review' as const});pins.set(context,{id:expectedRequesterId,role:actor.role,scope:captured,expires:now+60000,used:false});return context;
  }catch{return null;}
}
export async function readRequesterInventory(scope:InventoryScope,context:Context|null,deps:InventoryDependencies):Promise<InventoryState>{
  const captured={brand:scope.brand,styles:[...scope.styles]};
  const pin=context&&pins.get(context);if(!pin)return inventoryState('withheld','REQUESTER_REQUIRED',captured);
  try{
    const now=(deps.now??Date.now)();if(pin.used||!Number.isFinite(now)||now>=pin.expires)return inventoryState('withheld','CONTEXT_EXPIRED',captured);pin.used=true;
    if(JSON.stringify(captured)!==JSON.stringify(pin.scope))return inventoryState('forbidden','REQUESTER_MISMATCH',captured);
    const actor=await deps.currentActor();if(!actor||actor.userId!==pin.id||actor.role!==pin.role)return inventoryState('forbidden','REQUESTER_MISMATCH',captured);
    const after=(deps.now??Date.now)();if(!Number.isFinite(after)||after>=pin.expires)return inventoryState('withheld','CONTEXT_EXPIRED',captured);
    if(!deps.provider)return inventoryState('unconnected','UNCONNECTED',captured);
    const c=new AbortController();const timer=setTimeout(()=>c.abort(),10000);
    try{const sources=await abortable(deps.provider.read({brand:captured.brand,styles:[...captured.styles]},c.signal),c.signal);
      const values=Object.values(sources),observed=values.some(s=>s.kind==='observed'),error=values.some(s=>s.kind==='error');
      const reason=observed?'OBSERVED':error?(values.some(s=>s.reason==='READ_TIMEOUT')?'READ_TIMEOUT':'READ_FAILED'):values.some(s=>s.kind==='withheld')?'SOURCE_INVALID':'EMPTY';
      return {...inventoryState(observed?'observed':error?'error':'withheld',reason,captured),sources};
    }catch{return inventoryState('error',c.signal.aborted?'READ_TIMEOUT':'READ_FAILED',captured);}finally{clearTimeout(timer);}
  }catch{return inventoryState('error','AUTH_READ_FAILED',captured);}
}
export async function readInventoryWithBinding(input:unknown,binding:RequesterRestBinding|null,currentActor:()=>Promise<CentralActor|null>,http:typeof fetch=fetch):Promise<InventoryState>{
  const parsed=parseInventoryScope(input);if(parsed.reason)return inventoryState('request',parsed.reason);
  const scope=parsed.scope!;
  if(!binding)return inventoryState('unconnected','UNCONNECTED',scope);
  const deps:InventoryDependencies={currentActor,provider:null};const context=await prepareInventoryReview(scope,binding.expectedRequesterId,deps);
  if(!context)return inventoryState('withheld','REQUESTER_REQUIRED',scope);
  try{deps.provider=binding.rest?createInventoryRestProvider(binding.rest,http):null;return await readRequesterInventory(scope,context,deps);}catch{return inventoryState('error','READ_FAILED',scope);}
}
export async function readConfiguredInventory(input:unknown):Promise<InventoryState>{
  const parsed=parseInventoryScope(input);if(parsed.reason)return inventoryState('request',parsed.reason);
  let actor:CentralActor|null;try{actor=await currentCentralActor();}catch{return inventoryState('error','AUTH_READ_FAILED',parsed.scope);}
  if(!actor)return inventoryState('unauthenticated','AUTH_REQUIRED',parsed.scope);
  if(actor.role!=='viewer'&&actor.role!=='admin')return inventoryState('forbidden','ROLE_UNVERIFIED',parsed.scope);
  try{return await readInventoryWithBinding(input,configuredCentralRequesterBinding(),currentCentralActor);}catch{return inventoryState('error','READ_FAILED',parsed.scope);}
}
