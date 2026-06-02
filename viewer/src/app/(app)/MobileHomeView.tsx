'use client';
import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  fetchLatestRanking, fetchAnomalySignals, fetchOwnBrandBreakdown,
  fetchReviewStats, fetchActivePromotions,
  type RankingRow, type AnomalyRow, type OwnBrandStat, type PromoSummary,
} from '@/lib/queries';
import MobileFilterChips from '@/components/mobile/MobileFilterChips';

const fmt = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString();

const GENDER_CHIPS = [
  { value: 'A', label: '전체' },
  { value: 'M', label: '남성' },
  { value: 'F', label: '여성' },
];

const ANOMALY_LABEL: Record<string, string> = {
  rank_spike: '순위 급등', rank_drop_own: '자사 이탈',
  new_entrant_top10: 'TOP10 진입', sold_out: '품절',
  price_drop: '가격 급락', promo_heavy_discount: '고할인',
  review_count_surge: '리뷰 폭증', review_rating_drop: '별점 급락',
  review_negative_surge: '부정 리뷰',
};

function sevStyle(sev: string) {
  if (sev === 'hi') return { color: 'var(--td)', fontWeight: 700 };
  if (sev === 'md') return { color: 'var(--hs)', fontWeight: 600 };
  return { color: 'var(--f4)' };
}

