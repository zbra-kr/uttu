'use client';
import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useIsMobile } from '@/hooks/useViewport';
import MobileHomeView from './MobileHomeView';
import {
  fetchLatestRanking, fetchReviewStats, fetchAnomalySignals,
  fetchCollectionStats, fetchOwnBrandBreakdown, fetchActivePromotions, fetchTopBrandRanking,
  fetchActiveJobs,
  type RankingRow, type CollectionStat, type OwnBrandStat, type PromoSummary, type AnomalyRow, type BrandRankRow,
  type CollectionJob,
} from '@/lib/queries';
import { supabaseBrowser } from '@/lib/supabase/client';
import { IcRanking, IcBrandRanking, IcFlag, IcReview, IcPromo, IcArrowUR, IcProduct } from '@/components/ui/icons';

const fmt    = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString();
const fmtMan = (n: number | null) => n == null ? '—' : (n / 10000).toFixed(1) + '만';

const PROMO_TYPE_SEV: Record<string, string> = {
  limited_offer: 'hi',
  daily_sale:    'md',
  brand_week:    'hs',
  general:       'lo',
};

const PROMO_TYPE_LABEL: Record<string, string> = {
  limited_offer: '선착순특가',
  daily_sale:    '하루특가',
  brand_week:    '브랜드위크',
  general:       '기획전',
};

const COLL_STATUS_LABEL: Record<string, string> = { active: '활성', partial: '미완', pending: '대기' };
const COLL_STATUS_SEV:   Record<string, string> = { active: 'lo',   partial: 'md',   pending: 'hi' };

const SCRIPT_TO_STAT_ID: Record<string, string> = {
  musinsa_ranking:       'ranking',
  musinsa_product:       'comp-detail',
  musinsa_review:        'reviews',
  musinsa_event:         'promotions',
  musinsa_brand_ranking: 'brand-ranking',
  musinsa_snap:          'snaps',
  musinsa_magazine:      'magazines',
};

const GENDER_OPTS: [string, string][] = [['A', '전체'], ['M', '남성'], ['F', '여성']];

const BRAND_ORDER = [
  '커버낫', '커버낫 우먼', '커버낫 뷰티', '커버낫 키즈',
  '리', '리키즈',
  '와키윌리',
];
const BRAND_GROUP_START = new Set(['리', '와키윌리']);

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

function CollStatRow({ s, i, job, router }: {
  s: CollectionStat;
  i: number;
  job: CollectionJob | undefined;
  router: ReturnType<typeof useRouter>;
}) {
  const isRunning = !!job;
  const progressPct = job?.target && job.target > 0
    ? Math.min(100, Math.round((job.rows_done / job.target) * 100))
    : null;
  return (
    <div
      className={`row${s.link ? ' hover' : ''}${i % 2 ? ' alt' : ''}`}
      style={{ gridTemplateColumns: '1fr 72px 44px 52px', cursor: s.link ? 'pointer' : 'default' }}
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
        {isRunning ? (
          <span className="sev hi" style={{ fontSize: 9, padding: '1px 4px' }}>
            <span className="pip" />수집중{progressPct !== null ? ` ${progressPct}%` : ''}
          </span>
        ) : (
          <span className={`sev ${COLL_STATUS_SEV[s.status]}`} style={{ fontSize: 9, padding: '1px 4px' }}>
            <span className="pip" />{COLL_STATUS_LABEL[s.status]}
          </span>
        )}
      </span>
    </div>
  );
}

export default function HomePage() {
  const isMobile = useIsMobile();
  if (isMobile) return <MobileHomeView />;
  return <HomeDesktopView />;
}

