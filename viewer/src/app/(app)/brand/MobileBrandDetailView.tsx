'use client';
import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  fetchBrandInfo, fetchBrandStats, fetchBrandProducts, fetchBrandRankHistory, fetchBrandRankingDistribution,
  CATEGORY_MAP,
  type BrandInfo, type BrandStats, type BrandProduct, type BrandRankDay, type BrandDistRow,
} from '@/lib/queries';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';
import MobileFilterChips from '@/components/mobile/MobileFilterChips';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

const GENDER_CHIPS = [
  { value: '', label: '전체성별' },
  { value: 'A', label: '공용' },
  { value: 'M', label: '남성' },
  { value: 'F', label: '여성' },
];
const AGE_CHIPS = [
  { value: '', label: '전체' },
  { value: 'AGE_BAND_MINOR', label: '20미만' },
  { value: 'AGE_BAND_20', label: '20~25' },
  { value: 'AGE_BAND_25', label: '25~30' },
  { value: 'AGE_BAND_30', label: '30~35' },
  { value: 'AGE_BAND_35', label: '35~40' },
  { value: 'AGE_BAND_40', label: '40이상' },
];

const GENDER_LABEL: Record<string, string> = { A: '공용', M: '남성', F: '여성' };
const GENDER_KEYS = ['A', 'M', 'F'] as const;
const GENDER_COLORS = ['var(--f3)', 'var(--chart-blue-muted)', 'var(--shf)'];
const CAT_COLORS = ['var(--hs)', 'var(--chart-blue-muted)', 'var(--slf)', 'var(--chart-tan)', 'var(--f3)'];

function fmtPrice(v: number | null): string {
  if (v == null) return '—';
  if (v >= 10000) return `${Math.round(v / 10000)}만`;
  return `${Math.round(v / 1000)}천`;
}

