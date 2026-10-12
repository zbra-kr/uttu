// Pure contract checks. Source-code evidence is never live schema verification.
import {validDate,windowValid} from './insights.mjs';
export const BRANDS=Object.freeze(['CO','LE','WA','CK','LK']);
export const TRANSFER_SHOPS=Object.freeze(['B6055','B6057','B6063']);
export const SEASONS=Object.freeze({SS:['봄','여름','상반기','스탠다드'],FW:['가을','겨울','하반기','스탠다드']});
export const SOURCE_SPECS=Object.freeze({
  central:{source:'VW_SALES_VAT',amountField:'SALEAMT_VAT_EX',vatOperation:'already_excluded',excludedShops:TRANSFER_SHOPS,evidence:'src/lib/snowflake.ts:40'},
  detail:{source:'SW_SALEINFO',amountField:'SALEAMT',vatOperation:'source_expression_divide_1.1',excludedShops:null,evidence:'src/app/api/sales/style-detail/route.ts:61,71,75',unverified:['tax applicability','rounding','return sign','same transfer exclusion','reconciliation with central view']},
});
const text=v=>typeof v==='string'&&v.length>0&&v.trim()===v;
const strings=v=>Array.isArray(v)&&v.length>0&&v.every(text)&&new Set(v).size===v.length;
const sameSet=(a,b)=>strings(a)&&strings(b)&&a.length===b.length&&a.every(x=>b.includes(x));
const samePeriod=(a,b)=>a.start===b.start&&a.end===b.end;
const report=(mismatch=[],unknown=[])=>({status:mismatch.length?'incompatible':unknown.length?'unknown':'compatible',mismatch,unknown});
const key=(row,fields)=>JSON.stringify(fields.map(f=>row[f]));

export function requireProductGrain(fields) {
  if(!strings(fields))return report([],['product grain metadata absent']);
  return ['BRANDCD','STYLECD'].every(f=>fields.includes(f))?report():report(['brand/style product grain absent; no product join from coarse aggregate']);
}

export function validateContract(c) {
  const mismatch=[],unknown=[];
  if(!c||typeof c!=='object')return report([],['contract absent']);
  for(const f of ['source','amountField','vatOperation','currency','unit','signPolicy','roundingPolicy','channelScope','businessDefinitionVersion'])if(!text(c[f]))unknown.push(`${f} unconfirmed`);
  if(c.confirmation!=='synthetic-fixture'&&c.confirmation!=='verified-contract')unknown.push('contract confirmation absent');
  if(c.confirmation==='verified-contract'&&!text(c.verificationEvidence))unknown.push('verification evidence absent');
  if(c.complete!==true)unknown.push('receipt incomplete');
  if(!windowValid(c.period))unknown.push('valid inclusive period absent');
  if(!strings(c.grain))unknown.push('grain absent');
  else if(!['BRANDCD','STYLECD','SALEDT','SHOPCD'].every(f=>c.grain.includes(f)))mismatch.push('sales grain must retain brand/style/date/shop');
  if(!strings(c.brands))unknown.push('brand scope absent');
  else if(c.brands.some(b=>!BRANDS.includes(b)))mismatch.push('unsupported brand identity');
  if(!c.season||(!text(c.season.year)||!/^20\d{2}$/.test(c.season.year))||!strings(c.season.names))unknown.push('explicit season year/names absent');
  else if(c.season.names.some(n=>!new Set([...SEASONS.SS,...SEASONS.FW]).has(n)))mismatch.push('unknown season name');
  if(!Array.isArray(c.excludedShops)||!c.excludedShops.every(text)||new Set(c.excludedShops).size!==c.excludedShops.length)unknown.push('transfer exclusions unconfirmed');
  const spec=Object.values(SOURCE_SPECS).find(s=>s.source===c.source);
  if(!spec)unknown.push('source not covered by saved evidence');
  else {
    for(const f of ['amountField','vatOperation'])if(text(c[f])&&c[f]!==spec[f])mismatch.push(`${f} contradicts source evidence`);
    if(spec.excludedShops&&Array.isArray(c.excludedShops)&&!sameSet(c.excludedShops,spec.excludedShops))mismatch.push('central transfer exclusions differ');
    if(spec.unverified)unknown.push(...spec.unverified.map(x=>'detail unresolved: '+x));
  }
  return report(mismatch,unknown);
}

