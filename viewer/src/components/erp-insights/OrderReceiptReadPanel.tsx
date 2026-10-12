import {SUPPLY_REASONS,type SupplyState} from '@/lib/erp/order-receipt';
export default function OrderReceiptReadPanel({state}:{state:SupplyState}){
  return <section aria-label="발주·입고 별도 현황" data-erp-supply-state={state.kind}><h2>발주·입고 현황</h2>
    <p>발주는 시즌 발주 스냅샷, 입고는 지정 기간의 별도 수량입니다. 매출·재고와 합산하지 않습니다. 원천 거래일·INSERTDT와 ETL 갱신 시각은 별개이며, 입고 음수 의미는 검증 전 보류합니다.</p>
    <p role="status">{state.reasons.map(r=>SUPPLY_REASONS[r]).join(' · ')}</p>
    {state.summary&&<><p>발주 스냅샷 {state.summary.orderAsOf} · 시즌 {state.summary.seasonYear} {state.summary.season} · 입고 기간 {state.summary.receiptFrom} ~ {state.summary.receiptTo}</p><p>전체 발주 {state.summary.totalOrder} · 초도 {state.summary.initialOrder} · QR {state.summary.qrOrder} · QR 제외 발주 {state.summary.excludedQROrder} · 기간 입고 {state.summary.totalReceipt} · 입고율 미확인</p>
      <table className="tbl"><caption>발주 — 브랜드·상품·차수·색상·사이즈별</caption><thead><tr>{['브랜드','상품','차수','색상','사이즈','초도/QR 구분','발주'].map(x=><th scope="col" key={x}>{x}</th>)}</tr></thead><tbody>{state.summary.orders.map((r,i)=><tr key={i}><td>{r.brand}</td><td>{r.style}</td><td>{r.lot}</td><td>{r.color}</td><td>{r.size}</td><td>{r.bucket}</td><td>{r.quantity}</td></tr>)}</tbody></table>
      <table className="tbl"><caption>입고 — 상품 옵션별 별도 집계 · 차수 연결 미확인</caption><thead><tr>{['브랜드','상품','색상','사이즈','입고'].map(x=><th scope="col" key={x}>{x}</th>)}</tr></thead><tbody>{state.summary.receipts.map((r,i)=><tr key={i}><td>{r.brand}</td><td>{r.style}</td><td>{r.color}</td><td>{r.size}</td><td>{r.quantity}</td></tr>)}</tbody></table></>}
  </section>;
}
