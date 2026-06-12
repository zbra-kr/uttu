'use client';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import {
  fetchProductDetail, fetchProductPriceHistory, fetchProductRankHistory,
  fetchProductCategoryRanks, fetchReviews, fetchBodyStats,
  CATEGORY_MAP, AGE_MAP,
  type ProductDetail, type ReviewRow, type CategoryRankRow, type BodyStats,
} from '@/lib/queries';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';
import ReviewDetailSheet from '@/components/mobile/ReviewDetailSheet';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceDot } from 'recharts';

function fmtPrice(v: number | null): string {
  if (v == null) return '—';
  return `${v.toLocaleString()}원`;
}

function fmtDate(d: string): string { return d.slice(5); }

const FLAG_LABELS: [string, string][] = [
  ['is_musinsa_monopoly', '무신사 단독'],
  ['is_online_monopoly', '온라인 단독'],
  ['is_first', '퍼스트'],
  ['is_free_return', '무료반품'],
  ['is_drop', '드롭'],
  ['is_limited_quantity', '한정수량'],
  ['is_clearance', '클리어런스'],
  ['is_outlet', '아울렛'],
];

const SEASON_CODE: Record<string, string> = {
  SS: 'S/S', FW: 'F/W', SPRING: '봄', SUMMER: '여름', FALL: '가을', WINTER: '겨울',
};
const GENDER_LABEL: Record<string, string> = { M: '남성', F: '여성', A: '공용', U: '공용' };

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '4px 0', borderBottom: '0.5px solid var(--snk)' }}>
      <span style={{ fontSize: 11, color: 'var(--f4)', width: 68, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--f2)', flex: 1 }}>{value}</span>
    </div>
  );
}

function MiniKpi({ label, value, sub, valueColor }: { label: string; value: React.ReactNode; sub?: string; valueColor?: string }) {
  return (
    <div style={{ flex: 1, padding: '10px 12px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10, textAlign: 'center' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: valueColor ?? 'var(--f1)', fontFamily: 'var(--mono)' }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--f4)', marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 9, color: 'var(--f4)', marginTop: 1, fontFamily: 'var(--mono)' }}>{sub}</div>}
    </div>
  );
}

