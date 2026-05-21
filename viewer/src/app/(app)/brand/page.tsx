'use client';
import React from 'react';
import { Donut, Line } from '@/components/ui/charts';
import { IcBookmark, IcArrowUR } from '@/components/ui/icons';
import Link from 'next/link';
import {
  fetchBrandOptions,
  fetchBrandInfo,
  fetchBrandStats,
  fetchBrandProducts,
  type BrandInfo,
  type BrandStats,
  type BrandProduct,
} from '@/lib/queries';

export default function BrandPage() {
  const [brands, setBrands] = React.useState<{ id: string; name: string }[]>([]);
  const [selectedId, setSelectedId] = React.useState('');
  const [info, setInfo] = React.useState<BrandInfo | null>(null);
  const [stats, setStats] = React.useState<BrandStats | null>(null);
  const [products, setProducts] = React.useState<BrandProduct[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetchBrandOptions().then(opts => {
      setBrands(opts);
      if (opts.length > 0) setSelectedId(opts[0].id);
    }).catch(console.error);
  }, []);

  React.useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    fetchBrandInfo(selectedId).then(async bi => {
      setInfo(bi);
      if (!bi) { setLoading(false); return; }
      const [st, prods] = await Promise.all([
        fetchBrandStats(bi.name),
        fetchBrandProducts(bi.name, 50),
      ]);
      setStats(st);
      setProducts(prods);
      setLoading(false);
    }).catch(e => { console.error(e); setLoading(false); });
  }, [selectedId]);

  const brandName = info?.name ?? '—';

  return (
    <>
      <div className="page-title">
        <h1>{loading ? '…' : brandName}</h1>
        {info && <span className="chip">{info.nation_name ?? '—'}{info.since_year ? ` · ${info.since_year}년~` : ''}</span>}
        <span className="sub">{loading ? '' : info?.introduction?.slice(0, 40) ?? `${stats?.skuCount ?? 0} SKU`}</span>
        <div className="row-flex gap-6" style={{ marginLeft: 'auto' }}>
          <select
            className="btn sm"
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            style={{ cursor: 'pointer', paddingRight: 8 }}
          >
            {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button className="btn sm"><IcBookmark /> 북마크</button>
        </div>
      </div>

      <div className="grid grid-5 gap-8">
        {[
          ['TOP100 진입', loading ? '…' : String(stats?.top100Count ?? 0), ''],
          ['평균 랭킹', loading ? '…' : stats?.avgRank ? String(stats.avgRank) : '—', ''],
          ['진행 프로모션', loading ? '…' : String(stats?.promoCount ?? 0), ''],
          ['SKU (랭킹 진입)', loading ? '…' : String(stats?.skuCount ?? 0), ''],
          ['평균 평점', loading ? '…' : products.length > 0 ? (products.reduce((s, p) => s + p.review_score, 0) / products.length).toFixed(1) : '—', ''],
        ].map(([l, v, d], i) => (
          <div key={i} className="kpi">
            <span className="label">{l}</span>
            <div className="val">{v}</div>
            <div className="dlt"><span className="muted">{d}</span></div>
          </div>
        ))}
      </div>

      <section className="panel">
        <div className="sec-head">
          <h3>브랜드 랭킹 흐름 <span className="sub">카테고리별 평균 랭킹 (낮을수록 좋음) · 최근 12주</span></h3>
          <div className="row-flex gap-4">
            <button className="btn sm">4W</button>
            <button className="btn sm active">12W</button>
            <button className="btn sm">1Y</button>
          </div>
        </div>
        {loading ? (
          <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--snk)', borderRadius: 4 }}>
            <span className="mono dim" style={{ fontSize: 11 }}>로딩 중…</span>
          </div>
        ) : products.length === 0 ? (
          <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--snk)', borderRadius: 4 }}>
            <span className="mono dim" style={{ fontSize: 11 }}>스냅샷 데이터 축적 중 — 2일 이상 수집 후 표시됩니다</span>
          </div>
        ) : (
          <>
            <Line h={220} yMin={0} yMax={400}
              series={[
                { points: [180, 175, 168, 155, 150, 148, 142, 138, 132, 128, 130, 128], color: 'var(--f1)' },
                { points: [240, 232, 228, 222, 220, 215, 210, 208, 205, 202, 200, 198], color: 'var(--f3)' },
                { points: [320, 318, 312, 308, 310, 305, 302, 298, 295, 292, 290, 288], color: 'var(--bd)' },
              ]}
            />
            <div className="row-flex gap-14 wrap" style={{ marginTop: 8 }}>
              {[['상의', 'var(--f1)'], ['아우터', 'var(--f3)'], ['하의', 'var(--bd)']].map(([l, c], i) => (
                <span key={i} className="row-flex center gap-4">
                  <span style={{ width: 14, height: 1.5, background: c }} />
                  <span className="mono dim" style={{ fontSize: 10 }}>{l}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      <div className="grid" style={{ gridTemplateColumns: '1.5fr 1fr', gap: 14 }}>
        <section className="panel col-flex">
          <div className="sec-head">
            <h3>상품 랭킹 <span className="sub">최신 스냅샷 · {brandName}</span></h3>
            <div className="row-flex gap-4">
              <button className="btn sm active">전체</button>
            </div>
          </div>
          {loading ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>로딩 중…</div>
          ) : products.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>
              <span className="sec-tag">no data</span>
              <div style={{ marginTop: 8 }}>랭킹에 진입한 상품이 없습니다.</div>
            </div>
          ) : (
            <div className="tbl flex-1">
              <div className="row head" style={{ gridTemplateColumns: '36px 1fr 80px 70px 60px 54px 40px' }}>
                <span>#</span><span>상품</span><span className="cell-r">가격</span><span>할인</span><span className="cell-r">변동</span><span className="cell-r">평점</span><span></span>
              </div>
              {products.map((p, i) => (
                <div key={i} className={`row hover ${i % 2 ? 'alt' : ''}`} style={{ gridTemplateColumns: '36px 1fr 80px 70px 60px 54px 40px' }}>
                  <span className="mono muted">{p.rank_position ?? '—'}</span>
                  <span>{p.product_name}</span>
                  <span className="mono muted cell-r">{p.final_price ? p.final_price.toLocaleString() : '—'}</span>
                  <span>
                    {p.discount_rate ? (
                      <span className="chip" style={{ color: p.discount_rate >= 30 ? 'var(--shf)' : 'var(--f3)', borderColor: p.discount_rate >= 30 ? 'var(--shf)' : 'var(--bs)', background: p.discount_rate >= 30 ? 'var(--shb)' : 'var(--snk)' }}>
                        −{p.discount_rate}%
                      </span>
                    ) : <span className="dim mono">—</span>}
                  </span>
                  <span className="mono dim cell-r">—</span>
                  <span className="mono muted cell-r">{p.review_score > 0 ? p.review_score.toFixed(1) : '—'}</span>
                  <span><Link href={`/product?no=${p.musinsa_no}`} className="btn sm icon"><IcArrowUR /></Link></span>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="col-flex gap-12">
          <section className="panel">
            <div className="sec-head"><h3>랭킹 분포 <span className="sub">현재 진입 상품</span></h3></div>
            {loading || products.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--f4)', padding: '20px 0', textAlign: 'center' }}>데이터 없음</div>
            ) : (
              <div className="row-flex center gap-14">
                <Donut
                  size={90}
                  percent={stats?.top100Count && stats.skuCount ? Math.round((stats.top100Count / stats.skuCount) * 100) : 0}
                  label={`${stats?.top100Count ?? 0}`}
                  sub="TOP100"
                />
                <div className="flex-1">
                  {[
                    ['TOP 10', products.filter(p => (p.rank_position ?? 999) <= 10).length],
                    ['TOP 50', products.filter(p => (p.rank_position ?? 999) <= 50).length],
                    ['TOP 100', products.filter(p => (p.rank_position ?? 999) <= 100).length],
                    ['100위 이상', products.filter(p => (p.rank_position ?? 999) > 100).length],
                  ].map(([l, v], i) => (
                    <div key={i} className="row-flex between" style={{ padding: '3px 0' }}>
                      <span style={{ fontSize: 11, color: 'var(--f2)' }}>· {l}</span>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--f2)' }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="sec-head"><h3>가격대 분포 <span className="sub">{products.length} SKU</span></h3></div>
            {loading || products.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--f4)', padding: '20px 0', textAlign: 'center' }}>데이터 없음</div>
            ) : (() => {
              const prices = products.map(p => p.final_price ?? 0).filter(Boolean);
              const max = Math.max(...prices);
              const bins = [0, 30000, 50000, 80000, 100000, 150000, 200000, Infinity];
              const counts = bins.slice(0, -1).map((lo, i) => prices.filter(p => p >= lo && p < bins[i + 1]).length);
              const labels = ['~3만', '~5만', '~8만', '~10만', '~15만', '~20만', '20만+'];
              return (
                <div>
                  <div className="row-flex gap-2 center" style={{ height: 60, alignItems: 'flex-end' }}>
                    {counts.map((c, i) => (
                      <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <div style={{ width: '100%', background: 'var(--hs)', opacity: 0.7, height: Math.round((c / (Math.max(...counts) || 1)) * 48) }} />
                      </div>
                    ))}
                  </div>
                  <div className="row-flex between" style={{ marginTop: 4 }}>
                    {labels.map((l, i) => <span key={i} className="mono dim" style={{ fontSize: 9 }}>{l}</span>)}
                  </div>
                </div>
              );
            })()}
          </section>

          <section className="panel">
            <div className="sec-head"><h3>브랜드 정보</h3></div>
            {info ? (
              <>
                {[
                  ['국가', info.nation_name ?? '—'],
                  ['설립', info.since_year ? `${info.since_year}년` : '—'],
                  ['자사 브랜드', info.is_own ? 'Yes' : 'No'],
                  ['slug', info.slug],
                ].map(([k, v], i) => (
                  <div key={i} className="row-flex between" style={{ padding: '3px 0' }}>
                    <span className="dim" style={{ fontSize: 11 }}>{k}</span>
                    <span className="mono" style={{ fontSize: 11 }}>{v}</span>
                  </div>
                ))}
                {info.introduction && (
                  <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--f2)', lineHeight: '18px' }}>
                    {info.introduction.slice(0, 120)}{info.introduction.length > 120 ? '…' : ''}
                  </p>
                )}
              </>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--f4)', padding: '12px 0' }}>브랜드를 선택하세요.</div>
            )}
          </section>

          <section className="panel surface">
            <div className="sec-head">
              <h3>추이 분석 <span className="sub">데이터 수집 중</span></h3>
            </div>
            <p style={{ margin: 0, fontSize: 12, lineHeight: '19px', color: 'var(--f4)' }}>
              랭킹 추이·카테고리 점유율 차트는 2일치 이상 스냅샷이 쌓이면 자동으로 표시됩니다.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
