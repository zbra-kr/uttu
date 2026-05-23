'use client';
import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  fetchLatestRanking, fetchReviewStats, fetchAnomalySignals,
  fetchCollectionStats, fetchOwnBrandBreakdown, fetchActivePromotions,
  type RankingRow, type CollectionStat, type OwnBrandStat, type PromoSummary, type AnomalyRow,
} from '@/lib/queries';
import { IcRanking, IcBrandRanking, IcFlag, IcReview, IcPromo, IcArrowUR, IcProduct } from '@/components/ui/icons';

const fmt  = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString();
const fmtK = (n: number | null | undefined) => n == null ? '—' : `${Math.round(n / 1000).toLocaleString()}K`;

const PROMO_TYPE_LABEL: Record<string, string> = {
  limited_offer: '선착순특가',
  daily_sale:    '하루특가',
  brand_week:    '브랜드위크',
  general:       '기획전',
};

const COLL_STATUS_LABEL: Record<string, string> = { active: '활성', partial: '진행', pending: '대기' };
const COLL_STATUS_SEV:   Record<string, string> = { active: 'lo',   partial: 'md',   pending: 'hi' };

const GENDER_OPTS: [string, string][] = [['A', '전체'], ['M', '남성'], ['F', '여성']];

// 이상탐지 영역/이벤트 레이블
const ANOMALY_EVENT: Record<string, string> = {
  rank_spike:           '순위 급등',
  rank_drop_own:        '자사 순위 이탈',
  new_entrant_top10:    'TOP10 신규 진입',
  sold_out:             '품절 전환',
  price_drop:           '가격 급락',
  promo_heavy_discount: '고할인 프로모션',
  review_count_surge:   '리뷰 폭증',
  review_rating_drop:   '별점 급락',
  review_negative_surge:'부정 리뷰 급증',
};

