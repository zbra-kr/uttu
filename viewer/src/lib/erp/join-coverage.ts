export const JOIN_REASONS = {
  JOIN_RECEIPT_REQUIRED: '브랜드 조인 원천·매칭 건수 증빙 필요',
  JOIN_RECEIPT_INVALID: '브랜드 조인 증빙의 범위·건수 대사 확인 필요',
  JOIN_UNMATCHED: '브랜드를 특정할 수 없는 master 미연결 원천 행 — 집계 보류',
  JOIN_MASTER_DUPLICATE: '같은 STYLECD의 중복 master 확인 필요',
  JOIN_BRAND_CONFLICT: '같은 STYLECD의 브랜드 충돌·미확인 브랜드 — 집계 보류',
  JOIN_MULTIPLICITY: '상품 master 조인의 행 증식 관측 — 집계 보류',
  JOIN_PARTIAL: '브랜드 조인 응답·원천 범위가 미완료 — 집계 보류',
} as const;
export type JoinReason = keyof typeof JOIN_REASONS;
export interface JoinSummary {
  partition:string; sourceRows:number; matchedSourceRows:number; unmatchedSourceRows:number;
  excludedSourceRows:number; emittedRows:number; multiplicityExcessRows:number;
  duplicateMasterKeys:number; conflictingBrandKeys:number; unknownBrandRows:number;
}
const tables:Record<string,string>={shopInventory:'SW_SHOPINV',warehouseInventory:'SW_WHINV',receipts:'SW_WHININFO'};
const counts=['sourceRows','matchedSourceRows','unmatchedSourceRows','excludedSourceRows','emittedRows','multiplicityExcessRows','duplicateMasterKeys','conflictingBrandKeys','unknownBrandRows'] as const;
function object(x:unknown):x is Record<string,unknown>{return !!x&&typeof x==='object'&&!Array.isArray(x);}
function sameScope(a:unknown,b:unknown){
  if(!object(a)||!object(b))return false;
  if(!['brand','from','to','year','season','inventoryAsOf'].every(k=>a[k]===b[k]))return false;
  if(object(b.market))return object(a.market)&&['store','category','gender','age'].every(k=>(a.market as Record<string,unknown>)[k]===(b.market as Record<string,unknown>)[k]);
  return a.market===undefined;
}
// Counts must describe the request's pre-join source, not merely its returned rows.
// Trusted access.verify still authenticates query/coverage/aggregation evidence.
export function inspectJoinCoverage(partitions:unknown,request:unknown){
  const reasons=new Set<JoinReason>(),summaries:JoinSummary[]=[];
  if(!Array.isArray(partitions))return {reasons:[] as JoinReason[],summaries};
  for(const p of partitions){
    if(!object(p)||typeof p.name!=='string'||!Object.hasOwn(tables,p.name))continue;
    const a=p.joinAudit;
    if(!object(a)){reasons.add('JOIN_RECEIPT_REQUIRED');continue;}
    if(a.version!=='master-style-join-v1'||a.masterTable!=='SW_STYLEINFO'||a.sourceTable!==tables[p.name]
      ||!Array.isArray(a.joinKeys)||a.joinKeys.length!==1||a.joinKeys[0]!=='STYLECD'||!sameScope(a.request,request)
      ||typeof a.evidenceRef!=='string'||!a.evidenceRef.trim()||a.evidenceRef.length>160
      ||counts.some(k=>!Number.isSafeInteger(a[k])||Number(a[k])<0)){
      reasons.add('JOIN_RECEIPT_INVALID');continue;
    }
    const n=Object.fromEntries(counts.map(k=>[k,a[k]])) as unknown as Omit<JoinSummary,'partition'>;
    summaries.push({partition:p.name,...n});
    // BigInt avoids precision loss even for invalid near-safe-limit totals.
    if(BigInt(n.sourceRows)!==BigInt(n.matchedSourceRows)+BigInt(n.unmatchedSourceRows)+BigInt(n.excludedSourceRows)
      ||!Array.isArray(p.rows)||n.emittedRows!==p.rows.length||n.unknownBrandRows>n.matchedSourceRows)reasons.add('JOIN_RECEIPT_INVALID');
    if(a.complete!==true||(n.matchedSourceRows>0&&n.emittedRows===0))reasons.add('JOIN_PARTIAL');
    if(n.unmatchedSourceRows>0)reasons.add('JOIN_UNMATCHED');
    if(n.duplicateMasterKeys>0)reasons.add('JOIN_MASTER_DUPLICATE');
    if(n.conflictingBrandKeys>0||n.unknownBrandRows>0)reasons.add('JOIN_BRAND_CONFLICT');
    if(n.multiplicityExcessRows>0||n.emittedRows>n.matchedSourceRows)reasons.add('JOIN_MULTIPLICITY');
  }
  return {reasons:[...reasons].sort(),summaries};
}
