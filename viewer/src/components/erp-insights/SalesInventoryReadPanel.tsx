import { READ_REASONS, type SalesInventoryState } from '@/lib/erp/sales-inventory-types';
import type { InventoryState } from '@/lib/erp/inventory-read';
import InventoryRawReadPanel from './InventoryRawReadPanel';

export default function SalesInventoryReadPanel({ state,inventory,salesPeriod }: { state: SalesInventoryState;inventory?:InventoryState;salesPeriod?:{from:string;to:string} }) {
  return <><section aria-label="매출·재고와 시장 관측" data-erp-server-state={state.kind}>
    <h2>상품 실적·재고 × 동일 기간 시장 관측</h2>
    <p>매출은 기간 실적입니다. 재고 종료일 스냅샷은 별도 검증된 기준일이 있을 때만 표시합니다. 거래일·원천 INSERTDT는 ETL 갱신 시각을 증명하지 않습니다. 순위는 매출·점유율이 아니며 발주·입고 자료는 미연결입니다.</p>
    {state.kind !== 'ready' ? <p role="status">{state.reasons.map(reason => READ_REASONS[reason]).join(' · ')}</p>
      : state.observations.map(row => <article key={`${row.brand}:${row.style}`}>
        <h3>{row.brand} · {row.style}</h3>
        <p>{row.from} ~ {row.to} · 재고 기준일 {row.inventoryAsOf} · 순위 {row.market.fromRank} → {row.market.toRank}</p>
        <table className="tbl"><caption>VAT 제외 매출 — 중앙 일자·상품·매장 집계 또는 별도 검증된 옵션 투영</caption><thead><tr>{['일자','매장','색상','사이즈','매출 (원)','판매 수량'].map(x => <th scope="col" key={x}>{x}</th>)}</tr></thead><tbody>{row.sales.map((s,i) => <tr key={i}><td>{s.date}</td><td>{s.shop}</td><td>{s.color ?? '옵션 집계 없음'}</td><td>{s.size ?? '옵션 집계 없음'}</td><td>{s.vatExcludedKRW}</td><td>{s.quantity}</td></tr>)}</tbody></table>
        <table className="tbl"><caption>매장 재고 — 창고 가용재고와 합산하지 않음</caption><thead><tr>{['매장','색상','사이즈','재고','가용'].map(x => <th scope="col" key={x}>{x}</th>)}</tr></thead><tbody>{row.shops.map((s,i) => <tr key={i}><td>{s.shop}</td><td>{s.color}</td><td>{s.size}</td><td>{s.inventory}</td><td>{s.available}</td></tr>)}</tbody></table>
        <table className="tbl"><caption>창고 재고 — 온라인·오프라인 가용 구분</caption><thead><tr>{['창고','색상','사이즈','가용','온라인','오프라인'].map(x => <th scope="col" key={x}>{x}</th>)}</tr></thead><tbody>{row.warehouses.map((s,i) => <tr key={i}><td>{s.warehouse}</td><td>{s.color}</td><td>{s.size}</td><td>{s.available}</td><td>{s.online}</td><td>{s.offline}</td></tr>)}</tbody></table>
        <p>시장 범위: {Object.values(row.market.scope).join(' / ')} · 발주: 미확인 · 입고: 미확인 · 자동 실행 제안 없음</p>
      </article>)}
  </section>{inventory&&<InventoryRawReadPanel state={inventory} salesPeriod={salesPeriod}/>}</>;
}
