'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useIsMobile } from '@/hooks/useViewport';
import MobileReportView from './MobileReportView';
import {
  fetchDailyReport,
  type DailyReportData,
  type OwnBrandSummary,
  type RankRow,
  type DemoRow,
  AGE_LABEL,
  GENDER_LABEL,
} from '@/lib/queries-report';

// ── 포맷 헬퍼 ──────────────────────────────────────────────────────────────────
const fmt  = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString();
const pct  = (n: number | null | undefined) => n == null ? '—' : `${n}%`;
const fmtDisc = (r: number | null) => r == null ? null : r >= 40 ? 'hi' : r >= 20 ? 'md' : 'lo';

function RankDelta({ v }: { v: number | null }) {
  if (v === null) return <span style={{ color: 'var(--smf)', fontSize: 10, fontWeight: 700 }}>NEW</span>;
  if (v > 0)  return <span className="up" style={{ fontSize: 10 }}>▲{v}</span>;
  if (v < 0)  return <span className="dn" style={{ fontSize: 10 }}>▼{Math.abs(v)}</span>;
  return <span style={{ color: 'var(--f4)', fontSize: 10 }}>—</span>;
}

function BrandDelta({ v }: { v: number | null }) {
  if (v === null) return <span style={{ color: 'var(--f4)', fontSize: 10 }}>—</span>;
  if (v > 0)  return <span className="up" style={{ fontSize: 11, fontWeight: 600 }}>▲{v}</span>;
  if (v < 0)  return <span className="dn" style={{ fontSize: 11, fontWeight: 600 }}>▼{Math.abs(v)}</span>;
  return <span style={{ color: 'var(--f4)', fontSize: 11 }}>=</span>;
}

// ── KPI 카드 ───────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, accent }: { label: string; value: string | number; sub: string; accent?: string }) {
  return (
    <div className="kpi" style={{ background: 'var(--rai)' }}>
      <div className="label">{label}</div>
      <div className="val" style={accent ? { color: accent } : {}}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div style={{ fontSize: 11, color: 'var(--f4)', marginTop: 2 }}>{sub}</div>
    </div>
  );
}

