'use client';
import React from 'react';
import Link from 'next/link';
import { parseProductObservation } from '@/lib/product-observation-context';
import { fetchProductObservation, type ObservedProductResult } from '@/lib/queries-product-observation';

const number = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });

export default function ProductObservationPanel({ query }: { query: string }) {
  const parsed = React.useMemo(() => parseProductObservation(new URLSearchParams(query)), [query]);
  const value = parsed.kind === 'valid' ? parsed.value : null;
  const key = value ? JSON.stringify(value) : '';
  const [loaded, setLoaded] = React.useState<{ key: string; result: ObservedProductResult } | null>(null);
  const [retry, setRetry] = React.useState(0);

  React.useEffect(() => {
    if (!value) return;
    const controller = new AbortController();
    setLoaded(null);
    fetchProductObservation(value, controller.signal).then(result => {
      if (!controller.signal.aborted) setLoaded({ key, result });
    });
    return () => controller.abort();
  }, [key, retry, value]);

  if (parsed.kind === 'none') return null;
  const result = loaded?.key === key ? loaded.result : null;
  return <section className="panel" aria-label="지정 상품 관측" style={{ padding: 16, marginBottom: 14 }}>
    <div className="sec-head" style={{ flexWrap: 'wrap', gap: 8, padding: 0, marginBottom: 8 }}>
      <h2 style={{ margin: 0, fontSize: 15 }}>지정 상품 관측</h2>
      {value?.back && <Link className="btn sm" href={value.back}>원 관측·메모로 돌아가기</Link>}
    </div>
    {value && <p className="mono dim" style={{ fontSize: 11, margin: '0 0 8px' }}>
      {value.date} · {value.store} · 상품 #{value.product} · {value.category} / {value.gender} / {value.age}
    </p>}
    {parsed.kind === 'invalid' ? <p role="alert">관측 주소가 유효하지 않습니다. 날짜·상품·조회 조건을 확인하세요.</p>
      : !result ? <p role="status">지정 날짜의 상품 관측을 조회하는 중…</p>
      : result.status === 'ready' ? <div style={{ fontSize: 12, lineHeight: 1.7 }}>
        <strong>{result.row.name}</strong>{result.row.brand ? ` · ${result.row.brand}` : ''}
        <div>당시 순위 #{result.row.rank} · 표시 가격 {result.row.price === null ? '미확인' : `${number.format(result.row.price)}원`}
          {' '}· 표시 할인율 {result.row.discount === null ? '미확인' : `${number.format(result.row.discount)}%`}</div>
        <div className="dim">자사 상품 여부: {result.row.own === null ? '미확인' : result.row.own ? '확인됨' : '자사 아님'}</div>
      </div>
      : <div role={result.status === 'error' ? 'alert' : 'status'} style={{ fontSize: 12 }}>
        {result.status === 'missing' ? '이 날짜·조건의 상품 관측행이 없습니다.'
          : result.status === 'ambiguous' ? '같은 조건의 관측행이 2개여서 하나를 선택할 수 없습니다.'
          : result.status === 'capped' ? '같은 조건의 관측행이 3개 이상입니다. 조회 상한에 닿아 하나를 선택할 수 없습니다.'
          : '지정 상품 관측 조회에 실패했습니다.'}
        {result.status === 'error' && <button type="button" className="btn sm" onClick={() => setRetry(n => n + 1)}>다시 조회</button>}
      </div>}
    <p className="dim" style={{ fontSize: 11, lineHeight: 1.6, margin: '8px 0 0' }}>
      아래 상품 정보는 별도의 최신 조회 결과이며, 위 날짜·조건의 관측과 다를 수 있습니다. 순위나 표시 가격만으로 판매·수요를 판단할 수 없습니다.
    </p>
  </section>;
}
