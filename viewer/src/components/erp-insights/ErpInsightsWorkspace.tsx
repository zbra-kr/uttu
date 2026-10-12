'use client';

import { useRef, useState } from 'react';
import { FilterBlock, SegGroup } from '@/components/ui/filters';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';
import BriefingEvidenceNote from '@/components/briefing/BriefingEvidenceNote';
import { ERP_VIEWS, ERP_VIEW_IDS, INITIAL_ERP_REQUEST, UNCONNECTED_ERP_STATE, resolveErpWorkspace, requestReason, type ErpViewId, type ErpRequest, type ErpReadState } from '@/lib/erp-insight-workspace';
import styles from './erp-insights.module.css';

export default function ErpInsightsWorkspace({ initialView = 'planning', source = UNCONNECTED_ERP_STATE }: { initialView?: ErpViewId; source?: ErpReadState }) {
  const [view, setView] = useState<ErpViewId>(() => ERP_VIEW_IDS.includes(initialView) ? initialView : 'planning');
  const [request, setRequest] = useState<ErpRequest>(INITIAL_ERP_REQUEST);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const model = resolveErpWorkspace(source, request);
  const spec = ERP_VIEWS[view];
  const invalid = requestReason(request) === 'REQUEST_INVALID';
  const update = <K extends keyof ErpRequest>(key: K, value: ErpRequest[K]) => setRequest(previous => ({ ...previous, [key]: value }));
  return <main className={styles.workspace} data-erp-workspace data-state={model.kind}>
    <header className={styles.header}>
      <div className="page-title"><h1>ERP × 시장 인사이트</h1></div>
      <span className="chip subtle">검토용 페이지 · 연결 미완료</span>
      <p>포털의 현업 기준을 유지하고, UTTU의 외부 관측을 확인 근거로 연결합니다.</p>
    </header>
    <div className={`tabs ${styles.tabs}`} role="tablist" aria-label="ERP 시장 인사이트 화면">
      {ERP_VIEW_IDS.map((id, index) => <button key={id} type="button" role="tab" id={`erp-tab-${id}`} aria-controls={`erp-panel-${id}`} aria-selected={view === id} tabIndex={view === id ? 0 : -1}
        ref={element => { tabs.current[index] = element; }} className={`tab ${view === id ? 'active' : ''}`} onClick={() => setView(id)}
        onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % ERP_VIEW_IDS.length : event.key === 'ArrowLeft' ? (index + ERP_VIEW_IDS.length - 1) % ERP_VIEW_IDS.length : event.key === 'Home' ? 0 : event.key === 'End' ? ERP_VIEW_IDS.length - 1 : null;
          if (next !== null) { event.preventDefault(); setView(ERP_VIEW_IDS[next]); tabs.current[next]?.focus(); }
        }}>{ERP_VIEWS[id].label}</button>)}
    </div>
    <section className={styles.filters} aria-label="현업 조회 조건">
      <FilterBlock label="브랜드" hint="성인·키즈 별도">
        <div role="group" aria-label={`브랜드 필터 · 선택 ${request.brand === 'all' ? '전체' : request.brand}`}><SegGroup value={request.brand} onChange={value => update('brand', value as ErpRequest['brand'])} options={[[ 'all', '전체' ], ['CO', '커버낫'], ['LE', '리'], ['WA', '와키윌리'], ['CK', '커버낫 키즈'], ['LK', '리 키즈']]} /></div>
      </FilterBlock>
      <div className={styles.dates}>
        <label>시작일<input type="date" className="input-date" value={request.from} onChange={event => update('from', event.target.value)} aria-describedby="erp-request-note" aria-invalid={invalid} /></label>
        <label>종료일<input type="date" className="input-date" value={request.to} onChange={event => update('to', event.target.value)} aria-describedby="erp-request-note" aria-invalid={invalid} /></label>
        <label>시즌 연도<input type="text" inputMode="numeric" pattern="20[0-9]{2}" maxLength={4} placeholder="시즌 연도 선택" value={request.year} onChange={event => update('year', event.target.value)} aria-describedby="erp-request-note" aria-invalid={invalid} /></label>
      </div>
      <FilterBlock label="시즌" hint="스탠다드 양쪽 포함"><div role="group" aria-label={`시즌 필터 · 선택 ${request.season}`}><SegGroup value={request.season} onChange={value => update('season', value as ErpRequest['season'])} options={[['SS', 'S/S'], ['FW', 'F/W']]} /></div></FilterBlock>
      <p id="erp-request-note" className={styles.note}>조건 변경은 화면 선택만 바꿉니다. ERP·외부 데이터 조회는 아직 연결되지 않았습니다. 날짜와 시즌 연도는 별도 기준입니다.</p>
    </section>
    <section role="tabpanel" id={`erp-panel-${view}`} aria-labelledby={`erp-tab-${view}`}>
      <div className="sec-head"><h2 className={styles.title}>{spec.title}</h2></div><p className={styles.description}>{spec.description}</p>
      <aside className={`cell ${styles.status}`} role="status" aria-live="polite" aria-atomic="true">
        <strong>{model.title}</strong><span>미확인은 0·품절·목표 미달·만족으로 해석하지 않습니다. 실제 ERP·무신사 조회 결과가 아닙니다.</span>
        <ul>{model.codes.map(code => <li key={code}><span className="mono">{code}</span> · {model.messages[model.codes.indexOf(code)]}</li>)}</ul>
      </aside>
      <div className={styles.metrics} aria-label={`${spec.title} 핵심 지표`}>
        {spec.metrics.map(label => <div className="kpi" key={label}><span className="label">{label}</span><strong className="val">미확인</strong><span className="dlt muted">연결·산식 검증 후 표시</span></div>)}
      </div>
      <section className={`cell ${styles.question}`} aria-label="현업 확인 질문"><h3>확인할 질문</h3><p>{spec.question}</p><span className="muted">근거가 연결되기 전에는 대상 건수·추천·방향 신호를 생성하지 않습니다.</span></section>
      <div className={`tbl ${styles.scroll}`} role="region" aria-label={`${spec.title} 상세 표`} tabIndex={0}>
        <table className={styles.table}><caption>{spec.title} · 검증된 자료 연결 후 상품별 현황 표시</caption><thead><tr>{spec.columns.map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody><tr><td colSpan={spec.columns.length}><MobileEmptyState icon="◌" title={model.title} description="데이터 없음과 연결 실패를 구분합니다. 연결 전 가상 상품 행이나 합성 숫자를 표시하지 않습니다." /></td></tr></tbody></table>
      </div>
      <aside className={`cell ${styles.basis}`} aria-label="계산·연결 기준"><h3>계산·연결 기준</h3><p>{spec.basis}</p><p>CO / LE / WA / CK / LK와 BRANDCD + STYLECD를 구분합니다. 기간·VAT·키·표본·갱신·전체 응답 검증 전 판단을 보류합니다.</p><p>compatible은 선언 계약의 일치일 뿐 실제 ERP 검증을 의미하지 않습니다. 합성 fixture는 개발·테스트 경로에서만 다룹니다.</p><BriefingEvidenceNote audience="staff" /></aside>
    </section>
  </main>;
}