// ── 막대 차트 행 ──────────────────────────────────────────────────────────────
function BarRow({ label, count, maxCount, color, extraLabel }: {
  label: string; count: number; maxCount: number; color?: string; extraLabel?: string;
}) {
  const pctVal = maxCount > 0 ? Math.max(1, Math.round(count / maxCount * 100)) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
      <span style={{ width: 80, fontSize: 11, color: 'var(--f3)', textAlign: 'right', flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 18, background: 'var(--snk)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 4, width: `${pctVal}%`, background: color ?? 'var(--f3)', minWidth: count > 0 ? 2 : 0 }} />
      </div>
      <span style={{ width: 70, fontSize: 11, color: 'var(--f4)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
        {extraLabel ?? `${count.toLocaleString()}개`}
      </span>
    </div>
  );
}

// ── 섹션 헤더 ─────────────────────────────────────────────────────────────────
function SectionHead({ num, title, accentColor }: { num: string; title: string; accentColor?: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      fontSize: 15, fontWeight: 600, paddingBottom: 12,
      borderBottom: `2px solid ${accentColor ?? 'var(--bs)'}`,
      marginBottom: 18, color: 'var(--f1)',
    }}>
      <div style={{
        background: accentColor ?? 'var(--f3)',
        color: 'var(--rai)', width: 26, height: 26,
        borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, flexShrink: 0,
      }}>{num}</div>
      {title}
    </div>
  );
}

// ── 자사 브랜드 카드 ──────────────────────────────────────────────────────────
function OwnBrandCard({ brand }: { brand: OwnBrandSummary }) {
  const hasRanking = brand.dailyBestRank !== null;
  const accentColor = hasRanking ? 'var(--slf)' : 'var(--shf)';
  const statusText = hasRanking ? `#${brand.dailyBestRank} 랭킹 진입` : '랭킹 미진입';
  const statusColor = hasRanking ? 'var(--tu)' : 'var(--td)';

  return (
    <div style={{
      background: 'var(--rai)', border: '0.5px solid var(--bs)', borderRadius: 10,
      padding: '16px 18px', borderLeft: `4px solid ${accentColor}`, marginBottom: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--f1)' }}>{brand.brandName}</span>
        <span style={{ color: statusColor, fontWeight: 700, fontSize: 13 }}>{statusText}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 6, fontSize: 12 }}>
        {[
          { label: '일별 랭킹', value: brand.dailyBestRank != null ? `#${brand.dailyBestRank}` : '없음', highlight: brand.dailyBestRank != null },
          { label: '주별 랭킹', value: brand.weeklyBestRank != null ? `#${brand.weeklyBestRank}` : '없음', highlight: brand.weeklyBestRank != null },
          { label: '브랜드 순위', value: brand.brandRank != null ? `#${brand.brandRank}` : '없음', highlight: brand.brandRank != null },
          { label: '콘텐츠', value: brand.contentCount > 0 ? `${brand.contentCount}건 (${(brand.contentTotalViews / 1000).toFixed(0)}K)` : '미노출', highlight: brand.contentCount > 0 },
          { label: '추천판', value: brand.hasRecommend ? '노출 중' : '미노출', highlight: brand.hasRecommend },
          { label: '세일', value: brand.hasSale ? '등록 중' : '미등록', highlight: brand.hasSale },
        ].map(item => (
          <div key={item.label} style={{ background: 'var(--snk)', padding: '7px 10px', borderRadius: 5 }}>
            <div style={{ color: 'var(--f4)' }}>{item.label}</div>
            <strong style={{ color: item.highlight ? 'var(--f1)' : 'var(--f4)' }}>{item.value}</strong>
          </div>
        ))}
      </div>
      {brand.demoHighlights.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--f3)' }}>
          성별/연령별: {brand.demoHighlights.join(', ')}
        </div>
      )}
      {!hasRanking && (
        <div style={{
          marginTop: 10, padding: '8px 12px', background: 'var(--shb)',
          borderLeft: '3px solid var(--shf)', borderRadius: '0 6px 6px 0',
          fontSize: 12, color: 'var(--shf)',
        }}>
          → 랭킹 진입을 위해 콘텐츠/세일/추천 노출 확대 필요
        </div>
      )}
    </div>
  );
}

