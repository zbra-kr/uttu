'use client';
import React, { useState } from 'react';
import { DISCOVERY_CATEGORY_OPTIONS, DISCOVERY_GENDER_OPTIONS, DISCOVERY_AGE_OPTIONS,
  initialDiscoveryScope, discoveryScopeKey, discoveryScopeProblem, discoveryLabel, discoveryEvidenceHref,
  type DiscoveryProduct } from '@/lib/ranking-discovery-client';
import type { DiscoveryScope } from '@/lib/ranking-discovery';
import { useRankingEvidence } from '@/lib/use-ranking-evidence';
import { useRankingDiscovery } from '@/lib/use-ranking-discovery';
import styles from './discovery.module.css';

function Axis({ title, options, selected, onChange }: { title: string; options: readonly (readonly [string, string])[];
  selected: string[]; onChange: (values: string[]) => void }) {
  return <fieldset className={styles.axis}>
    <legend>{title} · {selected.length}개 선택</legend>
    <div className={styles.actions}>
      <button type="button" className="btn sm" onClick={() => onChange(options.map(o => o[0]))}>모든 {title} 선택</button>
      <button type="button" className="btn sm" onClick={() => onChange([])}>선택 해제</button>
    </div>
    <div className={styles.options}>{options.map(([code, label]) => <label key={code}>
      <input type="checkbox" checked={selected.includes(code)} onChange={() => onChange(selected.includes(code)
        ? selected.filter(v => v !== code) : [...selected, code])} />{label}
    </label>)}</div>
  </fieldset>;
}
function ProductEvidence({ product, scope, owner, onRestart }: { product: DiscoveryProduct; scope:DiscoveryScope; owner:string|null|undefined; onRestart:()=>void }) {
  const read=useRankingEvidence(product,scope,owner);
  return <div className={styles.evidence}>
    <p>각 순위는 해당 날짜·조합 안의 순위입니다. 수집 완전성은 미확인이며 전일 변화는 이 화면에서 조회하지 않습니다.</p>
    {read.status==='loading'?<p role="status">선택 상품의 조합별 근거를 조회하고 있습니다…</p>:null}
    {read.status==='error'?<div role="alert"><p>{messages[read.error??'']??'근거 조회가 연결되지 않았습니다. 다시 시도해 주세요.'}</p>
      {read.error==='stale-cursor'?<button className="btn sm" type="button" onClick={onRestart}>상품 목록부터 다시 조회</button>:<button className="btn sm" type="button" onClick={read.retry}>근거 다시 시도</button>}</div>:null}
    {read.data?<>
      <p>현재 근거 {read.data.evidence.length}건 / 저장 관측 {read.data.totalObservations.toLocaleString()}건 · {read.index+1}페이지</p>
      {!read.data.evidence.length?<p role="status">이 범위에서 저장된 근거를 찾지 못했습니다. 수집 상태는 미확인입니다.</p>:null}
      <div className={styles.tableScroll} tabIndex={0} aria-label="날짜와 조합별 순위 근거">
        <table><thead><tr><th>관측일</th><th>카테고리</th><th>성별</th><th>연령</th><th>순위</th><th>근거 보기</th></tr></thead>
          <tbody>{read.data.evidence.map(e=><tr key={e.id}>
            <td>{e.date}</td><td>{discoveryLabel(DISCOVERY_CATEGORY_OPTIONS,e.category)}</td><td>{discoveryLabel(DISCOVERY_GENDER_OPTIONS,e.gender)}</td><td>{discoveryLabel(DISCOVERY_AGE_OPTIONS,e.age)}</td>
            <td>{e.rank}위</td><td><a href={discoveryEvidenceHref(e)}>이 조합 랭킹</a></td>
          </tr>)}</tbody></table>
      </div>
      <nav className={styles.pagination} aria-label="근거 페이지"><button type="button" className="btn sm" disabled={!read.index} onClick={read.previous}>이전 근거 페이지</button>
        <button type="button" className="btn sm" disabled={!read.data.hasMore} onClick={read.next}>다음 근거 페이지</button></nav>
    </>:null}
  </div>;
}
const messages: Record<string, string> = {
  'stale-cursor':'페이지를 조회하는 동안 관측 범위가 변경되었습니다. 상품 목록부터 다시 조회해 주세요.',
  'aggregate-query-timeout':'랭킹 집계 조회 시간이 초과되었습니다. 기간이나 조합을 좁혀 다시 시도해 주세요.',
  'aggregate-function-unavailable':'랭킹 집계 조회가 아직 연결되지 않았습니다. 관리자에게 연결 상태를 확인해 주세요.',
  'aggregate-permission-denied':'랭킹 집계 조회 권한이 확인되지 않았습니다. 관리자에게 접근 권한을 확인해 주세요.',
  'aggregate-unconnected':'랭킹 집계 조회가 연결되지 않았거나 응답하지 않습니다. 관리자에게 연결 상태를 확인해 주세요.',
  'authentication-required':'로그인이 필요합니다. 로그인 후 다시 조회해 주세요.',
  'invalid-request':'조회 날짜와 선택 조건을 확인해 주세요.',
  'invalid-receipt':'완전한 집계 응답을 확인할 수 없어 결과를 표시하지 않습니다. 다시 시도해 주세요.',
};

