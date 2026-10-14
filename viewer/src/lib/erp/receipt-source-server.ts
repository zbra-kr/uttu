import 'server-only';
import { currentCentralActor } from './central-sales-runtime';
import { configuredCentralRequesterBinding } from './central-sales-composition';
import { validateRequesterIds } from './requester-allowlist';
import type { CentralActor } from './central-sales-server';
import type { RequesterRestBinding } from './requester-sales-rest';
import { createReceiptSourceProvider } from './receipt-source-rest';
import { parseReceiptScope,receiptState } from './receipt-source-read';
export async function readReceiptSourceWithBinding(input:unknown,binding:RequesterRestBinding|null,currentActor:()=>Promise<CentralActor|null>,http:typeof fetch=fetch,signal:AbortSignal=new AbortController().signal){
 const scope=parseReceiptScope(input);if(!scope)return receiptState('request','REQUEST_INVALID');
 if(!binding)return receiptState('unconnected','UNCONNECTED',scope);
 const allowed=binding.expectedRequesterIds===undefined?[binding.expectedRequesterId]:validateRequesterIds(binding.expectedRequesterIds);
 if(!allowed||!allowed.includes(binding.expectedRequesterId))return receiptState('withheld','REQUESTER_REQUIRED',scope);
 try{
  const actor=await currentActor(),selected=allowed.find(id=>id===actor?.userId);
  if(!selected||!actor||(actor.role!=='admin'&&actor.role!=='viewer'))return receiptState('withheld','REQUESTER_REQUIRED',scope);
  const role=actor.role,started=Date.now();
  const same=async()=>{const a=await currentActor(),now=Date.now();return a?.userId===selected&&a.role===role&&Number.isFinite(started)&&Number.isFinite(now)&&now>=started&&now-started<60000;};
  if(!await same())return receiptState('withheld','REQUESTER_MISMATCH',scope);
  if(!binding.rest)return receiptState('unconnected','UNCONNECTED',scope);
  const state=await createReceiptSourceProvider(binding.rest,http).read(scope,signal);
  // Never return rows after account/role changes, even if the source completed.
  if(!await same())return receiptState('withheld','REQUESTER_MISMATCH',scope);
  return state;
 }catch{return receiptState('error','READ_FAILED',scope);}
}
export async function readConfiguredReceiptSource(input:unknown){
 const scope=parseReceiptScope(input);if(!scope)return receiptState('request','REQUEST_INVALID');
 try{const actor=await currentCentralActor();if(!actor||(actor.role!=='admin'&&actor.role!=='viewer'))return receiptState('withheld','AUTH_REQUIRED',scope);
  return await readReceiptSourceWithBinding({...scope,styles:scope.styles.join(',')},configuredCentralRequesterBinding(),currentCentralActor);
 }catch{return receiptState('error','AUTH_READ_FAILED',scope);}
}