export default function MobileProductDetailView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const no = searchParams.get('no') ?? '';

  const [detail,         setDetail]         = useState<ProductDetail | null>(null);
  const [priceHistory,   setPriceHistory]   = useState<{ date: string; price: number; discount_rate: number | null }[]>([]);
  const [rankHistory,    setRankHistory]    = useState<{ date: string; rank: number; category: string }[]>([]);
  const [categoryRanks,  setCategoryRanks]  = useState<CategoryRankRow[]>([]);
  const [categoryDate,   setCategoryDate]   = useState('');
  const [reviews,        setReviews]        = useState<ReviewRow[]>([]);
  const [bodyStats,      setBodyStats]      = useState<BodyStats | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [selectedReview, setSelectedReview] = useState<ReviewRow | null>(null);

  useEffect(() => {
    if (!no) return;
    setLoading(true);
    Promise.all([
      fetchProductDetail(no),
      fetchProductPriceHistory(no),
      fetchProductRankHistory(no),
      fetchProductCategoryRanks(no),
    ]).then(async ([det, price, rank, cr]) => {
      setDetail(det);
      setPriceHistory(price);
      setRankHistory(rank);
      setCategoryRanks(cr.rows);
      setCategoryDate(cr.snapshot_date);
      if (det?.is_own) {
        const [rv, bs] = await Promise.all([
          fetchReviews({ productId: det.id, sort: 'recent', limit: 10 }),
          fetchBodyStats(det.id),
        ]);
        setReviews(rv.rows);
        setBodyStats(bs);
      } else if (det) {
        fetchReviews({ productId: det.id, limit: 5 }).then(({ rows }) => setReviews(rows));
      }
      setLoading(false);
    });
  }, [no]);

  if (!no) return <MobileEmptyState icon="🔍" title="상품 번호가 없습니다" />;
  if (loading) return <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>;
  if (!detail) return <MobileEmptyState icon="📦" title="상품 정보를 찾을 수 없습니다" />;

  // ── 랭킹 차트 계산 ─────────────────────────────
  const ranks = rankHistory.map(r => r.rank);
  const minRank = ranks.length > 0 ? Math.min(...ranks) : 0;
  const maxRank = ranks.length > 0 ? Math.max(...ranks) : 0;
  const rankChartData = rankHistory.map(r => ({ date: fmtDate(r.date), rank: r.rank }));
  const rankFirst = ranks[0];
  const rankLast  = ranks[ranks.length - 1];
  const rankTrend = ranks.length > 1 ? (rankLast < rankFirst ? 'up' : rankLast > rankFirst ? 'dn' : 'flat') : 'flat';
  const rankColor = rankTrend === 'up' ? 'var(--slf)' : rankTrend === 'dn' ? 'var(--shf)' : 'var(--f3)';

  // 랭킹 인사이트
  const rankMean   = ranks.length > 0 ? ranks.reduce((s, r) => s + r, 0) / ranks.length : 0;
  const rankStdDev = ranks.length >= 3
    ? Math.sqrt(ranks.reduce((s, r) => s + (r - rankMean) ** 2, 0) / ranks.length)
    : null;
  const stabilityLabel = rankStdDev === null ? '—' : rankStdDev < 5 ? '안정' : rankStdDev < 15 ? '보통' : '변동큼';
  const recent7 = ranks.slice(-7);
  const prev7   = ranks.slice(-14, -7);
  const avg7 = (a: number[]) => a.length > 0 ? a.reduce((s, r) => s + r, 0) / a.length : null;
  const velocity7d = (avg7(recent7) !== null && avg7(prev7) !== null)
    ? Math.round((avg7(prev7) as number) - (avg7(recent7) as number)) : null;
  const discountDays = priceHistory.slice(1).flatMap((ph, i) => {
    if (!ph.discount_rate || ph.discount_rate <= 0) return [];
    const rNow  = rankHistory.find(r => r.date === ph.date);
    const rPrev = rankHistory.find(r => r.date === priceHistory[i].date);
    if (!rNow || !rPrev) return [];
    return [rNow.rank - rPrev.rank];
  });
  const avgRankOnDiscount = discountDays.length > 0
    ? Math.round(discountDays.reduce((s, d) => s + d, 0) / discountDays.length) : null;

  // 가격 차트
  const prices    = priceHistory.map(p => p.price);
  const minPrice  = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice  = prices.length > 0 ? Math.max(...prices) : 0;
  const pricePad  = Math.max(Math.round((maxPrice - minPrice) * 0.15), 1000);
  const priceChartData = priceHistory.map(p => ({ date: fmtDate(p.date), price: p.price, discount: p.discount_rate ?? 0 }));

  const activeFlags = FLAG_LABELS.filter(([key]) => (detail as any)[key]).map(([, label]) => label);

  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 12px 20px', width: '100%', minWidth: 0 }}>

      {/* ── 헤더 ── */}
      <div style={{ padding: '14px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
        {detail.thumbnail_url && (
          <img src={detail.thumbnail_url} alt="" style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', borderRadius: 8, marginBottom: 12 }} />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span
            style={{ fontSize: 12, color: 'var(--f3)', cursor: 'pointer' }}
            onClick={() => detail.brand_id && router.push(`/brand?id=${detail.brand_id}`)}
          >
            {detail.brand_name}
          </span>
          {detail.company_name && (
            <span
              style={{ fontSize: 11, color: 'var(--f4)', cursor: 'pointer' }}
              onClick={() => detail.company_id && router.push(`/company?id=${detail.company_id}`)}
            >
              · {detail.company_name}
            </span>
          )}
          {detail.is_own && (
            <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--hs)', background: 'var(--hs-soft)', padding: '1px 5px', borderRadius: 4, marginLeft: 'auto' }}>자사</span>
          )}
        </div>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--f1)', lineHeight: 1.4 }}>
          {detail.name}
        </h1>
        {detail.name_eng && (
          <div style={{ fontSize: 11, color: 'var(--f4)', fontStyle: 'italic', marginTop: 2 }}>{detail.name_eng}</div>
        )}
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--f1)', fontFamily: 'var(--mono)' }}>
            {fmtPrice(detail.final_price)}
          </span>
          {detail.discount_rate != null && detail.discount_rate > 0 && (
            <span style={{ fontSize: 13, color: 'var(--td)', fontFamily: 'var(--mono)', fontWeight: 600 }}>-{Math.round(detail.discount_rate)}%</span>
          )}
          {detail.list_price != null && detail.list_price !== detail.final_price && (
            <span style={{ fontSize: 11, color: 'var(--f4)', textDecoration: 'line-through', fontFamily: 'var(--mono)' }}>{fmtPrice(detail.list_price)}</span>
          )}
        </div>
        <a
          href={`https://www.musinsa.com/products/${detail.musinsa_no}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'inline-block', marginTop: 8, fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', textDecoration: 'none' }}
        >
          무신사 보기 ↗
        </a>
      </div>

      {/* ── KPI 3칸 ── */}
      <div style={{ display: 'flex', gap: 8 }}>
        <MiniKpi
          label="현재 랭킹"
          value={detail.rank_position ? `#${detail.rank_position}` : '—'}
          valueColor={detail.rank_position && detail.rank_position <= 10 ? 'var(--hs)' : undefined}
        />
        <MiniKpi
          label="별점"
          value={detail.satisfaction_score != null ? `★${detail.satisfaction_score}` : '—'}
          sub={detail.review_count > 0 ? `리뷰 ${detail.review_count.toLocaleString()}건` : undefined}
          valueColor="var(--smf)"
        />
        <MiniKpi
          label="리뷰점수"
          value={detail.review_score != null ? `${detail.review_score}%` : '—'}
        />
      </div>

      {/* ── 랭킹 추이 ── */}
      {rankHistory.length >= 2 && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>랭킹 추이 ({rankHistory.length}일)</span>
            <span style={{ fontSize: 11, color: rankColor, fontFamily: 'var(--mono)', fontWeight: 600 }}>
              {rankTrend === 'up' ? '↑ ' : rankTrend === 'dn' ? '↓ ' : ''}#{rankFirst} → #{rankLast}
            </span>
          </div>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={rankChartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--f4)', fontFamily: 'var(--mono)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis reversed
                domain={[Math.max(1, minRank - Math.max(2, Math.round((maxRank - minRank) * 0.2))), maxRank + Math.max(2, Math.round((maxRank - minRank) * 0.2))]}
                tick={{ fontSize: 9, fill: 'var(--f4)', fontFamily: 'var(--mono)' }} tickLine={false} axisLine={false} width={30} tickFormatter={v => `#${v}`}
              />
              <Tooltip contentStyle={{ background: 'var(--sur)', border: '0.5px solid var(--bs)', borderRadius: 4, fontSize: 11 }} formatter={(v: unknown) => [`#${v}`, '순위']} labelStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="rank" stroke={rankColor} strokeWidth={2} dot={rankChartData.length <= 7} activeDot={{ r: 4 }} />
              <ReferenceDot x={rankChartData[ranks.indexOf(minRank)]?.date} y={minRank} r={4} fill={rankColor} stroke="var(--sur)" strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── 가격 추이 ── */}
      {priceHistory.length >= 2 && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>가격 추이 ({priceHistory.length}일)</span>
            <span style={{ fontSize: 11, color: 'var(--f3)', fontFamily: 'var(--mono)' }}>
              {minPrice === maxPrice ? `${minPrice.toLocaleString()}원` : `${minPrice.toLocaleString()} ~ ${maxPrice.toLocaleString()}원`}
            </span>
          </div>
          <ResponsiveContainer width="100%" height={130}>
            <LineChart data={priceChartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--f4)', fontFamily: 'var(--mono)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis domain={[minPrice - pricePad, maxPrice + pricePad]} tick={{ fontSize: 9, fill: 'var(--f4)' }} tickLine={false} axisLine={false} width={44} tickFormatter={v => `${Math.round(v / 1000)}k`} />
              <Tooltip contentStyle={{ background: 'var(--sur)', border: '0.5px solid var(--bs)', borderRadius: 4, fontSize: 11 }} formatter={(v: unknown) => [`${Number(v).toLocaleString()}원`, '가격']} labelStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="price" stroke="var(--f1)" strokeWidth={2} dot={priceChartData.length <= 7} activeDot={{ r: 4 }} />
              {priceChartData.filter(d => d.discount > 0).map(d => (
                <ReferenceDot key={d.date} x={d.date} y={d.price} r={4} fill="var(--shf)" stroke="var(--sur)" strokeWidth={1.5} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── 랭킹 인사이트 ── */}
      {ranks.length >= 2 && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 10 }}>랭킹 인사이트</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <MiniKpi label="안정성" value={stabilityLabel} sub={rankStdDev !== null ? `σ ${rankStdDev.toFixed(1)}` : undefined} />
            <MiniKpi
              label="7일 추세"
              value={velocity7d === null ? '—' : velocity7d > 0 ? `↑ ${velocity7d}` : velocity7d < 0 ? `↓ ${Math.abs(velocity7d)}` : '보합'}
              valueColor={velocity7d === null ? undefined : velocity7d > 0 ? 'var(--slf)' : velocity7d < 0 ? 'var(--shf)' : undefined}
              sub="전전주 대비"
            />
            <MiniKpi
              label="할인 반응"
              value={avgRankOnDiscount === null ? '—' : avgRankOnDiscount < 0 ? `↑ ${Math.abs(avgRankOnDiscount)}` : avgRankOnDiscount > 0 ? `↓ ${avgRankOnDiscount}` : '변화없음'}
              valueColor={avgRankOnDiscount === null ? undefined : avgRankOnDiscount < 0 ? 'var(--slf)' : avgRankOnDiscount > 0 ? 'var(--shf)' : undefined}
              sub={discountDays.length > 0 ? `${discountDays.length}일 관측` : '데이터 없음'}
            />
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', paddingTop: 8, borderTop: '0.5px dashed var(--bs)' }}>
            <span>최고 #{minRank}</span>
            <span>최저 #{maxRank}</span>
            <span>평균 #{Math.round(rankMean)}</span>
          </div>
        </div>
      )}

      {/* ── 베스트 랭킹 기록 ── */}
      {detail.ranking_best_records.length > 0 && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 8 }}>
            베스트 랭킹 기록 ({detail.ranking_best_records.length}건)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[...detail.ranking_best_records]
              .sort((a, b) => a.rank - b.rank)
              .slice(0, 10)
              .map((rec, i) => (
                <div key={`${rec.year}-${rec.month}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '0.5px solid var(--snk)' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--mono)', color: rec.rank <= 10 ? 'var(--hs)' : rec.rank <= 50 ? 'var(--slf)' : 'var(--f2)', width: 40 }}>
                    #{rec.rank}
                  </span>
                  <span style={{ flex: 1, fontSize: 11, color: 'var(--f2)' }}>{rec.depth1CategoryName}</span>
                  <span style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>
                    {rec.year}.{String(rec.month).padStart(2, '0')} · {rec.gender}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ── 카테고리 침투율 ── */}
      {categoryRanks.length > 0 && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>카테고리 침투율</span>
            {categoryDate && <span style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>{categoryDate} 기준</span>}
          </div>
          {categoryRanks.map((r, i) => (
            <div key={r.category_code} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 0', borderBottom: '0.5px solid var(--snk)' }}>
              <span style={{ fontSize: 12, color: 'var(--f2)', width: 60, flexShrink: 0 }}>
                {CATEGORY_MAP[r.category_code] ?? r.category_code}
              </span>
              <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {r.segments.map((s, j) => {
                  const sg = s.gender === 'M' ? '남' : s.gender === 'F' ? '여' : '전체';
                  const sa = s.age && s.age !== 'AGE_BAND_ALL' ? (AGE_MAP[s.age] ?? s.age) : '전체';
                  const isBest = s.gender === r.best_gender && s.age === r.best_age;
                  return (
                    <span key={j} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: isBest ? 'var(--hs)' : 'var(--snk)', color: isBest ? 'var(--white)' : 'var(--f3)' }}>
                      {sg}·{sa} #{s.rank}
                    </span>
                  );
                })}
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--mono)', color: r.best_rank === 1 ? 'var(--hs)' : r.best_rank <= 10 ? 'var(--slf)' : 'var(--f2)', flexShrink: 0 }}>
                #{r.best_rank}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── 기본정보 ── */}
      <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 8 }}>기본정보</div>
        <InfoRow label="무신사 번호" value={`#${detail.musinsa_no}`} />
        {detail.style_no && <InfoRow label="스타일번호" value={detail.style_no} />}
        <InfoRow label="카테고리" value={detail.category_d2_name
          ? `${detail.category_d2_name}${detail.category_d3_name ? ' / ' + detail.category_d3_name : ''}`
          : (CATEGORY_MAP[detail.category_code] ?? detail.category_code)} />
        {detail.gender && <InfoRow label="성별" value={GENDER_LABEL[detail.gender] ?? detail.gender} />}
        {detail.season_year && (
          <InfoRow label="시즌" value={`${detail.season_year} ${detail.season_code ? (SEASON_CODE[detail.season_code] ?? detail.season_code) : ''}`.trim()} />
        )}
      </div>

      {/* ── 소재·핏 ── */}
      {(detail.fit || detail.texture || detail.elasticity || detail.transparency || detail.thickness || detail.item_seasons.length > 0) && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 8 }}>소재·핏</div>
          {detail.fit          && <InfoRow label="핏"       value={detail.fit} />}
          {detail.texture      && <InfoRow label="소재감"   value={detail.texture} />}
          {detail.elasticity   && <InfoRow label="신축성"   value={detail.elasticity} />}
          {detail.transparency && <InfoRow label="비침"     value={detail.transparency} />}
          {detail.thickness    && <InfoRow label="두께감"   value={detail.thickness} />}
          {detail.item_seasons.length > 0 && <InfoRow label="착용시즌" value={detail.item_seasons.join(', ')} />}
        </div>
      )}

      {/* ── 태그 ── */}
      {(activeFlags.length > 0 || detail.labels.length > 0) && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 8 }}>태그</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {activeFlags.map(label => (
              <span key={label} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'var(--hs-soft)', color: 'var(--hs)', border: '0.5px solid var(--hs)' }}>
                {label}
              </span>
            ))}
            {detail.labels.map(l => (
              <span key={l} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'var(--snk)', color: 'var(--f3)' }}>
                {l}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── 컬러 / 사이즈 ── */}
      {(detail.colors.length > 0 || detail.sizes.length > 0) && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
          {detail.colors.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 6 }}>컬러</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                {detail.colors.map(c => (
                  <span key={c} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, background: 'var(--snk)', color: 'var(--f3)', fontFamily: 'var(--mono)' }}>{c}</span>
                ))}
              </div>
            </>
          )}
          {detail.sizes.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 6 }}>사이즈</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {detail.sizes.map(s => (
                  <span key={s} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, background: 'var(--snk)', color: 'var(--f3)', fontFamily: 'var(--mono)' }}>{s}</span>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── 체형별 리뷰 통계 (자사만) ── */}
      {detail.is_own && bodyStats && (bodyStats.byHeight.length > 0 || bodyStats.byWeight.length > 0) && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>체형별 평균 별점</span>
            <span style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>{bodyStats.totalSampled.toLocaleString()}건 기준</span>
          </div>
          {[
            { title: '키', buckets: bodyStats.byHeight },
            { title: '몸무게', buckets: bodyStats.byWeight },
          ].filter(g => g.buckets.length > 0).map(group => (
            <div key={group.title} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--f3)', marginBottom: 6 }}>{group.title}</div>
              {group.buckets.map(b => (
                <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, padding: '4px 8px', borderRadius: 6, background: 'var(--snk)' }}>
                  <span style={{ width: 54, fontSize: 10, color: 'var(--f4)', textAlign: 'right', flexShrink: 0 }}>{b.label}</span>
                  <span style={{ fontSize: 13, color: b.avgRating >= 4 ? 'var(--hs)' : b.avgRating >= 3 ? 'var(--f3)' : 'var(--td)' }}>
                    {'★'.repeat(Math.round(b.avgRating))}{'☆'.repeat(5 - Math.round(b.avgRating))}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: 'var(--f1)', fontFamily: 'var(--mono)' }}>{b.avgRating.toFixed(1)}</span>
                  <span style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>{b.count}건</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ── 리뷰 ── */}
      {reviews.length > 0 && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 8 }}>
            {detail.is_own ? `최근 리뷰 (${reviews.length}건)` : '최근 리뷰'}
          </div>
          {reviews.map((r, i) => (
            <div key={r.id}
              onClick={() => setSelectedReview(r)}
              style={{ borderTop: i > 0 ? '1px solid var(--bd)' : undefined, paddingTop: i > 0 ? 10 : 0, marginTop: i > 0 ? 10 : 0, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, color: r.rating >= 4 ? 'var(--slf)' : r.rating <= 2 ? 'var(--shf)' : 'var(--f3)' }}>
                    {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                  </span>
                  {r.has_image && (
                    <span style={{ fontSize: 9, background: 'var(--hs)', color: 'var(--white)', padding: '1px 4px', borderRadius: 2 }}>📷 {r.image_urls.length}</span>
                  )}
                </div>
                <span style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>{r.review_date.slice(0, 10)}</span>
              </div>
              {r.review_text && (
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--f2)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {r.review_text}
                </p>
              )}
              {(r.purchase_option || r.member_height || r.member_weight || r.satisfactions?.length) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
                  {r.purchase_option && (
                    <span style={{ fontSize: 10, background: 'var(--hs)', color: 'var(--white)', padding: '1px 5px', borderRadius: 3, fontWeight: 500 }}>{r.purchase_option}</span>
                  )}
                  {(r.member_height || r.member_weight) && (
                    <span style={{ fontSize: 10, background: 'var(--snk)', padding: '1px 5px', borderRadius: 3, color: 'var(--f3)' }}>
                      {[r.member_height ? `${r.member_height}cm` : null, r.member_weight ? `${r.member_weight}kg` : null].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  {r.satisfactions?.slice(0, 2).map((s, j) => (
                    <span key={j} style={{ fontSize: 10, background: 'var(--snk)', padding: '1px 5px', borderRadius: 3, color: 'var(--f4)' }}>
                      {s.attribute}: <strong style={{ color: 'var(--f3)' }}>{s.answer}</strong>
                    </span>
                  ))}
                </div>
              )}
              {r.helpful_count > 0 && (
                <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 4 }}>👍 {r.helpful_count}</div>
              )}
            </div>
          ))}
          {detail.is_own && (
            <div
              onClick={() => router.push('/reviews')}
              style={{ marginTop: 10, fontSize: 12, color: 'var(--hs)', cursor: 'pointer', fontFamily: 'var(--mono)' }}
            >
              전체 리뷰 →
            </div>
          )}
        </div>
      )}
      {!detail.is_own && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10, fontSize: 12, color: 'var(--f4)' }}>
          리뷰는 자사 상품만 수집합니다
        </div>
      )}
    </div>

    {selectedReview && (
      <ReviewDetailSheet
        review={selectedReview}
        showProductButton={false}
        onClose={() => setSelectedReview(null)}
      />
    )}
    </>
  );
}
