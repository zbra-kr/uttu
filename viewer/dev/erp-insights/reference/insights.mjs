// Pure synthetic prototype rules: incomplete evidence never becomes zero or a signal.
export const CONTRACT_ERRORS=Object.freeze({
 CONTRACT_MISMATCH:'원천·계산·기간 계약 불일치',CONTRACT_UNKNOWN:'원천·계산 계약 미확인',
 BATCH_MISMATCH:'원천 행의 키·기간·시즌 불일치',BATCH_UNKNOWN:'원천 행·완료 상태 미확인',
 MAPPING_MISMATCH:'상품 키·브랜드 매핑 충돌',MAPPING_UNKNOWN:'상품 매핑 검증 미확인',
 BINDING_MISMATCH:'화면 상품 연결 충돌',BINDING_UNKNOWN:'화면 상품 연결 미확인',
 PRODUCT_MISMATCH:'상품 연결 계약 불일치',PRODUCT_UNKNOWN:'유효 원천 상품 연결 미확인',
 SCOPE_MISMATCH:'시장 날짜·카테고리·범위 불일치',SCOPE_UNKNOWN:'시장 날짜·카테고리·범위 미확인',
 INPUT_MISMATCH:'입력 계약 불일치',INPUT_UNKNOWN:'합성 입력 계약 미확인',
 REQUEST_MISMATCH:'현재 화면 요청 기간·브랜드·상품·범위 불일치',REQUEST_UNKNOWN:'현재 화면 요청 범위 미확인',
});
export function contractGateMessage(gate) {
  const codes=Array.isArray(gate?.codes)?gate.codes.filter(c=>Object.hasOwn(CONTRACT_ERRORS,c)):[];
  return codes.map(c=>`[${c}] ${CONTRACT_ERRORS[c]}`).join(' · ')||'데이터 계약 미확인';
}
export function validDate(value) {
  return typeof value==='string' && /^20\d{2}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value+'T00:00:00Z'))
    && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
}
export function number(value,{min=-Infinity,max=Infinity,integer=false}={}) {
  return typeof value==='number' && Number.isFinite(value) && value>=min && value<=max
    && (!integer || Number.isSafeInteger(value));
}
export function windowValid(w) {return !!w && validDate(w.start)&&validDate(w.end)&&w.start<=w.end;}
const sameWindow=(a,b)=>windowValid(a)&&windowValid(b)&&a.start===b.start&&a.end===b.end;
const days=w=>(Date.parse(w.end)-Date.parse(w.start))/86400000+1;
export function aggregate(rows,key,{mean=false,receiptKey='erpComplete',validate=()=>true,...domain}={}) {
  const values=rows.filter(r=>number(r[key],domain)&&validate(r[key],r)).map(r=>r[key]);
  const totalN=rows.length, validN=values.length,missingN=totalN-validN;
  const receiptComplete=rows.every(r=>r[receiptKey]===true);
  let state=!totalN?'empty':!validN?'missing':missingN||!receiptComplete?'partial':'complete';
  let value=null;
  if(state==='complete') {
    const total=values.reduce((a,b)=>a+b,0);
    if(Number.isFinite(total)) value=mean?total/validN:total;
    else state='invalid';
  }
  return {value,state,validN,totalN,missingN,receiptComplete};
}
export function growth(now,before) {
  if(!number(now,{min:0})||!number(before,{min:0})||before===0) return null;
  const result=(now-before)/before*100;
  return Number.isFinite(result)?result:null;
}
export function reviewRate(low,total) {
  if(!number(total,{min:1,integer:true})||!number(low,{min:0,max:total,integer:true})) return null;
  return low/total*100;
}
export function evidence(row) {
  if(row.contractGate&&row.contractGate.status!=='compatible')return '판단 보류 · '+contractGateMessage(row.contractGate);
  if(row.mappingVerified!==true) return '판단 보류 · 상품 연결 미확인';
  if(row.sameScope!==true) return '판단 보류 · 시장 비교 범위 미확인';
  if(typeof row.erpSource!=='string'||!row.erpSource.trim()||typeof row.marketSource!=='string'||!row.marketSource.trim()) return '판단 보류 · 원천 미확인';
  if(row.erpComplete!==true||row.marketComplete!==true) return '판단 보류 · 수집 미완료/부분 응답';
  if(!validDate(row.erpDate)||!validDate(row.marketDate)||!validDate(row.asOf)) return '판단 보류 · 유효 기준일 누락';
  if(row.erpDate!==row.marketDate) return '판단 보류 · 기준일 불일치';
  if(row.erpDate!==row.asOf) return '판단 보류 · 최신성 미확인';
  if(!sameWindow(row.erpWindow,row.marketWindow)||!sameWindow(row.erpPreviousWindow,row.marketPreviousWindow)) return '판단 보류 · 비교 기간 누락/불일치';
  if(row.erpPreviousWindow.end>=row.erpWindow.start||days(row.erpPreviousWindow)!==days(row.erpWindow)) return '판단 보류 · 이전 기간 중첩/길이 불일치';
  if(row.erpWindow.end>row.asOf) return '판단 보류 · 미래 분석 기간';
  if(!validDate(row.rankDate)||!validDate(row.previousRankDate)||row.rankDate!==row.marketWindow.end||row.previousRankDate!==row.marketPreviousWindow.end) return '판단 보류 · 순위 관측기간 불일치';
  if(!validDate(row.erpUpdatedDate)||!validDate(row.marketUpdatedDate)||row.erpUpdatedDate!==row.asOf||row.marketUpdatedDate!==row.asOf) return '판단 보류 · 원천 최신성 미확인';
  return '동일 기준일·기간·완료 관측 비교';
}
export function pairedRank(row) {
  if(evidence(row)!=='동일 기준일·기간·완료 관측 비교'||!number(row.rank,{min:1,max:300,integer:true})||!number(row.previousRank,{min:1,max:300,integer:true})) return null;
  return row.previousRank-row.rank;
}
function signalMessage(row,view) {
  const ready=evidence(row);
  if(ready!=='동일 기준일·기간·완료 관측 비교') return ready;
  const rise=pairedRank(row);
  if(rise===null) return '판단 보류 · 양기간 순위 미확인';
  const pct=v=>number(v,{min:0,max:100});
  if(view==='quality') {
    if(row.reviewComplete!==true||!sameWindow(row.reviewWindow,row.marketWindow)||!validDate(row.reviewUpdatedDate)||row.reviewUpdatedDate!==row.asOf||reviewRate(row.lowReviews,row.reviews)===null) return '판단 보류 · 리뷰 미완료/표본 부족';
    return reviewRate(row.lowReviews,row.reviews)>=10?'품질 리뷰 우선 확인':'리뷰 표본 확인';
  }
  if(view==='carryover') {
    if(typeof row.carryover!=='boolean'||!number(row.inventory,{min:0,integer:true})||!number(row.online,{min:0,integer:true})) return '판단 보류 · 이월/재고 미확인';
    return row.carryover&&rise>0?'재노출 검토 · 가격/리뷰 확인':'재고와 수요 관측 확인';
  }
  if(view==='margin') {
    if(row.peerComplete!==true||!sameWindow(row.peerWindow,row.marketWindow)||!validDate(row.peerUpdatedDate)||row.peerUpdatedDate!==row.asOf||!number(row.peerCount,{min:1,integer:true})) return '판단 보류 · 경쟁 표본/기간/갱신 미확인';
    if(!pct(row.erpDiscount)||!pct(row.peerDiscount)||!number(row.profitChange)) return '판단 보류 · 할인/이익 지표 미확인';
    return row.erpDiscount>row.peerDiscount&&row.profitChange<0?'할인 확대·이익 감소 동시 관측':'가격 조건 비교';
  }
  if(view==='sales') {
    if(!number(row.wow)||!number(row.sale,{min:0})) return '판단 보류 · 매출/전주 비교 미확인';
    return rise>0&&row.wow<0?'시장 상승·내부 매출 하락 동시 관측':'내부·시장 방향 비교';
  }
  if(!pct(row.sellThrough)) return '판단 보류 · 판매율 미확인';
  return rise>0&&row.sellThrough<30?'시장 상승·낮은 판매율 확인':'기획·수요 관측 확인';
}
export function signalBasis(row) {
  const missing=['sale','sellThrough','peerDiscount','rank','previousRank'].filter(k=>!number(row[k]));
  return `리뷰 표본 ${number(row.reviews,{min:0,integer:true})?row.reviews:'미확인'} / 저평점 ${number(row.lowReviews,{min:0,integer:true})?row.lowReviews:'미확인'} · 주요 지표 누락 ${missing.length} · 내부 ${validDate(row.erpDate)?row.erpDate:'미확인'} / 시장 ${validDate(row.marketDate)?row.marketDate:'미확인'} · 최신성 ${validDate(row.asOf)&&row.erpUpdatedDate===row.asOf&&row.marketUpdatedDate===row.asOf?'기준일 갱신 확인':'미확인'} · 기간 ${windowValid(row.erpWindow)?row.erpWindow.start+'~'+row.erpWindow.end:'미확인'} · 응답 ${row.erpComplete===true&&row.marketComplete===true?'완료':'미완료'}`;
}

// The row message and every view-dependent summary share this assessment.
const flaggedMessages={planning:'시장 상승·낮은 판매율 확인',sales:'시장 상승·내부 매출 하락 동시 관측',margin:'할인 확대·이익 감소 동시 관측',carryover:'재노출 검토 · 가격/리뷰 확인',quality:'품질 리뷰 우선 확인'};
export function assessment(row,view) {
  const message=signalMessage(row,view);
  const ready=!message.startsWith('판단 보류');
  return {ready,message,flagged:ready&&message===flaggedMessages[view]};
}
export function signal(row,view) {return assessment(row,view).message;}
export function viewAggregate(rows,key,view,options={}) {
  const validate=options.validate||(()=>true);
  return aggregate(rows,key,{...options,validate:(value,row)=>assessment(row,view).ready&&validate(value,row)});
}
export function signalCount(rows,view) {
  const observations=rows.map(row=>({...row,candidate:assessment(row,view).flagged?1:0}));
  return viewAggregate(observations,'candidate',view,{min:0,max:1,integer:true});
}
