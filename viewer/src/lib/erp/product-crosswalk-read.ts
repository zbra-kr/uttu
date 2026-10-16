export interface ProductCandidate {id:string;musinsa_no:string;erp_style_code:string|null;is_own:boolean;brand_id:string|null}
export interface CrosswalkEvidence {productId:string;musinsaNo:string;style:string;brand:'CO'|'LE'|'WA'|'CK'|'LK';brandId:string;status:'confirmed';evidenceRef:string;version:string}
export function inspectProductCrosswalk(candidates:readonly ProductCandidate[],evidence:readonly CrosswalkEvidence[],complete:boolean){
 const accepted:CrosswalkEvidence[]=[],excluded:{productId:string;reason:string}[]=[];
 if(!complete)return {accepted,excluded:candidates.map(p=>({productId:p.id,reason:'READ_INCOMPLETE'}))};
 for(const p of candidates){
  const proof=evidence.filter(e=>e.productId===p.id&&e.status==='confirmed'&&e.musinsaNo===p.musinsa_no&&e.style===p.erp_style_code&&e.brandId===p.brand_id&&['CO','LE','WA','CK','LK'].includes(e.brand)&&e.evidenceRef.trim()&&e.version.trim());
  let reason='';if(!p.is_own||!p.erp_style_code?.trim()||!p.brand_id)reason='PRODUCT_KEYS_MISSING';
  else if(proof.length!==1)reason='ERP_PROOF_MISSING_OR_AMBIGUOUS';
  else if(candidates.filter(x=>x.id===p.id||x.musinsa_no===p.musinsa_no||x.brand_id===p.brand_id&&x.erp_style_code===p.erp_style_code).length!==1)reason='PRODUCT_DUPLICATE';
  else if(evidence.some(e=>e.productId!==p.id&&e.brand===proof[0].brand&&e.style===proof[0].style))reason='STYLE_CONFLICT';
  if(reason)excluded.push({productId:p.id,reason});else accepted.push({productId:proof[0].productId,musinsaNo:proof[0].musinsaNo,style:proof[0].style,brand:proof[0].brand,brandId:proof[0].brandId,status:'confirmed',evidenceRef:proof[0].evidenceRef,version:proof[0].version});
 }
 return {accepted,excluded};
}
// Adapter dependencies must be the existing authenticated reader + reviewed evidence store.
// Competitor match status alone is deliberately not an evidence source.
export async function readProductCrosswalk(deps:{authorize:()=>Promise<string|null>;load:()=>Promise<{candidates:ProductCandidate[];evidence:CrosswalkEvidence[];complete:boolean}>}){
 const pin=await deps.authorize();if(!pin)return {kind:'withheld' as const,reason:'ACCESS',accepted:[],excluded:[]};
 let raw;try{raw=await deps.load();}catch{return {kind:'withheld' as const,reason:'READ_FAILED',accepted:[],excluded:[]};}
 if(await deps.authorize()!==pin)return {kind:'withheld' as const,reason:'SESSION_CHANGED',accepted:[],excluded:[]};
 return {kind:'inspected' as const,...inspectProductCrosswalk(raw.candidates,raw.evidence,raw.complete)};
}
