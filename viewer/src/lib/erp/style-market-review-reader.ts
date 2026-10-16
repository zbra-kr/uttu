import {groupStyleMarketEvidence,type StyleMarketInput} from './style-market-group';
// A different read model, not a relaxation of inspectProductCrosswalk's confirmed
// style-to-one-product contract. This API has no proof/confirmation/write port.
export function inspectStyleMarketReviewOnly(input:StyleMarketInput){
 const grouped=groupStyleMarketEvidence(input);
 const styles=grouped.groups.map(g=>({
  brand:g.brand,style:g.style,
  sales:g.styleSales,
  children:g.market.map(p=>({
   productId:p.productId,musinsaNo:p.musinsaNo,color:p.color,name:p.name,
   sourceFullCode:p.sourceFullCode,
   observationForReview:p.marketEvidence,
   directResolutionChecked:p.directResolutionChecked,
   joinStatus:p.reviewState==='conflict'?'blocked-conflict' as const:'blocked-unconfirmed' as const,
   reason:p.reason,usableMarketSignal:null,insightEligible:false as const,
  })),
  cardinality:g.cardinality,
  mappingStatus:'unconfirmed' as const,usableComparison:null,insightEligible:false as const,
 }));
 return {kind:'style-market-review-only' as const,styles,allocation:'NONE' as const,
  confirmedMappings:0 as const,insightRows:[] as never[],
  warnings:[...grouped.warnings,'자식 관측은 검토 근거입니다. 미확정·상충 연결은 비교 신호로 사용할 수 없습니다.']};
}
export async function readStyleMarketReviewOnly(deps:{authorize:()=>Promise<string|null>;load:()=>Promise<StyleMarketInput>}){
 let pin:string|null;
 try{pin=await deps.authorize();}catch{return {kind:'withheld' as const,reason:'ACCESS' as const};}
 if(!pin)return {kind:'withheld' as const,reason:'ACCESS' as const};
 let raw:StyleMarketInput;
 try{raw=await deps.load();}catch{return {kind:'withheld' as const,reason:'READ_FAILED' as const};}
 // Capture loaded evidence before the second await; callers cannot swap it during
 // authorization. Output is a detached projection with no underlying client.
 let captured:StyleMarketInput;
 try{captured=structuredClone(raw);}catch{return {kind:'withheld' as const,reason:'SOURCE_INVALID' as const};}
 try{if(await deps.authorize()!==pin)return {kind:'withheld' as const,reason:'SESSION_CHANGED' as const};}
 catch{return {kind:'withheld' as const,reason:'ACCESS' as const};}
 try{return inspectStyleMarketReviewOnly(captured);}
 catch{return {kind:'withheld' as const,reason:'SOURCE_INVALID' as const};}
}