export default function HomePage() {
  const router = useRouter();

  const [collStats,   setCollStats]   = React.useState<CollectionStat[]>([]);
  const [ranking,     setRanking]     = React.useState<RankingRow[]>([]);
  const [rankGender,  setRankGender]  = React.useState<string>('A');
  const [rankLoading, setRankLoading] = React.useState(true);
  const [ownBrands,   setOwnBrands]   = React.useState<OwnBrandStat[]>([]);
  const [anomalies,   setAnomalies]   = React.useState<AnomalyRow[]>([]);
  const [reviewStats, setReviewStats] = React.useState<{ total: number; avgRating: number; lowCount: number; ratingDist: number[] } | null>(null);
  const [promos,      setPromos]      = React.useState<PromoSummary[]>([]);
  const [loading,     setLoading]     = React.useState(true);

  React.useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchCollectionStats().then(setCollStats).catch(() => {}),
      fetchOwnBrandBreakdown().then(setOwnBrands).catch(() => {}),
      fetchAnomalySignals().then(setAnomalies).catch(() => {}),
      fetchReviewStats(30).then(setReviewStats).catch(() => {}),
      fetchActivePromotions(10).then(setPromos).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    setRankLoading(true);
    fetchLatestRanking({ genderFilter: rankGender, limit: 10 })
      .then(setRanking)
      .catch(() => setRanking([]))
      .finally(() => setRankLoading(false));
  }, [rankGender]);

  // 집계 파생
  const rankStat    = collStats.find(s => s.id === 'ranking');
  const brankStat   = collStats.find(s => s.id === 'brand-ranking');
  const ownStat     = collStats.find(s => s.id === 'own-products');
  const reviewStat  = collStats.find(s => s.id === 'reviews');
  const promoStat   = collStats.find(s => s.id === 'promotions');
  const latestDate  = rankStat?.latestDate ?? '—';
  const ownTop100   = ownBrands.reduce((s, b) => s + b.top100_count, 0);
  const totalSku    = ownBrands.reduce((s, b) => s + b.sku_count, 0);

  const kpis = [
    { label: '상품 랭킹 스냅샷', val: fmt(rankStat?.count),  sub: `최근 ${latestDate}`,                  Icon: IcRanking,      link: '/ranking' },
    { label: '브랜드 랭킹',      val: fmt(brankStat?.count), sub: `최근 ${latestDate}`,                  Icon: IcBrandRanking, link: '/brand-ranking' },
    { label: '자사 SKU',        val: fmt(totalSku || ownStat?.count), sub: `${ownBrands.length}개 브랜드`, Icon: IcProduct,     link: '/matching' },
    { label: 'TOP100 진입',     val: fmt(ownTop100),        sub: `${latestDate} 기준`,                  Icon: null,           link: '/ranking' },
    { label: '수집 리뷰',       val: fmt(reviewStat?.count), sub: `평균 ★${reviewStats?.avgRating ?? '—'}`, Icon: IcReview,    link: '/reviews' },
    { label: '프로모션',         val: fmt(promoStat?.count), sub: `${promos.length}개 모듈`,              Icon: IcPromo,        link: '/promo' },
  ];

  return (
    <>
      {/* KPI 스트립 */}
      <div className="grid grid-6 gap-8">
        {kpis.map((k, i) => (
          <Link key={i} href={k.link} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="kpi" style={{ cursor: 'pointer', transition: 'background 80ms' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--hov)')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}>
              <div className="row-flex between center" style={{ marginBottom: 2 }}>
                <span className="label">{k.label}</span>
                {k.Icon && <k.Icon size={13} style={{ color: 'var(--f4)' }} />}
              </div>
              <div className="val">{loading ? '…' : k.val}</div>
              <div className="dlt"><span className="muted">{k.sub}</span></div>
            </div>
          </Link>
        ))}
      </div>

      {/* Row 1: TOP10 랭킹 + 수집 현황 */}
      <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr', gap: 14 }}>

        {/* 오늘의 랭킹 TOP10 */}
        <section className="panel col-flex">
          <div className="sec-head">
            <h3>오늘의 랭킹 <span className="sub">TOP10 · {latestDate} · 전체 카테고리</span></h3>
            <div className="row-flex gap-4">
              {GENDER_OPTS.map(([g, l]) => (
                <button key={g} className={`btn sm${rankGender === g ? ' active' : ''}`}
                  onClick={() => setRankGender(g)}>{l}</button>
              ))}
              <Link href="/ranking" className="btn sm"><IcArrowUR size={10} /> 전체</Link>
            </div>
          </div>
          <div className="tbl flex-1">
            <div className="row head" style={{ gridTemplateColumns: '30px 34px 1fr 72px 40px 36px' }}>
              <span>순위</span><span>변동</span><span>상품</span>
              <span style={{ textAlign: 'right' }}>가격</span>
              <span style={{ textAlign: 'right' }}>할인</span>
              <span>자사</span>
            </div>
            {ranking.slice(0, 10).map((r, i) => (
              <div key={i}
                className={`row hover${i % 2 ? ' alt' : ''}`}
                style={{ gridTemplateColumns: '30px 34px 1fr 72px 40px 36px', cursor: 'pointer' }}
                onClick={() => router.push(`/product?no=${r.musinsa_no}`)}>
                <span className="mono" style={{ fontSize: 11, fontWeight: 500, color: i < 3 ? 'var(--hs)' : 'var(--f2)' }}>
                  {r.rank_position}
                </span>
                <span style={{ fontSize: 10 }}>
                  {r.rank_change == null
                    ? <span className="dim" style={{ fontSize: 9 }}>NEW</span>
                    : r.rank_change > 0  ? <span className="up">↑{r.rank_change}</span>
                    : r.rank_change < 0  ? <span className="dn">↓{Math.abs(r.rank_change)}</span>
                    : <span className="dim">—</span>}
                </span>
                <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ color: 'var(--f4)', fontSize: 10, marginRight: 4 }}>{r.brand_name}</span>
                  {r.product_name}
                </span>
                <span className="mono" style={{ fontSize: 11, textAlign: 'right', color: 'var(--f2)' }}>
                  {r.final_price != null ? fmtK(r.final_price) : '—'}
                </span>
                <span className="mono" style={{ fontSize: 10, textAlign: 'right', color: 'var(--td)' }}>
                  {r.discount_rate != null && r.discount_rate > 0 ? `${Math.round(r.discount_rate)}%` : ''}
                </span>
                <span>
                  {r.is_own && (
                    <span className="sev lo" style={{ fontSize: 9, padding: '1px 4px' }}>자사</span>
                  )}
                </span>
              </div>
            ))}
            {ranking.length === 0 && (
              <div className="row" style={{ gridTemplateColumns: '1fr' }}>
                <span className="dim" style={{ fontSize: 12, textAlign: 'center', padding: '24px 0' }}>
                  {rankLoading ? '로딩 중…' : '랭킹 데이터 없음'}
                </span>
              </div>
            )}
          </div>
        </section>

        {/* 수집 현황 */}
        <section className="panel surface col-flex">
          <div className="sec-head">
            <h3>수집 현황
              <span className="sub">
                {collStats.filter(s => s.status === 'active').length}활성 ·
                {collStats.filter(s => s.status === 'pending').length}대기
              </span>
            </h3>
          </div>
          <div className="tbl flex-1">
            <div className="row head" style={{ gridTemplateColumns: '1fr 72px 44px 40px' }}>
              <span>항목</span>
              <span style={{ textAlign: 'right' }}>건수</span>
              <span style={{ textAlign: 'right' }}>최근</span>
              <span style={{ textAlign: 'right' }}>상태</span>
            </div>
            {collStats.length === 0 && loading && (
              <div className="row" style={{ gridTemplateColumns: '1fr' }}>
                <span className="dim" style={{ fontSize: 12, textAlign: 'center', padding: '16px 0' }}>로딩 중…</span>
              </div>
            )}
            {collStats.map((s, i) => (
              <div key={s.id}
                className={`row${s.link ? ' hover' : ''}${i % 2 ? ' alt' : ''}`}
                style={{ gridTemplateColumns: '1fr 72px 44px 40px', cursor: s.link ? 'pointer' : 'default' }}
                onClick={() => s.link && router.push(s.link)}>
                <span style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.label}
                </span>
                <span className="mono" style={{ textAlign: 'right', fontSize: 11 }}>
                  {s.status === 'pending' && s.count === 0
                    ? <span className="dim">—</span>
                    : s.target != null
                    ? <><span>{fmt(s.count)}</span><span className="dim">/{fmt(s.target)}</span></>
                    : fmt(s.count)}
                </span>
                <span className="mono dim" style={{ textAlign: 'right', fontSize: 10 }}>
                  {s.latestDate ?? '—'}
                </span>
                <span style={{ textAlign: 'right' }}>
                  <span className={`sev ${COLL_STATUS_SEV[s.status]}`} style={{ fontSize: 9, padding: '1px 4px' }}>
                    <span className="pip" />{COLL_STATUS_LABEL[s.status]}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* 자사 상품 현황 섹션 구분선 */}
      <div className="row-flex between center" style={{ borderBottom: '0.5px solid var(--bs)', paddingBottom: 8 }}>
        <div className="row-flex baseline gap-10">
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 500, letterSpacing: '-0.014em' }}>자사 상품 현황</h2>
          <span className="sec-tag">커버낫 · 리 · 와키윌리 · 7개 브랜드</span>
        </div>
        <div className="row-flex gap-6">
          <Link href="/reviews" className="btn sm"><IcReview size={11} /> 리뷰</Link>
          <Link href="/matching" className="btn sm">자사 매칭 ↗</Link>
        </div>
      </div>

      {/* Row 2: 브랜드별 현황 + 이상탐지 + 리뷰 */}
      <div className="grid" style={{ gridTemplateColumns: '1.1fr 1fr 0.85fr', gap: 14, minHeight: 300 }}>

        {/* 브랜드별 현황 */}
        <section className="panel col-flex">
          <div className="sec-head">
            <h3>브랜드별 현황 <span className="sub">SKU · TOP100 · 만족도</span></h3>
            <Link href="/ranking" className="btn sm"><IcRanking size={11} /> 랭킹</Link>
          </div>
          <div className="tbl flex-1">
            <div className="row head" style={{ gridTemplateColumns: '1fr 56px 60px 56px' }}>
              <span>브랜드</span>
              <span style={{ textAlign: 'right' }}>SKU</span>
              <span style={{ textAlign: 'right' }}>TOP100</span>
              <span style={{ textAlign: 'right' }}>만족도</span>
            </div>
            {ownBrands.map((b, i) => (
              <div key={b.slug}
                className={`row hover${i % 2 ? ' alt' : ''}`}
                style={{ gridTemplateColumns: '1fr 56px 60px 56px', cursor: 'pointer' }}
                onClick={() => router.push('/ranking')}>
                <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.name}
                </span>
                <span className="mono" style={{ textAlign: 'right', fontSize: 11 }}>{fmt(b.sku_count)}</span>
                <span className="mono" style={{ textAlign: 'right', fontSize: 11 }}>
                  {b.top100_count > 0
                    ? <span style={{ color: 'var(--tu)', fontWeight: 500 }}>{b.top100_count}</span>
                    : <span className="dim">0</span>}
                </span>
                <span className="mono" style={{ textAlign: 'right', fontSize: 11 }}>
                  {b.avg_satisfaction != null
                    ? <><span style={{ color: 'var(--hs)' }}>★</span>{b.avg_satisfaction}</>
                    : <span className="dim">—</span>}
                </span>
              </div>
            ))}
            {ownBrands.length === 0 && (
              <div className="row" style={{ gridTemplateColumns: '1fr' }}>
                <span className="dim" style={{ fontSize: 12, textAlign: 'center', padding: '20px 0' }}>
                  {loading ? '로딩 중…' : '브랜드 없음'}
                </span>
              </div>
            )}
            {/* 합계 행 */}
            {ownBrands.length > 0 && (
              <div className="row" style={{ gridTemplateColumns: '1fr 56px 60px 56px', background: 'var(--snk)', borderTop: '0.5px solid var(--bs)' }}>
                <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--f2)' }}>합계</span>
                <span className="mono" style={{ textAlign: 'right', fontSize: 11, fontWeight: 500 }}>{fmt(totalSku)}</span>
                <span className="mono" style={{ textAlign: 'right', fontSize: 11, fontWeight: 500, color: 'var(--tu)' }}>{fmt(ownTop100)}</span>
                <span className="mono dim" style={{ textAlign: 'right', fontSize: 10 }}>—</span>
              </div>
            )}
          </div>
        </section>

        {/* 이상탐지 */}
        <section className="panel col-flex">
          <div className="sec-head">
            <h3>이상탐지 <span className="sub">최근 7일 · {anomalies.length}건</span></h3>
            <Link href="/anomaly" className="btn sm"><IcFlag size={11} /> 전체</Link>
          </div>
          <div className="tbl flex-1">
            <div className="row head" style={{ gridTemplateColumns: '40px 40px 1fr' }}>
              <span>날짜</span><span>등급</span><span>이벤트</span>
            </div>
            {anomalies.slice(0, 8).map((a, i) => (
              <div key={i}
                className={`row hover${i % 2 ? ' alt' : ''}`}
                style={{ gridTemplateColumns: '40px 40px 1fr', cursor: 'pointer' }}
                onClick={() => router.push('/anomaly')}>
                <span className="mono dim" style={{ fontSize: 10 }}>{String(a[0]).slice(5)}</span>
                <span>
                  <span className={`sev ${a[1]}`} style={{ fontSize: 9, padding: '1px 4px' }}>
                    <span className="pip" />{String(a[1]).toUpperCase()}
                  </span>
                </span>
                <span style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span className="dim" style={{ fontSize: 10, marginRight: 3 }}>{a[2]}</span>
                  {a[3]}
                </span>
              </div>
            ))}
            {anomalies.length === 0 && (
              <div className="row" style={{ gridTemplateColumns: '1fr' }}>
                <span className="dim" style={{ fontSize: 12, textAlign: 'center', padding: '20px 0' }}>
                  {loading ? '로딩 중…' : '탐지된 이상 없음'}
                </span>
              </div>
            )}
          </div>
          {anomalies.length > 0 && (
            <div style={{ marginTop: 'auto', paddingTop: 6, borderTop: '0.5px dashed var(--bs)' }}>
              <div className="row-flex gap-8" style={{ padding: '4px 0 2px' }}>
                {(['hi', 'md', 'lo'] as const).map(sev => {
                  const cnt = anomalies.filter(a => a[1] === sev).length;
                  return cnt > 0 ? (
                    <span key={sev} className={`sev ${sev}`} style={{ fontSize: 10, padding: '2px 6px' }}>
                      <span className="pip" />{sev.toUpperCase()} {cnt}
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          )}
        </section>

        {/* 리뷰 현황 */}
        <section className="panel col-flex">
          <div className="sec-head">
            <h3>리뷰 현황 <span className="sub">최근 30일</span></h3>
            <Link href="/reviews" className="btn sm"><IcReview size={11} /> 분석</Link>
          </div>

          {reviewStats ? (
            <>
              <div className="row-flex baseline gap-12" style={{ marginBottom: 16 }}>
                <div>
                  <span className="mono" style={{ fontSize: 32, fontWeight: 500, color: 'var(--hs)', lineHeight: 1 }}>
                    ★{reviewStats.avgRating}
                  </span>
                </div>
                <div className="col-flex gap-3">
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{fmt(reviewStats.total)}건</span>
                  <span className="dim" style={{ fontSize: 11 }}>저점 리뷰 {fmt(reviewStats.lowCount)}건</span>
                </div>
              </div>
              <div className="col-flex gap-5" style={{ flex: 1 }}>
                {[5, 4, 3, 2, 1].map((star, idx) => {
                  const count = reviewStats.ratingDist[idx] ?? 0;
                  const pct = reviewStats.total > 0 ? (count / reviewStats.total) * 100 : 0;
                  return (
                    <div key={star} className="row-flex center gap-6">
                      <span className="mono" style={{ fontSize: 10, color: 'var(--f4)', width: 14, textAlign: 'right', flexShrink: 0 }}>★{star}</span>
                      <div style={{ flex: 1, height: 7, background: 'var(--snk)', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{
                          width: `${pct}%`, height: '100%', borderRadius: 4,
                          background: star >= 4 ? 'var(--tu)' : star <= 2 ? 'var(--td)' : 'var(--f3)',
                          transition: 'width 500ms ease',
                        }} />
                      </div>
                      <span className="mono dim" style={{ fontSize: 10, width: 30, textAlign: 'right', flexShrink: 0 }}>{fmt(count)}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 12, paddingTop: 8, borderTop: '0.5px dashed var(--bs)' }}>
                <Link href="/reviews" className="btn sm" style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                  리뷰 상세 보기 ↗
                </Link>
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="dim" style={{ fontSize: 12 }}>{loading ? '로딩 중…' : '데이터 없음'}</span>
            </div>
          )}
        </section>
      </div>

      {/* 프로모션 현황 */}
      {promos.length > 0 && (
        <section className="panel">
          <div className="sec-head">
            <h3>현재 프로모션 <span className="sub">{promos.length}개 모듈 · 무신사 세일탭</span></h3>
            <div className="row-flex gap-4">
              <Link href="/promo" className="btn sm"><IcPromo size={11} /> 전체보기</Link>
            </div>
          </div>
          <div className="tbl">
            <div className="row head" style={{ gridTemplateColumns: '100px 1fr 60px 72px 52px' }}>
              <span>유형</span><span>제목</span>
              <span style={{ textAlign: 'right' }}>상품</span>
              <span style={{ textAlign: 'right' }}>마감</span>
              <span style={{ textAlign: 'right' }}>수집일</span>
            </div>
            {promos.map((p, i) => (
              <div key={p.id}
                className={`row hover${i % 2 ? ' alt' : ''}`}
                style={{ gridTemplateColumns: '100px 1fr 60px 72px 52px', cursor: 'pointer' }}
                onClick={() => router.push('/promo')}>
                <span>
                  <span className="sev lo" style={{ fontSize: 9, padding: '1px 5px' }}>
                    {PROMO_TYPE_LABEL[p.promotion_type] ?? p.promotion_type}
                  </span>
                </span>
                <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.title}
                </span>
                <span className="mono" style={{ textAlign: 'right', fontSize: 11 }}>{fmt(p.items_count)}</span>
                <span className="mono dim" style={{ textAlign: 'right', fontSize: 10 }}>
                  {p.end_at ? new Date(p.end_at).toISOString().slice(5, 10) : '상시'}
                </span>
                <span className="mono dim" style={{ textAlign: 'right', fontSize: 10 }}>
                  {p.snapshot_date.slice(5)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