function HomeDesktopView() {
  const router = useRouter();

  const [collStats,   setCollStats]   = React.useState<CollectionStat[]>([]);
  const [activeJobs,  setActiveJobs]  = React.useState<CollectionJob[]>([]);
  const [ranking,          setRanking]          = React.useState<RankingRow[]>([]);
  const [rankGender,       setRankGender]       = React.useState<string>('A');
  const [rankLoading,      setRankLoading]      = React.useState(true);
  const [brandRanking,     setBrandRanking]     = React.useState<BrandRankRow[]>([]);
  const [brandRankGender,  setBrandRankGender]  = React.useState<string>('A');
  const [brandRankLoading, setBrandRankLoading] = React.useState(true);
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

  React.useEffect(() => {
    setBrandRankLoading(true);
    fetchTopBrandRanking({ genderFilter: brandRankGender, limit: 10 })
      .then(setBrandRanking)
      .catch(() => setBrandRanking([]))
      .finally(() => setBrandRankLoading(false));
  }, [brandRankGender]);

  // 수집 작업 실시간 상태 구독 + 폴링 백업
  React.useEffect(() => {
    let polling: ReturnType<typeof setInterval> | null = null;
    let latestJobs: CollectionJob[] = [];

    const refreshJobs = () =>
      fetchActiveJobs().then(jobs => {
        latestJobs = jobs;
        setActiveJobs(jobs);
        // 진행 중 job이 있을 때 5초, 없으면 30초 폴링
        const interval = jobs.length > 0 ? 5000 : 30000;
        if (polling) clearInterval(polling);
        polling = setInterval(refreshJobs, interval);
      }).catch(() => {});

    const refreshStats = () =>
      fetchCollectionStats().then(setCollStats).catch(() => {});

    refreshJobs();

    const client = supabaseBrowser();
    const channel = client
      .channel('collection_jobs_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'collection_jobs' },
        (payload: any) => {
          refreshJobs();
          // 작업 완료·오류 시 수집 건수·최근일자도 즉시 갱신
          if (payload.new?.status === 'done' || payload.new?.status === 'error') {
            refreshStats();
          }
        }
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
      if (polling) clearInterval(polling);
    };
  }, []);

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

      {/* Row 1: 상품랭킹 + 브랜드랭킹 */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>

        {/* 오늘의 상품랭킹 TOP10 */}
        <section className="panel col-flex">
          <div className="sec-head">
            <h3>오늘의 상품랭킹 <span className="sub">TOP10 · {latestDate}</span></h3>
            <div className="row-flex gap-4">
              {GENDER_OPTS.map(([g, l]) => (
                <button key={g} className={`btn sm${rankGender === g ? ' active' : ''}`}
                  onClick={() => setRankGender(g)}>{l}</button>
              ))}
              <Link href="/ranking" className="btn sm"><IcArrowUR size={10} /> 전체</Link>
            </div>
          </div>
          <div className="tbl flex-1">
            <div className="row head" style={{ gridTemplateColumns: '30px 34px 1fr 36px 90px 30px' }}>
              <span>순위</span><span>변동</span><span>상품</span>
              <span style={{ textAlign: 'right' }}>할인</span>
              <span style={{ textAlign: 'right' }}>가격</span>
              <span>자사</span>
            </div>
            {ranking.slice(0, 10).map((r, i) => (
              <div key={i}
                className={`row hover${i % 2 ? ' alt' : ''}`}
                style={{ gridTemplateColumns: '30px 34px 1fr 36px 90px 30px', cursor: 'pointer' }}
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
                <span className="mono" style={{ textAlign: 'right', fontSize: 10, color: 'var(--td)', fontWeight: 500 }}>
                  {r.discount_rate != null && r.discount_rate > 0 ? `${Math.round(r.discount_rate)}%` : ''}
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                  <span className="mono" style={{ fontSize: 11, color: r.discount_rate && r.discount_rate > 0 ? 'var(--td)' : 'var(--f2)', fontWeight: r.discount_rate && r.discount_rate > 0 ? 500 : 400 }}>
                    {r.final_price != null ? r.final_price.toLocaleString() : '—'}
                  </span>
                  {r.list_price != null && r.discount_rate != null && r.discount_rate > 0 && (
                    <span className="mono" style={{ fontSize: 10, color: 'var(--f4)', textDecoration: 'line-through' }}>
                      {r.list_price.toLocaleString()}
                    </span>
                  )}
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

        {/* 오늘의 브랜드랭킹 TOP10 */}
        <section className="panel col-flex">
          <div className="sec-head">
            <h3>오늘의 브랜드랭킹 <span className="sub">TOP10 · {brandRanking[0]?.snapshot_date ?? latestDate}</span></h3>
            <div className="row-flex gap-4">
              {GENDER_OPTS.map(([g, l]) => (
                <button key={g} className={`btn sm${brandRankGender === g ? ' active' : ''}`}
                  onClick={() => setBrandRankGender(g)}>{l}</button>
              ))}
              <Link href="/brand-ranking" className="btn sm"><IcArrowUR size={10} /> 전체</Link>
            </div>
          </div>
          <div className="tbl flex-1">
            <div className="row head" style={{ gridTemplateColumns: '20px 20px 0.7fr 1fr 36px 36px', gap: 8, padding: '5px 12px', lineHeight: 1.25 }}>
              <span>#</span><span>변동</span><span>브랜드</span>
              <span>회사</span>
              <span style={{ textAlign: 'right' }}>할인율<br /><span style={{ color: 'var(--f4)', fontWeight: 400 }}>평균가</span></span>
              <span style={{ textAlign: 'right' }}>★점수<br /><span style={{ color: 'var(--f4)', fontWeight: 400 }}>리뷰수</span></span>
            </div>
            {brandRanking.slice(0, 10).map((r, i) => (
              <div key={i}
                className={`row hover${i % 2 ? ' alt' : ''}`}
                style={{ gridTemplateColumns: '20px 20px 0.7fr 1fr 36px 36px', gap: 8, padding: '5px 12px', cursor: 'pointer' }}
                onClick={() => router.push(`/brand?slug=${r.musinsa_brand_slug}`)}>
                <span className="mono" style={{ fontSize: 10, fontWeight: 500, color: i < 3 ? 'var(--hs)' : 'var(--f2)' }}>
                  {r.rank_position}
                </span>
                <span style={{ fontSize: 9 }}>
                  {r.rank_change == null
                    ? <span className="dim" style={{ fontSize: 8 }}>NEW</span>
                    : r.rank_change > 0  ? <span className="up">↑{r.rank_change}</span>
                    : r.rank_change < 0  ? <span className="dn">↓{Math.abs(r.rank_change)}</span>
                    : <span className="dim">—</span>}
                </span>
                <span style={{ fontSize: 10, fontWeight: r.is_own ? 500 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: r.is_own ? 'var(--hs)' : 'var(--f1)' }}>
                  {r.brand_name}
                </span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--f3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.company_name ?? '—'}
                </span>
                {/* 할인율(위) / 평균가(아래) */}
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0 }}>
                  <span className="mono" style={{ fontSize: 10, color: r.avg_discount != null ? 'var(--td)' : 'var(--f4)' }}>
                    {r.avg_discount != null ? `${r.avg_discount}%` : '—'}
                  </span>
                  <span className="mono" style={{ fontSize: 9, color: 'var(--f4)' }}>
                    {fmtMan(r.avg_price)}
                  </span>
                </span>
                {/* ★점수(위) / 리뷰수(아래) */}
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0 }}>
                  <span className="mono" style={{ fontSize: 10, color: r.avg_review_score != null ? 'var(--f2)' : 'var(--f4)' }}>
                    {r.avg_review_score != null ? r.avg_review_score : '—'}
                  </span>
                  <span className="mono" style={{ fontSize: 9, color: 'var(--f4)' }}>
                    {r.total_review_count > 0 ? r.total_review_count.toLocaleString() : '—'}
                  </span>
                </span>
              </div>
            ))}
            {brandRanking.length === 0 && (
              <div className="row" style={{ gridTemplateColumns: '1fr' }}>
                <span className="dim" style={{ fontSize: 12, textAlign: 'center', padding: '24px 0' }}>
                  {brandRankLoading ? '로딩 중…' : '랭킹 데이터 없음'}
                </span>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* 자사 상품 현황 구분선 + Row 2 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
      <div className="grid" style={{ gridTemplateColumns: '1.1fr 1fr 0.85fr', gap: 14 }}>

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
              <span style={{ textAlign: 'right' }}>랭킹상품수</span>
              <span style={{ textAlign: 'right' }}>만족도</span>
            </div>
            {[...ownBrands]
              .sort((a, b) => {
                const ai = BRAND_ORDER.indexOf(a.name);
                const bi = BRAND_ORDER.indexOf(b.name);
                return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
              })
              .map((b, i) => (
                <React.Fragment key={b.slug}>
                  {BRAND_GROUP_START.has(b.name) && (
                    <div style={{ height: '1px', background: 'var(--bst)', margin: '0 14px' }} />
                  )}
                  <div
                    className={`row hover${i % 2 ? ' alt' : ''}`}
                    style={{ gridTemplateColumns: '1fr 56px 60px 56px', cursor: 'pointer' }}
                    onClick={() => router.push(`/brand?id=${b.id}`)}>
                    <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.name}
                    </span>
                    <span className="mono" style={{ textAlign: 'right', fontSize: 11 }}>{fmt(b.sku_count)}</span>
                    <span className="mono" style={{ textAlign: 'right', fontSize: 11 }}>
                      {b.top100_count > 0
                        ? <span style={{ color: 'var(--tu)', fontWeight: 500 }}>{b.top100_count}</span>
                        : <span className="dim">—</span>}
                    </span>
                    <span className="mono" style={{ textAlign: 'right', fontSize: 11 }}>
                      {b.avg_satisfaction != null
                        ? <><span style={{ color: 'var(--hs)' }}>★</span>{b.avg_satisfaction}</>
                        : <span className="dim">—</span>}
                    </span>
                  </div>
                </React.Fragment>
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
            {anomalies.slice(0, 7).map((a, i) => (
              <div key={i}
                className={`row hover${i % 2 ? ' alt' : ''}`}
                style={{ gridTemplateColumns: '40px 40px 1fr', cursor: 'pointer' }}
                onClick={() => router.push(`/anomaly?id=${a[6]}`)}>
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
              <div className="row-flex gap-8" style={{ padding: '2px 0' }}>
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
              <div className="row-flex baseline gap-12" style={{ marginBottom: 8 }}>
                <div>
                  <span className="mono" style={{ fontSize: 24, fontWeight: 500, color: 'var(--hs)', lineHeight: 1 }}>
                    ★{reviewStats.avgRating}
                  </span>
                </div>
                <div className="col-flex gap-2">
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{fmt(reviewStats.total)}건</span>
                  <span className="dim" style={{ fontSize: 11 }}>저점 {fmt(reviewStats.lowCount)}건</span>
                </div>
              </div>
              <div className="col-flex gap-4" style={{ flex: 1 }}>
                {[5, 4, 3, 2, 1].map((star, idx) => {
                  const count = reviewStats.ratingDist[idx] ?? 0;
                  const pct = reviewStats.total > 0 ? (count / reviewStats.total) * 100 : 0;
                  return (
                    <div key={star} className="row-flex center gap-6">
                      <span className="mono" style={{ fontSize: 10, color: 'var(--f4)', width: 14, textAlign: 'right', flexShrink: 0 }}>★{star}</span>
                      <div style={{ flex: 1, height: 7, background: 'var(--snk)', borderRadius: 5, overflow: 'hidden' }}>
                        <div style={{
                          width: `${pct}%`, height: '100%', borderRadius: 5,
                          background: star >= 4 ? 'var(--tu)' : star <= 2 ? 'var(--td)' : 'var(--f3)',
                          transition: 'width 500ms ease',
                        }} />
                      </div>
                      <span className="mono dim" style={{ fontSize: 10, width: 30, textAlign: 'right', flexShrink: 0 }}>{fmt(count)}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: '0.5px dashed var(--bs)' }}>
                <Link href="/reviews" className="btn sm" style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                  리뷰 상세 보기 ↗
                </Link>
              </div>
            </>
          ) : (
            <div style={{ padding: '20px 0', textAlign: 'center' }}>
              <span className="dim" style={{ fontSize: 12 }}>{loading ? '로딩 중…' : '데이터 없음'}</span>
            </div>
          )}
        </section>
      </div>
      </div>{/* /자사 상품 현황 wrapper */}

      {/* 프로모션 현황 */}
      {promos.length > 0 && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="row-flex between center" style={{ borderBottom: '0.5px solid var(--bs)', paddingBottom: 8 }}>
            <div className="row-flex baseline gap-10">
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 500, letterSpacing: '-0.014em' }}>프로모션 현황</h2>
              <span className="sec-tag">무신사 세일탭 · {promos.length}개 모듈</span>
            </div>
            <Link href="/promo" className="btn sm"><IcPromo size={11} /> 전체보기</Link>
          </div>
          <section className="panel">
            <div className="tbl">
              <div className="row head" style={{ gridTemplateColumns: '100px 1fr 50px 52px 64px' }}>
                <span>유형</span><span>제목</span>
                <span style={{ textAlign: 'right' }}>상품수</span>
                <span style={{ textAlign: 'right' }}>평균할인</span>
                <span style={{ textAlign: 'right' }}>종료일</span>
              </div>
              {promos.map((p, i) => (
                <div key={p.id}
                  className={`row hover${i % 2 ? ' alt' : ''}`}
                  style={{ gridTemplateColumns: '100px 1fr 50px 52px 64px', cursor: 'pointer' }}
                  onClick={() => router.push(`/promo?id=${p.id}&date=${p.snapshot_date}`)}>
                  <span>
                    {PROMO_TYPE_SEV[p.promotion_type] === 'hs' ? (
                      <span style={{ fontSize: 9, padding: '1px 5px', background: 'var(--hs-soft)', color: 'var(--hs)', border: '0.5px solid var(--hs)', borderRadius: 3, display: 'inline-block' }}>
                        {PROMO_TYPE_LABEL[p.promotion_type]}
                      </span>
                    ) : (
                      <span className={`sev ${PROMO_TYPE_SEV[p.promotion_type] ?? 'lo'}`} style={{ fontSize: 9, padding: '1px 5px' }}>
                        {PROMO_TYPE_LABEL[p.promotion_type] ?? p.promotion_type}
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.title}
                  </span>
                  <span className="mono" style={{ textAlign: 'right', fontSize: 11 }}>{fmt(p.items_count)}</span>
                  <span className="mono" style={{ textAlign: 'right', fontSize: 11, color: p.avg_discount_rate != null ? 'var(--td)' : 'var(--f4)' }}>
                    {p.avg_discount_rate != null ? `${p.avg_discount_rate}%` : '—'}
                  </span>
                  <span className="mono dim" style={{ textAlign: 'right', fontSize: 10 }}>
                    {p.end_at ? new Date(p.end_at).toISOString().slice(5, 10) : '상시'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* 수집 현황 (페이지 최하단) */}
      {!loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="row-flex between center" style={{ borderBottom: '0.5px solid var(--bs)', paddingBottom: 8 }}>
            <div className="row-flex baseline gap-10">
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 500, letterSpacing: '-0.014em' }}>수집 현황</h2>
              <span className="sec-tag">
                {collStats.filter(s => s.status === 'active').length}활성 ·
                {collStats.filter(s => s.status === 'pending').length}대기
                {activeJobs.length > 0 && <> · <span style={{ color: 'var(--hi)' }}>{activeJobs.length}수집중</span></>}
              </span>
            </div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
            {/* 1열: 무신사 수집 + 콘텐츠·자사 */}
            <section className="panel surface">
              <div className="tbl">
                <div className="row head" style={{ gridTemplateColumns: '1fr 72px 44px 52px' }}>
                  <span>무신사 · 콘텐츠 · 자사</span>
                  <span style={{ textAlign: 'right' }}>건수</span>
                  <span style={{ textAlign: 'right' }}>최근</span>
                  <span style={{ textAlign: 'right' }}>상태</span>
                </div>
                {collStats
                  .filter(s => ['ranking','brand-ranking','comp-detail','promotions','snaps','magazines','reviews','own-products'].includes(s.id))
                  .map((s, i) => <CollStatRow key={s.id} s={s} i={i} job={activeJobs.find(j => SCRIPT_TO_STAT_ID[j.script] === s.id)} router={router} />)}
              </div>
            </section>
            {/* 2열: 재무·분석 */}
            <section className="panel surface">
              <div className="tbl">
                <div className="row head" style={{ gridTemplateColumns: '1fr 72px 44px 52px' }}>
                  <span>재무 · 분석</span>
                  <span style={{ textAlign: 'right' }}>건수</span>
                  <span style={{ textAlign: 'right' }}>최근</span>
                  <span style={{ textAlign: 'right' }}>상태</span>
                </div>
                {collStats
                  .filter(s => ['companies','dart-disc','dart-fin','own-sales','own-inventory','review-analysis'].includes(s.id))
                  .map((s, i) => <CollStatRow key={s.id} s={s} i={i} job={activeJobs.find(j => SCRIPT_TO_STAT_ID[j.script] === s.id)} router={router} />)}
              </div>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
