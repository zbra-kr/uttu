import { ERP_BRANDS } from '@/lib/erp-insight-workspace';
import type { CentralScope } from '@/lib/erp/central-sales-read';
import type { ReceiptSourceState } from '@/lib/erp/receipt-source-read';
export default function ReceiptSourceReadPanel({state,salesScope}:{state:ReceiptSourceState;salesScope?:CentralScope}){
 return <section aria-label="입고 원천 행 조회" data-receipt-source-state={state.kind}>
  <h2>입고 원천 · 차수·옵션·창고·입고일</h2>
  <form method="get">{salesScope?.aggregate==='daily'&&<input type="hidden" name="aggregate" value="daily"/>}<label>브랜드<select name="brand" defaultValue={state.scope?.brand??salesScope?.brand??''}><option value="">선택</option>{ERP_BRANDS.map(b=><option key={b}>{b}</option>)}</select></label><label>시작일<input type="date" name="from" defaultValue={state.scope?.from??salesScope?.from??''}/></label><label>종료일<input type="date" name="to" defaultValue={state.scope?.to??salesScope?.to??''}/></label><label>품번 (쉼표로 구분, 최대10개)<input name="receiptStyles" defaultValue={state.scope?.styles.join(',')??''}/></label><button type="submit">입고 원천 조회</button></form>
  <p>WHINDT 기준의 선택 기간 원천 행입니다. 발주별 배분·입고율·누적 입고·재고 기준시각은 미확인입니다. 수량은 FLOAT 원천 표현이며 정확 수량이나 기간 합계를 확정하지 않습니다.</p>
  {state.scope&&<p>{state.scope.brand} · {state.scope.from} ~ {state.scope.to} · 지정 상품만 조회</p>}
  <p role="status">{state.reason} · 미연결·빈 응답·실패는 입고0이 아닙니다.</p>
  {state.kind==='observed'&&<><table><caption>입고 원천 행 · 배분·합계 보류</caption><thead><tr>{['상품','차수','색상','사이즈','창고','입고일','원천 수량 표현'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{state.rows.map((r,i)=><tr key={i}><td>{r.style}</td><td>{r.lot??'미확인'}</td><td>{r.color??'미확인'}</td><td>{r.size??'미확인'}</td><td>{r.warehouse??'미확인'}</td><td>{r.date}</td><td>{r.quantityText??'원천 NULL · 미확인'}</td></tr>)}</tbody></table><p>표시 투영키 중복 {state.duplicateProjectionKeys}행 · 실제 입고 전표 고유키는 별도 확인 필요</p></>}
 </section>;
}
