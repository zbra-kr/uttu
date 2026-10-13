import { ERP_BRANDS } from '@/lib/erp-insight-workspace';
import { INVENTORY_REASONS,INVENTORY_MAPPING,INVENTORY_COLUMNS,type InventoryState } from '@/lib/erp/inventory-read';
const LABELS:Record<string,string>={INVQTY:'원천 재고 수량',AVAILQTY:'원천 가용 수량',ONLINEQTY:'온라인 가용',OFFLINEQTY:'오프라인 가용'};
const QUANTITY_REASONS={NULL:'원천 NULL · 수량 미확인',INVALID:'유효한 수량 표현 아님',NEGATIVE:'음수 부호의 원천 표현 · 정밀도 미확인',APPROXIMATE:'FLOAT/Number 근사 표현',SOURCE_NUMBER:'NUMBER 원본 표현 · 정밀도 대사 미확인'};
export default function InventoryRawReadPanel({state,salesPeriod}:{state:InventoryState;salesPeriod?:{from:string;to:string}}){
  return <section aria-label="제한된 상품의 원천 재고 관측" data-inventory-state={state.kind}>
    <h2>매장·창고 원천 재고 관측</h2>
    <form method="get">{salesPeriod&&<><input type="hidden" name="from" value={salesPeriod.from}/><input type="hidden" name="to" value={salesPeriod.to}/></>}<label>브랜드<select name="brand" defaultValue={state.scope?.brand??''}><option value="">선택</option>{ERP_BRANDS.map(b=><option key={b}>{b}</option>)}</select></label>
      <label>상품 코드 (쉼표로 구분, 최대10개)<input name="inventoryStyles" defaultValue={state.scope?.styles.join(',')??''}/></label><button type="submit">재고 조회 상태 확인</button></form>
    <p role="status">{INVENTORY_REASONS[state.reason]}</p>
    <p>원천에 재고 기준시각이 없습니다. 현재 재고·종료일 스냅샷으로 확정하지 않습니다. 지정 상품만 검사하며 전체 브랜드 재고나 시장 비교를 뜻하지 않습니다.</p>
    {(['shop','warehouse'] as const).map(source=>{
      const data=state.sources[source];if(!data)return null;
      return <article key={source} data-inventory-source={source} data-source-state={data.kind}>
        <h3>{source==='shop'?'매장':'창고'} 관측</h3><p>{INVENTORY_REASONS[data.reason]}</p>
        <ul>{data.audit.map(a=><li key={a.style}>{a.style}: {INVENTORY_MAPPING[a.mapping]} · 마스터 {a.masterRows}행/브랜드 {a.brandCount}개 · 원천 {a.sourceRows}행</li>)}</ul>
        {data.rows.length>0&&<div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}><caption>기준시각 미확인 원천 수량 · 다른 원천/수량 열과 합산하지 않음</caption>
          <thead><tr>{['상품 코드','매장/창고 코드','색상','사이즈',...INVENTORY_COLUMNS[source].map(c=>LABELS[c]),'투영키 상태'].map(c=><th scope="col" key={c}>{c}</th>)}</tr></thead>
          <tbody>{data.rows.map((r,i)=><tr key={i}><td>{r.style}</td><td>{r.location??'미확인'}</td><td>{r.color??'미확인'}</td><td>{r.size??'미확인'}</td>
            {r.quantities.map(q=><td key={q.column}>{q.text??'—'} · {QUANTITY_REASONS[q.reason]}</td>)}<td>{r.duplicateGrain>1?`동일 투영키 ${r.duplicateGrain}행 · 추가 집계 단위 확인 필요`:'단일 관측 행'}</td>
          </tr>)}</tbody></table></div>}
        <p>표시 행의 투영키 중복 {data.duplicateRows===null?'미확인':`${data.duplicateRows}행`} · 수량 합계 보류 · 기준시각 미확인</p>
      </article>;
    })}
  </section>;
}