export function compareContracts(a,b) {
  const left=validateContract(a),right=validateContract(b);
  const mismatch=[...left.mismatch.map(x=>'left: '+x),...right.mismatch.map(x=>'right: '+x)];
  const unknown=[...left.unknown.map(x=>'left: '+x),...right.unknown.map(x=>'right: '+x)];
  if(a&&b){
    for(const f of ['source','amountField','vatOperation','currency','unit','signPolicy','roundingPolicy','channelScope','businessDefinitionVersion'])if(text(a[f])&&text(b[f])&&a[f]!==b[f])mismatch.push(`${f} differs; no automatic reconciliation`);
    for(const f of ['grain','brands','excludedShops'])if(Array.isArray(a[f])&&Array.isArray(b[f])&&!sameSet(a[f],b[f]))mismatch.push(`${f} differs`);
    if(windowValid(a.period)&&windowValid(b.period)&&!samePeriod(a.period,b.period))mismatch.push('period differs');
    if(a.season&&b.season&&(a.season.year!==b.season.year||!sameSet(a.season.names,b.season.names)))mismatch.push('season selection differs');
  }
  return report(mismatch,unknown);
}

// Atomic output: no partially validated row batch can be consumed as eligible rows.
const rowOutput=(checked,rows,included=[],excluded=[])=>({
  ...checked,executable:checked.status==='compatible',partialSuccess:false,
  included:checked.status==='compatible'?included:[],
  excluded:checked.status==='compatible'?excluded:[],
  diagnostics:{withheldInputs:checked.status==='compatible'?[]:
    (Array.isArray(rows)?rows:[]).map((input,index)=>({index,input,reason:'entire batch withheld; diagnostics only, not eligible output'}))},
});

export function validateRows(rows,c) {
  const base=validateContract(c);if(base.status!=='compatible')return rowOutput(base,rows);
  if(!Array.isArray(rows)||!rows.length)return rowOutput(report([],['empty observation sample']),rows);
  const mismatch=[],unknown=[],included=[],excluded=[],seen=new Set();
  for(const [i,r] of rows.entries()){
    if(!r||typeof r!=='object'){unknown.push(`row ${i} absent`);continue;}
    if(!BRANDS.includes(r.BRANDCD)||!c.brands.includes(r.BRANDCD))mismatch.push(`row ${i} brand outside contract`);
    if(c.grain.some(f=>!text(r[f])))unknown.push(`row ${i} key field absent/noncanonical`);
    else {const k=key(r,c.grain);if(seen.has(k))mismatch.push(`row ${i} duplicate grain`);seen.add(k);}
    if(!validDate(r.SALEDT))unknown.push(`row ${i} date invalid`);
    else if(r.SALEDT<c.period.start||r.SALEDT>c.period.end)mismatch.push(`row ${i} period mixed`);
    if(!text(r.YEAR)||!text(r.SEASONNM))unknown.push(`row ${i} season absent`);
    else if(r.YEAR!==c.season.year||!c.season.names.includes(r.SEASONNM))mismatch.push(`row ${i} season mixed`);
    if(typeof r.amount!=='string'||! /^-?(0|[1-9]\d*)$/.test(r.amount)||r.amount==='-0')unknown.push(`row ${i} exact integer amount absent`);
    if(c.excludedShops.includes(r.SHOPCD))excluded.push(r);else included.push(r);
  }
  return rowOutput(report(mismatch,unknown),rows,included,excluded);
}

