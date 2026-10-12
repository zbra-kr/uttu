import 'server-only';
import { normalizeOrderReceipt,supplyBlocked,validSupplyRequest,type SupplyRequest,type SupplyState } from './order-receipt';
export interface SupplyProvider {readPartition(name:'orders'|'receipts',request:SupplyRequest):Promise<unknown>}
export interface SupplyAccess {authorize(request:SupplyRequest):Promise<boolean>;verify(parts:readonly unknown[],request:SupplyRequest):Promise<boolean>}
export async function readOrderReceipt(input:unknown,provider:SupplyProvider|null,access:SupplyAccess|null):Promise<SupplyState>{
  if(!provider)return supplyBlocked('unconnected','UNCONNECTED');
  if(!validSupplyRequest(input))return supplyBlocked('withheld','REQUEST');
  if(!access)return supplyBlocked('withheld','ACCESS');
  try{
    const q=structuredClone(input);
    if(await access.authorize(structuredClone(q))!==true)return supplyBlocked('withheld','ACCESS');
    const settled=await Promise.allSettled((['orders','receipts'] as const).map(n=>provider.readPartition(n,structuredClone(q))));
    if(settled.some(r=>r.status==='rejected'))return supplyBlocked('error','READ_FAILED');
    const parts=settled.map(r=>(r as PromiseFulfilledResult<unknown>).value);
    if(await access.verify(parts,structuredClone(q))!==true)return supplyBlocked('withheld','CONTRACT');
    return normalizeOrderReceipt(parts,q);
  }catch{return supplyBlocked('error','READ_FAILED');}
}
export async function readConfiguredOrderReceipt(){return readOrderReceipt(null,null,null);}
