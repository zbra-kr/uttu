import { ERP_BRANDS } from '../erp-insight-workspace';
export type InventorySource = 'shop' | 'warehouse';
export interface InventoryScope { brand:string; styles:string[] }
export const INVENTORY_REASONS = {
  REQUEST:'브랜드와 상품 코드 1~10개를 지정해 주세요', INVALID_REQUEST:'단일 브랜드·중복 없는 상품 코드 최대10개 필요',
  AUTH_REQUIRED:'본인 서버 인증 필요', AUTH_READ_FAILED:'본인 서버 인증 확인 실패', ROLE_UNVERIFIED:'기존 사용자 역할 확인 필요',
  REQUESTER_REQUIRED:'신뢰된 요청자 본인 binding 필요', REQUESTER_MISMATCH:'요청자·현재 서버 세션 불일치', CONTEXT_EXPIRED:'일회성 본인 조회 컨텍스트 만료',
  UNCONNECTED:'재고 REST 공급자 미연결', READ_FAILED:'재고 조회 실패 — 재고0 아님', READ_TIMEOUT:'재고 조회 제한 시간 초과',
  SOURCE_INVALID:'재고 응답·매핑 증빙 불일치', LIMIT_REACHED:'200행 초과 또는 미완결 응답 — 수량 보류', EMPTY:'지정 상품의 관측 행 없음 — 재고0 아님',
  OBSERVED:'기준시각 미확인 원천 수량 관측 · 합계·현재 재고 확정 보류',
} as const;
export const INVENTORY_MAPPING = {
  MATCHED:'요청 브랜드의 단일 스타일 마스터 일치', MISSING:'스타일 마스터 미매칭', DUPLICATE:'스타일 마스터 중복', CONFLICT:'스타일의 브랜드 충돌', UNKNOWN:'마스터 브랜드 미확인', OUT_OF_SCOPE:'요청 브랜드 범위 밖',
} as const;
export type InventoryReason=keyof typeof INVENTORY_REASONS;
export type InventoryMap=keyof typeof INVENTORY_MAPPING;
export interface InventoryQuantity { column:string; sourceType:string; sourceValue:string|number|null; text:string|null; reason:'NULL'|'INVALID'|'NEGATIVE'|'APPROXIMATE'|'SOURCE_NUMBER'; exactValue:null }
export interface InventoryRow { style:string; location:string|null; color:string|null; size:string|null; duplicateGrain:number; quantities:InventoryQuantity[] }
export interface InventoryAudit { style:string; mapping:InventoryMap; masterRows:number; brandCount:number; sourceRows:number }
export interface InventoryProjection { kind:'observed'|'empty'|'withheld'|'error'; reason:InventoryReason; rows:InventoryRow[]; audit:InventoryAudit[]; totals:null; asOf:null; duplicateRows:number|null }
export interface InventoryState { kind:'request'|'unauthenticated'|'forbidden'|'unconnected'|'error'|'withheld'|'observed'; reason:InventoryReason; scope:InventoryScope|null; sources:Partial<Record<InventorySource,InventoryProjection>>; asOf:null; executable:false }
export function inventoryState(kind:InventoryState['kind'],reason:InventoryReason,scope:InventoryScope|null=null):InventoryState{return {kind,reason,scope,sources:{},asOf:null,executable:false};}
export function parseInventoryScope(input:unknown):{scope:InventoryScope|null;reason:InventoryReason|null}{
  if(!input||typeof input!=='object'||Array.isArray(input))return {scope:null,reason:'INVALID_REQUEST'};
  const p=input as Record<string,unknown>;
  if((p.brand===undefined||p.brand==='')&&(p.styles===undefined||p.styles===''))return {scope:null,reason:'REQUEST'};
  if(typeof p.styles==='undefined'||p.styles==='')return {scope:null,reason:'REQUEST'};
  if(!ERP_BRANDS.includes(p.brand as typeof ERP_BRANDS[number])||typeof p.styles!=='string')return {scope:null,reason:'INVALID_REQUEST'};
  const styles=p.styles.split(',').map(s=>s.trim());
  if(styles.length>10||styles.some(s=>!/^[A-Za-z0-9_-]{1,80}$/.test(s))||new Set(styles).size!==styles.length)return {scope:null,reason:'INVALID_REQUEST'};
  return {scope:{brand:p.brand as string,styles},reason:null};
}
export const INVENTORY_COLUMNS={shop:['INVQTY','AVAILQTY'],warehouse:['AVAILQTY','ONLINEQTY','OFFLINEQTY']} as const;
export const INVENTORY_BASE_COLUMNS=['STYLECD','MAPPED_BRAND','MASTER_ROWS','BRAND_COUNT','MAPPING','SOURCE_PRESENT','STYLE_SOURCE_ROWS','LOCATIONCD','COLORCD','SIZECD','DUPLICATE_GRAIN'];
export interface InventoryRaw { complete:boolean; rows:Record<string,unknown>[]; types:Record<string,string> }
function integer(x:unknown):number|null{if(typeof x==='string'&&!/^\d+$/.test(x))return null;const n=typeof x==='number'||typeof x==='string'?Number(x):NaN;return Number.isSafeInteger(n)&&n>=0?n:null;}
function quantity(column:string,raw:unknown,sourceType:string):InventoryQuantity{
  const q:InventoryQuantity={column,sourceType,sourceValue:null,text:null,reason:'INVALID',exactValue:null};
  if(raw===null)return {...q,reason:'NULL'};
  if(typeof raw==='number'&&Number.isFinite(raw)||typeof raw==='string'&&raw.length<=100&&/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)){
    // Validation only; keep the original representation, never the converted
    // value. A finite NUMBER string does not become an exact Number quantity.
    if(typeof raw==='string'&&(!Number.isFinite(Number(raw))||Number(raw)===0&&/[1-9]/.test(raw.split(/[eE]/)[0])))return q;
    const text=String(raw);return {...q,sourceValue:raw as string|number,text,reason:text.startsWith('-')?'NEGATIVE':sourceType==='real'||typeof raw==='number'?'APPROXIMATE':'SOURCE_NUMBER'};
  }return q;
}
export function blockedInventoryProjection(kind:InventoryProjection['kind'],reason:InventoryReason):InventoryProjection{return {kind,reason,rows:[],audit:[],totals:null,asOf:null,duplicateRows:null};}
export function normalizeInventory(source:InventorySource,scope:InventoryScope,raw:InventoryRaw):InventoryProjection{
  const fail=()=>blockedInventoryProjection('withheld','SOURCE_INVALID');
  if(!raw||raw.complete!==true||!Array.isArray(raw.rows)||raw.rows.length>200)return blockedInventoryProjection('withheld','LIMIT_REACHED');
  const columns=INVENTORY_COLUMNS[source];
  if(!columns||!raw.types||columns.some(c=>raw.types[c]!== (source==='shop'?'real':'fixed')))return fail();
  const groups=new Map<string,{audit:InventoryAudit;present:number;placeholders:number}>(),rows:InventoryRow[]=[];let duplicateRows=0;
  for(const r of raw.rows){
    if(!r||typeof r!=='object'||[...INVENTORY_BASE_COLUMNS,...columns].some(c=>!Object.hasOwn(r,c)))return fail();
    if(!r||typeof r!=='object'||typeof r.STYLECD!=='string'||!scope.styles.includes(r.STYLECD)||typeof r.MAPPING!=='string'||!Object.hasOwn(INVENTORY_MAPPING,r.MAPPING))return fail();
    const master=integer(r.MASTER_ROWS),brands=integer(r.BRAND_COUNT),present=integer(r.SOURCE_PRESENT),count=integer(r.STYLE_SOURCE_ROWS),dup=integer(r.DUPLICATE_GRAIN);
    if(master===null||brands===null||brands>master||present===null||present>1||count===null||dup===null||present===1&&(dup<1||dup>count)||present===0&&(dup!==0||count!==0))return fail();
    const mapping=r.MAPPING as InventoryMap;
    if(mapping==='MATCHED'&&(master!==1||brands!==1||r.MAPPED_BRAND!==scope.brand)||mapping!=='MATCHED'&&r.MAPPED_BRAND!==null)return fail();
    if(mapping==='MISSING'&&(master!==0||brands!==0)||mapping==='DUPLICATE'&&(master<2||brands>1)||mapping==='CONFLICT'&&brands<2||mapping==='UNKNOWN'&&(master!==1||brands!==0)||mapping==='OUT_OF_SCOPE'&&(master!==1||brands!==1))return fail();
    const audit:InventoryAudit={style:r.STYLECD,mapping,masterRows:master,brandCount:brands,sourceRows:count};
    const g=groups.get(r.STYLECD)??{audit,present:0,placeholders:0};
    if(JSON.stringify(g.audit)!==JSON.stringify(audit))return fail();
    present?g.present++:g.placeholders++;groups.set(r.STYLECD,g);
    if(mapping!=='MATCHED'){
      if(['LOCATIONCD','COLORCD','SIZECD',...columns].some(c=>r[c]!==null))return fail();continue;
    }
    if(!present){if(['LOCATIONCD','COLORCD','SIZECD',...columns].some(c=>r[c]!==null))return fail();continue;}
    if(['LOCATIONCD','COLORCD','SIZECD'].some(c=>r[c]!==null&&(typeof r[c]!=='string'||(r[c] as string).length>160)))return fail();
    if(dup>1)duplicateRows++;
    rows.push({style:r.STYLECD,location:r.LOCATIONCD as string|null,color:r.COLORCD as string|null,size:r.SIZECD as string|null,duplicateGrain:dup,quantities:columns.map(c=>quantity(c,r[c],raw.types[c]))});
  }
  if(groups.size!==scope.styles.length||[...groups.values()].some(g=>g.present!==g.audit.sourceRows||g.placeholders!==(g.audit.sourceRows===0?1:0)))return fail();
  // Recheck projected-key multiplicity; no sum or dedup that changes raw grain.
  const counts=new Map<string,number>();for(const r of rows){const key=JSON.stringify([r.style,r.location,r.color,r.size]);counts.set(key,(counts.get(key)??0)+1);}
  if(rows.some(r=>r.duplicateGrain!==counts.get(JSON.stringify([r.style,r.location,r.color,r.size]))))return fail();
  const audit=[...groups.values()].map(g=>g.audit);
  return {kind:rows.length?'observed':audit.some(a=>a.mapping!=='MATCHED')?'withheld':'empty',reason:rows.length?'OBSERVED':audit.some(a=>a.mapping!=='MATCHED')?'SOURCE_INVALID':'EMPTY',rows,audit,totals:null,asOf:null,duplicateRows:rows.length||audit.every(a=>a.mapping==='MATCHED')?duplicateRows:null};
}
