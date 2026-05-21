'use client';
import React from 'react';
import { IcBookmark } from '@/components/ui/icons';
import { fetchOwnProducts, fetchProductDetail, fetchProductPriceHistory, fetchReviews, type ProductDetail, type ReviewRow } from '@/lib/queries';

export default function ProductPage() {
  const [products, setProducts] = React.useState<{ id: string; musinsa_no: number; name: string; brand_name: string }[]>([]);
  const [selectedNo, setSelectedNo] = React.useState('');
  const [detail, setDetail] = React.useState<ProductDetail | null>(null);
  const [priceHistory, setPriceHistory] = React.useState<{ date: string; price: number }[]>([]);
  const [reviews, setReviews] = React.useState<ReviewRow[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetchOwnProducts(300).then(opts => {
      setProducts(opts as any);
      if (opts.length > 0) setSelectedNo(String(opts[0].musinsa_no));
    }).catch(console.error);
  }, []);

  React.useEffect(() => {
    if (!selectedNo) return;
    setLoading(true);
    Promise.all([
      fetchProductDetail(selectedNo),
      fetchProductPriceHistory(selectedNo),
    ]).then(async ([d, ph]) => {
      setDetail(d);
      setPriceHistory(ph);
      if (d) {
        const rv = await fetchReviews({ productId: d.id, sort: 'recent', limit: 5, offset: 0 });
        setReviews(rv.rows);
      }
      setLoading(false);
    }).catch(e => { console.error(e); setLoading(false); });
  }, [selectedNo]);

  const prices = priceHistory.map(p => p.price);
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
  const pricePct = (v: number) => maxPrice === minPrice ? 50 : Math.round(((v - minPrice) / (maxPrice - minPrice)) * 100);

  return (
    <div className="col-flex gap-14">
      <div className="page-title">
        <h1>{loading ? '…' : (detail?.name ?? '상품 선택')}</h1>
        {detail && <span className="chip">{detail.brand_name}</span>}
        <div className="row-flex gap-6" style={{ marginLeft: 'auto' }}>
          <select
            className="btn sm"
            value={selectedNo}
            onChange={e => setSelectedNo(e.target.value)}
            style={{ cursor: 'pointer', paddingRight: 8, maxWidth: 280 }}
          >
            {products.map(p => <option key={p.id} value={String(p.musinsa_no)}>{p.brand_name} — {p.name}</option>)}
          </select>
          <button className="btn sm icon" title="북마크"><IcBookmark /></button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '80px 20px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>로딩 중…</div>
      ) : !detail ? (
        <div style={{ padding: '80px 20px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>
          <span className="sec-tag">no data</span>
          <div style={{ marginTop: 8 }}>상세 정보가 없습니다. 상세 수집이 완료된 상품을 선택하세요.</div>
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: '300px 1fr', gap: 14 }}>
          <div className="col-flex gap-10">
            <div className="panel compact" style={{ height: 280, background: 'var(--snk)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
              {detail.thumbnail_url ? (
                <img src={detail.thumbnail_url} alt={detail.name} style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }} />
              ) : (
                <span className="mono dim" style={{ fontSize: 11, background: 'var(--rai)', padding: '2px 6px', borderRadius: 2 }}>이미지 없음</span>
              )}
            </div>

            <section className="panel">
              <span className="sec-tag">현재가</span>
              <div className="row-flex baseline gap-4" style={{ marginTop: 4 }}>
                <span className="mono tnum" style={{ fontSize: 26, fontWeight: 500, color: 'var(--f1)' }}>
                  {detail.final_price ? detail.final_price.toLocaleString() : '—'}
                </span>
                <span style={{ fontSize: 12, color: 'var(--f3)' }}>원</span>
              </div>
              {detail.list_price && detail.final_price && detail.list_price !== detail.final_price && (
                <div className="mono dim" style={{ fontSize: 11, marginTop: 4 }}>
                  정가 {detail.list_price.toLocaleString()} · −{detail.discount_rate ?? Math.round((1 - detail.final_price / detail.list_price) * 100)}%
                </div>
              )}
              <hr className="hr-d" style={{ margin: '12px 0' }} />
              {[
                ['브랜드', detail.brand_name],
                ['SKU', detail.musinsa_no],
                ['카테고리', detail.category_code],
                ['성별', detail.gender ?? '—'],
                ['랭킹', detail.rank_position ? `#${detail.rank_position}` : '—'],
                ['평점', detail.satisfaction_score ? `${detail.satisfaction_score} (${detail.review_count.toLocaleString()})` : `(${detail.review_count.toLocaleString()})`],
              ].map(([k, v], i) => (
                <div key={i} className="row-flex between" style={{ padding: '3px 0' }}>
                  <span className="dim" style={{ fontSize: 11 }}>{k}</span>
                  <span className="mono" style={{ fontSize: 11 }}>{v}</span>
                </div>
              ))}
            </section>
          </div>

          <div className="col-flex gap-12">
            <section className="panel">
              <div className="sec-head"><h3>가격 추이 <span className="sub">{priceHistory.length}일 수집</span></h3></div>
              {priceHistory.length < 2 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>
                  데이터 수집 중 — 2일치 이상 쌓이면 차트가 표시됩니다.
                </div>
              ) : (
                <div style={{ position: 'relative', height: 120, marginTop: 8 }}>
                  <svg viewBox={`0 0 ${prices.length - 1} 100`} preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
                    <polyline
                      points={prices.map((p, i) => `${i},${100 - pricePct(p)}`).join(' ')}
                      fill="none" stroke="var(--f1)" strokeWidth="0.8"
                    />
                  </svg>
                  <div className="row-flex between" style={{ marginTop: 4 }}>
                    <span className="mono dim" style={{ fontSize: 10 }}>{priceHistory[0]?.date}</span>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--hs)' }}>
                      {minPrice.toLocaleString()} ~ {maxPrice.toLocaleString()}원
                    </span>
                    <span className="mono dim" style={{ fontSize: 10 }}>{priceHistory[priceHistory.length - 1]?.date}</span>
                  </div>
                </div>
              )}
            </section>

            <section className="panel">
              <div className="sec-head"><h3>최근 리뷰 <span className="sub">자사 상품 최신 5건</span></h3></div>
              {reviews.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--f4)', padding: '16px 0' }}>수집된 리뷰가 없습니다.</div>
              ) : (
                <div className="col-flex gap-8">
                  {reviews.map((r, i) => (
                    <div key={r.id} className="panel compact" style={{ background: i % 2 ? 'var(--snk)' : 'transparent' }}>
                      <div className="row-flex between center" style={{ marginBottom: 4 }}>
                        <span className="mono" style={{ fontSize: 12, color: r.rating >= 4 ? 'var(--up)' : r.rating <= 2 ? 'var(--dn)' : 'var(--f2)' }}>
                          {'★'.repeat(r.rating > 0 ? r.rating : 0)}{'☆'.repeat(r.rating > 0 ? 5 - r.rating : 5)}
                          {r.rating === 0 && <span className="dim"> —</span>}
                        </span>
                        <span className="mono dim" style={{ fontSize: 10 }}>{r.review_date}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--f2)', lineHeight: '18px' }}>
                        {r.review_text ? r.review_text.slice(0, 120) + (r.review_text.length > 120 ? '…' : '') : <span className="dim">내용 없음</span>}
                      </div>
                      {r.helpful_count > 0 && (
                        <div className="mono dim" style={{ fontSize: 10, marginTop: 4 }}>도움됨 {r.helpful_count}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
