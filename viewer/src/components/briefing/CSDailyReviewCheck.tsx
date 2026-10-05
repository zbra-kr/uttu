'use client';
import Link from 'next/link';
import type { CSDailyReviewState } from '@/hooks/useCSDailyReviewCheck';
import { currentCSProductHref } from '@/lib/cs-daily-review-check';

export default function CSDailyReviewCheck({ state }: { state: CSDailyReviewState }) {
  if (state.status === 'inactive') return null;
  const result = state.result;
  return (
    <section aria-label="CS 저장 리뷰 확인" style={{ border: '1px solid var(--bd)', borderRadius: 10, padding: 14, minWidth: 0, color: 'var(--f2)' }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 14, color: 'var(--f1)' }}>확인할 저평점 리뷰</h2>
      <p style={{ margin: '0 0 6px', fontSize: 12, lineHeight: 1.6 }}>
        브리핑 기준일 {state.briefingDate} · 저장된 리뷰 작성일 {state.reviewDate ?? '확인 필요'} · 1–2점
      </p>
      <p style={{ margin: '0 0 12px', fontSize: 11, lineHeight: 1.6 }}>
        현재 자사로 분류되고 상품이 연결된 리뷰를 조회합니다. 작성일은 수집일이 아니며, 수집 완료 여부·최신성은 확인하지 않았습니다. 전체 고객 불만이나 처리된 상담·제품 결함을 뜻하지 않습니다.
      </p>
      {state.status === 'invalid-date' ? <p role="status">유효한 현재 또는 과거 브리핑 날짜를 선택하세요.</p>
        : state.status === 'signed-out' ? <p role="status">로그인 후 저장 리뷰를 확인할 수 있습니다.</p>
        : state.status === 'loading' ? <p role="status" aria-live="polite">저장 리뷰를 확인하는 중…</p>
        : state.status === 'error' ? <div role="alert"><p>저장 리뷰 또는 정확한 건수를 확인하지 못했습니다.</p><button type="button" onClick={state.retry} style={{ padding: '10px 14px', minHeight: 44, border: '1px solid var(--bd)', borderRadius: 8, background: 'var(--sur)', color: 'var(--f1)', cursor: 'pointer' }}>다시 확인</button></div>
        : result ? <>
          <p role="status" aria-live="polite" style={{ fontSize: 12, margin: '0 0 10px' }}>
            조회 권한 내 조건에 맞는 저장 리뷰 {result.total.toLocaleString()}건 중 {result.rows.length}건 표시 · 최대 20건
            {result.total > 20 ? ' · 일부만 표시하며 전체 검토를 뜻하지 않습니다.' : ''}
          </p>
          {result.excluded > 0 && <p role="status" style={{ fontSize: 12 }}>조회된 행 중 {result.excluded}건은 날짜·별점·리뷰 식별을 확인하지 못해 제외했습니다.</p>}
          {result.total === 0 ? <p>이 작성일·조건에 맞는 저장 리뷰가 없습니다. 수집 완료나 고객 문제 없음이 확인된 것은 아닙니다.</p>
            : result.rows.length === 0 ? <p>표시할 수 있는 원자료가 없습니다. 조회된 행의 확인이 필요합니다.</p> :
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
                {result.rows.map(row => {
                  const href = currentCSProductHref(row);
                  return <li key={row.id} style={{ background: 'var(--snk)', borderRadius: 8, padding: 12, minWidth: 0, overflowWrap: 'anywhere', fontSize: 12 }}>
                    <strong>{typeof row.product_name === 'string' ? row.product_name : '상품명 확인 필요'}</strong>
                    <p style={{ margin: '5px 0', lineHeight: 1.5 }}>{typeof row.brand_name === 'string' ? row.brand_name : '브랜드 확인 필요'} · {row.rating}점 · 작성일 {row.review_date}</p>
                    <details><summary style={{ cursor: 'pointer', padding: '12px 0', minHeight: 44 }}>리뷰 원문 펼치기</summary><p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{row.review_text?.trim() ? row.review_text : '저장된 원문이 없습니다.'}</p></details>
                    {href ? <Link href={href} style={{ color: 'var(--hs)', display: 'inline-block', padding: '12px 0', minHeight: 44 }}>현재 상품 상세 보기</Link>
                      : <p>상품 식별을 확인하지 못해 상세 링크를 제공하지 않습니다.</p>}
                  </li>;
                })}
              </ul>}
        </> : null}
    </section>
  );
}
