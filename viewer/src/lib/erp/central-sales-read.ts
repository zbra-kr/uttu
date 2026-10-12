import { ERP_BRANDS, type ErpBrand } from '../erp-insight-workspace';
import { validCSDate } from '../cs-daily-review-check';
import type { CentralDisplayRow, CentralDisplayTotal } from './central-sales-display';
export const CENTRAL_READ_REASONS = {
  REQUEST_REQUIRED:'중앙 매출 브랜드·시작일·종료일을 선택해 주세요',
  REQUEST_INVALID:'중앙 매출은 유효한 단일 브랜드·최대31일 기간만 조회할 수 있습니다',
  AUTH_REQUIRED:'현재 사용자 인증 필요', AUTH_READ_FAILED:'현재 사용자 인증 확인 실패',
  LOCAL_REQUESTER_REQUIRED:'요청자 본인의 검증된 서버 세션·로컬 조회 컨텍스트 필요',
  LOCAL_REQUESTER_MISMATCH:'요청자 본인과 현재 서버 세션이 일치하지 않습니다',
  LOCAL_REVIEW_EXPIRED:'요청자 로컬 검증 컨텍스트 만료·소진 — 재확인 필요',
  ROLE_UNVERIFIED:'현재 사용자 역할 확인 필요', ERP_GRANT_UNVERIFIED:'공유 웹 화면의 ERP 접근 범위 미확정 — 본인 로컬 검증은 별도 경계',
  ERP_ACCESS_DENIED:'현재 사용자·역할의 선택 브랜드 ERP 읽기 권한 없음',
  TRANSPORT_UNREGISTERED:'중앙 매출 서버 의존성 미연결 — JWT 공급자·접속 설정 또는 신뢰된 요청자 연결 미설정',
  READ_FAILED:'중앙 매출 조회 실패 — 매출0으로 해석하지 마세요', READ_TIMEOUT:'중앙 매출 제한 시간 초과 — 집계 보류',
  PARTIAL_READ:'중앙 매출 응답 누락·부분조회 확인 필요', LIMIT_REACHED:'조회 그룹 한도 도달 — 완전한 집계로 표시하지 않습니다',
  SOURCE_INVALID:'중앙 매출 브랜드·상품·일자 원천 범위 확인 필요',
  FLOAT_PRECISION_UNVERIFIED:'중앙 FLOAT 매출의 정밀도·반올림·VAT 대사 미완료 — 금액 표시 보류',
  EIS_APPROXIMATE_DISPLAY:'EIS 기준 관측용 근사 표시 · 원단위 확정 금액·회계 대사 미확인',
  EMPTY:'권한이 확인된 조회 범위의 관측 그룹 없음 — 매출0을 뜻하지 않습니다',
} as const;
export type CentralReason=keyof typeof CENTRAL_READ_REASONS;
export interface CentralScope {brand:ErpBrand;from:string;to:string}
export interface CentralState {kind:'request'|'unauthenticated'|'forbidden'|'withheld'|'unconnected'|'error'|'empty'|'observed';scope:CentralScope|null;reasons:CentralReason[];groupsObserved:number|null;rows:readonly CentralDisplayRow[];total:CentralDisplayTotal|null;value:null;executable:false}
export const CENTRAL_GROUP_LIMIT=200;
export const CENTRAL_SQL = `SELECT BRANDCD,STYLECD,SALEDT,SUM(SALEAMT_VAT_EX) AS SALES_VAT_EX
FROM BCAVE.SEWON.VW_SALES_VAT
WHERE BRANDCD = %s AND SALEDT BETWEEN %s AND %s AND LENGTH(SALEDT)=8
AND SHOPCD NOT IN ('B6055','B6057','B6063')
GROUP BY BRANDCD,STYLECD,SALEDT
ORDER BY SALEDT,STYLECD
LIMIT 201`;
function object(x:unknown):x is Record<string,unknown>{return !!x&&typeof x==='object'&&!Array.isArray(x);}
export function parseCentralScope(input:unknown):{scope:CentralScope|null;reason:CentralReason|null}{
  if(!object(input))return {scope:null,reason:'REQUEST_INVALID'};
  if(['brand','from','to'].every(k=>input[k]===undefined||input[k]===''))return {scope:null,reason:'REQUEST_REQUIRED'};
  if(!ERP_BRANDS.includes(input.brand as ErpBrand)||typeof input.from!=='string'||typeof input.to!=='string'||!validCSDate(input.from)||!validCSDate(input.to)||input.from>input.to)return {scope:null,reason:'REQUEST_INVALID'};
  const days=(Date.parse(input.to+'T00:00:00Z')-Date.parse(input.from+'T00:00:00Z'))/86400000+1;
  if(days>31)return {scope:null,reason:'REQUEST_INVALID'};
  return {scope:{brand:input.brand as ErpBrand,from:input.from,to:input.to},reason:null};
}
export function centralState(kind:CentralState['kind'],scope:CentralScope|null,reason:CentralReason,groupsObserved:number|null=null):CentralState{
  return {kind,scope,reasons:[reason],groupsObserved,rows:[],total:null,value:null,executable:false};
}
