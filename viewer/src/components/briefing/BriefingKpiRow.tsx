'use client';
import Link from 'next/link';
import { OwnBrandKpi, AnomalyKpi, CompetitorRankKpi, BriefingKpiData, KpiStatus } from '@/lib/queries-kpi';

// ── Sparkline ──────────────────────────────────────────────────────────────────

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const W = 90, H = 30;
  const maxR  = Math.max(...points);
  const minR  = Math.min(...points);
  const range = maxR - minR || 1;
  const toY = (r: number) => ((r - minR) / range) * (H - 6) + 3;
  const toX = (i: number) => (i / (points.length - 1)) * W;

  const linePoints = points.map((r, i) => `${toX(i).toFixed(1)},${toY(r).toFixed(1)}`).join(' ');
  const areaPoints = [
    `0,${H}`,
    ...points.map((r, i) => `${toX(i).toFixed(1)},${toY(r).toFixed(1)}`),
    `${W},${H}`,
  ].join(' ');
  const lastY = toY(points[points.length - 1]);

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible', display: 'block' }}>
      <polygon points={areaPoints} fill="var(--hs-soft)" />
      <polyline points={linePoints} fill="none" stroke="var(--hs)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={W} cy={lastY} r={2.5} fill="var(--hs)" />
    </svg>
  );
}

// ── 자사 브랜드 카드 ────────────────────────────────────────────────────────────

function BrandCard({ brand, sourceDate }: { brand: OwnBrandKpi; sourceDate: string }) {
  if (brand.best_rank_yesterday === null) return null;
  const improved = brand.rank_delta !== null && brand.rank_delta > 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--f4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {brand.name}
      </span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        <span style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--f1)', lineHeight: 1 }}>
          #{brand.best_rank_yesterday}
        </span>
        {brand.rank_delta !== null && brand.rank_delta !== 0 && (
          <span style={{ fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 600, color: improved ? 'var(--tu)' : 'var(--td)' }}>
            {improved ? `↑${brand.rank_delta}` : `↓${Math.abs(brand.rank_delta)}`}
          </span>
        )}
        {brand.rank_delta === 0 && (
          <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--f4)' }}>–</span>
        )}
      </div>
      <Sparkline points={brand.weekly_trend.map(t => t.best_rank)} />
      <span style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>{sourceDate} 최고순위</span>
    </div>
  );
}

// ── 이상탐지 위젯 ───────────────────────────────────────────────────────────────

