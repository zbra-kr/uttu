import { auditDailySalesAmount } from './daily-sales-amount-audit';
import { parseCentralScope,centralState,type CentralScope,type CentralState } from './central-sales-read';
import { centralAmountDisplay,centralDisplayTotal } from './central-sales-display';
function object(x:unknown):x is Record<string,unknown>{return !!x&&typeof x==='object'&&!Array.isArray(x);}
// Shared DTO validation only; caller remains responsible for authenticated read capability.
export function normalizeCentralDailyReceipt(q:CentralScope,raw:unknown):CentralState{
 if(!q||parseCentralScope(q).reason||q.aggregate!=='daily')return centralState('request',null,'REQUEST_INVALID');
 if(!object(raw)||raw.complete!==true||!Array.isArray(raw.rows))return centralState('withheld',q,'PARTIAL_READ');
      if(raw.rows.length>31)return centralState('withheld',q,'LIMIT_REACHED');
      const seen=new Set<string>();
      for(const row of raw.rows){
        if(!object(row)||Object.keys(row).sort().join(',')!=='AMOUNT_ROWS,BRANDCD,SALEDT,SALES_VAT_EX,SOURCE_ROWS'||row.BRANDCD!==q.brand||typeof row.SALEDT!=='string'||!/^\d{8}$/.test(row.SALEDT))return centralState('withheld',q,'SOURCE_INVALID');
        const date=`${row.SALEDT.slice(0,4)}-${row.SALEDT.slice(4,6)}-${row.SALEDT.slice(6)}`;
        if(!auditDailySalesAmount(row.SOURCE_ROWS,row.AMOUNT_ROWS,row.SALES_VAT_EX)||parseCentralScope({brand:q.brand,from:date,to:date}).reason||date<q.from||date>q.to||seen.has(date))return centralState('withheld',q,'SOURCE_INVALID');
        seen.add(date);
      }
      if(!raw.rows.length)return centralState('empty',q,'EMPTY',0);
      const rows=raw.rows.map(row=>{const v=row as Record<string,unknown>,day=v.SALEDT as string;const audit=auditDailySalesAmount(v.SOURCE_ROWS,v.AMOUNT_ROWS,v.SALES_VAT_EX)!;const amount=centralAmountDisplay(v.SALES_VAT_EX);return {brand:v.BRANDCD as string,saleDate:`${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6)}`,audit,amount:!audit.complete&&amount.sourceValue!==null?{...amount,approximateValue:null,millionsText:null,reason:'SOURCE_NULL_ROWS' as const}:amount};});
      return {...centralState('summary',q,'DAILY_SUMMARY_DISPLAY',rows.length),dailySummary:{rows,total:centralDisplayTotal(rows)}};
}