function KpiCard({ label, value, sub, color }: { label: string; value: React.ReactNode; sub?: string; color?: string }) {
  return (
    <div style={{ flex: '1 1 calc(50% - 5px)', padding: '10px 12px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
      <div style={{ fontSize: 10, color: 'var(--f4)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: color ?? 'var(--f1)', fontFamily: 'var(--mono)', lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--f4)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function MobileBrandDetailView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const brandId = searchParams.get('id') ?? '';

  const [info, setInfo] = useState<BrandInfo | null>(null);
  const [stats, setStats] = useState<BrandStats | null>(null);
  const [products, setProducts] = useState<BrandProduct[]>([]);
  const [rankHistory, setRankHistory] = useState<BrandRankDay[]>([]);
  const [distribution, setDistribution] = useState<BrandDistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [distGender, setDistGender] = useState('');
  const [distAge, setDistAge] = useState('');

  useEffect(() => {
    if (!brandId) return;
    setLoading(true);
    fetchBrandInfo(brandId).then(inf => {
      setInfo(inf);
      if (!inf) { setLoading(false); return; }
      Promise.all([
        fetchBrandStats(inf.name),
        fetchBrandProducts(inf.name, 100),
        fetchBrandRankHistory(inf.name),
        fetchBrandRankingDistribution(inf.name),
      ]).then(([st, prods, hist, dist]) => {
        setStats(st);
        setProducts(prods);
        setRankHistory(hist.map(h => ({ ...h, date: h.date.slice(5) })));
        setDistribution(dist);
        setLoading(false);
      });
    });
  }, [brandId]);

  if (!brandId) return <MobileEmptyState icon="🔍" title="브랜드 ID가 없습니다" />;
  if (loading) return <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>;
  if (!info) return <MobileEmptyState icon="🏷️" title="브랜드 정보를 찾을 수 없습니다" />;

  const withDiscount = products.filter(p => p.discount_rate && p.discount_rate > 0);
  const avgDiscount = withDiscount.length > 0
    ? Math.round(withDiscount.reduce((s, p) => s + (p.discount_rate ?? 0), 0) / withDiscount.length)
    : null;

  const genderMap: Record<string, number> = { A: 0, M: 0, F: 0 };
  distribution.forEach(d => { if (d.gender_filter in genderMap) genderMap[d.gender_filter] += d.count; });
  const genderTotal = Object.values(genderMap).reduce((s, v) => s + v, 0) || 1;

  const catMap = new Map<string, number>();
  distribution.forEach(d => catMap.set(d.category_code, (catMap.get(d.category_code) ?? 0) + d.count));
  const topCats = [...catMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const catTotal = [...catMap.values()].reduce((s, v) => s + v, 0) || 1;

  const trend30 = rankHistory.length >= 2
    ? rankHistory[rankHistory.length - 1].top100_count - rankHistory[0].top100_count
    : null;
  const trendLabel = trend30 === null ? '—'
    : trend30 > 0 ? `+${trend30} SKU` : trend30 < 0 ? `${trend30} SKU` : '변동없음';
  const trendColor = trend30 === null ? 'var(--f3)'
    : trend30 > 0 ? 'var(--slf)' : trend30 < 0 ? 'var(--shf)' : 'var(--f3)';

  const filteredDist = distribution.filter(d =>
    (!distGender || d.gender_filter === distGender) &&
    (!distAge || d.age_filter === distAge)
  );
  const catBarMap = new Map<string, number>();
  filteredDist.forEach(d => catBarMap.set(d.category_code, (catBarMap.get(d.category_code) ?? 0) + d.count));
  const catBars = [...catBarMap.entries()].sort((a, b) => b[1] - a[1]);
  const catBarMax = catBars[0]?.[1] || 1;
  const filteredTotal = filteredDist.reduce((s, d) => s + d.count, 0);
  const filteredTop100 = filteredDist.reduce((s, d) => s + (d.best_rank <= 100 ? d.count : 0), 0);
  const filteredBest = filteredDist.length > 0 ? Math.min(...filteredDist.map(d => d.best_rank)) : null;

  const prices = products.map(p => p.final_price ?? 0).filter(Boolean);
  const priceBins = [0, 30000, 50000, 80000, 100000, 150000, 200000, Infinity];
  const priceBinLabels = ['~3만', '~5만', '~8만', '~10만', '~15만', '~20만', '20만+'];
  const priceDist = priceBinLabels.map((name, i) => ({
    name, count: prices.filter(p => p >= priceBins[i] && p < priceBins[i + 1]).length,
  })).filter(d => d.count > 0);
  const priceMax = Math.max(...priceDist.map(d => d.count), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 12px 20px', width: '100%', minWidth: 0 }}>

      {/* 헤더 */}
      <div style={{ padding: '14px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {info.logo_url && (
            <img src={info.logo_url} alt="" width={48} height={48} style={{ borderRadius: 7, objectFit: 'contain', border: '1px solid var(--bd)', flexShrink: 0 }} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--f1)' }}>{info.name}</span>
              {info.is_own && (
                <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--hs)', background: 'var(--hs-soft)', padding: '1px 5px', borderRadius: 5 }}>자사</span>
              )}
            </div>
            {info.company_name && (
              <div style={{ fontSize: 12, color: 'var(--f3)', marginTop: 2, cursor: 'pointer' }}
                onClick={() => info.company_id && router.push(`/company?id=${info.company_id}`)}>
                {info.company_name}
              </div>
            )}
            {info.nation_name && <div style={{ fontSize: 11, color: 'var(--f4)', marginTop: 2 }}>{info.nation_name}</div>}
          </div>
        </div>
      </div>

      {/* KPI 6카드 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <KpiCard label="TOP100 진입" value={stats?.top100Count ?? 0} sub="전체 카테고리" color="var(--hs)" />
        <KpiCard label="평균 랭킹" value={stats?.avgRank ? `${Math.round(stats.avgRank)}위` : '—'} sub="공용·전체연령" />
        <KpiCard label="랭킹 진입 SKU" value={products.length} sub="최신 스냅샷" />
        <KpiCard label="평균 할인율" value={avgDiscount != null ? `${avgDiscount}%` : '—'} sub={`${withDiscount.length}개 할인 상품`} />
        <KpiCard label="TOP100 추이" value={trendLabel} color={trendColor}
          sub={rankHistory.length >= 2 ? `${rankHistory[0].date} → ${rankHistory[rankHistory.length - 1].date}` : '수집 중'} />
        <KpiCard label="진행 프로모션" value={stats?.promoCount ?? 0} sub="현재 진행 중" />
      </div>

      {/* 성별·카테고리 분포 */}
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: 'var(--f4)', marginBottom: 6 }}>성별 분포</div>
          <div style={{ display: 'flex', height: 8, borderRadius: 3, overflow: 'hidden', background: 'var(--bs)' }}>
            {GENDER_KEYS.map((k, i) => {
              const pct = Math.round((genderMap[k] ?? 0) / genderTotal * 100);
              return pct > 0 ? <div key={k} style={{ width: `${pct}%`, background: GENDER_COLORS[i] }} /> : null;
            })}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
            {GENDER_KEYS.map((k, i) => (
              <span key={k} style={{ fontSize: 9, color: GENDER_COLORS[i], fontFamily: 'var(--mono)' }}>
                {GENDER_LABEL[k]} {Math.round((genderMap[k] ?? 0) / genderTotal * 100)}%
              </span>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: 'var(--f4)', marginBottom: 6 }}>카테고리 집중도</div>
          <div style={{ display: 'flex', height: 8, borderRadius: 3, overflow: 'hidden', background: 'var(--bs)' }}>
            {topCats.map(([code, cnt], i) => {
              const pct = Math.round((cnt / catTotal) * 100);
              return pct > 0 ? <div key={code} style={{ width: `${pct}%`, background: CAT_COLORS[i] }} /> : null;
            })}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
            {topCats.slice(0, 3).map(([code, cnt], i) => (
              <span key={code} style={{ fontSize: 9, color: CAT_COLORS[i], fontFamily: 'var(--mono)' }}>
                {CATEGORY_MAP[code] ?? code} {Math.round((cnt / catTotal) * 100)}%
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 평균 랭킹 추이 */}
      {rankHistory.length >= 2 && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 8 }}>평균 랭킹 추이 (낮을수록 좋음)</div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={rankHistory}>
              <XAxis dataKey="date" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9 }} width={30} reversed />
              <Tooltip formatter={(v: unknown) => [v as number, '평균랭킹']} labelStyle={{ fontSize: 10 }} contentStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="avg_rank" stroke="var(--hs)" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 상품 랭킹 */}
      {products.length > 0 && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 8 }}>상품 랭킹 ({products.length}개)</div>
          {products.map((p, i) => (
            <button type="button" key={p.musinsa_no} onClick={() => router.push(`/product?no=${p.musinsa_no}`)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', width: '100%', textAlign: 'left',
                paddingTop: i > 0 ? 8 : 0, marginTop: i > 0 ? 8 : 0,
                borderTop: i > 0 ? '1px solid var(--bd)' : 'none',
              }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--f4)', fontFamily: 'var(--mono)', width: 22, flexShrink: 0, textAlign: 'right' }}>
                {p.rank_position ?? '—'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.product_name}
                </div>
                <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', display: 'flex', gap: 6, marginTop: 1 }}>
                  <span>{CATEGORY_MAP[p.category_code] ?? p.category_code}</span>
                  <span>{GENDER_LABEL[p.gender_filter] ?? p.gender_filter}</span>
                  <span>{fmtPrice(p.final_price)}</span>
                  {p.discount_rate != null && p.discount_rate > 0 && (
                    <span style={{ color: p.discount_rate >= 30 ? 'var(--shf)' : 'var(--f3)' }}>−{p.discount_rate}%</span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* 랭킹 분포 */}
      {distribution.length > 0 && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 8 }}>랭킹 분포 · 카테고리별 SKU</div>
          <MobileFilterChips items={GENDER_CHIPS} activeValue={distGender} onChange={setDistGender} />
          <div style={{ marginTop: 6 }}>
            <MobileFilterChips items={AGE_CHIPS} activeValue={distAge} onChange={setDistAge} />
          </div>
          <div style={{ display: 'flex', gap: 20, margin: '10px 0', paddingBottom: 10, borderBottom: '1px solid var(--bd)' }}>
            {[['총 SKU', filteredTotal], ['TOP100', filteredTop100], ['최고순위', filteredBest ?? '—']].map(([l, v]) => (
              <div key={String(l)}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--f1)', fontFamily: 'var(--mono)' }}>{v}</div>
                <div style={{ fontSize: 10, color: 'var(--f4)' }}>{l}</div>
              </div>
            ))}
          </div>
          {catBars.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--f4)', textAlign: 'center', padding: '8px 0' }}>해당 조건 데이터 없음</div>
          ) : catBars.map(([code, cnt]) => (
            <div key={code} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <div style={{ fontSize: 10, color: 'var(--f3)', width: 52, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {CATEGORY_MAP[code] ?? code}
              </div>
              <div style={{ flex: 1, height: 8, background: 'var(--bs)', borderRadius: 5, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.round((cnt / catBarMax) * 100)}%`, background: 'var(--hs)', borderRadius: 5 }} />
              </div>
              <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', width: 20, textAlign: 'right', flexShrink: 0 }}>{cnt}</div>
            </div>
          ))}
        </div>
      )}

      {/* 가격대 분포 */}
      {priceDist.length > 0 && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 8 }}>가격대 분포</div>
          {priceDist.map(d => (
            <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <div style={{ fontSize: 10, color: 'var(--f3)', width: 36, flexShrink: 0 }}>{d.name}</div>
              <div style={{ flex: 1, height: 8, background: 'var(--bs)', borderRadius: 5, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.round((d.count / priceMax) * 100)}%`, background: 'var(--f3)', borderRadius: 5 }} />
              </div>
              <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', width: 20, textAlign: 'right', flexShrink: 0 }}>{d.count}</div>
            </div>
          ))}
        </div>
      )}

      {/* 브랜드 정보 */}
      <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 8 }}>브랜드 정보</div>
        {([
          ['국가', info.nation_name ?? '—'],
          ['설립', info.since_year ? `${info.since_year}년` : '—'],
          ['자사 브랜드', info.is_own ? 'Yes' : 'No'],
          ['법인', info.company_name ?? '—'],
          ['slug', info.slug],
        ] as [string, string][]).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '0.5px solid var(--snk)' }}>
            <span style={{ fontSize: 11, color: 'var(--f4)' }}>{k}</span>
            <span style={{ fontSize: 11, color: 'var(--f1)', fontFamily: 'var(--mono)' }}>{v}</span>
          </div>
        ))}
        {info.introduction && (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--f2)', lineHeight: '18px' }}>
            {info.introduction.slice(0, 120)}{info.introduction.length > 120 ? '…' : ''}
          </p>
        )}
      </div>
    </div>
  );
}