// No VAT conversion/rounding inference. Only already-excluded exact integer fixture units.
export function sumSales(rows,c) {
  const result=validateRows(rows,c);
  if(result.status!=='compatible')return {...result,total:null};
  if(c.vatOperation!=='already_excluded'||c.unit!=='KRW_integer'||c.currency!=='KRW'||c.signPolicy!=='signed_ledger'||c.roundingPolicy!=='already_integer')return {...rowOutput(report([],['calculator policy unsupported; no inferred formula']),rows),total:null};
  return {...result,total:result.included.reduce((n,r)=>n+BigInt(r.amount),0n).toString()};
}

export function validateCrosswalk(mappings) {
  const mismatch=[],unknown=[],erp=new Set(),uttu=new Set(),musinsa=new Set(),versions=new Set();
  if(!Array.isArray(mappings)||!mappings.length)return report([],['crosswalk absent']);
  for(const [i,m] of mappings.entries()){
    if(!m||!BRANDS.includes(m.BRANDCD)||!text(m.STYLECD)||!text(m.productId)||!text(m.musinsaNo)){unknown.push(`mapping ${i} identity absent`);continue;}
    if(m.verified!==true||!text(m.mappingVersion)||!text(m.verificationEvidence))unknown.push(`mapping ${i} not verified/versioned`);
    if(m.uttuBrand!==m.BRANDCD)mismatch.push(`mapping ${i} brand identity collapsed/changed`);
    const k=key(m,['BRANDCD','STYLECD']);
    if(erp.has(k)||uttu.has(m.productId)||musinsa.has(m.musinsaNo))mismatch.push(`mapping ${i} ambiguous/duplicate one-to-one identity`);
    erp.add(k);uttu.add(m.productId);musinsa.add(m.musinsaNo);if(text(m.mappingVersion))versions.add(m.mappingVersion);
  }
  if(versions.size>1)mismatch.push('mixed mapping versions');
  return report(mismatch,unknown);
}

export function joinProduct(erpRow,mappings) {
  const checked=validateCrosswalk(mappings);if(checked.status!=='compatible')return {...checked,product:null};
  if(!erpRow||!BRANDS.includes(erpRow.BRANDCD)||!text(erpRow.STYLECD))return {...report([],['ERP product identity absent']),product:null};
  const matches=mappings.filter(m=>m.BRANDCD===erpRow.BRANDCD&&m.STYLECD===erpRow.STYLECD);
  return matches.length===1?{...report(),product:{productId:matches[0].productId,musinsaNo:matches[0].musinsaNo,brand:matches[0].BRANDCD}}:{...report([],['unmapped composite product key']),product:null};
}

export function compareMarketScope(erp,market,crosswalk) {
  const mismatch=[],unknown=[];
  if(!erp||!market||!crosswalk)return report([],['market scope/crosswalk absent']);
  if(crosswalk.verified!==true||!text(crosswalk.version)||!text(crosswalk.evidence))unknown.push('category crosswalk not verified/versioned');
  for(const f of ['item','category','store','gender','age']){
    const a=f==='category'?crosswalk.category:erp[f],b=market[f];
    if(!text(a)||!text(b))unknown.push(`${f} scope absent`);
    else if(a!==b)mismatch.push(`${f} scope differs`);
  }
  if(!text(crosswalk.item)||crosswalk.item!==erp.item)mismatch.push('crosswalk item differs');
  if(!validDate(erp.date)||!validDate(market.date))unknown.push('canonical observation dates absent');
  else if(erp.date!==market.date)mismatch.push('observation date differs');
  if(!windowValid(erp.period)||!windowValid(market.period))unknown.push('observation periods absent');
  else if(!samePeriod(erp.period,market.period))mismatch.push('observation period differs');
  for(const [name,scope] of [['ERP',erp],['market',market]])if(validDate(scope.date)&&windowValid(scope.period)&&scope.date!==scope.period.end)mismatch.push(`${name} snapshot not at period end`);
  if(erp.complete!==true||market.complete!==true)unknown.push('scope receipt incomplete');
  return report(mismatch,unknown);
}
