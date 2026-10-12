import 'server-only';
import { CENTRAL_SQL,CENTRAL_GROUP_LIMIT,parseCentralScope,centralState,type CentralScope,type CentralState } from './central-sales-read';
import { centralAmountDisplay, centralDisplayTotal, type CentralDisplayRow } from './central-sales-display';
export interface CentralActor {userId:string;role:'admin'|'viewer'|null}
export interface CentralGrant {kind:'allowed'|'denied';principalId:string;brand:CentralScope['brand'];roles:readonly ('admin'|'viewer')[];evidenceRef:string}
export interface CentralQuery {
  sql:typeof CENTRAL_SQL;binds:readonly [string,string,string];statementTimeoutSeconds:10;maxRows:201;maxEstimatedScanBytes:16777216;signal:AbortSignal;
}
// A reviewed server-side executor must enforce timeout, preflight cost budget,
// and read-only SQL. No credential or worker-process spawning implementation here.
export interface CentralExecutor {execute(query:CentralQuery):Promise<unknown>}
export interface CentralDependencies {
  currentActor():Promise<CentralActor|null>;
  grantFor(actor:CentralActor,scope:CentralScope):Promise<CentralGrant|null>;
  executor:CentralExecutor|null;
  deadlineMs?:number;
}
class CentralDeadline extends Error {}
// Stable internal executor error contract, including independently bundled modules.
export class CentralReadTimeout extends Error {
  constructor(){super('CENTRAL_READ_TIMEOUT');this.name='CentralReadTimeout';}
}
function isCentralReadTimeout(error:unknown):boolean {
  return error instanceof Error && error.name==='CentralReadTimeout' && error.message==='CENTRAL_READ_TIMEOUT';
}
function object(x:unknown):x is Record<string,unknown>{return !!x&&typeof x==='object'&&!Array.isArray(x);}
export async function readCentralSales(input:unknown,deps:CentralDependencies):Promise<CentralState>{
  const parsed=parseCentralScope(input);if(parsed.reason)return centralState('request',null,parsed.reason);
  const q=parsed.scope!;let actor:CentralActor|null;
  try{actor=await deps.currentActor();}catch{return centralState('error',q,'AUTH_READ_FAILED');}
  if(!actor||typeof actor.userId!=='string'||!actor.userId)return centralState('unauthenticated',q,'AUTH_REQUIRED');
  if(actor.role!=='admin'&&actor.role!=='viewer')return centralState('forbidden',q,'ROLE_UNVERIFIED');
  let grant:CentralGrant|null;
  try{grant=await deps.grantFor({...actor},{...q});}catch{return centralState('withheld',q,'ERP_GRANT_UNVERIFIED');}
  if(!grant)return centralState('withheld',q,'ERP_GRANT_UNVERIFIED');
  if(grant.kind!=='allowed'||grant.principalId!==actor.userId||grant.brand!==q.brand||!Array.isArray(grant.roles)||!grant.roles.includes(actor.role)||grant.roles.some(r=>r!=='admin'&&r!=='viewer')||typeof grant.evidenceRef!=='string'||!grant.evidenceRef.trim())return centralState('forbidden',q,'ERP_ACCESS_DENIED');
  if(!deps.executor)return centralState('unconnected',q,'TRANSPORT_UNREGISTERED');
  try{
    const controller=new AbortController();
    const query:CentralQuery={sql:CENTRAL_SQL,binds:[q.brand,q.from.replaceAll('-',''),q.to.replaceAll('-','')],statementTimeoutSeconds:10,maxRows:201,maxEstimatedScanBytes:16777216,signal:controller.signal};
    const requested=deps.deadlineMs;
    const ms=typeof requested==='number'&&Number.isInteger(requested)&&requested>0&&requested<=10000?requested:10000;
    let timer:ReturnType<typeof setTimeout>|undefined;let raw:unknown;
    try{raw=await Promise.race([deps.executor.execute(query),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new CentralDeadline());},ms);})]);}
    finally{if(timer)clearTimeout(timer);}
    if(!object(raw)||raw.complete!==true||!Array.isArray(raw.rows))return centralState('withheld',q,'PARTIAL_READ');
    if(raw.rows.length>CENTRAL_GROUP_LIMIT)return centralState('withheld',q,'LIMIT_REACHED');
    const keys=new Set<string>();
    for(const row of raw.rows){
      if(!object(row)||row.BRANDCD!==q.brand||typeof row.STYLECD!=='string'||!row.STYLECD.trim()||row.STYLECD.length>160||typeof row.SALEDT!=='string'||!/^\d{8}$/.test(row.SALEDT)||!Object.hasOwn(row,'SALES_VAT_EX'))return centralState('withheld',q,'SOURCE_INVALID');
      const date=`${row.SALEDT.slice(0,4)}-${row.SALEDT.slice(4,6)}-${row.SALEDT.slice(6)}`;
      if(parseCentralScope({brand:q.brand,from:date,to:date}).reason||date<q.from||date>q.to)return centralState('withheld',q,'SOURCE_INVALID');
      const key=JSON.stringify([row.BRANDCD,row.STYLECD,row.SALEDT]);if(keys.has(key))return centralState('withheld',q,'SOURCE_INVALID');keys.add(key);
      // Option/year fields do not belong to this fixed central aggregation.
      if(['COLORCD','SIZECD','YEARCD'].some(k=>Object.hasOwn(row,k)))return centralState('withheld',q,'SOURCE_INVALID');
    }
    if(!raw.rows.length)return centralState('empty',q,'EMPTY',0);
    // Only structurally complete, authorized rows reach the display DTO. No raw
    // driver fields, actor or grant metadata are copied. Exact money stays null.
    const rows:CentralDisplayRow[]=raw.rows.map(row=>{
      const r=row as Record<string,unknown>;
      const day=r.SALEDT as string;
      return {brand:r.BRANDCD as string,styleId:r.STYLECD as string,saleDate:`${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6)}`,amount:centralAmountDisplay(r.SALES_VAT_EX)};
    });
    return {...centralState('observed',q,'EIS_APPROXIMATE_DISPLAY',rows.length),rows,total:centralDisplayTotal(rows)};
  }catch(e){return centralState('error',q,e instanceof CentralDeadline||isCentralReadTimeout(e)?'READ_TIMEOUT':'READ_FAILED');}
}
