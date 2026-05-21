'use client';
import React from 'react';
import Link from 'next/link';
import { Line } from '@/components/ui/charts';
import { fetchHomeSummary, fetchReviewStats, fetchAnomalySignals, type HomeSummary, type AnomalyRow } from '@/lib/queries';

export default function HomePage() {
  const [period, setPeriod] = React.useState('90D');
  const [summary, setSummary] = React.useState<HomeSummary | null>(null);
  const [reviewStats, setReviewStats] = React.useState<{ total: number; avgRating: number; lowCount: number } | null>(null);
  const [anomalies, setAnomalies] = React.useState<AnomalyRow[]>([]);
  const [anomalyFilter, setAnomalyFilter] = React.useState('전체');

  React.useEffect(() => {
    fetchHomeSummary().then(setSummary).catch(console.error);
    fetchReviewStats(30).then(setReviewStats).catch(console.error);
    fetchAnomalySignals().then(setAnomalies).catch(console.error);
  }, []);

  const fmt = (n: number | null | undefined) => n == null ? '…' : n.toLocaleString();

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: '2fr 1fr', gap: 14 }}>
        <section className="panel">
          <div className="row-flex between baseline" style={{ marginBottom: 10 }}>
            <div className="col-flex gap-2">
              <div className="row-flex baseline gap-8">
                <h2 style={{ fontSize: 16, fontWeight: 500, margin: 0, letterSpacing: '-0.012em' }}>자사 — 무신사 매출 추이</h2>
                <span className="sec-tag">최근 90일 · 일 단위</span>
              </div>
            </div>
            <div className="row-flex gap-4">
              {['7D', '30D', '90D', '1Y'].map(p => (
                <button key={p} className={`btn sm ${period === p ? 'active' : ''}`} onClick={() => setPeriod(p)}>{p}</button>
              ))}
            </div>
          </div>

          <div className="row-flex baseline gap-20" style={{ marginBottom: 12 }}>
            <div className="col-flex gap-2">
              <div>
                <span className="mono tnum" style={{ fontSize: 30, fontWeight: 500, letterSpacing: '-0.018em' }}>
                  —<span style={{ fontSize: 18, color: 'var(--f3)' }}>억</span>
                </span>
                <span style={{ marginLeft: 6, fontSize: 12, color: 'var(--f3)' }}>/ 일평균</span>
              </div>
              <span className="sec-tag">average daily gmv · ERP 연동 예정</span>
            </div>
            <div className="col-flex gap-2">
              <div className="row-flex baseline gap-6">
                <span className="mono" style={{ fontSize: 14, color: 'var(--f1)', fontWeight: 500 }}>
                  {summary ? `${fmt(summary.ownProducts)} SKU` : '… SKU'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--f3)' }}>자사 상품</span>
              </div>
              <span className="sec-tag">own products</span>
            </div>
          </div>

          <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--snk)', borderRadius: 4 }}>
            <span className="mono dim" style={{ fontSize: 11 }}>매출 차트 — ERP 데이터 연동 예정</span>
          </div>
        </section>

        <section className="panel surface">
          <div className="sec-head">
            <h3>수집 상태 <span className="sub">cron · 일 1회 03:00 KST</span></h3>
          </div>
          <div className="panel snk compact" style={{ marginBottom: 10 }}>
            <span className="sec-tag">최종 수집일</span>
            <div className="mono tnum" style={{ fontSize: 16, fontWeight: 500, marginTop: 2 }}>
              {summary ? summary.latestDate : '…'}
            </div>
            <span className="mono dim" style={{ fontSize: 11 }}>
              랭킹 스냅샷 {summary ? fmt(summary.totalProducts) : '…'}건
            </span>
          </div>
          {[
            ['ranking.job', 'OK',   '03:01', summary ? fmt(summary.totalProducts) : '…'],
            ['review.job',  'OK',   '03:13', reviewStats ? fmt(reviewStats.total) : '…'],
            ['snap.job',    'OK',   '03:08', '2,000'],
            ['magazine.job','OK',   '03:11', '10,000+'],
            ['product.job', 'OK',   '03:08', summary ? fmt(summary.ownProducts) : '…'],
            ['dart.job',    'WARN', '03:14', '준비 중'],
          ].map((j, i) => (
            <div key={i} className="row-flex between center" style={{ padding: '7px 0', borderBottom: i < 5 ? '0.5px dashed var(--bs)' : 'none' }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--f2)' }}>{j[0]}</span>
              <div className="row-flex center gap-8">
                <span className="mono dim" style={{ fontSize: 10 }}>{j[2]} · {j[3]}</span>
                <span className={`sev ${j[1] === 'OK' ? 'lo' : 'md'}`}><span className="pip" />{j[1]}</span>
              </div>
            </div>
          ))}
        </section>
      </div>

      {/* KPI strip */}
      <div className="grid grid-6 gap-8">
        {[
          ['오늘 이상탐지', '—',    '준비 중'],
          ['자사 활성 SKU', summary ? fmt(summary.ownProducts) : '…', summary ? `TOP100 ${fmt(summary.ownTop100)}개` : ''],
          ['TOP100 진입',   summary ? fmt(summary.ownTop100) : '…',  summary ? `${summary.latestDate} 기준` : ''],
          ['추적 브랜드',   summary ? fmt(summary.totalBrands) : '…', '수집 브랜드'],
          ['리뷰 (30일)',   reviewStats ? fmt(reviewStats.total) : '…', reviewStats ? `평균 ★${reviewStats.avgRating}` : ''],
          ['평균 평점',     reviewStats ? String(reviewStats.avgRating) : '…', reviewStats ? `저점 ${fmt(reviewStats.lowCount)}건` : ''],
        ].map(([l, v, d], i) => (
          <div key={i} className="kpi">
            <span className="label">{l}</span>
            <div className="val">{v}</div>
            <div className="dlt"><span className="muted">{d}</span></div>
          </div>
        ))}
      </div>

      {/* Bottom row */}
      <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr', gap: 14, minHeight: 380 }}>
        <section className="panel col-flex">
          <div className="sec-head">
            <h3>오늘의 이상탐지 <span className="sub">{anomalies.length}건 · 우선순위 정렬</span></h3>
            <div className="row-flex gap-4">
              {['전체', '상품', '리뷰', '프로모션'].map(f => (
                <button key={f} className={`btn sm ${anomalyFilter === f ? 'active' : ''}`} onClick={() => setAnomalyFilter(f)}>{f}</button>
              ))}
              <Link href="/anomaly" className="btn sm">전체보기 ↗</Link>
            </div>
          </div>
          <div className="tbl flex-1">
            <div className="row head" style={{ gridTemplateColumns: '90px 56px 1fr 200px 64px' }}>
              <span>날짜</span><span>sev</span><span>이벤트</span><span>대상</span><span>영역</span>
            </div>
            {(anomalyFilter === '전체' ? anomalies : anomalies.filter(a => a[2] === anomalyFilter))
              .slice(0, 6)
              .map((row, i) => (
                <div key={i} className={`row hover ${i % 2 ? 'alt' : ''}`} style={{ gridTemplateColumns: '90px 56px 1fr 200px 64px' }}>
                  <span className="mono dim" style={{ fontSize: 10 }}>{row[0]}</span>
                  <span><span className={`sev ${row[1]}`}><span className="pip" />{row[1].toUpperCase()}</span></span>
                  <span style={{ fontSize: 12 }}>{row[3]}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{row[4]}</span>
                  <span className="mono dim" style={{ fontSize: 11 }}>{row[2]}</span>
                </div>
              ))}
            {anomalies.length === 0 && (
              <div className="row" style={{ gridTemplateColumns: '1fr' }}>
                <span className="dim" style={{ fontSize: 12, textAlign: 'center', padding: '20px 0' }}>탐지된 이상 없음</span>
              </div>
            )}
          </div>
        </section>

        <div className="col-flex gap-12">
          <section className="panel">
            <div className="sec-head">
              <h3>시장 펄스 <span className="sub">자사 카테고리 · 24h</span></h3>
            </div>
            {[
              ['상의 / 후디', `TOP100 ${fmt(summary?.ownTop100 ?? 0)}개`, '최신 랭킹 기준'],
              ['추적 브랜드', `${fmt(summary?.totalBrands ?? 0)}개`, '수집 브랜드 수'],
              ['자사 상품', `${fmt(summary?.ownProducts ?? 0)} SKU`, `${summary?.latestDate ?? '—'} 기준`],
            ].map((m, i) => (
              <div key={i} style={{ padding: '8px 0', borderBottom: i < 2 ? '0.5px dashed var(--bs)' : 'none' }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{m[0]}</div>
                <div className="row-flex between" style={{ marginTop: 3 }}>
                  <span className="mono hs" style={{ fontSize: 11, fontWeight: 500 }}>{m[1]}</span>
                  <span className="dim" style={{ fontSize: 11 }}>{m[2]}</span>
                </div>
              </div>
            ))}
          </section>

          <section className="panel surface flex-1" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="sec-head">
              <h3>AI 데일리 요약 <span className="sub">uttu ai · daily</span></h3>
              <span className="capsule"><span className="ico" /> auto-generated</span>
            </div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: 'var(--f2)' }}>
              {summary ? (
                <>자사 상품 <span className="hs" style={{ fontWeight: 500 }}>{fmt(summary.ownProducts)}개</span> 수집 완료.
                TOP100 진입 상품 <span className="hs" style={{ fontWeight: 500 }}>{fmt(summary.ownTop100)}개</span> ({summary.latestDate} 기준).
                이상탐지 신호 <span className="hs" style={{ fontWeight: 500 }}>{anomalies.length}건</span> — {anomalies.filter(a => a[1] === 'hi').length}건 High 우선.
                리뷰 모니터링 {reviewStats ? `최근 30일 ${fmt(reviewStats.total)}건 수집 · 평균 ★${reviewStats.avgRating}` : '연결 중'}.</>
              ) : 'AI 요약 로딩 중…'}
            </p>
            <div className="row-flex gap-6" style={{ marginTop: 'auto' }}>
              <Link href="/reviews" className="btn sm">↗ 리뷰 현황</Link>
              <Link href="/anomaly" className="btn sm">↗ 이상탐지</Link>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