function AnomalyWidget({ data, sourceDate, status }: { data: AnomalyKpi; sourceDate: string; status: KpiStatus }) {
  const rows = [
    { label: 'HIGH',  count: data.high,   bg: 'var(--shb)', fg: 'var(--shf)' },
    { label: 'MED',   count: data.medium, bg: 'var(--smb)', fg: 'var(--smf)' },
    { label: 'LOW',   count: data.low,    bg: 'var(--slb)', fg: 'var(--slf)' },
  ];
  const max = Math.max(data.high, data.medium, data.low, 1);

  return (
    <Link href={`/anomaly?date=${sourceDate}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column', gap: 10,
        padding: '12px 14px',
        border: '0.5px solid var(--bd)', borderRadius: 10,
        background: 'var(--bg)',
        transition: 'background 0.12s',
      }}
        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--snk)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg)'; }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--f1)' }}>이상탐지{status === 'truncated' ? ' · 표본' : ''}</span>
          <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--f3)' }}>{sourceDate}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(status === 'complete' || status === 'truncated') && rows.map(({ label, count, fg }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 600,
                color: fg, width: 28, flexShrink: 0,
              }}>{label}</span>
              <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--bs)', overflow: 'hidden' }}>
                <div style={{
                  width: `${(count / max) * 100}%`,
                  height: '100%', borderRadius: 3,
                  background: fg,
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <span style={{
                fontSize: 12, fontFamily: 'var(--mono)', fontWeight: 700,
                color: count > 0 ? fg : 'var(--f4)', width: 16, textAlign: 'right',
              }}>{count}</span>
            </div>
          ))}
        </div>
        <div style={{ borderTop: '0.5px solid var(--bs)', paddingTop: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--f3)', fontFamily: 'var(--mono)' }}>
            {status === 'unavailable' ? '읽기 실패' : status === 'invalid' ? '유효하지 않은 자료 · 집계 보류' : `${status === 'complete' ? '조회 총' : '제한 표본'} ${data.total}건`}
            {status !== 'complete' && status !== 'unavailable' ? ' · 전체 분포 미확인' : ''}
            {data.unknown > 0 ? ` · 자료 미확인 ${data.unknown}건` : ''}
          </span>
        </div>
      </div>
    </Link>
  );
}

// ── 경쟁사 TOP5 위젯 ────────────────────────────────────────────────────────────

function CompetitorWidget({ brands, sourceDate, status }: { brands: CompetitorRankKpi[]; sourceDate: string; status: KpiStatus }) {
  return (
    <Link href="/brand-ranking" style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column', gap: 8,
        padding: '12px 14px',
        border: '0.5px solid var(--bd)', borderRadius: 10,
        background: 'var(--bg)',
        transition: 'background 0.12s',
      }}
        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--snk)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg)'; }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--f1)' }}>경쟁사 TOP5</span>
          <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--f3)' }}>전체카테고리 · {sourceDate}</span>
        </div>
        {brands.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--f4)' }}>{statusMessage(status, '조회 결과 0건')}</p>
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {brands.map(b => (
            <div key={b.slug} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 700,
                color: 'var(--f4)', width: 14, textAlign: 'right', flexShrink: 0,
              }}>{b.rank}</span>
              <span style={{
                fontSize: 13, color: b.is_own ? 'var(--hs)' : 'var(--f2)',
                fontWeight: b.is_own ? 600 : 400,
                overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
              }}>{b.name}</span>
              {b.is_own && (
                <span style={{ fontSize: 9, color: 'var(--hs)', fontWeight: 600, flexShrink: 0 }}>●</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </Link>
  );
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────────

function statusMessage(status: KpiStatus, empty: string): string {
  return status === 'unavailable' ? '읽기 실패' : status === 'truncated' ? '조회 상한/완전성 미확인 · 집계 보류' : status === 'invalid' ? '유효하지 않은 자료 · 집계 보류' : empty;
}

interface Props {
  metadata: Pick<BriefingKpiData, 'source_date' | 'since' | 'rank_status' | 'anomaly_status' | 'competitor_status'>;
  ownBrands: OwnBrandKpi[];
  anomalies: AnomalyKpi;
  competitor_top5: CompetitorRankKpi[];
}

export default function BriefingKpiRow({ ownBrands, anomalies, competitor_top5, metadata }: Props) {
  const visibleBrands = ownBrands.filter(b => b.best_rank_yesterday !== null);

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <span className="sec-tag">KPI 대시보드 · 기준 {metadata.source_date} (KST)</span>
      <span style={{ fontSize: 10, color: 'var(--f4)' }}>조회 가능한 저장 자료 기준 · 수집 완료 여부 미확인 · 순위 변화는 전일 대비</span>

      {/* 자사 브랜드 순위 스파크라인 */}
      <div>
        <span style={{ fontSize: 10, color: 'var(--f4)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          자사 브랜드 · {metadata.since}–{metadata.source_date} · 모든 카테고리/스토어 혼합 최고순위 · 전체 성별/연령
        </span>
        {visibleBrands.length > 0 ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${visibleBrands.length}, 1fr)`,
            gap: 20,
            marginTop: 10,
          }}>
            {visibleBrands.map(brand => <BrandCard key={brand.slug} brand={brand} sourceDate={metadata.source_date} />)}
          </div>
        ) : (
          <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--f4)' }}>{statusMessage(metadata.rank_status, '기준일 순위 관측 0건')}</p>
        )}
      </div>

      {/* 이상탐지 + 경쟁사 — 항상 표시 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <AnomalyWidget data={anomalies} sourceDate={metadata.source_date} status={metadata.anomaly_status} />
        <CompetitorWidget brands={competitor_top5} sourceDate={metadata.source_date} status={metadata.competitor_status} />
      </div>
    </div>
  );
}
