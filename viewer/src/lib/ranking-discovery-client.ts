import type { DiscoveryScope } from './ranking-discovery';
import type { AggregateReceipt, AggregateProduct, AggregateEvidence } from './ranking-discovery-aggregate';
import { rankingContextToSearchParams } from './notes/ranking-context';

export type DiscoveryResult = AggregateReceipt & { mode:'products'; products:AggregateProduct[]; totalProducts:number; matchingObservations:number; nextCursor:string|null };
export type EvidenceResult = AggregateReceipt & { mode:'evidence'; evidence:AggregateEvidence[]; totalObservations:number; productId:string; nextCursor:string|null };
export type DiscoveryProduct = AggregateProduct;
export const DISCOVERY_CATEGORY_OPTIONS = [
  ['000', '전체 카테고리 구간'], ['001', '상의'], ['002', '아우터'], ['003', '바지'], ['004', '가방'],
  ['017', '스포츠/레저'], ['026', '속옷/홈웨어'], ['100', '원피스/스커트'], ['101', '소품'],
  ['102', '디지털/라이프'], ['103', '신발'], ['104', '뷰티'], ['106', '키즈'],
] as const;
export const DISCOVERY_GENDER_OPTIONS = [['A', '전체 성별 구간'], ['M', '남성'], ['F', '여성']] as const;
export const DISCOVERY_AGE_OPTIONS = [['AGE_BAND_ALL', '전체 연령 구간'], ['AGE_BAND_MINOR', '20세 미만'],
  ['AGE_BAND_20', '20~24세'], ['AGE_BAND_25', '25~29세'], ['AGE_BAND_30', '30~34세'],
  ['AGE_BAND_35', '35~39세'], ['AGE_BAND_40', '40세 이상']] as const;
export const discoveryLabel = (options: readonly (readonly [string, string])[], code: string) => options.find(o => o[0] === code)?.[1] ?? code;
export class DiscoveryClientError extends Error {
  constructor(public code: string) { super(code); }
}
export function initialDiscoveryScope(date: string): DiscoveryScope {
  return { version: 2, storeCode: 'musinsa', fromDate: date, toDate: date,
    categories: DISCOVERY_CATEGORY_OPTIONS.map(o => o[0]), genders: DISCOVERY_GENDER_OPTIONS.map(o => o[0]),
    ages: DISCOVERY_AGE_OPTIONS.map(o => o[0]), ownOnly: true, pageSize: 50 };
}
export const discoveryScopeKey = (scope: DiscoveryScope) => JSON.stringify({ ...scope,
  categories: [...scope.categories].sort(), genders: [...scope.genders].sort(), ages: [...scope.ages].sort() });
const day = (value: string) => Date.parse(value + 'T00:00:00Z') / 86400000;
const validDate = (value: unknown): value is string => typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(day(value)) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;

export function discoveryScopeProblem(scope: DiscoveryScope): string | null {
  if (!validDate(scope.fromDate) || !validDate(scope.toDate) || day(scope.toDate) < day(scope.fromDate)) return '시작일과 종료일을 확인해 주세요.';
  if (day(scope.toDate) - day(scope.fromDate) > 30) return '한 번에 최대 31일을 조회할 수 있습니다. 기간을 줄여 주세요.';
  if (!scope.categories.length || !scope.genders.length || !scope.ages.length) return '각 조건에서 하나 이상의 구간을 선택해 주세요.';
  return null;
}

