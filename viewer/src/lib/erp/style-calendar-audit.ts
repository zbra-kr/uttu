import {normalizeCentralDailyReceipt} from './central-daily-receipt';
import {centralAmountDisplay} from './central-sales-display';
import {parseCentralScope,type CentralScope} from './central-sales-read';
export interface CalendarAudit {queryKind:string;complete:boolean;scope:CentralScope;styles:string[];rows:Record<string,unknown>[]}
// A recorded receipt is not authentication. Zero describes this filtered source-view
// snapshot only; it never proves upstream ingestion completeness or no real-world sale.
export function auditedStyleCalendar(q:CentralScope,styles:string[],raw:CalendarAudit){
 if(parseCentralScope(q).reason||q.brand!=='CO'||q.from!=='2026-10-01'||q.to!=='2026-10-14'||q.aggregate!=='daily'||raw.queryKind!=='FIXED_STYLE_CALENDAR_LEFT_JOIN_V1'||raw.complete!==true||JSON.stringify(raw.scope)!==JSON.stringify(q)||styles.length<1||styles.length>10||new Set(styles).size!==styles.length||raw.styles.length!==styles.length||raw.styles.some(s=>!styles.includes(s))||new Set(raw.styles).size!==styles.length||raw.rows.length!==styles.length*14)throw Error('CALENDAR_AUDIT_INCOMPLETE');
 const days=Array.from({length:14},(_,i)=>'202610'+String(i+1).padStart(2,'0')),seen=new Set<string>();
 for(const r of raw.rows){const key=String(r.STYLECD)+'/'+String(r.SALEDT);if(r.BRANDCD!=='CO'||!styles.includes(String(r.STYLECD))||!days.includes(String(r.SALEDT))||seen.has(key)||Object.keys(r).sort().join(',')!=='AMOUNT_ROWS,BRANDCD,SALEDT,SALES_VAT_EX,SOURCE_ROWS,STYLECD')throw Error('CALENDAR_AUDIT_INVALID');seen.add(key);}
 return styles.map(style=>{const rows=raw.rows.filter(r=>r.STYLECD===style),zero=rows.filter(r=>r.SOURCE_ROWS==='0');
 if(zero.some(r=>r.AMOUNT_ROWS!=='0'||r.SALES_VAT_EX!==null))throw Error('CALENDAR_ZERO_INVALID');
 const positive=rows.filter(r=>r.SOURCE_ROWS!=='0').map(({STYLECD:_,...r})=>r),normalized=normalizeCentralDailyReceipt(q,{complete:true,rows:positive});
 if(positive.length&&normalized.kind!=='summary')throw Error('CALENDAR_AMOUNT_INVALID');
 const daily=[...(normalized.dailySummary?.rows??[]),...zero.map(r=>({brand:'CO',saleDate:String(r.SALEDT).replace(/^(....)(..)(..)$/,'$1-$2-$3'),audit:{sourceRows:'0',amountRows:'0',nullAmountRows:'0',complete:true},amount:centralAmountDisplay('0')}))].sort((a,b)=>a.saleDate.localeCompare(b.saleDate));
 return {style,daily,provenZeroDays:zero.length,sourceCoverage:'FILTERED_VIEW_SINGLE_QUERY_SNAPSHOT' as const,upstreamCollectionComplete:null};});
}
