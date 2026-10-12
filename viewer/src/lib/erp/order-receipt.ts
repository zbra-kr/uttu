import { JOIN_REASONS, inspectJoinCoverage, type JoinSummary } from './join-coverage';
import { SCHEMA_REASONS, observedSchemaIssues } from './observed-schema-boundary';
import { ERP_BRANDS, requestReason, type ErpRequest } from '../erp-insight-workspace';

export const SUPPLY_REASONS = {
  ...SCHEMA_REASONS,
  ...JOIN_REASONS,
  UNCONNECTED: '발주・입고 읽기 공급자 미연결', ACCESS: '발주·입고 읽기 권한 확인 필요',
  REQUEST: '브랜드·시즌·기간 확인 필요', READ_FAILED: '발주·입고 조회 실패',
  INCOMPLETE: '발주·입고 응답 누락 또는 일부 조회 미완료', EMPTY: '발주·입고 검증 표본 없음',
  CONTRACT: '발주·입고 원천·집계 단위·기간 증빙 확인 필요', INVALID_ROW: '발주·입고 NULL·누락·중복·범위 오류 확인 필요',
  RATE_UNVERIFIED: '차수별 입고 연결키·누적 기간·입고율 분모 미확인 — 입고율 계산 보류',
} as const;
export type SupplyReason = keyof typeof SUPPLY_REASONS;
export const QR_EXCLUDED_PONO = ['글로벌','대만','대만 수주','중국','수주'] as const;
export const SUPPLY_CONTRACT = {
  orders: {source:'verified-season-order-projection',grain:'BRANDCD|STYLECD|CHASU|COLORCD|SIZECD|PONO',basis:'season-order-snapshot'},
  receipts: {source:'verified-receipt-option-projection',grain:'BRANDCD|STYLECD|COLORCD|SIZECD',basis:'explicit-receipt-window'},
} as const;
export interface SupplyRequest extends ErpRequest { brand: typeof ERP_BRANDS[number] }
export interface SupplySummary {
  orderAsOf:string;receiptFrom:string;receiptTo:string;seasonYear:string;season:string;
  orders: {brand:string;style:string;lot:string;color:string;size:string;bucket:'initial'|'QR'|'excludedQR';quantity:string}[];
  receipts: {brand:string;style:string;color:string;size:string;quantity:string}[];
  totalOrder:string;initialOrder:string;qrOrder:string;excludedQROrder:string;totalReceipt:string;
  receiptRate:null;
}
export interface SupplyState {kind:'ready'|'unconnected'|'withheld'|'empty'|'error';reasons:SupplyReason[];summary:SupplySummary|null;coverage?:JoinSummary[];executable:false}
export function supplyBlocked(kind:SupplyState['kind'],...reasons:SupplyReason[]):SupplyState { return {kind,reasons,summary:null,executable:false}; }
function object(x:unknown):x is Record<string,unknown>{return !!x&&typeof x==='object'&&!Array.isArray(x);}
function text(x:unknown):x is string{return typeof x==='string'&&x.length>0&&x.length<=160&&x===x.trim();}
function quantity(x:unknown):x is string{return typeof x==='string'&&/^(?:0|[1-9]\d*)$/.test(x)&&x.length<=30;}
export function validSupplyRequest(x:unknown):x is SupplyRequest{return object(x)&&requestReason(x)===null&&ERP_BRANDS.includes(x.brand as typeof ERP_BRANDS[number]);}
function same(a:unknown,b:SupplyRequest){return object(a)&&['brand','from','to','year','season'].every(k=>a[k]===b[k as keyof SupplyRequest]);}
// Source option aggregates are kept separate. There is deliberately no order to
// receipt join: receipt CHASU exists in the live schema; lot cardinality and temporal denominator remain unverified.
export function normalizeOrderReceipt(input:unknown,q:SupplyRequest):SupplyState{
  if(!validSupplyRequest(q))return supplyBlocked('withheld','REQUEST');
  if(!Array.isArray(input))return supplyBlocked('withheld','INCOMPLETE');
  const coverage=inspectJoinCoverage(input,q);
  const issues=new Set<SupplyReason>(coverage.reasons),parts=new Map<string,Record<string,unknown>>();
  if(input.length!==2)issues.add('INCOMPLETE');
  for(const p of input){
    for(const code of observedSchemaIssues(p))issues.add(code);
    if(!object(p)||!['orders','receipts'].includes(p.name as string)||parts.has(p.name as string)){issues.add('INCOMPLETE');continue;}
    parts.set(p.name as string,p);const c=SUPPLY_CONTRACT[p.name as keyof typeof SUPPLY_CONTRACT];
    if(p.complete!==true||!Number.isSafeInteger(p.pagesExpected)||Number(p.pagesExpected)<1||p.pagesExpected!==p.pagesReceived||!Array.isArray(p.rows))issues.add('INCOMPLETE');
    if(Array.isArray(p.rows)&&p.rows.length===0)issues.add('EMPTY');
    if(p.source!==c.source||p.grain!==c.grain||p.basis!==c.basis||!same(p.request,q)||p.asOf!==q.to||p.definition!=='ipj-initial-qr-v1'||!text(p.verificationReceipt))issues.add('CONTRACT');
    // Receipts are a supplied, explicitly verified window; no source date column
    // or historical order snapshot is invented by this normalization module.
    if(p.name==='receipts'&&(!object(p.window)||p.window.from!==q.from||p.window.to!==q.to))issues.add('CONTRACT');
  }
  for(const n of ['orders','receipts'])if(!parts.has(n))issues.add('INCOMPLETE');
  const summary:SupplySummary={orderAsOf:q.to,receiptFrom:q.from,receiptTo:q.to,seasonYear:q.year,season:q.season,orders:[],receipts:[],totalOrder:'0',initialOrder:'0',qrOrder:'0',excludedQROrder:'0',totalReceipt:'0',receiptRate:null};
  const seasons=q.season==='SS'?['봄','여름','상반기','스탠다드']:['가을','겨울','하반기','스탠다드'];
  let total=BigInt(0),initial=BigInt(0),qr=BigInt(0),excluded=BigInt(0),receipt=BigInt(0);
  for(const name of ['orders','receipts'] as const){
    const rows=Array.isArray(parts.get(name)?.rows)?parts.get(name)!.rows as unknown[]:[];const seen=new Set<string>();
    for(const r of rows){
      if(!object(r)||r.BRANDCD!==q.brand||!text(r.STYLECD)||!text(r.COLORCD)||!text(r.SIZECD)||r.YEARCD!==q.year||!seasons.includes(r.SEASONNM as string)){issues.add('INVALID_ROW');continue;}
      const value=name==='orders'?r.ORDQTY:r.INQTY;
      if(!quantity(value)){issues.add('INVALID_ROW');continue;}
      if(name==='orders'&&(!text(r.CHASU)||!(r.PONO===null||typeof r.PONO==='string'&&r.PONO.length<=160))){issues.add('INVALID_ROW');continue;}
      const key=JSON.stringify([r.BRANDCD,r.STYLECD,...(name==='orders'?[r.CHASU,r.PONO??'']:[]),r.COLORCD,r.SIZECD]);
      if(seen.has(key)){issues.add('INVALID_ROW');continue;}seen.add(key);
      const n=BigInt(value);
      if(name==='orders'){
        const bucket=r.CHASU==='01'?'initial':QR_EXCLUDED_PONO.includes((r.PONO??'') as typeof QR_EXCLUDED_PONO[number])?'excludedQR':'QR';
        total+=n;if(bucket==='initial')initial+=n;else if(bucket==='QR')qr+=n;else excluded+=n;
        summary.orders.push({brand:q.brand,style:r.STYLECD,lot:r.CHASU as string,color:r.COLORCD,size:r.SIZECD,bucket,quantity:value});
      }else{
        // CHASU exists upstream but is not part of this option aggregate projection. If a provider
        // sends lot-grain rows, accepting them would silently change the grain.
        if(Object.hasOwn(r,'CHASU')){issues.add('CONTRACT');continue;}
        receipt+=n;summary.receipts.push({brand:q.brand,style:r.STYLECD,color:r.COLORCD,size:r.SIZECD,quantity:value});
      }
    }
  }
  if(issues.size)return {...supplyBlocked(issues.size===1&&issues.has('EMPTY')?'empty':'withheld',...[...issues].sort()),coverage:coverage.summaries};
  summary.totalOrder=String(total);summary.initialOrder=String(initial);summary.qrOrder=String(qr);summary.excludedQROrder=String(excluded);summary.totalReceipt=String(receipt);
  return {kind:'ready',reasons:['RATE_UNVERIFIED'],summary,coverage:coverage.summaries,executable:false};
}
