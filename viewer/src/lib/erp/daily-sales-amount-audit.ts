// Counts describe source-view rows, never unique sales/orders or customers.
export interface DailySalesAmountAudit {sourceRows:string;amountRows:string;nullAmountRows:string;complete:boolean}
function count(value:unknown):bigint|null{
  if(typeof value==='number')return Number.isSafeInteger(value)&&value>=0?BigInt(value):null;
  if(typeof value==='string'&&/^\d{1,38}$/.test(value))return BigInt(value);
  return null;
}
export function auditDailySalesAmount(sourceRows:unknown,amountRows:unknown,amount:unknown):DailySalesAmountAudit|null{
  const source=count(sourceRows),present=count(amountRows);
  if(source===null||present===null||source===BigInt(0)||present>source||(present===BigInt(0))!==(amount===null))return null;
  return {sourceRows:source.toString(),amountRows:present.toString(),nullAmountRows:(source-present).toString(),complete:source===present};
}