// ── 랭킹 행 ──────────────────────────────────────────────────────────────────
function RankRowItem({ row, i }: { row: RankRow; i: number }) {
  const rankColors: Record<number, string> = { 1: 'var(--smf)', 2: 'var(--f3)', 3: 'var(--shf)' };
  const rankColor = rankColors[row.rank] ?? 'var(--f2)';
  const musinsaUrl = `https://www.musinsa.com/products/${row.musinsaNo}`;

  return (
    <div className={`row${i % 2 ? ' alt' : ''}${row.isOwn ? ' flag' : ''}`}
      style={{ gridTemplateColumns: '36px 1fr 110px 70px 50px 50px', gap: 8 }}>
      <span className="mono" style={{ color: rankColor, fontWeight: 700, fontSize: 12 }}>{row.rank}</span>
      <div style={{ minWidth: 0 }}>
        <a href={musinsaUrl} target="_blank" rel="noreferrer"
          style={{ color: 'var(--f1)', textDecoration: 'none', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', display: 'block', textOverflow: 'ellipsis' }}>
          {row.productName}
        </a>
        <span style={{ fontSize: 10, color: 'var(--f4)' }}>{row.brandName}</span>
      </div>
      <span style={{ textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{row.price != null ? `${row.price.toLocaleString()}원` : '—'}</span>
      <span style={{ textAlign: 'right' }}>
        {row.discountRate != null && row.discountRate > 0 ? (
          <span className={`sev ${fmtDisc(row.discountRate)}`} style={{ fontSize: 10, padding: '1px 6px' }}>
            {Math.round(row.discountRate)}%
          </span>
        ) : '—'}
      </span>
      <span style={{ textAlign: 'center' }}><RankDelta v={row.rankChange} /></span>
      <span style={{ fontSize: 10, color: row.isOwn ? 'var(--slf)' : 'transparent', textAlign: 'center' }}>
        {row.isOwn ? '자사' : ''}
      </span>
    </div>
  );
}

// ── 성별×연령 카드 ────────────────────────────────────────────────────────────
function DemoCard({ row }: { row: DemoRow }) {
  const gLabel = GENDER_LABEL[row.gender] ?? row.gender;
  const aLabel = AGE_LABEL[row.age] ?? row.age;
  return (
    <div style={{
      background: 'var(--rai)', border: '0.5px solid var(--bs)', borderRadius: 8, padding: '10px 12px',
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--f2)', marginBottom: 6 }}>
        {gLabel} · {aLabel}
      </div>
      {row.top3.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--f4)' }}>데이터 없음</div>
      ) : (
        row.top3.map((item, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 3, alignItems: 'baseline' }}>
            <span className="mono" style={{ fontSize: 10, color: 'var(--f4)', width: 22, flexShrink: 0 }}>#{item.rank}</span>
            <span style={{ fontSize: 11, color: 'var(--f3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <strong style={{ color: 'var(--f2)', marginRight: 4 }}>{item.brand}</strong>
              {item.product}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────
export default function ReportPage() {
  const isMobile = useIsMobile();
  if (isMobile) return <MobileReportView />;
  return <ReportDesktopView />;
}

function ReportDesktopView() {
  const [data, setData] = useState<DailyReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAllRanking, setShowAllRanking] = useState(false);
  const [rankingExpanded, setRankingExpanded] = useState(false);

  useEffect(() => {
    fetchDailyReport().then(d => { setData(d); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div className="main">
        <div className="tb"><div className="bc"><span className="crumb last">일일 리포트</span></div></div>
        <div className="main-body" style={{ alignItems: 'center', justifyContent: 'center', color: 'var(--f4)', fontSize: 13 }}>
          데이터 로딩 중…
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="main">
        <div className="tb"><div className="bc"><span className="crumb last">일일 리포트</span></div></div>
        <div className="main-body" style={{ color: 'var(--f4)', fontSize: 13 }}>랭킹 데이터가 없습니다.</div>
      </div>
    );
  }

  const { kpi, ownBrands, competitors, channelConversions, priceBuckets, topBrandsByCount, rankingRows, topContent, saleDist, brandRanking, demoGrid, recommendModules, recommendTopBrands } = data;

  // 오늘의 핵심 bullet points
  const bestChannel = channelConversions.reduce((best, c) => (c.rate > best.rate ? c : best), channelConversions[0]);
  const topPriceBucket = priceBuckets.reduce((best, b) => (b.count > best.count ? b : best), priceBuckets[0]);
  const rankingOwnBrands = ownBrands.filter(b => b.dailyBestRank != null);
  const rankingMissing = ownBrands.filter(b => b.dailyBestRank == null);
  const rankNoPromoCount = rankingRows.filter(r => {
    // 판 미노출 = 어떤 판에도 등록 안 된 브랜드 (세일, 콘텐츠, 추천)
    return !saleDist.some(() => false); // 아래서 계산
  }).length;

  const displayedRanking = showAllRanking ? rankingRows : rankingRows.slice(0, 10);

  return (
    <div className="main">
      {/* Topbar */}
      <div className="tb">
        <div className="bc">
          <span className="crumb">인텔리전스</span>
          <span className="sep">/</span>
          <span className="crumb last">일일 리포트</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="meta">{kpi.latestDate}</div>
          <Link href="/ranking" className="btn sm">랭킹 상세</Link>
          <Link href="/brand-ranking" className="btn sm">브랜드 순위</Link>
        </div>
      </div>

      <div className="main-body">

        {/* ── 리포트 헤더 ──────────────────────────────────────────── */}
        <div className="panel" style={{
          background: 'linear-gradient(135deg, var(--snk), var(--bg))',
          border: '0.5px solid var(--bs)',
        }}>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.5px', marginBottom: 6 }}>
            MRR — 무신사 분석 리포트
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 12, color: 'var(--f3)' }}>
            <span>기준일: {kpi.latestDate}</span>
            <span>모바일 기준</span>
            <span>일별 랭킹 {kpi.dailyCount.toLocaleString()}개 상품 분석</span>
          </div>
        </div>

        {/* ── 0. 핵심 KPI ──────────────────────────────────────────── */}
        <div>
          <div style={{ fontSize: 12, fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--f4)', marginBottom: 8 }}>핵심 지표</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <KpiCard label="일별 랭킹" value={kpi.dailyCount} sub="전체 상품" accent="var(--f2)" />
            <KpiCard label="주별 랭킹" value={kpi.weeklyCount ?? '—'} sub={kpi.weeklyDate ? `${kpi.weeklyDate} 기준` : '데이터 없음'} />
            <KpiCard label="급상승/신규" value={kpi.risingCount} sub="▲10+ 또는 신규 진입" accent="var(--smf)" />
            <KpiCard label="콘텐츠" value={kpi.contentCount} sub={`${kpi.contentBrandCount}개 브랜드`} accent="var(--tu)" />
            <KpiCard label="추천판" value={kpi.recommendItemCount} sub={`${kpi.recommendBrandCount}개 브랜드`} accent="var(--smf)" />
            <KpiCard label="세일" value={kpi.saleItemCount} sub={`${kpi.saleBrandCount}개 브랜드`} accent="var(--td)" />
            <KpiCard label="성별×연령" value={14} sub="조합 분석" />
          </div>
        </div>

        {/* ── 오늘의 핵심 ──────────────────────────────────────────── */}
        <div className="panel">
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--smf)', marginBottom: 10 }}>오늘의 핵심</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {bestChannel && bestChannel.rate > 0 && (
              <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                <span style={{ color: 'var(--smf)', fontWeight: 700, marginRight: 6 }}>1.</span>
                <strong>{bestChannel.channel}</strong>이 랭킹 전환율 {bestChannel.rate}%로 가장 효과적
                — {bestChannel.exposureBrands}개 노출 → {bestChannel.matchedBrands}개 랭킹
              </div>
            )}
            {topPriceBucket && (
              <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                <span style={{ color: 'var(--smf)', fontWeight: 700, marginRight: 6 }}>2.</span>
                랭킹 메인 가격대는 <strong>{topPriceBucket.label}</strong> — {topPriceBucket.count.toLocaleString()}개로 최다
              </div>
            )}
            {rankingOwnBrands.length > 0 && (
              <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                <span style={{ color: 'var(--smf)', fontWeight: 700, marginRight: 6 }}>3.</span>
                자사 브랜드 랭킹 진입:&nbsp;
                {rankingOwnBrands.map(b => `${b.brandName} #${b.dailyBestRank}`).join(', ')}
              </div>
            )}
            {rankingMissing.length > 0 && (
              <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--td)' }}>
                <span style={{ color: 'var(--smf)', fontWeight: 700, marginRight: 6 }}>4.</span>
                {rankingMissing.map(b => b.brandName).join(', ')}은 현재 랭킹 TOP 진입 못함 — 노출 전략 재검토 필요
              </div>
            )}
            {topBrandsByCount[0] && (
              <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                <span style={{ color: 'var(--smf)', fontWeight: 700, marginRight: 6 }}>5.</span>
                랭킹 독점 1위: <strong>{topBrandsByCount[0].brand}</strong> ({topBrandsByCount[0].count}개 상품, 최고 #{topBrandsByCount[0].bestRank})
              </div>
            )}
          </div>
        </div>

        {/* ── B. 우리 브랜드 ───────────────────────────────────────── */}
        <div>
          <SectionHead num="B" title="우리 브랜드 현황" accentColor="var(--tu)" />
          {ownBrands.length === 0 ? (
            <div style={{ color: 'var(--f4)', fontSize: 13 }}>자사 브랜드 없음</div>
          ) : (
            ownBrands.map(b => <OwnBrandCard key={b.brandId} brand={b} />)
          )}
        </div>

        {/* ── C. 경쟁사 벤치마크 ───────────────────────────────────── */}
        {competitors.length > 0 && (
          <div>
            <SectionHead num="C" title={`경쟁사 벤치마크 (${competitors.length}개 브랜드)`} />
            <div className="tbl">
              <div className="row head" style={{ gridTemplateColumns: '1fr 60px 50px 80px 30px 30px 30px' }}>
                <span>브랜드</span>
                <span className="cell-r">최고순위</span>
                <span className="cell-r">상품수</span>
                <span className="cell-r">평균가격</span>
                <span className="cell-c">콘텐츠</span>
                <span className="cell-c">세일</span>
                <span className="cell-c">추천</span>
              </div>
              {competitors.map((c, i) => (
                <div key={c.brandName} className={`row${i % 2 ? ' alt' : ''}${c.isOwn ? ' flag' : ''}`}
                  style={{ gridTemplateColumns: '1fr 60px 50px 80px 30px 30px 30px' }}>
                  <span style={{ fontWeight: 600, fontSize: 12 }}>
                    {c.brandName}
                    {c.isOwn && <span className="chip brand" style={{ marginLeft: 6, fontSize: 9 }}>자사</span>}
                  </span>
                  <span className="cell-r mono" style={{ fontWeight: 700, fontSize: 12, color: 'var(--f2)' }}>
                    {c.bestRank != null ? `#${c.bestRank}` : '—'}
                  </span>
                  <span className="cell-r" style={{ fontSize: 12 }}>{c.productCount > 0 ? c.productCount : '—'}</span>
                  <span className="cell-r" style={{ fontSize: 12 }}>{c.avgPrice != null ? `${c.avgPrice.toLocaleString()}` : '—'}</span>
                  <span className="cell-c" style={{ fontSize: 12, color: c.hasContent ? 'var(--tu)' : 'var(--f4)' }}>{c.hasContent ? 'O' : '-'}</span>
                  <span className="cell-c" style={{ fontSize: 12, color: c.hasSale ? 'var(--smf)' : 'var(--f4)' }}>{c.hasSale ? 'O' : '-'}</span>
                  <span className="cell-c" style={{ fontSize: 12, color: c.hasRecommend ? 'var(--tu)' : 'var(--f4)' }}>{c.hasRecommend ? 'O' : '-'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── S. 전략 인사이트 ─────────────────────────────────────── */}
        <div>
          <SectionHead num="S" title="전략 인사이트" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>

            {/* 채널 전환율 */}
            <div className="panel">
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--f2)', marginBottom: 10 }}>판별 랭킹 전환 효과</div>
              {channelConversions.map((ch, i) => {
                const isTop = i === 0 && ch.rate === Math.max(...channelConversions.map(c => c.rate));
                return (
                  <BarRow
                    key={ch.channel}
                    label={ch.channel.replace(' (선착순)', '')}
                    count={ch.matchedBrands}
                    maxCount={channelConversions[0]?.matchedBrands || 1}
                    color={isTop ? 'var(--tu)' : 'var(--f3)'}
                    extraLabel={`${ch.exposureBrands}→${ch.matchedBrands} (${ch.rate}%)`}
                  />
                );
              })}
            </div>

            {/* 가격 분포 */}
            <div className="panel">
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--f2)', marginBottom: 10 }}>가격 전략 (랭킹 상품)</div>
              {(() => {
                const maxCount = Math.max(...priceBuckets.map(b => b.count), 1);
                return priceBuckets.map((b, i) => (
                  <BarRow key={b.label} label={b.label} count={b.count} maxCount={maxCount}
                    color={i === 0 ? 'var(--smf)' : 'var(--f3)'} />
                ));
              })()}
            </div>

            {/* 랭킹 독점 */}
            <div className="panel">
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--f2)', marginBottom: 10 }}>랭킹 독점 브랜드 TOP 10</div>
              {topBrandsByCount.map((b, i) => (
                <div key={b.brand} style={{ display: 'flex', gap: 8, marginBottom: 5, alignItems: 'baseline' }}>
                  <span className="mono" style={{ width: 16, fontSize: 10, color: 'var(--f4)', flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ fontSize: 12, fontWeight: i < 3 ? 600 : 400, color: 'var(--f1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.brand}</span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--f4)' }}>{b.count}개 · #{b.bestRank}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── 1. 콘텐츠판 ─────────────────────────────────────────── */}
        <div>
          <SectionHead num="1" title={`콘텐츠판 (최근 30일 · ${data.kpi.contentCount}건)`} />
          <div style={{ fontSize: 12, color: 'var(--f4)', marginBottom: 8 }}>조회수 TOP 10</div>
          <div className="tbl">
            <div className="row head" style={{ gridTemplateColumns: '28px 1fr 60px 50px 50px' }}>
              <span>#</span><span>제목 / 브랜드</span>
              <span className="cell-r">조회수</span>
              <span className="cell-r">댓글</span>
              <span className="cell-r">랭킹</span>
            </div>
            {topContent.map((c, i) => (
              <div key={i} className={`row${i % 2 ? ' alt' : ''}`}
                style={{ gridTemplateColumns: '28px 1fr 60px 50px 50px' }}>
                <span style={{ fontSize: 11, color: 'var(--f4)' }}>{i + 1}</span>
                <div style={{ minWidth: 0 }}>
                  {c.landingUrl ? (
                    <a href={c.landingUrl} target="_blank" rel="noreferrer"
                      style={{ color: 'var(--f1)', textDecoration: 'none', fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.title}
                    </a>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--f1)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                  )}
                  <span style={{ fontSize: 10, color: 'var(--f4)' }}>{c.brandNames.slice(0, 3).join(', ')}</span>
                </div>
                <span className="cell-r mono" style={{ fontSize: 11 }}>
                  {c.viewCount >= 1000 ? `${(c.viewCount / 1000).toFixed(0)}K` : c.viewCount}
                </span>
                <span className="cell-r mono" style={{ fontSize: 11 }}>{c.commentCount}</span>
                <span className="cell-r mono" style={{ fontSize: 11, color: c.rankMatch != null ? 'var(--f2)' : 'var(--f4)' }}>
                  {c.rankMatch != null ? `#${c.rankMatch}` : '-'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── 2. 추천판 ────────────────────────────────────────────── */}
        <div>
          <SectionHead num="2" title={`추천판 (${kpi.recommendItemCount.toLocaleString()}개 상품 · ${kpi.recommendBrandCount}개 브랜드)`} accentColor="var(--smf)" />
          {recommendModules.length === 0 ? (
            <div style={{ color: 'var(--f4)', fontSize: 13, padding: '12px 0' }}>오늘 추천판 데이터가 없습니다.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {/* 모듈 목록 */}
              <div className="panel">
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--f2)', marginBottom: 10 }}>큐레이션 모듈 ({recommendModules.length}개)</div>
                <div className="tbl">
                  <div className="row head" style={{ gridTemplateColumns: '28px 1fr 36px 36px' }}>
                    <span>#</span><span>테마</span>
                    <span className="cell-c">유형</span>
                    <span className="cell-r">상품</span>
                  </div>
                  {recommendModules.map((m, i) => (
                    <div key={m.id} className={`row${i % 2 ? ' alt' : ''}`}
                      style={{ gridTemplateColumns: '28px 1fr 36px 36px' }}>
                      <span style={{ fontSize: 11, color: 'var(--f4)' }}>{m.position + 1}</span>
                      <span style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</span>
                      <span className="cell-c">
                        <span className="chip" style={{ fontSize: 9, padding: '1px 4px', background: m.moduleType.includes('DYNAMIC') ? 'var(--tu)' : 'var(--f4)', color: 'var(--rai)' }}>
                          {m.moduleType.includes('DYNAMIC') ? '탭' : '일반'}
                        </span>
                      </span>
                      <span className="cell-r mono" style={{ fontSize: 11 }}>{m.itemsCount}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 추천판 상위 브랜드 */}
              <div className="panel">
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--f2)', marginBottom: 10 }}>노출 브랜드 TOP {Math.min(recommendTopBrands.length, 10)}</div>
                {recommendTopBrands.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--f4)' }}>데이터 없음</div>
                ) : (
                  recommendTopBrands.map((b, i) => (
                    <div key={b.brandName} style={{ display: 'flex', gap: 8, marginBottom: 5, alignItems: 'baseline' }}>
                      <span className="mono" style={{ width: 16, fontSize: 10, color: 'var(--f4)', flexShrink: 0 }}>{i + 1}</span>
                      <span style={{ fontSize: 12, fontWeight: i < 3 ? 600 : 400, color: 'var(--f1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.brandName}</span>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--f4)' }}>{b.count}개</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── 3. 세일판 ────────────────────────────────────────────── */}
        <div>
          <SectionHead num="3" title={`세일판 (${kpi.saleItemCount.toLocaleString()}개 상품 · ${kpi.saleBrandCount}개 브랜드)`} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="panel">
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--f2)', marginBottom: 10 }}>할인율 분포</div>
              {(() => {
                const maxCount = Math.max(...saleDist.map(b => b.count), 1);
                return saleDist.map((b, i) => (
                  <BarRow key={b.label} label={b.label} count={b.count} maxCount={maxCount}
                    color={i === 2 ? 'var(--smf)' : i >= 3 ? 'var(--td)' : 'var(--tu)'} />
                ));
              })()}
            </div>
            <div className="panel">
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--f2)', marginBottom: 10 }}>채널 요약</div>
              {channelConversions.filter(ch => ch.channel !== '추천판').map(ch => (
                <div key={ch.channel} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12 }}>
                  <span style={{ color: 'var(--f2)' }}>{ch.channel}</span>
                  <span style={{ color: 'var(--f3)' }}>{ch.exposureBrands}개 노출 → 랭킹 전환 <strong>{ch.rate}%</strong></span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── 4. 랭킹 분석 ────────────────────────────────────────── */}
        <div>
          <SectionHead num="4" title={`랭킹 분석 (${rankingRows.length.toLocaleString()}개 상품)`} />
          <div style={{ fontSize: 12, color: 'var(--f4)', marginBottom: 8 }}>전체 일별 TOP 10</div>
          <div className="tbl">
            <div className="row head" style={{ gridTemplateColumns: '36px 1fr 110px 70px 50px 50px', gap: 8 }}>
              <span>#</span><span>상품</span>
              <span className="cell-r">가격</span>
              <span className="cell-r">할인</span>
              <span className="cell-c">변동</span>
              <span className="cell-c">구분</span>
            </div>
            {displayedRanking.map((row, i) => <RankRowItem key={row.musinsaNo} row={row} i={i} />)}
          </div>
          {rankingRows.length > 10 && (
            <button
              className="btn ghost"
              style={{ marginTop: 10, width: '100%', justifyContent: 'center', fontSize: 12 }}
              onClick={() => setShowAllRanking(!showAllRanking)}
            >
              {showAllRanking ? '▲ 접기' : `▼ 전체 ${rankingRows.length.toLocaleString()}개 보기`}
            </button>
          )}
        </div>

        {/* ── 5. 브랜드 랭킹 ──────────────────────────────────────── */}
        <div>
          <SectionHead num="5" title={`브랜드 랭킹 TOP ${brandRanking.length}`} />
          <div className="tbl">
            <div className="row head" style={{ gridTemplateColumns: '40px 1fr 60px 50px' }}>
              <span>#</span><span>브랜드</span>
              <span className="cell-c">변동</span>
              <span className="cell-c">구분</span>
            </div>
            {brandRanking.map((b, i) => (
              <div key={b.brandName} className={`row${i % 2 ? ' alt' : ''}${b.isOwn ? ' flag' : ''}`}
                style={{ gridTemplateColumns: '40px 1fr 60px 50px' }}>
                <span className="mono" style={{ fontWeight: 700, fontSize: 12, color: 'var(--f2)' }}>
                  {b.rank}
                </span>
                <span style={{ fontWeight: b.isOwn ? 700 : 400, fontSize: 12 }}>{b.brandName}</span>
                <span className="cell-c"><BrandDelta v={b.rankChange} /></span>
                <span className="cell-c">
                  {b.isOwn && <span className="chip brand" style={{ fontSize: 9 }}>자사</span>}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── 6. 성별×연령 ────────────────────────────────────────── */}
        <div>
          <SectionHead num="6" title="성별×연령 TOP 3 분석 (14조합)" />
          <div style={{ marginBottom: 12 }}>
            {['M', 'F'].map(gender => (
              <div key={gender} style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--f3)', marginBottom: 8, fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {GENDER_LABEL[gender]}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                  {demoGrid.filter(r => r.gender === gender).map(row => (
                    <DemoCard key={`${row.gender}|${row.age}`} row={row} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 푸터 */}
        <div style={{
          textAlign: 'center', padding: '20px 0', color: 'var(--f4)',
          fontSize: 11, borderTop: '0.5px solid var(--bs)',
        }}>
          UTTU — B.CAVE Intelligence Platform · {kpi.latestDate} 기준
        </div>

      </div>
    </div>
  );
}