export default function MobileHomeView() {
  const router = useRouter();
  const [ranking,    setRanking]    = React.useState<RankingRow[]>([]);
  const [rankGender, setRankGender] = React.useState('A');
  const [rankLoading, setRankLoading] = React.useState(true);
  const [anomalies,  setAnomalies]  = React.useState<AnomalyRow[]>([]);
  const [ownBrands,  setOwnBrands]  = React.useState<OwnBrandStat[]>([]);
  const [reviewStats, setReviewStats] = React.useState<{ total: number; avgRating: number; lowCount: number } | null>(null);
  const [promos,     setPromos]     = React.useState<PromoSummary[]>([]);
  const [loading,    setLoading]    = React.useState(true);

  React.useEffect(() => {
    Promise.all([
      fetchAnomalySignals(7).then(setAnomalies).catch(() => {}),
      fetchOwnBrandBreakdown().then(setOwnBrands).catch(() => {}),
      fetchReviewStats(30).then(setReviewStats).catch(() => {}),
      fetchActivePromotions(5).then(setPromos).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    setRankLoading(true);
    fetchLatestRanking({ genderFilter: rankGender, limit: 10 })
      .then(setRanking)
      .catch(() => setRanking([]))
      .finally(() => setRankLoading(false));
  }, [rankGender]);

  const ownTop100 = ownBrands.reduce((s, b) => s + b.top100_count, 0);
  const totalSku  = ownBrands.reduce((s, b) => s + b.sku_count, 0);
  const hiCount   = anomalies.filter(a => a[1] === 'hi').length;
  const mdCount   = anomalies.filter(a => a[1] === 'md').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 12px 20px', width: '100%', minWidth: 0 }}>

      {/* ── KPI 2열 그리드 ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[
          { label: '자사 SKU', value: loading ? '…' : fmt(totalSku), sub: `${ownBrands.length}개 브랜드`, link: '/matching' },
          { label: 'TOP100 진입', value: loading ? '…' : fmt(ownTop100), sub: '오늘 기준', link: '/ranking' },
          { label: '이상탐지', value: loading ? '…' : fmt(anomalies.length), sub: hiCount > 0 ? `HIGH ${hiCount}건` : mdCount > 0 ? `MED ${mdCount}건` : '최근 7일', link: '/anomaly' },
          { label: '자사 리뷰', value: loading ? '…' : (reviewStats ? `★${reviewStats.avgRating}` : '—'), sub: reviewStats ? `${fmt(reviewStats.total)}건` : '—', link: '/reviews' },
        ].map(k => (
          <Link key={k.label} href={k.link} style={{ textDecoration: 'none' }}>
            <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--f1)', fontFamily: 'var(--mono)' }}>{k.value}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--f3)', marginTop: 2 }}>{k.label}</div>
              <div style={{ fontSize: 10, color: 'var(--f4)', marginTop: 1 }}>{k.sub}</div>
            </div>
          </Link>
        ))}
      </div>

      {/* ── 빠른 이동 ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {[
          { href: '/ranking',       icon: '📊', label: '상품랭킹' },
          { href: '/brand-ranking', icon: '🏷️', label: '브랜드' },
          { href: '/promo',         icon: '🎁', label: '프로모션' },
          { href: '/anomaly',       icon: '🔔', label: '이상탐지' },
          { href: '/reviews',       icon: '⭐', label: '리뷰' },
          { href: '/snap',          icon: '📸', label: '스냅' },
          { href: '/magazine',      icon: '📰', label: '매거진' },
          { href: '/report',        icon: '📋', label: '리포트' },
        ].map(item => (
          <Link key={item.href} href={item.href} style={{ textDecoration: 'none' }}>
            <div style={{ padding: '10px 4px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 18 }}>{item.icon}</div>
              <div style={{ fontSize: 10, color: 'var(--f3)', marginTop: 4, fontWeight: 500 }}>{item.label}</div>
            </div>
          </Link>
        ))}
      </div>

      {/* ── 오늘의 상품 랭킹 ── */}
      <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)' }}>상품 랭킹 TOP10</span>
          <Link href="/ranking" style={{ fontSize: 11, color: 'var(--hs)', textDecoration: 'none', fontFamily: 'var(--mono)' }}>전체 →</Link>
        </div>
        <MobileFilterChips items={GENDER_CHIPS} activeValue={rankGender} onChange={setRankGender} />
        <div style={{ marginTop: 8 }}>
          {rankLoading ? (
            <div style={{ textAlign: 'center', padding: '20px 0', fontSize: 12, color: 'var(--f4)' }}>불러오는 중...</div>
          ) : ranking.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0', fontSize: 12, color: 'var(--f4)' }}>데이터 없음</div>
          ) : (
            ranking.map((r, i) => (
              <div
                key={i}
                onClick={() => router.push(`/product?no=${r.musinsa_no}`)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: i < ranking.length - 1 ? '0.5px solid var(--snk)' : undefined, cursor: 'pointer' }}
              >
                <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--mono)', width: 24, color: i < 3 ? 'var(--hs)' : 'var(--f3)', textAlign: 'center', flexShrink: 0 }}>
                  {r.rank_position}
                </span>
                <span style={{ fontSize: 10, width: 22, flexShrink: 0 }}>
                  {r.rank_change == null
                    ? <span style={{ color: 'var(--f4)', fontSize: 8 }}>NEW</span>
                    : r.rank_change > 0  ? <span style={{ color: 'var(--slf)' }}>↑{r.rank_change}</span>
                    : r.rank_change < 0  ? <span style={{ color: 'var(--shf)' }}>↓{Math.abs(r.rank_change)}</span>
                    : <span style={{ color: 'var(--f4)' }}>—</span>}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--f4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.brand_name}
                    {r.is_own && <span style={{ fontSize: 9, color: 'var(--hs)', marginLeft: 4 }}>자사</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.product_name}
                  </div>
                </div>
                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                  {r.discount_rate != null && r.discount_rate > 0 && (
                    <div style={{ fontSize: 9, color: 'var(--td)', fontFamily: 'var(--mono)', fontWeight: 600 }}>-{Math.round(r.discount_rate)}%</div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--f2)', fontFamily: 'var(--mono)' }}>
                    {r.final_price != null ? r.final_price.toLocaleString() : '—'}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── 자사 브랜드 현황 ── */}
      {!loading && ownBrands.length > 0 && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)' }}>자사 브랜드 현황</span>
            <Link href="/matching" style={{ fontSize: 11, color: 'var(--hs)', textDecoration: 'none', fontFamily: 'var(--mono)' }}>전체 →</Link>
          </div>
          {ownBrands.map((b, i) => (
            <div
              key={b.id}
              onClick={() => router.push(`/brand?id=${b.id}`)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: i < ownBrands.length - 1 ? '0.5px solid var(--snk)' : undefined, cursor: 'pointer' }}
            >
              <span style={{ flex: 1, fontSize: 12, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
              <span style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', flexShrink: 0 }}>
                SKU {fmt(b.sku_count)}
              </span>
              <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: b.top100_count > 0 ? 'var(--slf)' : 'var(--f4)', flexShrink: 0 }}>
                TOP100 {b.top100_count > 0 ? b.top100_count : '—'}
              </span>
              {b.avg_satisfaction != null && (
                <span style={{ fontSize: 11, color: 'var(--hs)', fontFamily: 'var(--mono)', flexShrink: 0 }}>★{b.avg_satisfaction}</span>
              )}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 12, marginTop: 8, paddingTop: 8, borderTop: '0.5px dashed var(--bs)', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--f3)' }}>
            <span>합계 SKU {fmt(totalSku)}</span>
            <span>TOP100 {fmt(ownTop100)}</span>
          </div>
        </div>
      )}

      {/* ── 이상탐지 ── */}
      {!loading && anomalies.length > 0 && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)' }}>이상탐지 <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--f4)' }}>최근 7일</span></span>
            <Link href="/anomaly" style={{ fontSize: 11, color: 'var(--hs)', textDecoration: 'none', fontFamily: 'var(--mono)' }}>전체 →</Link>
          </div>
          {anomalies.slice(0, 7).map((a, i) => (
            <div
              key={a[6]}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderBottom: i < Math.min(anomalies.length, 7) - 1 ? '0.5px solid var(--snk)' : undefined }}
            >
              <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--f4)', flexShrink: 0, marginTop: 2, width: 28 }}>
                {String(a[0]).slice(5)}
              </span>
              <span style={{ ...sevStyle(a[1]), fontSize: 9, flexShrink: 0, width: 22, marginTop: 2 }}>
                {a[1].toUpperCase()}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a[4]}
                </div>
                <div style={{ fontSize: 10, color: 'var(--f4)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a[3]}
                </div>
              </div>
            </div>
          ))}
          {anomalies.length > 7 && (
            <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', textAlign: 'center', marginTop: 8 }}>
              +{anomalies.length - 7}건 더
            </div>
          )}
        </div>
      )}

      {/* ── 프로모션 현황 ── */}
      {!loading && promos.length > 0 && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)' }}>프로모션 현황</span>
            <Link href="/promo" style={{ fontSize: 11, color: 'var(--hs)', textDecoration: 'none', fontFamily: 'var(--mono)' }}>전체 →</Link>
          </div>
          {promos.map((p, i) => (
            <div
              key={p.id}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: i < promos.length - 1 ? '0.5px solid var(--snk)' : undefined }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</div>
                <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 1 }}>
                  상품 {p.items_count}개 · {p.end_at ? p.end_at.slice(5, 10) : '상시'}
                </div>
              </div>
              {p.avg_discount_rate != null && (
                <span style={{ fontSize: 11, color: 'var(--td)', fontFamily: 'var(--mono)', flexShrink: 0, fontWeight: 600 }}>
                  -{Math.round(p.avg_discount_rate)}%
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── 리뷰 현황 ── */}
      {!loading && reviewStats && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)' }}>리뷰 현황 <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--f4)' }}>최근 30일</span></span>
            <Link href="/reviews" style={{ fontSize: 11, color: 'var(--hs)', textDecoration: 'none', fontFamily: 'var(--mono)' }}>분석 →</Link>
          </div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
            <span style={{ fontSize: 28, fontWeight: 700, color: 'var(--hs)', fontFamily: 'var(--mono)' }}>★{reviewStats.avgRating}</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{fmt(reviewStats.total)}건</div>
              <div style={{ fontSize: 11, color: 'var(--f4)', marginTop: 2 }}>저점 {fmt(reviewStats.lowCount)}건</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
