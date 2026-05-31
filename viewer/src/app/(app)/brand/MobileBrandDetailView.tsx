'use client';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import {
  fetchBrandInfo, fetchBrandStats, fetchBrandProducts, fetchBrandRankHistory,
  type BrandInfo, type BrandStats, type BrandProduct, type BrandRankDay,
} from '@/lib/queries';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

function fmtPrice(v: number | null): string {
  if (v == null) return '—';
  return `${Math.round(v / 1000).toLocaleString()}천원`;
}

export default function MobileBrandDetailView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const brandId = searchParams.get('id') ?? '';

  const [info, setInfo] = useState<BrandInfo | null>(null);
  const [stats, setStats] = useState<BrandStats | null>(null);
  const [products, setProducts] = useState<BrandProduct[]>([]);
  const [rankHistory, setRankHistory] = useState<BrandRankDay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!brandId) return;
    setLoading(true);
    fetchBrandInfo(brandId).then(inf => {
      setInfo(inf);
      setLoading(false);
      if (!inf) return;
      Promise.all([
        fetchBrandStats(inf.name),
        fetchBrandProducts(inf.name, 20),
        fetchBrandRankHistory(inf.name),
      ]).then(([st, prods, hist]) => {
        setStats(st);
        setProducts(prods);
        setRankHistory(hist.slice(-30).map(h => ({ ...h, date: h.date.slice(5) })));
      });
    });
  }, [brandId]);

  if (!brandId) return <MobileEmptyState icon="🔍" title="브랜드 ID가 없습니다" />;
  if (loading) return <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>;
  if (!info) return <MobileEmptyState icon="🏷️" title="브랜드 정보를 찾을 수 없습니다" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 12px 20px' }}>
      {/* 헤더 */}
      <div style={{ padding: '14px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {info.logo_url && (
            <img src={info.logo_url} alt="" width={48} height={48} style={{ borderRadius: 8, objectFit: 'contain', border: '1px solid var(--bd)' }} />
          )}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--f1)' }}>{info.name}</span>
              {info.is_own && (
                <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--hs)', background: 'var(--hs-soft)', padding: '1px 5px', borderRadius: 4 }}>자사</span>
              )}
            </div>
            {info.company_name && (
              <div
                style={{ fontSize: 12, color: 'var(--f3)', marginTop: 2, cursor: 'pointer' }}
                onClick={() => info.company_id && router.push(`/company?id=${info.company_id}`)}
              >
                {info.company_name}
              </div>
            )}
            {info.nation_name && (
              <div style={{ fontSize: 11, color: 'var(--f4)', marginTop: 2 }}>{info.nation_name}</div>
            )}
          </div>
        </div>
        {stats && (
          <div style={{ marginTop: 12, display: 'flex', gap: 0, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
            {[
              { label: 'TOP100', value: stats.top100Count },
              { label: '평균순위', value: stats.avgRank ? `${Math.round(stats.avgRank)}위` : '—' },
              { label: 'SKU', value: stats.skuCount },
              { label: '프로모', value: stats.promoCount },
            ].map(kpi => (
              <div key={kpi.label} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--f1)', fontFamily: 'var(--mono)' }}>{kpi.value}</div>
                <div style={{ fontSize: 10, color: 'var(--f4)', marginTop: 2 }}>{kpi.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 랭킹 추이 */}
      {rankHistory.length >= 2 && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 8 }}>브랜드 랭킹 추이 (30일)</div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={rankHistory}>
              <XAxis dataKey="date" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9 }} width={30} />
              <Tooltip formatter={(v: unknown) => [v as number, 'TOP100']} labelStyle={{ fontSize: 10 }} contentStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="top100_count" stroke="var(--hs)" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 인기 상품 TOP */}
      {products.length > 0 && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 8 }}>인기 상품 TOP 10</div>
          {products.slice(0, 10).map((p, i) => (
            <div
              key={p.musinsa_no}
              onClick={() => router.push(`/product?no=${p.musinsa_no}`)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                paddingTop: i > 0 ? 8 : 0, marginTop: i > 0 ? 8 : 0,
                borderTop: i > 0 ? '1px solid var(--bd)' : 'none',
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--f4)', fontFamily: 'var(--mono)', width: 18 }}>
                {i + 1}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.product_name}
                </div>
                <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>
                  {fmtPrice(p.final_price)}
                  {p.rank_position != null && ` · #${p.rank_position}`}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
