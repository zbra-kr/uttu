// Synthetic input adapter: return only display projections and allowlisted summaries.
// Never return validation diagnostics, included/excluded source arrays or raw reasons.
import {compareContracts,validateRows,validateCrosswalk,joinProduct,compareMarketScope,BRANDS} from './data-contracts.mjs';
import {CONTRACT_ERRORS,validDate,windowValid} from './insights.mjs';
const record=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=v=>typeof v==='string'&&v.length>0&&v.trim()===v;
const strings=v=>Array.isArray(v)&&v.length>0&&v.every(text)&&new Set(v).size===v.length;
const sameSet=(a,b)=>strings(a)&&strings(b)&&a.length===b.length&&a.every(x=>b.includes(x));
const samePeriod=(a,b)=>windowValid(a)&&windowValid(b)&&a.start===b.start&&a.end===b.end;
const identity=b=>record(b)&&BRANDS.includes(b.displayBrand)&&text(b.displayStyle)&&BRANDS.includes(b.BRANDCD)&&text(b.STYLECD);
const candidate=r=>record(r)&&BRANDS.includes(r.brand)&&text(r.style)&&text(r.item);
const combine=checks=>checks.some(c=>c.status==='incompatible')?'incompatible':checks.some(c=>c.status!=='compatible')?'unknown':'compatible';
const code=(prefix,status)=>status==='compatible'?null:prefix+'_'+(status==='incompatible'?'MISMATCH':'UNKNOWN');
const gate=checks=>{const codes=[...new Set(checks.map(c=>code(c.prefix,c.status)).filter(Boolean))];return {status:combine(checks),codes,summary:codes.map(c=>CONTRACT_ERRORS[c]).join(' · ')||'선언·합성 계약 일치; 실제 ERP 검증 아님'};};
// Existing presentation values are synthetic KPIs, not derived business formulas.
const FIELDS=['brand','brandName','item','name','style','sale','qty','wow','erpDiscount','peerDiscount','profitChange','sellThrough','ord','inbound','inventory','online','rank','previousRank','reviews','lowReviews','carryover','mappingVerified','sameScope','erpDate','marketDate','erpSource','marketSource','erpComplete','marketComplete','reviewComplete','reviewWindow','reviewUpdatedDate','peerComplete','peerWindow','peerUpdatedDate','peerCount','asOf','erpUpdatedDate','marketUpdatedDate','erpWindow','marketWindow','erpPreviousWindow','marketPreviousWindow','rankDate','previousRankDate'];
function requestCheck(c,request) {
  if(!record(request)||!windowValid(request.period)||!strings(request.brands)||request.brands.some(b=>!BRANDS.includes(b))||!strings(request.grain)||!text(request.channelScope)||!record(request.season)||!text(request.season.year)||!strings(request.season.names)||!Array.isArray(request.bindings)||!request.bindings.length||request.bindings.some(b=>!identity(b)||!text(b.item)||!text(b.category)||!text(b.store)||!text(b.gender)||!text(b.age)))return {prefix:'REQUEST',status:'unknown'};
  if(!record(c)||!windowValid(c.period)||!strings(c.brands)||!strings(c.grain)||!record(c.season)||!text(c.channelScope))return {prefix:'REQUEST',status:'unknown'};
  const sourceBinding=compareContracts(c,request.sourceContract);
  if(sourceBinding.status!=='compatible')return {prefix:'REQUEST',status:sourceBinding.status};
  const mismatch=!samePeriod(c.period,request.period)||request.brands.some(b=>!c.brands.includes(b))||!sameSet(c.grain,request.grain)||c.channelScope!==request.channelScope||c.season.year!==request.season.year||!sameSet(c.season.names,request.season.names);
  return {prefix:'REQUEST',status:mismatch?'incompatible':'compatible'};
}
function rowRequestCheck(row,b,request) {
  if(!candidate(row)||!record(request)||!windowValid(request.period)||!Array.isArray(request.bindings))return {prefix:'REQUEST',status:'unknown'};
  const expected=request.bindings.filter(x=>identity(x)&&x.displayBrand===row.brand&&x.displayStyle===row.style);
  if(expected.length!==1)return {prefix:'REQUEST',status:expected.length?'incompatible':'unknown'};
  const e=expected[0];
  if(!windowValid(row.erpWindow)||!windowValid(row.marketWindow)||!validDate(row.erpDate)||!validDate(row.marketDate))return {prefix:'REQUEST',status:'unknown'};
  const missing=['store','gender','age'].some(f=>!text(b.erpScope?.[f])||!text(b.marketScope?.[f]))||!text(b.marketScope?.category)||!text(b.categoryCrosswalk?.category);
  if(missing)return {prefix:'REQUEST',status:'unknown'};
  const mismatch=!Array.isArray(request.brands)||!request.brands.includes(row.brand)||!samePeriod(row.erpWindow,request.period)||!samePeriod(row.marketWindow,request.period)||row.erpDate!==request.period.end||row.marketDate!==request.period.end||e.BRANDCD!==b.BRANDCD||e.STYLECD!==b.STYLECD||e.item!==row.item||e.category!==b.marketScope.category||e.category!==b.categoryCrosswalk.category||['store','gender','age'].some(f=>e[f]!==b.erpScope[f]||e[f]!==b.marketScope[f])||(text(request.itemFilter)&&request.itemFilter!=='all'&&row.item!==request.itemFilter);
  return {prefix:'REQUEST',status:mismatch?'incompatible':'compatible'};
}
export function adaptScreenInput(rows,input,request) {
  const candidates=Array.isArray(rows)?Array.from(rows):[];
  const contract=compareContracts(input?.contract,input?.expectedContract);
  const batch=validateRows(input?.ledgerRows,input?.contract);
  const mapping=validateCrosswalk(input?.mappings);
  const checks=[{prefix:'CONTRACT',status:contract.status},{prefix:'BATCH',status:batch.status},{prefix:'MAPPING',status:mapping.status}];
  checks.push(requestCheck(input?.contract,request));
  if(input?.syntheticOnly!==true)checks.push({prefix:'INPUT',status:'unknown'});
  if(!Array.isArray(rows)||candidates.some(r=>!candidate(r)))checks.push({prefix:'INPUT',status:'unknown'});
  const bindings=Array.isArray(input?.bindings)?input.bindings.filter(identity):[];
  if(!Array.isArray(input?.bindings)||bindings.length!==input.bindings.length)checks.push({prefix:'BINDING',status:'unknown'});
  const duplicateDisplay=candidates.some((r,i)=>candidate(r)&&candidates.some((other,j)=>i!==j&&candidate(other)&&r.brand===other.brand&&r.style===other.style));
  if(duplicateDisplay)checks.push({prefix:'BINDING',status:'incompatible'});
  const projected=candidates.map(row=>{
    const windowFields=['erpWindow','marketWindow','erpPreviousWindow','marketPreviousWindow','reviewWindow','peerWindow'];
    const dateFields=['erpDate','marketDate','reviewUpdatedDate','peerUpdatedDate','asOf','erpUpdatedDate','marketUpdatedDate','rankDate','previousRankDate'];
    const safe=Object.fromEntries(FIELDS.filter(f=>Object.hasOwn(row||{},f)).map(f=>[f,
      windowFields.includes(f)?(row[f]&&typeof row[f]==='object'?{start:validDate(row[f].start)?row[f].start:null,end:validDate(row[f].end)?row[f].end:null}:null):
      dateFields.includes(f)?(validDate(row[f])?row[f]:null):
      (row[f]===null||['string','number','boolean'].includes(typeof row[f])?row[f]:null)]));
    const local=[...checks];
    const matches=candidate(row)?bindings.filter(b=>b.displayBrand===row.brand&&b.displayStyle===row.style):[];
    if(matches.length!==1)local.push({prefix:'BINDING',status:matches.length?'incompatible':'unknown'});
    else {
      const b=matches[0];
      local.push(rowRequestCheck(row,b,request));
      if(b.BRANDCD!==row.brand)local.push({prefix:'BINDING',status:'incompatible'});
      const product=joinProduct({BRANDCD:b.BRANDCD,STYLECD:b.STYLECD},input?.mappings);
      local.push({prefix:'PRODUCT',status:product.status});
      // Must be backed by a validated, non-transfer source record, not mappings alone.
      if(batch.status==='compatible'&&!batch.included.some(r=>r.BRANDCD===b.BRANDCD&&r.STYLECD===b.STYLECD))local.push({prefix:'PRODUCT',status:'unknown'});
      const erp={...b.erpScope,item:row.item,date:row.erpDate,period:row.erpWindow,complete:row.erpComplete};
      const market={...b.marketScope,item:row.item,date:row.marketDate,period:row.marketWindow,complete:row.marketComplete};
      local.push({prefix:'SCOPE',status:compareMarketScope(erp,market,b.categoryCrosswalk).status});
    }
    return {...safe,contractGate:gate(local)};
  });
  const result=gate(projected.length?projected.map(r=>({...r.contractGate,prefix:'INPUT'})):[{prefix:'INPUT',status:'unknown'}]);
  // Rebuild codes from actual row gates rather than exposing raw comparison reports.
  result.codes=[...new Set(projected.flatMap(r=>r.contractGate.codes))];
  if(!projected.length)result.codes=['INPUT_UNKNOWN'];
  result.summary=result.codes.map(c=>CONTRACT_ERRORS[c]).join(' · ')||'선언·합성 계약 일치; 실제 ERP 검증 아님';
  result.validN=projected.filter(r=>r.contractGate.status==='compatible').length;
  result.totalN=projected.length;
  return {rows:projected,contractSummary:result};
}
