import 'server-only';
import { parseCentralScope } from './central-sales-read';
const master=`B AS (SELECT ? AS BRANDCD), R AS (SELECT DISTINCT COLUMN1 AS STYLECD FROM VALUES ${Array(10).fill('(?)').join(',')}),
M AS (SELECT STYLECD,COUNT(*) AS MASTER_ROWS,COUNT(DISTINCT BRANDCD) AS BRAND_COUNT,MIN(BRANDCD) AS BRANDCD FROM BCAVE.SEWON.SW_STYLEINFO WHERE STYLECD IN (SELECT STYLECD FROM R) GROUP BY STYLECD)`;
const matched='m.MASTER_ROWS=1 AND m.BRAND_COUNT=1 AND m.BRANDCD=b.BRANDCD';
const audit=`r.STYLECD,COALESCE(m.MASTER_ROWS,0) AS MASTER_ROWS,COALESCE(m.BRAND_COUNT,0) AS BRAND_COUNT,
CASE WHEN m.STYLECD IS NULL THEN 'MISSING' WHEN m.MASTER_ROWS<>1 OR m.BRAND_COUNT<>1 THEN 'AMBIGUOUS' WHEN m.BRANDCD<>b.BRANDCD THEN 'OUT_OF_SCOPE' ELSE 'MATCHED' END AS MAPPING,
CASE WHEN s.STYLECD IS NULL THEN 0 ELSE 1 END AS SOURCE_PRESENT`;
export const RECEIPT_SOURCE_SQL=`WITH ${master} SELECT ${audit},s.CHASU,s.COLORCD,s.SIZECD,s.WHCD,s.INQTY,s.WHINDT FROM R r CROSS JOIN B b LEFT JOIN M m ON r.STYLECD=m.STYLECD LEFT JOIN BCAVE.SEWON.SW_WHININFO s ON r.STYLECD=s.STYLECD AND ${matched} AND s.WHINDT BETWEEN ? AND ? ORDER BY r.STYLECD,s.WHINDT,s.CHASU,s.COLORCD,s.SIZECD LIMIT 201`;
export function planReceiptSource(input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))return null;
 const p=input as Record<string,unknown>,sales=parseCentralScope({brand:p.brand,from:p.from,to:p.to});
 if(!sales.scope||typeof p.styles!=='string')return null;
 const styles=p.styles.split(',').map(s=>s.trim());
 if(styles.length>10||styles.some(s=>!/^[A-Za-z0-9_-]{1,80}$/.test(s))||new Set(styles).size!==styles.length)return null;
 const binds=[sales.scope.brand,...styles,...Array(10-styles.length).fill(styles[0]),sales.scope.from.replaceAll('-',''),sales.scope.to.replaceAll('-','')];
 return {receipts:{sql:RECEIPT_SOURCE_SQL,binds:Object.freeze(binds)}};
}
