import {auditedStyleCalendar,type CalendarAudit} from './style-calendar-audit';
import {parseCentralScope,type CentralScope} from './central-sales-read';
import {normalizeCentralDailyReceipt} from './central-daily-receipt';
import {centralDisplayTotal} from './central-sales-display';
interface Color {BRANDCD:string;STYLECD:string;COLORCD:string}
interface Product {id:string;musinsa_no:string;name:string;style_no:string;erp_style_code:string|null}
interface Rank {product_id:string;snapshot_date:string;rank_position:number;store_code:string;category_code:string;gender_filter:string;age_filter:string}
export interface StyleMarketInput {scope:CentralScope;styles:string[];colors:{complete:boolean;rows:Color[]};sales:{complete:boolean;rows:Record<string,unknown>[]};market:{complete:boolean;products:Product[];ranks:Rank[];rank_read_complete:boolean};calendarAudit?:CalendarAudit;directInspection?:{checkedCodes:string[];rows:{BRANDCD:string;STYLECD:string}[]}}
// Style sales live exactly once here. Children carry market evidence only, never allocation or copied amounts.
export function groupStyleMarketEvidence(input:StyleMarketInput){
 const q=parseCentralScope(input.scope).scope;
 if(!q||q.brand!=='CO'||q.aggregate!=='daily'||(Date.parse(q.to)-Date.parse(q.from))/86400000!==13||input.styles.length>10||!input.styles.length||new Set(input.styles).size!==input.styles.length)throw Error('STYLE_GROUP_SCOPE_INVALID');
 if(input.colors.rows.some(r=>r.BRANDCD!=='CO'||!input.styles.includes(r.STYLECD)||!r.COLORCD)||input.sales.rows.some(r=>r.BRANDCD!=='CO'||typeof r.STYLECD!=='string'||!input.styles.includes(r.STYLECD)))throw Error('STYLE_GROUP_SOURCE_INVALID');
 const days=Array.from({length:14},(_,i)=>new Date(Date.parse(q.from)+i*86400000).toISOString().slice(0,10)),midpoint=days[6];
 const calendar=input.calendarAudit?auditedStyleCalendar(q,input.styles,input.calendarAudit):null;
 const groups=input.styles.map(style=>{
  const colors=input.colors.rows.filter(r=>r.STYLECD===style),colorSet=new Set(colors.map(c=>c.COLORCD));
  const styleRows=input.sales.rows.filter(r=>r.STYLECD===style).map(r=>({BRANDCD:r.BRANDCD,SALEDT:r.SALEDT,SALES_VAT_EX:r.SALES_VAT_EX,SOURCE_ROWS:r.SOURCE_ROWS,AMOUNT_ROWS:r.AMOUNT_ROWS}));
  const normalized=normalizeCentralDailyReceipt(q,{complete:input.sales.complete,rows:styleRows}),calendarStyle=calendar?.find(r=>r.style===style),daily=calendarStyle?.daily??normalized.dailySummary?.rows??[];
  const salesComplete=(!!calendarStyle||normalized.kind==='summary')&&daily.length===14&&new Set(daily.map(r=>r.saleDate)).size===14&&daily.every(r=>days.includes(r.saleDate)&&r.amount.approximateValue!==null);
  const previous=salesComplete?centralDisplayTotal(daily.filter(r=>r.saleDate<=midpoint)):null,current=salesComplete?centralDisplayTotal(daily.filter(r=>r.saleDate>midpoint)):null;
  const totalsComplete=salesComplete&&previous?.approximateValue!==null&&current?.approximateValue!==null;
  const styleSales={grain:'BRANDCD/STYLECD/date; all colors' as const,label:'스타일 전체 색상 매출',status:totalsComplete?'observed-complete' as const:'held' as const,observedDays:styleRows.length,provenZeroDays:calendarStyle?.provenZeroDays??0,sourceCoverage:calendarStyle?.sourceCoverage??'OBSERVED_ROWS_ONLY',upstreamCollectionComplete:null,previous:totalsComplete?previous:null,current:totalsComplete?current:null,reason:totalsComplete?'FLOAT_APPROXIMATE_STYLE_TOTAL':salesComplete?'AMOUNT_OVERFLOW_HELD':'SOURCE_DAYS_OR_NULL_HELD'};
  const links=input.market.products.filter(p=>colors.some(c=>c.STYLECD+c.COLORCD===p.style_no));
  const market=links.map(p=>{
   const resolutions=input.colors.rows.filter(c=>c.STYLECD+c.COLORCD===p.style_no),direct=input.directInspection?.rows.filter(r=>r.BRANDCD==='CO'&&r.STYLECD===p.style_no)??[];
   const duplicateProductCode=input.market.products.filter(x=>x.style_no===p.style_no).length!==1;
   const color=resolutions.length===1?resolutions[0].COLORCD:null;
   const rows=input.market.ranks.filter(r=>r.product_id===p.id&&r.store_code==='musinsa'&&r.category_code==='000'&&r.gender_filter==='A'&&r.age_filter==='AGE_BAND_ALL'&&[midpoint,q.to].includes(r.snapshot_date)&&Number.isSafeInteger(r.rank_position)&&r.rank_position>0);
   const start=rows.filter(r=>r.snapshot_date===midpoint),end=rows.filter(r=>r.snapshot_date===q.to);
   const endpoints=input.market.rank_read_complete&&start.length===1&&end.length===1;
   const conflict=resolutions.length!==1||direct.length>0||duplicateProductCode||!input.colors.complete||!input.market.complete;
   return {productId:p.id,musinsaNo:p.musinsa_no,name:p.name,sourceFullCode:p.style_no,color,reviewState:conflict?'conflict' as const:'candidate' as const,directResolutionChecked:input.directInspection?.checkedCodes.includes(p.style_no)??false,reason:conflict?'AMBIGUOUS_CODE_OR_PRODUCT':'BRAND_CODE_GRAIN_REVIEW_PENDING',marketEvidence:{scope:'musinsa/000/A/AGE_BAND_ALL',from:midpoint,to:q.to,startRank:endpoints?start[0].rank_position:null,endRank:endpoints?end[0].rank_position:null,rankChange:endpoints?start[0].rank_position-end[0].rank_position:null,status:endpoints?'observed-endpoints':'ENDPOINTS_MISSING_OR_AMBIGUOUS'},insightEligible:false};
  });
  return {brand:'CO',style,styleSales,market,cardinality:{sourceColors:colorSet.size,linkedProducts:links.length,missingColors:[...colorSet].filter(color=>!links.some(p=>p.style_no===style+color)),duplicateFullCodes:market.filter(p=>p.reason==='AMBIGUOUS_CODE_OR_PRODUCT').length,completeUnderObservedCodeRelation:input.colors.complete&&colors.length===colorSet.size&&input.market.complete,oneToMany:links.length>1},confirmed:false,insightEligible:false};
 });
 return {mode:'candidate-grain-review' as const,groups,styleSalesInstances:groups.length,marketProductInstances:groups.reduce((s,g)=>s+g.market.length,0),allocation:'NONE' as const,insightRows:[],warnings:['매출은 STYLECD 전체 색상 합계로 한 번만 표시합니다. 색상 상품별 매출로 해석하거나 배분하지 않습니다.','전체 cardinality는 관측한 정확 코드 관계 범위입니다. 다른 품번체계·무코드 재등록·brand_id와 ERP CO 독립근거는 미검증입니다.']};
}
export function renderStyleMarketReview(result:ReturnType<typeof groupStyleMarketEvidence>){
 const entities:Record<string,string>={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
 const e=(v:unknown)=>String(v??'—').replace(/[&<>"']/g,c=>entities[c]);
 return '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>스타일·색상 단위 검토</title><style>body{font:16px system-ui;margin:32px;background:rgb(245,247,250);color:rgb(25,35,50)}section{background:white;padding:24px;margin:20px 0;border-radius:12px}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:10px;border-bottom:1px solid rgb(220,225,230)}small{color:rgb(80,90,105)}</style><h1>스타일 매출 · 색상별 시장 근거</h1><p>검토 후보 · 확정/DB 반영 없음 · 매출 배분 없음</p><p>저장 근거 기준 코드 없는 자사 Covernat 상품 165개는 이 색상에 귀속할 수 없습니다. 누락·대체 코드 가능성 때문에 상품 부재를 확정할 수 없습니다.</p>'+result.warnings.map(w=>'<p>'+e(w)+'</p>').join('')+result.groups.map(g=>'<section><h2>'+e(g.style)+'</h2><div data-style-sales="'+e(g.style)+'"><b>'+e(g.styleSales.label)+'</b><p>'+(g.styleSales.status==='observed-complete'?'이전 7일 '+e(g.styleSales.previous?.millionsText)+' → 최근 7일 '+e(g.styleSales.current?.millionsText)+' 백만원 (FLOAT 근사) · 원천 뷰 행 부재로 입증한 0일 '+e(g.styleSales.provenZeroDays)+'개 · 상위 수집 완전성 미확인':'매출 보류 · 관측 '+e(g.styleSales.observedDays)+'/14일 · 누락/NULL을 0으로 채우지 않음')+'</p></div><small>원천 색상 '+g.cardinality.sourceColors+' · 연결 상품 '+g.cardinality.linkedProducts+' · 동일 코드로 연결되지 않은 색상 '+e(g.cardinality.missingColors.join(', '))+' · '+(g.cardinality.completeUnderObservedCodeRelation?'정확 코드 관계 조회 완료':'조회 불완전 · 전체 수 미확인')+' · 검토 미확정</small><table><thead><tr><th>색상 / 상품</th><th>시장 순위 '+e(g.market[0]?.marketEvidence.from)+' → '+e(g.market[0]?.marketEvidence.to)+'</th><th>근거 상태</th></tr></thead><tbody>'+g.market.map(p=>'<tr data-market-product="'+e(p.productId)+'"><td>'+e(p.color)+' / '+e(p.musinsaNo)+'<br><small>'+e(p.name)+'</small></td><td>'+e(p.marketEvidence.startRank)+' → '+e(p.marketEvidence.endRank)+'</td><td>'+e(p.marketEvidence.status)+'<br>'+e(p.reviewState)+' · direct 경로 '+(p.directResolutionChecked?'검사됨':'미검사')+'</td></tr>').join('')+'</tbody></table></section>').join('');
}
