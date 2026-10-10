'use client';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useKstToday } from '@/hooks/useKstToday';
import { comparisonPriceGap, loadProductComparison, validComparisonDate, type ProductComparison } from '@/lib/product-comparison';
import { ROUTES } from '@/lib/routes';

const money = (value: number | null) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? `${value.toLocaleString()}원` : '미확인';
const observed = (date: string | null | undefined) => validComparisonDate(date) ? date : '미확인';
const muted = { color: 'var(--f3)', fontSize: 12, lineHeight: 1.7 };

export default function ProductComparisonWorkspace() {
  const no = useSearchParams().get('no') ?? '';
  const today = useKstToday();
  const [days, setDays] = useState<7 | 30>(30);
  const daysRef = useRef(days);
  const [reload, setReload] = useState(0);
  const [auth, setAuth] = useState({ ready: false, userId: null as string | null, epoch: 0 });
  const identity = useRef(auth);
  const sequence = useRef(0);
  const busy = useRef(false);
  const key = JSON.stringify([auth.epoch, no, today, days]);
  const keyRef = useRef(key); keyRef.current = key;
  const [state, setState] = useState<{ key: string; status: 'loading' | 'ready' | 'error'; data: ProductComparison | null }>({ key: '', status: 'loading', data: null });
  useEffect(() => {
    let active = true;
    const { data: { subscription } } = supabaseBrowser().auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      const userId = session?.user.id ?? null;
      if (identity.current.ready && identity.current.userId === userId) return;
      identity.current = { ready: true, userId, epoch: identity.current.epoch + 1 };
      sequence.current++; busy.current = false;
      setState({ key: '', status: 'loading', data: null }); setAuth(identity.current);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!auth.ready || !auth.userId) return;
    let active = true;
    const request = ++sequence.current, epoch = auth.epoch;
    const controller = new AbortController();
    const current = () => active && sequence.current === request && identity.current.epoch === epoch;
    busy.current = true; setState({ key, status: 'loading', data: null });
    const timer = setTimeout(() => {
      if (!current()) return;
      sequence.current++; controller.abort(); busy.current = false;
      setState({ key, status: 'error', data: null });
    }, 20000);
    loadProductComparison(no, today, days, controller.signal).then(data => {
      if (current()) setState({ key, status: 'ready', data });
    }).catch(() => {
      if (current()) setState({ key, status: 'error', data: null });
    }).finally(() => { clearTimeout(timer); if (current()) busy.current = false; });
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [auth.ready, auth.userId, auth.epoch, no, today, days, reload, key]);
  const retry = () => {
    if (keyRef.current !== key || identity.current.epoch !== auth.epoch || busy.current || !identity.current.userId) return;
    busy.current = true; sequence.current++;
    setState({ key, status: 'loading', data: null }); setReload(n => n + 1);
  };
  const view = state.key === key ? state : { status: 'loading' as const, data: null };
  const data = view.data;
  const higher = data?.competitors.filter(c => c.detail && (comparisonPriceGap(data.own, c.detail).gap ?? 0) > 0).length ?? 0;
  return <div className="col-flex gap-12" style={{ maxWidth: 1100, margin: '0 auto', padding: 12 }}>
    <div className="page-title wrap"><h1>가격·고객 안내 점검</h1><span className="sub">이 자사 상품에서 먼저 확인할 가격 설명과 고객 불편의 근거</span></div>
    <p style={muted}>확정 연결된 경쟁 상품과 저장 리뷰를 함께 읽습니다. 판매량·수익성·가격 변경 효과를 예측하지 않습니다.</p>
    <div className="row-flex gap-8 wrap">
      <Link href={ROUTES.product(no)} className="btn sm">상품 상세로</Link>
      <Link href={ROUTES.matching} className="btn sm">경쟁 상품 연결 확인</Link>
      {[7, 30].map(n => <button type="button" key={n} className={`btn sm ${days === n ? 'active' : ''}`} aria-pressed={days === n} onClick={() => { if (daysRef.current === n) return; daysRef.current = n as 7 | 30; sequence.current++; busy.current = false; setDays(n as 7 | 30); setReload(v => v + 1); }}>리뷰 {n}일</button>)}
    </div>
    {!auth.ready ? <p role="status">접근 범위를 확인하는 중…</p> : !auth.userId ? <p>로그인 후 자사 상품의 근거를 확인하세요. <Link href={ROUTES.login}>로그인</Link></p> : view.status === 'loading' ? <p role="status">상품·확정 연결·리뷰 근거를 불러오는 중…</p> : view.status === 'error' ? <section className="panel" role="alert"><p>자사 상품 근거를 확인하지 못했습니다. 상품번호와 접근 범위를 확인하세요. 다른 상품으로 대체하지 않습니다.</p><button className="btn sm" onClick={retry}>다시 조회</button></section> : data ? <>
      <section className="panel">
        <h2 style={{ fontSize: 17 }}>{data.own.brand_name} · {data.own.name}</h2>
        <p>자사 저장 판매가 <strong>{money(data.own.final_price)}</strong> · 가격 관측일 {observed(data.own.rank_snapshot_date)}</p>
        <p style={muted}>가격은 무신사 랭킹 스냅샷의 저장값입니다. 현재 실시간 판매가·배송비·쿠폰 적용가는 확인하지 않았습니다.</p>
      </section>
      <section className="panel">
        <h2 style={{ fontSize: 15 }}>다음에 확인할 것</h2>
        <ul style={{ paddingLeft: 20, fontSize: 13, lineHeight: 1.8 }}>
          <li>{data.matchError ? '경쟁 연결 조회에 실패했습니다. 연결 상태를 다시 확인한 뒤 가격 설명을 검토하세요.' : higher > 0 ? `같은 관측일·대분류에서 자사 저장가가 더 높은 연결 ${higher}개: 소재·사양·할인 조건을 확인하고 가격 차이를 설명할 근거를 정리하세요.` : '확인된 연결에서 가격 인하·인상 필요성을 결론내리지 않습니다. 관측일과 동일 사양 여부부터 점검하세요.'}</li>
          <li>{data.reviewError ? '리뷰 근거 조회에 실패했습니다. 0건으로 판단하지 말고 같은 기간을 다시 확인하세요.' : (data.reviews?.lowTotal ?? 0) > 0 ? '아래 저점 원문의 구매 옵션·불편 설명을 확인하고 샘플 또는 고객 안내에서 점검할 항목을 정하세요. 자동 원인 분류는 하지 않습니다.' : '이 기간에 저장된 저점 리뷰가 없습니다. 고객 불편이 없거나 수집이 완료됐다는 뜻은 아닙니다.'}</li>
        </ul>
      </section>
      <section className="panel">
        <h2 style={{ fontSize: 15 }}>확정 경쟁 상품의 가격 근거</h2>
        <p style={muted}>불러온 확정 연결 중 최근 3개까지 표시합니다. 전체 시장을 대표하지 않으며, 확정은 동일 사양 검증을 뜻하지 않습니다. 자동 후보는 가격 판단에서 제외합니다.</p>
        {data.matchError ? <div role="alert">경쟁 연결을 확인하지 못했습니다. <button className="btn sm" onClick={retry}>근거 다시 조회</button></div> : <>
          <p style={muted}>불러온 연결 중 확정 {data.confirmedLoaded}개 · 자동 후보 {data.autoLoaded}개(비교 미포함)</p>
          {data.competitors.length === 0 ? <p>불러온 범위에 확정된 경쟁 연결이 없습니다. 매칭 화면에서 비교할 상품을 먼저 확인하세요.</p> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {data.competitors.map(c => {
              const gap = c.detail ? comparisonPriceGap(data.own, c.detail) : null;
              return <article key={c.match.id} style={{ border: '0.5px solid var(--bs)', borderRadius: 6, padding: 12 }}>
                <Link href={ROUTES.product(String(c.match.competitor_musinsa_no))}>{c.match.competitor_brand} · {c.match.competitor_name}</Link>
                {c.unavailable || !c.detail ? <p role="status">상품·가격 근거 미확인. 다른 후보로 채우지 않습니다.</p> : <>
                  <p>저장 판매가 <strong>{money(c.detail.final_price)}</strong></p><p style={muted}>가격 관측일 {observed(c.detail.rank_snapshot_date)}</p>
                  <p>{gap?.gap !== null && gap?.gap !== undefined ? `자사 − 경쟁 ${gap.gap > 0 ? '+' : ''}${gap.gap.toLocaleString()}원 (${gap.percent!.toFixed(1)}%, 경쟁 저장가 기준)` : '가격 차이 판단 보류'}</p>
                  <p style={muted}>{gap?.reason}</p>
                </>}
              </article>;
            })}
          </div>}
        </>}
      </section>
      <section className="panel">
        <h2 style={{ fontSize: 15 }}>자사 저점 리뷰 원문</h2>
        <p style={muted}>리뷰 작성일 {data.from} ~ {data.to} · 양 끝 날짜 포함 {days}일 · 저장 리뷰만 집계, 수집 확인시각은 이 조회에서 제공되지 않습니다.</p>
        {data.reviewError || !data.reviews ? <div role="alert">기간별 리뷰 근거를 확인하지 못했습니다. <button className="btn sm" onClick={retry}>근거 다시 조회</button></div> : <>
          <p>저장 리뷰 {data.reviews.total.toLocaleString()}건 중 ★1~2 {data.reviews.lowTotal.toLocaleString()}건{data.reviews.total > 0 ? ` (${(data.reviews.lowTotal / data.reviews.total * 100).toFixed(1)}%)` : ' · 비율 계산 불가'}</p>
          <p style={muted}>최근 저점 원문 최대 3건. 별점과 원문은 가격 차이나 매출의 원인을 입증하지 않습니다.</p>
          {data.reviews.rows.length === 0 ? <p>이 기간에 저장된 저점 원문이 없습니다.</p> : data.reviews.rows.map(r => <article key={r.id} style={{ borderTop: '0.5px solid var(--bs)', padding: '10px 0' }}>
            <p style={muted}>{r.review_date} · ★{r.rating} · 근거 리뷰 #{r.musinsa_review_id}</p>
            {r.purchase_option && <p style={muted}>구매 옵션: {r.purchase_option}</p>}
            <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13 }}>{r.review_text?.trim() || '본문이 저장되지 않았습니다.'}</p>
          </article>)}
        </>}
      </section>
    </> : null}
  </div>;
}