export default function RankingDiscoveryPage() {
  const [draft, setDraft] = useState(() => initialDiscoveryScope(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())));
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const read = useRankingDiscovery();
  const problem = discoveryScopeProblem(draft);
  const combinations = draft.categories.length * draft.genders.length * draft.ages.length;
  const dirty = !!read.appliedScope && discoveryScopeKey(draft) !== discoveryScopeKey(read.appliedScope);
  const setAxis = (key: 'categories' | 'genders' | 'ages', values: string[]) => setDraft(p => ({ ...p, [key]: values }));
  const apply = (event: React.FormEvent) => { event.preventDefault(); if (problem) return; setExpanded(new Set()); read.apply(draft); };
  const changePage = (next: boolean) => { setExpanded(new Set()); if (next) read.next(); else read.previous(); };
  const result = read.data;
  return <section className={styles.page} aria-label="전체 조합 상품 탐색">
    <div className={styles.heading}><div><h1>전체 조합 상품 탐색</h1>
      <p>상품을 한 번에 찾고, 등장한 날짜와 조합별 순위를 확인하세요.</p></div>
      <a className="btn sm" href="/ranking">단일 조합 랭킹 · 저장 필터</a></div>
    <form className={styles.filters} onSubmit={apply}>
      <fieldset className={styles.mode}><legend>상품 범위</legend>
        <label><input type="radio" name="product-scope" checked={draft.ownOnly} onChange={() => setDraft(p => ({ ...p, ownOnly: true }))} />자사 상품</label>
        <label><input type="radio" name="product-scope" checked={!draft.ownOnly} onChange={() => setDraft(p => ({ ...p, ownOnly: false }))} />전체 상품</label>
      </fieldset>
      <div className={styles.dates}><label>시작일 (KST)<input type="date" value={draft.fromDate} onChange={e => setDraft(p => ({ ...p, fromDate: e.target.value }))} /></label>
        <label>종료일 (KST)<input type="date" value={draft.toDate} onChange={e => setDraft(p => ({ ...p, toDate: e.target.value }))} /></label>
        <span>최대 31일 · 일별 관측</span></div>
      <details className={styles.selection}><summary>조합 선택 · {combinations}개 조합</summary>
        <p>‘전체 구간’은 하나의 모집단입니다. ‘모든 구간 선택’은 여러 모집단을 함께 탐색합니다.</p>
        <div className={styles.axes}>
          <Axis title="카테고리" options={DISCOVERY_CATEGORY_OPTIONS} selected={draft.categories} onChange={v => setAxis('categories', v)} />
          <Axis title="성별" options={DISCOVERY_GENDER_OPTIONS} selected={draft.genders} onChange={v => setAxis('genders', v)} />
          <Axis title="연령" options={DISCOVERY_AGE_OPTIONS} selected={draft.ages} onChange={v => setAxis('ages', v)} />
        </div>
      </details>
      {problem ? <p role="alert" className={styles.notice}>{problem}</p> : null}
      <div className={styles.actions}><button className="btn" type="submit" disabled={!!problem || read.auth === undefined || read.auth === null}>
        {combinations}개 조합 조회</button>
        {dirty ? <span>조건을 변경했습니다. 조회 버튼을 눌러 적용하세요.</span> : null}</div>
    </form>
    {read.auth === undefined ? <p role="status">로그인 상태를 확인하고 있습니다…</p> : null}
    {read.auth === null || read.error === 'authentication-required' ? <p role="alert">로그인 후 상품을 조회할 수 있습니다. <a href="/login">로그인</a></p> : null}
    {read.status === 'idle' && read.auth ? <p role="status" className={styles.notice}>날짜와 상품 범위를 정한 뒤 조회 버튼을 눌러 주세요. 기본 선택은 자사 상품·273개 조합입니다.</p> : null}
    {read.status === 'loading' ? <p role="status" aria-live="polite" className={styles.notice}>선택한 기간의 상품과 조합별 근거를 조회하고 있습니다…</p> : null}
    {read.status === 'error' && read.error !== 'authentication-required' ? <div role="alert" className={styles.notice}>
      <p>{messages[read.error ?? ''] ?? '상품을 불러오지 못했습니다. 다시 시도해 주세요.'}</p>
      {read.error === 'stale-cursor' ? <button type="button" className="btn sm" onClick={() => { setExpanded(new Set()); read.restart(); }}>처음부터 다시 조회</button>
        : <button type="button" className="btn sm" onClick={read.retry}>다시 시도</button>}
    </div> : null}
    {result ? <section aria-label="상품 탐색 결과" aria-live="polite">
      <div className={styles.resultHeading}><h2>{result.totalProducts.toLocaleString()}개 상품</h2>
        <span>{result.scope.ownOnly ? '자사 상품' : '전체 상품'} · {result.scope.fromDate} ~ {result.scope.toDate} · {result.scope.categories.length * result.scope.genders.length * result.scope.ages.length}개 조합</span></div>
      <p className={styles.notice}>저장 관측 {result.matchingObservations.toLocaleString()}건 · 상품별 중복 제거 · 현재 자사 매핑 기준<br />
        수집 완전성 미확인 · 관측되지 않은 조합은 미수집·수집 실패·0건을 구분할 수 없습니다. 페이지 사이 자료가 갱신될 수 있습니다.</p>
      {!result.products.length ? <p role="status">선택한 기간·조합에서 조건에 맞는 저장 관측을 찾지 못했습니다. 자사 상품이 다른 날짜나 조합에도 없다는 뜻은 아닙니다.</p> : null}
      <div className={styles.products}>{result.products.map(product => {
        const open = expanded.has(product.productId), panelId = `evidence-${product.productId}`;
        return <article key={product.productId} className={styles.product}>
          <div className={styles.productHeading}><div><h3>{product.name ?? `상품 ${product.musinsaNo}`}</h3>
            <p>{product.brand ?? '브랜드 미확인'} · 상품 번호 {product.musinsaNo} · {product.own ? '자사' : '현재 자사 매핑 아님'}</p></div>
            <button type="button" className="btn sm" aria-expanded={open} aria-controls={panelId} onClick={() => setExpanded(previous => {
              const next = new Set(previous); if (next.has(product.productId)) next.delete(product.productId); else { next.clear(); next.add(product.productId); } return next;
            })}>{open ? '근거 접기' : '조합별 근거 펼치기'}</button></div>
          <div className={styles.metrics}><span>등장 조합 {product.observedCohorts}개</span><span>관측일 {product.observedDays}일</span>
            <span>관측 {product.observationCount}건</span><span>마지막 관측 {product.latestObservedDate}</span></div>
          {open ? <div id={panelId}><ProductEvidence product={product} scope={result.scope} owner={read.auth} onRestart={() => { setExpanded(new Set()); read.restart(); }} /></div> : null}
        </article>;
      })}</div>
      <nav aria-label="상품 페이지" className={styles.pagination}><button type="button" className="btn sm" disabled={!read.pageIndex || dirty} onClick={() => changePage(false)}>이전 상품 페이지</button>
        <span>{read.pageIndex + 1}페이지 · 현재 {result.products.length}개 상품</span>
        <button type="button" className="btn sm" disabled={!result.hasMore || dirty} onClick={() => changePage(true)}>다음 상품 페이지</button></nav>
    </section> : null}
  </section>;
}
