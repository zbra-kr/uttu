'use client';
import { useRef, type ReactNode } from 'react';
import type { ProductDetail } from '@/lib/queries';
import { parseProductObservation } from '@/lib/product-observation-context';
import { useObservationReviewState } from '@/lib/observation-review-context';

/** One existing review section: recent content or explicitly activated dated content. */
export default function ProductReviewMode({ query, detail, children }: { query: string; detail: ProductDetail; children: ReactNode }) {
  const state = useObservationReviewState(), region = useRef<HTMLElement>(null);
  const parsed = parseProductObservation(new URLSearchParams(query));
  const matching = state?.query === query;
  const available = matching && state.available && parsed.kind === 'valid'
    && String(detail.musinsa_no) === parsed.value.product;
  const active = matching && state.active;
  const transferFocus = (button: HTMLButtonElement) => { if (document.activeElement === button) region.current?.focus(); };
  return <section ref={region} tabIndex={-1} className="panel" aria-label="상품 저장 리뷰" aria-busy={active && state.status === 'loading'} style={{ padding: 14, minWidth: 0 }}>
    {(active || available) && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
      {active ? <button type="button" className="btn" style={{ minHeight: 44 }} onClick={event => { transferFocus(event.currentTarget); state.recent(); }}>최근 리뷰로 돌아가기</button>
        : <button type="button" className="btn" style={{ minHeight: 44 }} onClick={event => { transferFocus(event.currentTarget); state.activate(); }}>관측일 1–2점 저장 리뷰 확인</button>}
    </div>}
    {!active ? children : <>
      <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>관측일의 저평점 저장 리뷰</h3>
      <p style={{ fontSize: 12, lineHeight: 1.6 }}>리뷰 작성일 {state.date} · 1–2점 · 이 상품에 연결된 저장 리뷰입니다. 작성일은 수집일이 아니며, 수집 완료·최신성은 확인하지 않았습니다. 관측 날짜가 같아도 리뷰가 순위 변화의 원인임을 뜻하지 않습니다.</p>
      {state.status === 'loading' ? <p role="status" aria-live="polite">저장 리뷰를 확인하는 중…</p>
        : state.status === 'signed-out' ? <p role="status">로그인 후 저장 리뷰를 확인할 수 있습니다.</p>
        : state.status === 'unavailable' ? <p role="status">이 상품의 저장 리뷰 연결을 확인하지 못했습니다.</p>
        : state.status === 'error' ? <div role="alert"><p>저장 리뷰 또는 정확한 건수를 확인하지 못했습니다.</p><button type="button" className="btn" style={{ minHeight: 44 }} onClick={event => { transferFocus(event.currentTarget); state.retry(); }}>다시 확인</button></div>
        : state.result ? <>
          <p role="status" aria-live="polite">조건에 맞는 저장 리뷰 {state.result.total.toLocaleString()}건 중 {state.result.rows.length}건 표시 · 최대 20건{state.result.total > 20 ? ' · 일부만 표시하며 전체 검토를 뜻하지 않습니다.' : ''}</p>
          {state.result.excluded > 0 && <p role="status">조회된 행 중 {state.result.excluded}건은 날짜·별점·상품 또는 리뷰 식별을 확인하지 못해 제외했습니다.</p>}
          {state.result.total === 0 ? <p>이 작성일·상품의 1–2점 저장 리뷰가 없습니다. 수집 완료나 고객 문제 없음이 확인된 것은 아닙니다.</p>
            : state.result.rows.length === 0 ? <p>표시할 수 있는 원자료가 없습니다. 조회된 행의 확인이 필요합니다.</p>
            : <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
              {state.result.rows.map(row => <li key={row.id} style={{ padding: 12, background: 'var(--snk)', borderRadius: 8, overflowWrap: 'anywhere' }}>
                <p>{row.rating}점 · 작성일 {row.review_date}</p><details><summary style={{ minHeight: 44, padding: '12px 0', cursor: 'pointer' }}>리뷰 원문 펼치기</summary><p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{row.review_text?.trim() ? row.review_text : '저장된 원문이 없습니다.'}</p></details>
              </li>)}
            </ul>}
        </> : null}
    </>}
  </section>;
}
