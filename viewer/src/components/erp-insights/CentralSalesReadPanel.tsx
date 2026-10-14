import type { ReactNode } from 'react';
import { CENTRAL_READ_REASONS,type CentralState } from '@/lib/erp/central-sales-read';
import { ERP_BRANDS } from '@/lib/erp-insight-workspace';
import { CENTRAL_AMOUNT_REASONS, centralSourceResponseText } from '@/lib/erp/central-sales-display';
export default function CentralSalesReadPanel({state,receiptStyles,children}:{state:CentralState;receiptStyles?:string;children?:ReactNode}){
  return <section aria-label="중앙 매출 서버 조회" data-central-state={state.kind}>
    <h2>매출 현황 · 브랜드·기간</h2>
    <form method="get">{receiptStyles&&<input type="hidden" name="receiptStyles" value={receiptStyles}/>}<label>브랜드<select name="brand" defaultValue={state.scope?.brand??''}><option value="">선택</option>{ERP_BRANDS.map(b=><option key={b} value={b}>{b}</option>)}</select></label>
      <label>시작일<input type="date" name="from" defaultValue={state.scope?.from??''}/></label><label>종료일<input type="date" name="to" defaultValue={state.scope?.to??''}/></label><label><input type="checkbox" name="aggregate" value="daily" defaultChecked={state.scope?.aggregate==='daily'||state.kind==='request'||state.reasons.includes('LIMIT_REACHED')}/>일별 합계 조회 (상품 상세 제외)</label><button type="submit">현황 조회</button></form>
    {children}
    <p role="status">{state.reasons.map(r=>CENTRAL_READ_REASONS[r]).join(' · ')}</p>
    <details className="my-3"><summary>연결·응답 진단</summary>
    {state.kind==='unconnected'&&state.configurationDiagnostics&&<aside aria-label="본인 관리자 서버 구성 진단"><p>서버 구성 검증 코드 · 값·원본 오류·키 지문은 표시하지 않습니다.</p><ul>{state.configurationDiagnostics.map((check,i)=><li key={i}><code>{check.field}</code>: <code>{check.code}</code></li>)}</ul></aside>}
    {state.transportDiagnostics&&<aside aria-label="본인 관리자 ERP 응답 진단"><p>원천 행·SQL·토큰 없이 응답 완결성만 표시합니다.</p><dl>{Object.entries(state.transportDiagnostics).map(([field,value])=><div key={field}><dt><code>{field}</code></dt><dd><code>{value===null?'미확인':String(value)}</code></dd></div>)}</dl></aside>}
    </details>
    <p>단일 브랜드·최대31일. 일별 합계는 최대31개 날짜, 상품별 상세는 최대200그룹입니다. 중앙 매출에 없는 옵션·시즌 연도를 만들지 않습니다. 거래일은 ETL 갱신 시각이 아닙니다.</p>
    {state.scope&&<p>요청 범위: {state.scope.brand} · {state.scope.from} ~ {state.scope.to}</p>}
    {state.kind==='summary'&&state.dailySummary&&<>
      <p>선택 범위의 서버 일별 합계 · 상품별 상세 목록은 별도 조회입니다. 매장 B6055·B6057·B6063 제외 · 부가세 제외 · FLOAT 근사값 · 백만원 단위</p>
      <details><summary>매출 금액·누락 처리 기준</summary>      <p>원천 관측이 없는 날짜는 매출0으로 채우지 않습니다. 조회 시점의 원천 집계이며 ETL 갱신 완료나 회계 확정 금액을 뜻하지 않습니다. 원천 행 수는 판매·주문 건수가 아닙니다. NULL 누락이 있으면 전체 금액을 보류하며 원문은 금액이 있는 행의 SUM입니다. 문자열은 응답 숫자 표현을 유지하고, Number 응답은 이미 숫자로 해석된 표현입니다. FLOAT 원천 정밀도는 복원되지 않습니다.</p>
</details>
      <table><caption>선택 범위의 브랜드·일자 매출 합계 · 상품 목록 아님</caption><thead><tr><th scope="col">브랜드</th><th scope="col">거래일</th><th scope="col">매출 근사값 (백만원)</th><th scope="col">응답 집계 원문 (반올림 전·원단위 확정 아님)</th><th scope="col">원천 행 / 금액 NULL 행</th><th scope="col">금액 상태</th></tr></thead>
        <tbody>{state.dailySummary.rows.map(row=><tr key={row.saleDate}><td>{row.brand}</td><td>{row.saleDate}</td><td>{row.amount.millionsText===null?'—':`≈ ${row.amount.millionsText}`}</td><td><code>{centralSourceResponseText(row.amount)??'—'}</code></td><td>{row.audit.sourceRows} / {row.audit.nullAmountRows}</td><td>{CENTRAL_AMOUNT_REASONS[row.amount.reason]}</td></tr>)}</tbody>
        <tfoot><tr><th scope="row" colSpan={2}>선택 범위 일별 합계 근사값</th><td>{state.dailySummary.total.millionsText===null?'—':`≈ ${state.dailySummary.total.millionsText}`}</td><td colSpan={3}>{CENTRAL_AMOUNT_REASONS[state.dailySummary.total.reason]}</td></tr></tfoot>
      </table>
    </>}
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
    </> : state.kind==='summary'?null:<p>표시 매출: 미확인 · 조회 상태와 사유를 확인해 주세요.</p>}
  </section>;
}
