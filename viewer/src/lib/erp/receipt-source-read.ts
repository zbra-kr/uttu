import 'server-only';
import { planReceiptSource } from './receipt-source-plan';
export const RECEIPT_COLUMNS=['STYLECD','MASTER_ROWS','BRAND_COUNT','MAPPING','SOURCE_PRESENT','CHASU','COLORCD','SIZECD','WHCD','INQTY','WHINDT'] as const;
export interface ReceiptScope {brand:string;styles:string[];from:string;to:string}
export interface ReceiptSourceRow {style:string;lot:string|null;color:string|null;size:string|null;warehouse:string|null;date:string;quantityText:string|null;quantityType:string;exactValue:null}
export interface ReceiptSourceState {kind:'request'|'unconnected'|'withheld'|'error'|'empty'|'observed';reason:string;scope:ReceiptScope|null;rows:ReceiptSourceRow[];allocation:null;rate:null;inventoryAsOf:null;complete:boolean;duplicateProjectionKeys:number|null}
export function receiptState(kind:ReceiptSourceState['kind'],reason:string,scope:ReceiptScope|null=null):ReceiptSourceState{return {kind,reason,scope,rows:[],allocation:null,rate:null,inventoryAsOf:null,complete:false,duplicateProjectionKeys:null};}
export function parseReceiptScope(input:unknown):ReceiptScope|null{
 const p=planReceiptSource(input);if(!p)return null;
 const q=input as Record<string,string>;return {brand:q.brand,styles:q.styles.split(',').map(s=>s.trim()),from:q.from,to:q.to};
}
export function normalizeReceiptSource(scope:ReceiptScope,input:unknown):ReceiptSourceState{
 if(!parseReceiptScope({...scope,styles:scope.styles.join(',')}))return receiptState('request','REQUEST_INVALID');
 if(!input||typeof input!=='object'||Array.isArray(input))return receiptState('withheld','SOURCE_INVALID',scope);
 const p=input as {complete?:unknown;rows?:unknown;types?:Record<string,string>};
 if(p.complete!==true||!Array.isArray(p.rows)||p.rows.length>200)return receiptState('withheld','INCOMPLETE',scope);
 if(!p.types||!/^(real|float|double)$/i.test(p.types.INQTY??''))return receiptState('withheld','SOURCE_TYPE_UNVERIFIED',scope);
 const coverage=new Set<string>(),rows:ReceiptSourceRow[]=[],keys=new Set<string>();let duplicates=0;
 const optional=(x:unknown)=>x===null||(typeof x==='string'&&x.length>0&&x.length<=160&&x===x.trim());
 for(const raw of p.rows){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return receiptState('withheld','SOURCE_INVALID',scope);
  const r=raw as Record<string,unknown>;if(typeof r.STYLECD!=='string'||!scope.styles.includes(r.STYLECD)||r.MAPPING!=='MATCHED'||Number(r.MASTER_ROWS)!==1||Number(r.BRAND_COUNT)!==1)return receiptState('withheld','MAPPING_UNVERIFIED',scope);coverage.add(r.STYLECD);
  if(r.SOURCE_PRESENT===0||r.SOURCE_PRESENT==='0'){
   if(!['CHASU','COLORCD','SIZECD','WHCD','INQTY','WHINDT'].every(field=>r[field]===null))return receiptState('withheld','SOURCE_INVALID',scope);
   continue;
  }if(r.SOURCE_PRESENT!==1&&r.SOURCE_PRESENT!=='1')return receiptState('withheld','SOURCE_INVALID',scope);
  if(![r.CHASU,r.COLORCD,r.SIZECD,r.WHCD].every(optional)||typeof r.WHINDT!=='string'||!/^\d{8}$/.test(r.WHINDT))return receiptState('withheld','SOURCE_INVALID',scope);
  const date=`${r.WHINDT.slice(0,4)}-${r.WHINDT.slice(4,6)}-${r.WHINDT.slice(6)}`;
  if(date<scope.from||date>scope.to||!parseReceiptScope({...scope,styles:scope.styles.join(','),from:date,to:date}))return receiptState('withheld','SOURCE_DATE_INVALID',scope);
  const n=r.INQTY;if(n!==null&&!((typeof n==='number'&&Number.isFinite(n))||(typeof n==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(n)&&Number.isFinite(Number(n)))))return receiptState('withheld','QUANTITY_INVALID',scope);
  const key=JSON.stringify([r.STYLECD,r.CHASU,r.COLORCD,r.SIZECD,r.WHCD,date]);if(keys.has(key))duplicates++;keys.add(key);
  rows.push({style:r.STYLECD,lot:r.CHASU as string|null,color:r.COLORCD as string|null,size:r.SIZECD as string|null,warehouse:r.WHCD as string|null,date,quantityText:n===null?null:String(n),quantityType:p.types.INQTY,exactValue:null});
 }
 if(coverage.size!==scope.styles.length)return receiptState('withheld','INCOMPLETE',scope);
 return {...receiptState(rows.length?'observed':'empty',rows.length?'RAW_RECEIPTS_UNALLOCATED':'EMPTY_NOT_ZERO',scope),rows,complete:true,duplicateProjectionKeys:duplicates};
}
