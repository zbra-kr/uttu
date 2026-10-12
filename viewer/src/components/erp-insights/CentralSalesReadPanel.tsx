import { CENTRAL_READ_REASONS,type CentralState } from '@/lib/erp/central-sales-read';
import { ERP_BRANDS } from '@/lib/erp-insight-workspace';
import { CENTRAL_AMOUNT_REASONS } from '@/lib/erp/central-sales-display';
export default function CentralSalesReadPanel({state}:{state:CentralState}){
  return <section aria-label="중앙 매출 서버 조회" data-central-state={state.kind}>
    <h2>중앙 매출 · 브랜드·상품·일자</h2>
    <form method="get"><label>브랜드<select name="brand" defaultValue={state.scope?.brand??''}><option value="">선택</option>{ERP_BRANDS.map(b=><option key={b} value={b}>{b}</option>)}</select></label>
      <label>시작일<input type="date" name="from" defaultValue={state.scope?.from??''}/></label><label>종료일<input type="date" name="to" defaultValue={state.scope?.to??''}/></label><button type="submit">서버 조회 상태 확인</button></form>
    <p role="status">{state.reasons.map(r=>CENTRAL_READ_REASONS[r]).join(' · ')}</p>
    <p>단일 브랜드·최대31일·최대200그룹. 중앙 매출에 없는 옵션·시즌 연도를 만들지 않습니다. 거래일은 ETL 갱신 시각이 아닙니다.</p>
    {state.scope&&<p>요청 범위: {state.scope.brand} · {state.scope.from} ~ {state.scope.to}</p>}
    {state.kind==='observed' ? <>
      <p>부가세 제외 · EIS 표시 단위: 백만원 · 소수 1자리 · FLOAT 근사값</p>
      <p>원천 집계 부호를 유지합니다. 반품별 금액·환산 통화·원단위 대사는 미확인입니다.</p>
      <div className="overflow-x-auto"><table>
        <caption>선택 범위의 중앙 매출 관측 · 정확한 회계 금액 아님</caption>
        <thead><tr><th scope="col">브랜드</th><th scope="col">상품 코드</th><th scope="col">거래일</th><th scope="col">매출 근사값 (백만원)</th><th scope="col">금액 상태</th></tr></thead>
        <tbody>{state.rows.map(row=><tr key={JSON.stringify([row.brand,row.styleId,row.saleDate])}>
          <td>{row.brand}</td><td>{row.styleId}</td><td>{row.saleDate}</td>
          <td>{row.amount.millionsText===null?'—':`≈ ${row.amount.millionsText}`}</td><td>{CENTRAL_AMOUNT_REASONS[row.amount.reason]}</td>
        </tr>)}</tbody>
        <tfoot><tr><th scope="row" colSpan={3}>선택 범위 합계 근사값</th><td>{state.total?.millionsText==null?'—':`≈ ${state.total.millionsText}`}</td><td>{state.total ? CENTRAL_AMOUNT_REASONS[state.total.reason] : '합계 미확인'}</td></tr></tfoot>
      </table></div>
      <p>합계는 표시 반올림 전 Number 값의 합산 손실을 줄여 계산합니다. FLOAT·Number의 정밀도 한계는 유지되며, 문자열 응답도 정밀도가 복원된 금액이 아닙니다.</p>
    </> : <p>표시 매출: 미확인 · 조회 상태와 사유를 확인해 주세요.</p>}
  </section>;
}
