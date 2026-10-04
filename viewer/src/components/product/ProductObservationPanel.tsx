'use client';
import React from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/client';
import { parseProductObservation, type ProductObservationContext } from '@/lib/product-observation-context';
import { fetchProductObservation, type ObservedProductResult } from '@/lib/queries-product-observation';

const number = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });

function Frame({ value, children }: { value: ProductObservationContext | null; children: React.ReactNode }) {
  return <section className="panel" aria-label="지정 상품 관측" style={{ padding: 16, marginBottom: 14 }}>
    <div className="sec-head" style={{ flexWrap: 'wrap', gap: 8, padding: 0, marginBottom: 8 }}>
      <h2 style={{ margin: 0, fontSize: 15 }}>지정 상품 관측</h2>
      {value?.back && <Link className="btn sm" href={value.back}>원 관측·메모로 돌아가기</Link>}
    </div>
    {value && <p className="mono dim" style={{ fontSize: 11, margin: '0 0 8px' }}>
      {value.date} · {value.store} · 상품 #{value.product} · {value.category} / {value.gender} / {value.age}
    </p>}
    {children}
    {value && <p className="dim" style={{ fontSize: 11, lineHeight: 1.6, margin: '8px 0 0' }}>
      아래 상품 정보는 별도의 최신 조회 결과이며, 위 날짜·조건의 관측과 다를 수 있습니다. 순위나 표시 가격만으로 판매·수요를 판단할 수 없습니다.
    </p>}
  </section>;
}

/** A URL change remounts this boundary; auth events also invalidate it without a route remount. */
function ValidObservation({ value }: { value: ProductObservationContext }) {
  const [auth, setAuth] = React.useState<{ ready: boolean; userId: string | null; epoch: number }>(
    { ready: false, userId: null, epoch: 0 });
  const [loaded, setLoaded] = React.useState<{ epoch: number; result: ObservedProductResult } | null>(null);
  const [retry, setRetry] = React.useState(0);
  const generation = React.useRef(0);
  const currentRead = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    let cancelled = false, authEventSeen = false;
    const identity = (userId: string | null) => {
      if (cancelled) return;
      generation.current++;
      currentRead.current?.abort();
      setLoaded(null);
      setAuth(previous => ({ ready: true, userId, epoch: previous.epoch + 1 }));
    };
    const client = supabaseBrowser();
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      authEventSeen = true;
      identity(session?.user?.id ?? null);
    });
    void client.auth.getUser().then(({ data }) => {
      if (!authEventSeen) identity(data.user?.id ?? null);
    }).catch(() => { if (!authEventSeen) identity(null); });
    return () => {
      cancelled = true;
      generation.current++;
      currentRead.current?.abort();
      subscription.unsubscribe();
    };
  }, []);

  React.useEffect(() => {
    if (!auth.ready || !auth.userId) return;
    const controller = new AbortController();
    const requestGeneration = generation.current;
    currentRead.current = controller;
    setLoaded(null);
    fetchProductObservation(value, controller.signal).then(result => {
      if (!controller.signal.aborted && requestGeneration === generation.current)
        setLoaded({ epoch: auth.epoch, result });
    });
    return () => { controller.abort(); if (currentRead.current === controller) currentRead.current = null; };
  }, [value, auth.ready, auth.userId, auth.epoch, retry]);

  const result = loaded?.epoch === auth.epoch && auth.userId ? loaded.result : null;
  return <Frame value={value}>
    {!auth.ready ? <p role="status">로그인 상태를 확인하는 중…</p>
      : !auth.userId ? <p role="status">로그인 후 지정 상품 관측을 조회할 수 있습니다.</p>
      : !result ? <p role="status">지정 날짜의 상품 관측을 조회하는 중…</p>
      : result.status === 'ready' ? <div style={{ fontSize: 12, lineHeight: 1.7 }}>
        <strong>{result.row.name}</strong>{result.row.brand ? ` · ${result.row.brand}` : ''}
        <div>당시 순위 #{result.row.rank} · 표시 가격 {result.row.price === null ? '미확인' : `${number.format(result.row.price)}원`}
          {' '}· 표시 할인율 {result.row.discount === null ? '미확인' : `${number.format(result.row.discount)}%`}</div>
        <p className="dim" style={{ margin: '4px 0 0' }}>현재 상품 레코드의 자사 분류: {result.row.own === null ? '미확인' : result.row.own ? '자사' : '자사 아님'} · 관측일 당시 분류는 확인되지 않습니다.</p>
      </div>
      : <div role={result.status === 'error' ? 'alert' : 'status'} style={{ fontSize: 12 }}>
        {result.status === 'missing' ? '이 날짜·조건의 상품 관측행이 없습니다.'
          : result.status === 'ambiguous' ? '같은 조건의 관측행이 2개여서 하나를 선택할 수 없습니다.'
          : result.status === 'capped' ? '같은 조건의 관측행이 3개 이상입니다. 조회 상한에 닿아 하나를 선택할 수 없습니다.'
          : '지정 상품 관측 조회에 실패했습니다.'}
        {result.status === 'error' && <button type="button" className="btn sm" onClick={() => setRetry(n => n + 1)}>다시 조회</button>}
      </div>}
  </Frame>;
}

export default function ProductObservationPanel({ query }: { query: string }) {
  const parsed = React.useMemo(() => parseProductObservation(new URLSearchParams(query)), [query]);
  if (parsed.kind !== 'valid') {
    if (parsed.kind === 'none') return null;
    return <Frame value={null}>
      <p role="alert">관측 주소가 유효하지 않습니다. 날짜·상품·조회 조건을 확인하세요.</p>
    </Frame>;
  }
  return <ValidObservation key={JSON.stringify(parsed.value)} value={parsed.value} />;
}