const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
function parseResult(value:unknown,scope:DiscoveryScope,mode:'products'|'evidence',productId:string|null,cursor:string|null):DiscoveryResult|EvidenceResult{
 const bad=():never=>{throw new DiscoveryClientError('invalid-receipt');};
 const r=value as AggregateReceipt & {nextCursor:string|null}, count=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
 if(!r||r.version!==3||r.mode!==mode||!r.scope||!Array.isArray(r.scope.categories)||!Array.isArray(r.scope.genders)||!Array.isArray(r.scope.ages)
  ||discoveryScopeKey(r.scope)!==discoveryScopeKey(scope)||r.sourceCompleteness!=='unknown'||r.paginationConsistency!=='keyset-best-effort'||r.ownClassification!=='current-product-master')return bad();
 const list=mode==='products'?r.products:r.evidence,limit=mode==='products'?scope.pageSize:100,total=mode==='products'?r.totalProducts:r.totalObservations;
 if(!count(total)||!count(r.remainingCount)||r.remainingCount>total||(!cursor&&r.remainingCount!==total)||!Array.isArray(list)
  ||list.length!==Math.min(limit,r.remainingCount)||r.hasMore!==(r.remainingCount>limit)
  ||(r.hasMore?typeof r.nextCursor!=='string'||!r.nextCursor||r.nextCursor.length>1024:r.nextCursor!==null))return bad();
 let previous='';
 for(const item of list){
  if(!item||typeof item!=='object')return bad();
  const id=mode==='products'?(item as AggregateProduct).productId:(item as AggregateEvidence).id;
  if(!uuid(id)||id<=previous)return bad();previous=id;
 }
 if(r.hasMore?r.nextId!==previous:r.nextId!==null)return bad();
 if(mode==='products'){
  if(!count(r.matchingObservations)||r.matchingObservations<total)return bad();
  const days=(day(scope.toDate)-day(scope.fromDate)+1),cohorts=scope.categories.length*scope.genders.length*scope.ages.length;
  for(const p of r.products!)if(typeof p.musinsaNo!=='string'||!/^[1-9]\d{0,19}$/.test(p.musinsaNo)||typeof p.own!=='boolean'||(scope.ownOnly&&!p.own)
   ||!(p.name===null||typeof p.name==='string')||!(p.brand===null||typeof p.brand==='string')||!validDate(p.latestObservedDate)||p.latestObservedDate<scope.fromDate||p.latestObservedDate>scope.toDate
   ||!count(p.observedDays)||p.observedDays<1||p.observedDays>days||!count(p.observedCohorts)||p.observedCohorts<1||p.observedCohorts>cohorts
   ||!count(p.observationCount)||p.observationCount<Math.max(p.observedDays,p.observedCohorts)||p.observationCount>p.observedDays*p.observedCohorts)return bad();
 }else{
  if(r.productId!==productId)return bad();
  const grains=new Set<string>();
  for(const e of r.evidence!){
   if(!validDate(e.date)||e.date<scope.fromDate||e.date>scope.toDate||!scope.categories.includes(e.category)||!scope.genders.includes(e.gender)||!scope.ages.includes(e.age)
    ||!Number.isSafeInteger(e.rank)||e.rank<1||e.rankStatus!=='unknown'||e.changeStatus!=='not-read')return bad();
   const k=[e.date,e.category,e.gender,e.age].join('/');if(grains.has(k))return bad();grains.add(k);
  }
 }
 return r as DiscoveryResult|EvidenceResult;
}
async function request(scope:DiscoveryScope,mode:'products'|'evidence',productId:string|null,cursor:string|null,signal:AbortSignal){
 const response=await fetch('/api/ranking/discovery',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:3,scope,mode,productId,cursor}),signal});
 signal.throwIfAborted();let data:unknown;try{data=await response.json();}catch{throw new DiscoveryClientError('invalid-receipt');}signal.throwIfAborted();
 if(!response.ok){
  const code=data&&typeof data==='object'?(data as{error?:unknown}).error:null;
  const safe=['authentication-required','invalid-request','stale-cursor','aggregate-function-unavailable','aggregate-permission-denied','aggregate-query-timeout','aggregate-unconnected','invalid-receipt'];
  throw new DiscoveryClientError(typeof code==='string'&&safe.includes(code)?code:'aggregate-unconnected');
 }
 return parseResult(data,scope,mode,productId,cursor);
}
export async function fetchDiscovery(scope:DiscoveryScope,cursor:string|null,signal:AbortSignal):Promise<DiscoveryResult>{return await request(scope,'products',null,cursor,signal) as DiscoveryResult;}
export async function fetchDiscoveryEvidence(scope:DiscoveryScope,productId:string,expectedObservations:number,cursor:string|null,signal:AbortSignal):Promise<EvidenceResult>{
 const result=await request(scope,'evidence',productId,cursor,signal) as EvidenceResult;
 if(result.totalObservations!==expectedObservations)throw new DiscoveryClientError('stale-cursor');return result;
}
export function discoveryEvidenceHref(e: AggregateEvidence): string {
  return '/ranking?' + rankingContextToSearchParams({ version: 1, kind: 'ranking', period: 'custom', fromDate: e.date, toDate: e.date,
    resolvedFromDate: e.date, resolvedToDate: e.date, selectedCategory: e.category, gender: e.gender, age: e.age,
    price: [0, 50], companies: [], brands: [], ownOnly: false, moverOnly: false, sort: 'rank', sortDir: 'asc', page: 1 }).toString();
}
