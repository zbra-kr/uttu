'use client';
import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  fetchCompanyInfo, fetchCompanyBrands, fetchCompanyFinancials, fetchCompanyDisclosures,
  fetchCompanyRankStats, fetchCompanyTop100Trend, fetchCompanyProductDist, fetchCompanyBrandTrend,
  fetchChildCompanies,
  CATEGORY_MAP,
  type CompanyInfo, type CompanyBrand, type DartFinancial, type DartDisclosure,
  type CompanyRankStats, type CompanyProductDist, type BrandTrendRow, type CompanyChild,
} from '@/lib/queries';
import { getFundingRounds, type FundingRound } from '@/lib/queries-funding';
import { FundingCollectButton } from '@/components/uttu/funding-collect-button';
import { FundingTimeline } from '@/components/uttu/funding-timeline';
import { FundingBrief } from '@/components/uttu/funding-brief';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';
import {
  BarChart, Bar, LineChart, Line, Cell,
  XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine, Legend, CartesianGrid,
} from 'recharts';

// ── 재무 지표 파생 ─────────────────────────────────────────────────────
interface FinMetrics {
  year: number; revenue: number | null; op: number | null; net: number | null;
  assets: number | null; liab: number | null; equity: number | null;
  opMargin: number | null; netMargin: number | null;
  debtRatio: number | null; equityRatio: number | null;
  roa: number | null; roe: number | null; revGrowth: number | null;
  assetTurnover: number | null; capTurnover: number | null;
}

function computeMetrics(financials: DartFinancial[]): FinMetrics[] {
  return financials.map((f, i) => {
    const eq = f.total_assets != null && f.total_liabilities != null ? f.total_assets - f.total_liabilities : null;
    const prev = financials[i + 1];
    const pct = (a: number | null, b: number | null) =>
      a != null && b != null && b > 0 ? Math.round((a / b) * 1000) / 10 : null;
    return {
      year: f.fiscal_year, revenue: f.revenue, op: f.operating_income, net: f.net_income,
      assets: f.total_assets, liab: f.total_liabilities, equity: eq,
      opMargin:    pct(f.operating_income, f.revenue),
      netMargin:   pct(f.net_income, f.revenue),
      debtRatio:   eq != null && eq > 0 ? Math.round(((f.total_liabilities ?? 0) / eq) * 10) / 10 : null,
      equityRatio: f.total_assets != null && f.total_assets > 0 && eq != null ? Math.round((eq / f.total_assets) * 1000) / 10 : null,
      roa:          pct(f.net_income, f.total_assets),
      roe:          eq != null && eq > 0 ? pct(f.net_income, eq) : null,
      assetTurnover: f.revenue != null && f.total_assets != null && f.total_assets > 0
        ? Math.round((f.revenue / f.total_assets) * 100) / 100 : null,
      capTurnover:   f.revenue != null && eq != null && eq > 0
        ? Math.round((f.revenue / eq) * 100) / 100 : null,
      revGrowth: prev?.revenue && prev.revenue > 0 && f.revenue != null
        ? Math.round(((f.revenue - prev.revenue) / prev.revenue) * 1000) / 10 : null,
    };
  });
}

type Grade = 'good' | 'warn' | 'bad' | 'na';
const GC: Record<Grade, string> = { good: 'var(--slf)', warn: 'var(--warn)', bad: 'var(--shf)', na: 'var(--f4)' };
const GL: Record<Grade, string> = { good: '양호', warn: '주의', bad: '위험', na: 'N/A' };
function grade(v: number | null, g: number, w: number, hi = true): Grade {
  if (v == null) return 'na';
  return hi ? (v >= g ? 'good' : v >= w ? 'warn' : 'bad') : (v <= g ? 'good' : v <= w ? 'warn' : 'bad');
}

function fmtB(v: number | null): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000_000) return `${(v / 1_000_000_000_000).toFixed(1)}조`;
  if (abs >= 100_000_000)       return `${Math.round(v / 100_000_000).toLocaleString()}억`;
  if (abs >= 10_000)            return `${Math.round(v / 10_000).toLocaleString()}만`;
  return v.toLocaleString();
}
const fmtPct = (v: number | null) => v == null ? '—' : `${v.toFixed(1)}%`;
const fmtChg = (v: number | null) => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;

const TT = {
  contentStyle: { background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, fontSize: 11, fontFamily: 'var(--mono)' },
  labelStyle: { color: 'var(--f3)' },
  cursor: { fill: 'var(--snk)' },
};
const AX = { fontSize: 9, fill: 'var(--f4)', fontFamily: 'var(--mono)' };
const CM = { top: 4, right: 8, left: 0, bottom: 0 };
const BRAND_COLORS = ['var(--hs)', 'var(--chart-green)', 'var(--warn)', 'var(--chart-blue)', 'var(--chart-violet)', 'var(--chart-pink)', 'var(--chart-teal)'];

function classifyDisc(disclosures: DartDisclosure[]) {
  const cats: Record<string, number> = { '사업보고서': 0, '분기·반기': 0, '주요사항': 0, '증권발행': 0, '기타': 0 };
  for (const d of disclosures) {
    const nm = d.report_nm;
    if (nm.includes('사업보고서')) cats['사업보고서']++;
    else if (nm.includes('분기보고서') || nm.includes('반기보고서')) cats['분기·반기']++;
    else if (nm.includes('주요사항')) cats['주요사항']++;
    else if (nm.includes('증권') || nm.includes('주식') || nm.includes('전환사채') || nm.includes('신주')) cats['증권발행']++;
    else cats['기타']++;
  }
  return Object.entries(cats).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
}

function monthlyDisc(disclosures: DartDisclosure[]) {
  const m = new Map<string, number>();
  for (const d of disclosures) {
    const month = d.rcept_dt.slice(0, 7);
    m.set(month, (m.get(month) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12).map(([name, value]) => ({ name: name.slice(2), value }));
}

// ── 공통 컴포넌트 ────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function KpiCard({ label, value, sub, color }: { label: string; value: React.ReactNode; sub?: string; color?: string }) {
  return (
    <div style={{ flex: '1 1 calc(50% - 5px)', padding: '10px 12px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
      <div style={{ fontSize: 10, color: 'var(--f4)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: color ?? 'var(--f1)', fontFamily: 'var(--mono)', lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--f4)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
    </div>
  );
}

function FinKpiCard({ label, value, g }: { label: string; value: string; g: Grade }) {
  return (
    <div style={{ flex: '1 1 calc(50% - 5px)', padding: '10px 12px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
      <div style={{ fontSize: 10, color: 'var(--f4)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: GC[g], fontFamily: 'var(--mono)', lineHeight: 1.2 }}>{value}</div>
      <div style={{ fontSize: 9, color: GC[g], marginTop: 2 }}>{GL[g]}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '5px 0', borderBottom: '0.5px solid var(--snk)', gap: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--f4)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11, color: 'var(--f1)', fontFamily: 'var(--mono)', textAlign: 'right', wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

function HorizBar({ name, value, max, color = 'var(--hs)' }: { name: string; value: number; max: number; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
      <div style={{ fontSize: 10, color: 'var(--f3)', width: 64, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
      <div style={{ flex: 1, height: 8, background: 'var(--bs)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.round((value / max) * 100)}%`, background: color, borderRadius: 4 }} />
      </div>
      <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', width: 24, textAlign: 'right', flexShrink: 0 }}>{value}</div>
    </div>
  );
}

function Chart({ h, children }: { h?: number; children: React.ReactNode }) {
  return (
    <div style={{ overflow: 'hidden' }}>
      <ResponsiveContainer width="100%" height={h ?? 160}>{children as React.ReactElement}</ResponsiveContainer>
    </div>
  );
}

// ── 탭 컴포넌트 ──────────────────────────────────────────────────────────

type TabKey = 'overview' | 'ranking' | 'financial' | 'disclosure' | 'funding';

function TabOverview({
  info, brands, financials, rankStats, top100Trend, router,
}: {
  info: CompanyInfo; brands: CompanyBrand[]; financials: DartFinancial[];
  rankStats: CompanyRankStats | null; top100Trend: { date: string; top100_count: number }[];
  router: ReturnType<typeof useRouter>;
}) {
  const metrics = computeMetrics(financials);
  const m0 = metrics[0] ?? null;
  const latest = financials[0] ?? null;
  const eq = latest?.total_assets != null && latest?.total_liabilities != null
    ? latest.total_assets - latest.total_liabilities : null;
  const opMargin = latest?.revenue && latest.revenue > 0 && latest.operating_income != null
    ? Math.round((latest.operating_income / latest.revenue) * 1000) / 10 : null;
  const debtRatio = eq != null && eq > 0 && latest?.total_liabilities != null
    ? Math.round((latest.total_liabilities / eq) * 10) / 10 : null;

  const billionData = [...metrics].reverse().map(m => ({
    year: String(m.year),
    rev: m.revenue != null ? Math.round(m.revenue / 100_000_000) : null,
    op:  m.op != null      ? Math.round(m.op / 100_000_000)      : null,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* KPI 카드 */}
      {(m0 || rankStats) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {m0 && (
            <>
              <KpiCard label={`매출 (${m0.year})`} value={fmtB(m0.revenue)}
                sub={m0.revGrowth != null ? `YoY ${fmtChg(m0.revGrowth)}` : undefined} />
              <FinKpiCard label="영업이익률" value={fmtPct(m0.opMargin)} g={grade(m0.opMargin, 10, 0)} />
              <FinKpiCard label="순이익률"   value={fmtPct(m0.netMargin)} g={grade(m0.netMargin, 5, 0)} />
              <FinKpiCard label="부채비율"   value={fmtPct(m0.debtRatio)} g={grade(m0.debtRatio, 100, 200, false)} />
              <FinKpiCard label="ROE"        value={fmtPct(m0.roe)}       g={grade(m0.roe, 10, 0)} />
            </>
          )}
          {rankStats && (
            <>
              <KpiCard label="TOP 100" value={rankStats.top100_count} sub={rankStats.snapshot_date} color="var(--hs)" />
              <KpiCard label="평균 랭킹" value={`${rankStats.avg_rank}위`} sub={`${rankStats.sku_count} SKU`} />
            </>
          )}
        </div>
      )}

      {/* 매출·영업이익 차트 */}
      {billionData.length >= 2 && (
        <Section title="매출 · 영업이익 (억원)">
          <Chart h={160}>
            <BarChart data={billionData} margin={CM} barGap={2}>
              <XAxis dataKey="year" tick={AX} axisLine={false} tickLine={false} />
              <YAxis tick={AX} axisLine={false} tickLine={false} width={36} />
              <Tooltip {...TT} formatter={(v: unknown) => [`${v as number}억`, undefined]} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="rev" name="매출"     fill="var(--hs)"  radius={[2,2,0,0]} maxBarSize={16} />
              <Bar dataKey="op"  name="영업이익" fill="var(--slf)" radius={[2,2,0,0]} maxBarSize={16} />
              <ReferenceLine y={0} stroke="var(--bd)" />
            </BarChart>
          </Chart>
        </Section>
      )}

      {/* TOP100 추이 */}
      {top100Trend.length > 1 && (
        <Section title="TOP 100 추이 (30일)">
          <Chart h={140}>
            <LineChart data={top100Trend} margin={CM}>
              <XAxis dataKey="date" tick={AX} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={AX} axisLine={false} tickLine={false} width={30} />
              <Tooltip {...TT} />
              <Line type="monotone" dataKey="top100_count" name="TOP100" stroke="var(--hs)" strokeWidth={2} dot={false} />
            </LineChart>
          </Chart>
        </Section>
      )}

      {/* 이익률 추이 */}
      {metrics.length >= 2 && (
        <Section title="이익률 추이 (%)">
          <Chart h={140}>
            <LineChart data={[...metrics].reverse().map(m => ({ name: String(m.year), 영업이익률: m.opMargin, 순이익률: m.netMargin }))} margin={CM}>
              <XAxis dataKey="name" tick={AX} axisLine={false} tickLine={false} />
              <YAxis tick={AX} axisLine={false} tickLine={false} width={30} />
              <Tooltip {...TT} formatter={(v: unknown) => [`${v as number}%`, '']} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <ReferenceLine y={0} stroke="var(--bd)" strokeDasharray="3 3" />
              <Line type="monotone" dataKey="영업이익률" stroke="var(--hs)"  strokeWidth={1.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="순이익률"   stroke="var(--chart-green)" strokeWidth={1.5} dot={{ r: 3 }} />
            </LineChart>
          </Chart>
        </Section>
      )}

      {/* 법인 기본정보 */}
      <Section title="법인 기본정보">
        <InfoRow label="대표자" value={info.ceo_name ?? '—'} />
        <InfoRow label="사업자번호" value={info.business_number ?? '—'} />
        <InfoRow label="주소" value={info.address ?? '—'} />
        <InfoRow label="전화" value={info.phone ?? '—'} />
        {info.email && <InfoRow label="이메일" value={info.email} />}
        {info.website && (
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '0.5px solid var(--snk)' }}>
            <span style={{ fontSize: 11, color: 'var(--f4)' }}>웹사이트</span>
            <a href={info.website.startsWith('http') ? info.website : `https://${info.website}`}
              target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: 'var(--hs)', fontFamily: 'var(--mono)', textDecoration: 'none' }}>
              {info.website.slice(0, 30)}{info.website.length > 30 ? '…' : ''} ↗
            </a>
          </div>
        )}
      </Section>

      {/* DART */}
      <Section title="DART · 증권">
        <InfoRow label="상장 여부" value={<span style={{ color: info.is_listed ? 'var(--slf)' : 'var(--f3)' }}>{info.is_listed ? '상장' : '비상장'}</span>} />
        <InfoRow label="종목코드" value={info.stock_code ?? '—'} />
        <InfoRow label="DART 고유번호" value={info.corp_code ?? '—'} />
        <InfoRow label="DART 조회일" value={info.dart_fetched_at ? info.dart_fetched_at.slice(0, 10) : '—'} />
      </Section>

      {/* 재무 스냅샷 */}
      {latest && (
        <Section title={`재무 스냅샷 (${latest.fiscal_year}년)`}>
          <InfoRow label="매출액" value={fmtB(latest.revenue)} />
          <InfoRow label="영업이익" value={
            <span style={{ color: latest.operating_income != null && latest.operating_income < 0 ? 'var(--shf)' : 'var(--f1)' }}>
              {fmtB(latest.operating_income)}
            </span>
          } />
          <InfoRow label="순이익" value={
            <span style={{ color: latest.net_income != null && latest.net_income < 0 ? 'var(--shf)' : 'var(--f1)' }}>
              {fmtB(latest.net_income)}
            </span>
          } />
          <InfoRow label="영업이익률" value={<span style={{ color: GC[grade(opMargin, 10, 0)] }}>{fmtPct(opMargin)}</span>} />
          <InfoRow label="부채비율" value={<span style={{ color: GC[grade(debtRatio, 100, 200, false)] }}>{fmtPct(debtRatio)}</span>} />
          <InfoRow label="총자산" value={fmtB(latest.total_assets)} />
        </Section>
      )}

      {/* 랭킹 스냅샷 */}
      {rankStats && (
        <Section title={`랭킹 스냅샷 (${rankStats.snapshot_date})`}>
          <InfoRow label="랭킹 진입 SKU" value={rankStats.sku_count.toLocaleString()} />
          <InfoRow label="TOP 100" value={<span style={{ color: 'var(--hs)', fontWeight: 600 }}>{rankStats.top100_count}</span>} />
          <InfoRow label="평균 랭킹" value={`${rankStats.avg_rank}위`} />
          <InfoRow label="최고 순위" value={
            <span>
              <span style={{ color: 'var(--hs)', fontWeight: 600 }}>#{rankStats.best_rank}</span>
              <span style={{ color: 'var(--f4)', marginLeft: 6, fontSize: 10 }}>{rankStats.best_product_name.slice(0, 16)}{rankStats.best_product_name.length > 16 ? '…' : ''}</span>
            </span>
          } />
        </Section>
      )}

      {/* 산하 브랜드 */}
      <Section title={`산하 브랜드 (${brands.length}개)`}>
        {brands.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--f4)', fontSize: 12, padding: '12px 0' }}>등록된 브랜드가 없습니다.</div>
        ) : brands.map((b, i) => (
          <div key={b.id}
            onClick={() => router.push(`/brand?id=${b.id}`)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
              paddingTop: i > 0 ? 8 : 0, marginTop: i > 0 ? 8 : 0,
              borderTop: i > 0 ? '1px solid var(--bd)' : 'none',
            }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: b.is_own ? 600 : 400, color: b.is_own ? 'var(--hs)' : 'var(--f1)' }}>{b.name}</span>
              {b.nation_name && <span style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginLeft: 6 }}>{b.nation_name}</span>}
            </div>
            {b.is_own
              ? <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--hs)', background: 'var(--hs-soft)', padding: '1px 5px', borderRadius: 4 }}>자사</span>
              : <span style={{ fontSize: 9, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>경쟁사</span>}
            <span style={{ fontSize: 11, color: 'var(--f4)' }}>›</span>
          </div>
        ))}
      </Section>
    </div>
  );
}

function TabRanking({
  rankStats, top100Trend, brandTrend, productDist, rankLoading,
}: {
  rankStats: CompanyRankStats | null; top100Trend: { date: string; top100_count: number }[];
  brandTrend: BrandTrendRow[]; productDist: CompanyProductDist | null; rankLoading: boolean;
}) {
  if (rankLoading) return <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--f4)', fontSize: 13 }}>랭킹 데이터 로딩 중…</div>;
  if (!rankStats || rankStats.sku_count === 0) return <MobileEmptyState icon="📊" title="무신사 랭킹 진입 데이터가 없습니다" />;

  const catData = rankStats.by_category.slice(0, 8);
  const catMax = catData[0]?.sku_count || 1;
  const hasMultiBrand = rankStats.by_brand.length > 1;
  const trendChartData = brandTrend.map(row => {
    const obj: Record<string, unknown> = { date: row.date };
    for (const c of row.counts) obj[c.brand] = c.top100;
    return obj;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* TOP100 추이 */}
      {top100Trend.length > 1 && (
        <Section title="TOP 100 추이 (30일)">
          <Chart h={150}>
            <LineChart data={top100Trend} margin={CM}>
              <XAxis dataKey="date" tick={AX} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={AX} axisLine={false} tickLine={false} width={28} />
              <Tooltip {...TT} />
              <Line type="monotone" dataKey="top100_count" name="TOP100" stroke="var(--hs)" strokeWidth={2} dot={false} />
            </LineChart>
          </Chart>
        </Section>
      )}

      {/* 카테고리 분포 */}
      {catData.length > 0 && (
        <Section title="카테고리 분포">
          {catData.map(c => (
            <HorizBar key={c.category_code} name={CATEGORY_MAP[c.category_code] ?? c.category_code} value={c.sku_count} max={catMax} />
          ))}
        </Section>
      )}

      {/* 가격대 분포 */}
      {productDist?.priceBuckets && productDist.priceBuckets.filter(b => b.count > 0).length > 0 && (
        <Section title="가격대 분포">
          {(() => {
            const data = productDist.priceBuckets.filter(b => b.count > 0);
            const max = Math.max(...data.map(d => d.count), 1);
            return data.map(d => <HorizBar key={d.label} name={d.label} value={d.count} max={max} color="var(--f3)" />);
          })()}
        </Section>
      )}

      {/* 할인율 분포 */}
      {productDist?.discountBuckets && productDist.discountBuckets.length > 0 && (
        <Section title="할인율 분포">
          <Chart h={130}>
            <BarChart data={productDist.discountBuckets} margin={CM}>
              <XAxis dataKey="label" tick={AX} axisLine={false} tickLine={false} />
              <YAxis tick={AX} axisLine={false} tickLine={false} width={24} />
              <Tooltip {...TT} />
              <Bar dataKey="count" name="상품수" fill="var(--hs)" opacity={0.85} radius={[2, 2, 0, 0]} />
            </BarChart>
          </Chart>
        </Section>
      )}

      {/* 리뷰 만족도 분포 */}
      {productDist?.reviewBuckets && productDist.reviewBuckets.filter(b => b.count > 0).length > 0 && (
        <Section title="리뷰 만족도 분포">
          <Chart h={130}>
            <BarChart data={productDist.reviewBuckets.filter(b => b.count > 0)} margin={CM}>
              <XAxis dataKey="label" tick={AX} axisLine={false} tickLine={false} />
              <YAxis tick={AX} axisLine={false} tickLine={false} width={24} />
              <Tooltip {...TT} />
              <Bar dataKey="count" name="상품수" fill="var(--chart-green)" opacity={0.85} radius={[2, 2, 0, 0]} />
            </BarChart>
          </Chart>
        </Section>
      )}

      {/* 브랜드별 TOP100 추이 */}
      {hasMultiBrand && trendChartData.length > 1 && (
        <Section title="브랜드별 TOP 100 추이 (30일)">
          <Chart h={170}>
            <LineChart data={trendChartData} margin={CM}>
              <CartesianGrid strokeDasharray="3 4" stroke="var(--bs)" vertical={false} />
              <XAxis dataKey="date" tick={AX} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={AX} axisLine={false} tickLine={false} width={24} />
              <Tooltip {...TT} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {rankStats.by_brand.map((b, i) => (
                <Line key={b.brand_name} type="monotone" dataKey={b.brand_name}
                  stroke={BRAND_COLORS[i % BRAND_COLORS.length]} strokeWidth={1.5} dot={false} connectNulls />
              ))}
            </LineChart>
          </Chart>
        </Section>
      )}

      {/* 브랜드별 현황 테이블 */}
      {hasMultiBrand && (
        <Section title="브랜드별 랭킹 현황">
          {rankStats.by_brand.map((b, i) => (
            <div key={b.brand_name} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              paddingTop: i > 0 ? 8 : 0, marginTop: i > 0 ? 8 : 0,
              borderTop: i > 0 ? '1px solid var(--bd)' : 'none',
            }}>
              <div style={{ flex: 1, fontSize: 13, color: 'var(--f1)' }}>{b.brand_name}</div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: b.top100_count > 0 ? 'var(--hs)' : 'var(--f4)' }}>{b.top100_count}</span>
                <span style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginLeft: 4 }}>TOP100</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', width: 40, textAlign: 'right' }}>
                {b.sku_count}SKU
              </div>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

function TabFinancial({
  financials, top100Trend,
}: {
  financials: DartFinancial[]; top100Trend: { date: string; top100_count: number }[];
}) {
  if (!financials.length) {
    return <MobileEmptyState icon="📈" title="DART 재무 데이터가 수집되면 자동으로 표시됩니다" />;
  }

  const metrics = computeMetrics(financials);
  const latest = metrics[0];
  const chartData = [...metrics].reverse();

  const billionData = chartData.map(m => ({
    name: `${m.year}`,
    매출: m.revenue != null ? Math.round(m.revenue / 100_000_000) : null,
    영업이익: m.op != null ? Math.round(m.op / 100_000_000) : null,
    순이익: m.net != null ? Math.round(m.net / 100_000_000) : null,
  }));
  const assetData = chartData.map(m => ({
    name: `${m.year}`,
    자기자본: m.equity != null ? Math.round(m.equity / 100_000_000) : 0,
    부채: m.liab != null ? Math.round(m.liab / 100_000_000) : 0,
  }));
  const rateData = chartData.map(m => ({ name: `${m.year}`, 영업이익률: m.opMargin, 순이익률: m.netMargin }));
  const roeData  = chartData.map(m => ({ name: `${m.year}`, ROA: m.roa, ROE: m.roe }));
  const debtData = chartData.map(m => ({ name: `${m.year}`, 부채비율: m.debtRatio }));
  const growData = chartData.map(m => ({ name: `${m.year}`, 매출성장률: m.revGrowth }));
  const turnData = chartData.map(m => ({ name: `${m.year}`, 자산회전율: m.assetTurnover, 자본회전율: m.capTurnover }));

  const scoreItems = [
    { label: '영업이익률', val: fmtPct(latest.opMargin),   g: grade(latest.opMargin,   10, 0)         },
    { label: '순이익률',   val: fmtPct(latest.netMargin),  g: grade(latest.netMargin,   5, 0)         },
    { label: '부채비율',   val: fmtPct(latest.debtRatio),  g: grade(latest.debtRatio,  100, 200, false) },
    { label: '자기자본비율', val: fmtPct(latest.equityRatio), g: grade(latest.equityRatio, 50, 30)      },
    { label: 'ROA',        val: fmtPct(latest.roa),        g: grade(latest.roa,         5, 0)         },
    { label: 'ROE',        val: fmtPct(latest.roe),        g: grade(latest.roe,        10, 0)         },
    { label: '매출 YoY',  val: fmtChg(latest.revGrowth),  g: grade(latest.revGrowth,  10, 0)         },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* 재무 KPI 8카드 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <FinKpiCard label="영업이익률"   value={fmtPct(latest.opMargin)}  g={grade(latest.opMargin, 10, 0)} />
        <FinKpiCard label="순이익률"     value={fmtPct(latest.netMargin)} g={grade(latest.netMargin, 5, 0)} />
        <FinKpiCard label="부채비율"     value={fmtPct(latest.debtRatio)} g={grade(latest.debtRatio, 100, 200, false)} />
        <FinKpiCard label="자기자본비율" value={fmtPct(latest.equityRatio)} g={grade(latest.equityRatio, 50, 30)} />
        <FinKpiCard label="ROA"          value={fmtPct(latest.roa)}       g={grade(latest.roa, 5, 0)} />
        <FinKpiCard label="ROE"          value={fmtPct(latest.roe)}       g={grade(latest.roe, 10, 0)} />
        <FinKpiCard label="매출 YoY"    value={fmtChg(latest.revGrowth)} g={grade(latest.revGrowth, 10, 0)} />
        <KpiCard    label="최신 연도"    value={`${latest.year}년`} />
      </div>

      {/* 스코어카드 */}
      <Section title="재무 건전성 스코어카드">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {scoreItems.map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: 'var(--snk)', borderRadius: 6, border: `1px solid ${GC[s.g]}30` }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: GC[s.g], flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: 'var(--f3)' }}>{s.label}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: GC[s.g], fontFamily: 'var(--mono)' }}>{s.val}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* 연도별 핵심지표 테이블 */}
      <Section title="연도별 핵심지표 비교">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
            <thead>
              <tr>
                {['연도', '매출', '영업이익', '영업이익률', '부채비율', 'ROE', 'YoY'].map(h => (
                  <th key={h} style={{ textAlign: h === '연도' ? 'left' : 'right', padding: '4px 6px', color: 'var(--f4)', fontWeight: 500, borderBottom: '1px solid var(--snk)', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map(m => (
                <tr key={m.year} style={{ borderBottom: '1px solid var(--snk)' }}>
                  <td style={{ padding: '4px 6px', color: 'var(--f2)', fontWeight: 500, fontFamily: 'var(--mono)', fontSize: 10 }}>{m.year}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 10 }}>{fmtB(m.revenue)}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 10, color: m.op != null && m.op < 0 ? 'var(--shf)' : 'var(--f1)' }}>{fmtB(m.op)}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 10, color: GC[grade(m.opMargin, 10, 0)] }}>{fmtPct(m.opMargin)}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 10, color: GC[grade(m.debtRatio, 100, 200, false)] }}>{fmtPct(m.debtRatio)}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 10, color: GC[grade(m.roe, 10, 0)] }}>{fmtPct(m.roe)}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 10, color: GC[grade(m.revGrowth, 10, 0)] }}>{fmtChg(m.revGrowth)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* B1 매출·영업이익·순이익 */}
      <Section title="B1 · 매출 · 영업이익 · 순이익 (억원)">
        <Chart h={170}>
          <BarChart data={billionData} margin={CM}>
            <CartesianGrid strokeDasharray="3 4" stroke="var(--bs)" vertical={false} />
            <XAxis dataKey="name" tick={AX} axisLine={false} tickLine={false} />
            <YAxis tick={AX} axisLine={false} tickLine={false} width={30} />
            <Tooltip {...TT} formatter={(v: unknown) => [`${v as number}억`, '']} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="매출"     fill="var(--f3)"  opacity={0.6} radius={[2, 2, 0, 0]} />
            <Bar dataKey="영업이익" fill="var(--hs)"  opacity={0.85} radius={[2, 2, 0, 0]} />
            <Bar dataKey="순이익"   fill="var(--chart-green)"    opacity={0.85} radius={[2, 2, 0, 0]} />
          </BarChart>
        </Chart>
      </Section>

      {/* B2 수익률 추이 */}
      <Section title="B2 · 수익률 추이 (%)">
        <Chart h={160}>
          <LineChart data={rateData} margin={CM}>
            <CartesianGrid strokeDasharray="3 4" stroke="var(--bs)" vertical={false} />
            <XAxis dataKey="name" tick={AX} axisLine={false} tickLine={false} />
            <YAxis tick={AX} axisLine={false} tickLine={false} width={30} />
            <Tooltip {...TT} formatter={(v: unknown) => [`${v as number}%`, '']} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <ReferenceLine y={0} stroke="var(--bs)" strokeDasharray="3 3" />
            <Line type="monotone" dataKey="영업이익률" stroke="var(--hs)"  strokeWidth={1.5} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="순이익률"   stroke="var(--chart-green)" strokeWidth={1.5} dot={{ r: 3 }} />
          </LineChart>
        </Chart>
      </Section>

      {/* B3 부채비율 */}
      <Section title="B3 · 부채비율 추이 (%)">
        <Chart h={150}>
          <LineChart data={debtData} margin={CM}>
            <CartesianGrid strokeDasharray="3 4" stroke="var(--bs)" vertical={false} />
            <XAxis dataKey="name" tick={AX} axisLine={false} tickLine={false} />
            <YAxis tick={AX} axisLine={false} tickLine={false} width={30} />
            <Tooltip {...TT} formatter={(v: unknown) => [`${v as number}%`, '']} />
            <ReferenceLine y={200} stroke="var(--shf)" strokeDasharray="4 3" label={{ value: '위험 200%', fill: 'var(--shf)', fontSize: 9, position: 'insideTopRight' }} />
            <ReferenceLine y={100} stroke="var(--warn)" strokeDasharray="4 3" label={{ value: '주의 100%', fill: 'var(--warn)', fontSize: 9, position: 'insideTopRight' }} />
            <Line type="monotone" dataKey="부채비율" stroke="var(--shf)" strokeWidth={1.5} dot={{ r: 3 }} />
          </LineChart>
        </Chart>
      </Section>

      {/* B4 ROA/ROE */}
      <Section title="B4 · ROA / ROE 추이 (%)">
        <Chart h={150}>
          <LineChart data={roeData} margin={CM}>
            <CartesianGrid strokeDasharray="3 4" stroke="var(--bs)" vertical={false} />
            <XAxis dataKey="name" tick={AX} axisLine={false} tickLine={false} />
            <YAxis tick={AX} axisLine={false} tickLine={false} width={30} />
            <Tooltip {...TT} formatter={(v: unknown) => [`${v as number}%`, '']} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <ReferenceLine y={0} stroke="var(--bs)" strokeDasharray="3 3" />
            <Line type="monotone" dataKey="ROA" stroke="var(--hs)" strokeWidth={1.5} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="ROE" stroke="var(--chart-blue)"   strokeWidth={1.5} dot={{ r: 3 }} />
          </LineChart>
        </Chart>
      </Section>

      {/* B5 자산 구성 */}
      <Section title="B5 · 자산 구성 (억원)">
        <Chart h={150}>
          <BarChart data={assetData} margin={CM}>
            <CartesianGrid strokeDasharray="3 4" stroke="var(--bs)" vertical={false} />
            <XAxis dataKey="name" tick={AX} axisLine={false} tickLine={false} />
            <YAxis tick={AX} axisLine={false} tickLine={false} width={30} />
            <Tooltip {...TT} formatter={(v: unknown) => [`${v as number}억`, '']} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="자기자본" stackId="a" fill="var(--chart-green)" opacity={0.8} />
            <Bar dataKey="부채"    stackId="a" fill="var(--shf)" opacity={0.6} radius={[2, 2, 0, 0]} />
          </BarChart>
        </Chart>
      </Section>

      {/* B6 매출 성장률 */}
      <Section title="B6 · 매출 성장률 (%)">
        <Chart h={150}>
          <BarChart data={growData} margin={CM}>
            <CartesianGrid strokeDasharray="3 4" stroke="var(--bs)" vertical={false} />
            <XAxis dataKey="name" tick={AX} axisLine={false} tickLine={false} />
            <YAxis tick={AX} axisLine={false} tickLine={false} width={30} />
            <Tooltip {...TT} formatter={(v: unknown) => [`${v as number}%`, '']} />
            <ReferenceLine y={0} stroke="var(--bs)" />
            <Bar dataKey="매출성장률" radius={[2, 2, 0, 0]}>
              {growData.map((d, i) => (
                <Cell key={i} fill={(d.매출성장률 ?? 0) >= 0 ? 'var(--hs)' : 'var(--shf)'} opacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </Chart>
      </Section>

      {/* B7 회전율 */}
      <Section title="B7 · 자산·자본 회전율 추이 (배)">
        <div style={{ fontSize: 10, color: 'var(--f4)', marginBottom: 6 }}>높을수록 자산 활용 효율 우수</div>
        <Chart h={150}>
          <LineChart data={turnData} margin={CM}>
            <CartesianGrid strokeDasharray="3 4" stroke="var(--bs)" vertical={false} />
            <XAxis dataKey="name" tick={AX} axisLine={false} tickLine={false} />
            <YAxis tick={AX} axisLine={false} tickLine={false} width={30} />
            <Tooltip {...TT} formatter={(v: unknown) => [`${v as number}배`, '']} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <ReferenceLine y={1} stroke="var(--f4)" strokeDasharray="3 3" label={{ value: '기준 1배', fill: 'var(--f4)', fontSize: 9, position: 'insideTopRight' }} />
            <Line type="monotone" dataKey="자산회전율" stroke="var(--hs)"  strokeWidth={1.5} dot={{ r: 3 }} connectNulls />
            <Line type="monotone" dataKey="자본회전율" stroke="var(--chart-blue)" strokeWidth={1.5} dot={{ r: 3 }} connectNulls />
          </LineChart>
        </Chart>
      </Section>

      {/* E3 랭킹×재무 상관 */}
      {top100Trend.length > 1 && (
        <Section title="E3 · 랭킹 퍼포먼스 × 재무 성과">
          <div style={{ fontSize: 10, color: 'var(--f4)', marginBottom: 6 }}>최근 30일 TOP100 추이</div>
          <Chart h={120}>
            <LineChart data={top100Trend} margin={CM}>
              <XAxis dataKey="date" tick={AX} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={AX} axisLine={false} tickLine={false} width={28} />
              <Tooltip {...TT} />
              <Line type="monotone" dataKey="top100_count" stroke="var(--hs)" strokeWidth={2} dot={false} />
            </LineChart>
          </Chart>
        </Section>
      )}
    </div>
  );
}

function TabDisclosure({ disclosures }: { disclosures: DartDisclosure[] }) {
  if (!disclosures.length) {
    return <MobileEmptyState icon="📄" title="DART 공시 데이터가 수집되면 자동으로 표시됩니다" />;
  }

  const typeData = classifyDisc(disclosures);
  const monthData = monthlyDisc(disclosures);
  const typeMax = Math.max(...typeData.map(d => d.value), 1);
  const corrections = disclosures.filter(d => d.rm === '유');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* 정정 공시 알림 */}
      {corrections.length > 0 && (
        <div style={{ padding: '10px 13px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, fontSize: 12, color: 'var(--shf)' }}>
          ⚠ 정정 공시 {corrections.length}건 — {corrections.slice(0, 2).map(d => d.report_nm).join(', ')}{corrections.length > 2 ? ` 외 ${corrections.length - 2}건` : ''}
        </div>
      )}

      {/* 유형 분류 */}
      <Section title="공시 유형 분류">
        {typeData.map(d => <HorizBar key={d.name} name={d.name} value={d.value} max={typeMax} />)}
      </Section>

      {/* 월별 빈도 */}
      {monthData.length > 0 && (
        <Section title="월별 공시 빈도">
          <Chart h={130}>
            <BarChart data={monthData} margin={CM}>
              <XAxis dataKey="name" tick={AX} axisLine={false} tickLine={false} />
              <YAxis tick={AX} axisLine={false} tickLine={false} width={24} allowDecimals={false} />
              <Tooltip {...TT} />
              <Bar dataKey="value" name="건수" fill="var(--hs)" opacity={0.8} radius={[2, 2, 0, 0]} />
            </BarChart>
          </Chart>
        </Section>
      )}

      {/* 공시 목록 */}
      <Section title={`공시 목록 (${disclosures.length}건)`}>
        {disclosures.map((d, i) => (
          <div key={d.id} style={{ paddingTop: i > 0 ? 10 : 0, marginTop: i > 0 ? 10 : 0, borderTop: i > 0 ? '1px solid var(--bd)' : 'none' }}>
            <a href={`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${d.rcept_no}`}
              target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
              <div style={{ fontSize: 13, color: 'var(--f1)', lineHeight: 1.4 }}>
                {d.report_nm}
                {d.rm === '유' && <span style={{ fontSize: 9, color: 'var(--shf)', fontFamily: 'var(--mono)', marginLeft: 5 }}>정정</span>}
              </div>
            </a>
            <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 2 }}>
              {d.rcept_dt.replace(/(\d{4})(\d{2})(\d{2})/, '$1.$2.$3')}
              {d.flr_nm && ` · ${d.flr_nm}`}
            </div>
          </div>
        ))}
      </Section>
    </div>
  );
}

function TabFundingMobile({
  companyId,
  fundingLastCollectedAt,
  rounds,
  briefMd,
  briefAt,
  onRefresh,
}: {
  companyId: string;
  fundingLastCollectedAt: string | null;
  rounds: FundingRound[];
  briefMd: string | null;
  briefAt: string | null;
  onRefresh: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Section title="투자정보 수집">
        <div style={{ marginBottom: 10 }}>
          <FundingCollectButton
            companyId={companyId}
            fundingLastCollectedAt={fundingLastCollectedAt}
            onDone={onRefresh}
          />
        </div>
        <div style={{ fontSize: 11, color: 'var(--f4)' }}>
          DART 공시 + 뉴스 NLP 추출 (on-demand) · 비상장 사모 라운드는 뉴스에만 의존
        </div>
      </Section>

      <Section title={`투자 라운드 타임라인${rounds.length > 0 ? ` (${rounds.length}건)` : ''}`}>
        <div style={{ overflowX: 'auto' }}>
          <FundingTimeline rounds={rounds} />
        </div>
      </Section>

      <Section title="AI 투자 브리핑">
        <FundingBrief companyId={companyId} briefMd={briefMd} briefAt={briefAt} />
      </Section>
    </div>
  );
}

// ── 메인 ─────────────────────────────────────────────────────────────────
export default function MobileCompanyDetailView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const companyId = searchParams.get('id') ?? '';

  const [info,          setInfo]          = useState<CompanyInfo | null>(null);
  const [brands,        setBrands]        = useState<CompanyBrand[]>([]);
  const [financials,    setFinancials]    = useState<DartFinancial[]>([]);
  const [disclosures,   setDisclosures]   = useState<DartDisclosure[]>([]);
  const [rankStats,     setRankStats]     = useState<CompanyRankStats | null>(null);
  const [top100Trend,   setTop100Trend]   = useState<{ date: string; top100_count: number }[]>([]);
  const [productDist,   setProductDist]   = useState<CompanyProductDist | null>(null);
  const [brandTrend,    setBrandTrend]    = useState<BrandTrendRow[]>([]);
  const [fundingRounds,  setFundingRounds]  = useState<FundingRound[]>([]);
  const [childCompanies, setChildCompanies] = useState<CompanyChild[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [rankLoading,   setRankLoading]   = useState(false);
  const [tab, setTab] = useState<TabKey>('overview');

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    setRankStats(null); setTop100Trend([]); setProductDist(null); setBrandTrend([]);
    setFundingRounds([]); setChildCompanies([]);
    Promise.all([
      fetchCompanyInfo(companyId),
      fetchCompanyBrands(companyId),
      fetchCompanyFinancials(companyId),
      fetchCompanyDisclosures(companyId),
      getFundingRounds(companyId, 50),
      fetchChildCompanies(companyId),
    ]).then(async ([ci, cb, cf, cd, fr, children]) => {
      setInfo(ci); setBrands(cb); setFinancials(cf); setDisclosures(cd);
      setFundingRounds(fr); setChildCompanies(children);
      setLoading(false);

      const childBrands = children.flatMap((c: CompanyChild) => c.brands);
      const allBrands = [...cb, ...childBrands];
      if (allBrands.length > 0) {
        setRankLoading(true);
        const brandNames = allBrands.map((b: { name: string }) => b.name);
        const [rs, trend, pd, bt] = await Promise.all([
          fetchCompanyRankStats(brandNames),
          fetchCompanyTop100Trend(brandNames, 30),
          fetchCompanyProductDist(brandNames),
          allBrands.length > 1 ? fetchCompanyBrandTrend(brandNames, 30) : Promise.resolve([]),
        ]);
        setRankStats(rs); setTop100Trend(trend); setProductDist(pd); setBrandTrend(bt);
        setRankLoading(false);
      }
    }).catch(() => setLoading(false));
  }, [companyId]);

  if (!companyId) return <MobileEmptyState icon="🔍" title="회사 ID가 없습니다" />;
  if (loading) return <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>;
  if (!info) return <MobileEmptyState icon="🏢" title="회사 정보를 찾을 수 없습니다" />;

  const ownCount = brands.filter(b => b.is_own).length;

  const TAB_ITEMS: { key: TabKey; label: string; badge?: string | number | null }[] = [
    { key: 'overview', label: '개요' },
    { key: 'ranking', label: '랭킹·상품', badge: rankStats?.sku_count ? `${rankStats.sku_count} SKU` : null },
    { key: 'financial', label: '재무', badge: financials.length ? `${financials.length}개년` : null },
    { key: 'disclosure', label: '공시', badge: disclosures.length || null },
    { key: 'funding', label: '투자정보', badge: fundingRounds.length || null },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 12px 20px', width: '100%', minWidth: 0 }}>

      {/* 헤더 */}
      <div style={{ padding: '14px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--f1)' }}>{info.corp_name}</span>
          {info.is_listed && (
            <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--slf)', background: 'var(--slb)', padding: '1px 5px', borderRadius: 4 }}>상장</span>
          )}
          {info.corp_code && (
            <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--hs)', background: 'var(--hs-soft)', padding: '1px 5px', borderRadius: 4 }}>DART ✓</span>
          )}
        </div>
        {info.stock_code && (
          <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 2 }}>종목코드 {info.stock_code}</div>
        )}
        {brands.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--f4)', marginTop: 2 }}>
            산하 브랜드 {brands.length}개{ownCount > 0 ? ` · 자사 ${ownCount}개` : ''}
          </div>
        )}
      </div>

      {/* KPI 요약 (랭킹) */}
      {(rankStats || rankLoading) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <KpiCard label="랭킹 진입 SKU" value={rankLoading ? '…' : rankStats?.sku_count.toLocaleString() ?? '—'} sub={rankStats?.snapshot_date} />
          <KpiCard label="TOP 100" value={rankLoading ? '…' : rankStats?.top100_count.toLocaleString() ?? '—'} color="var(--hs)" />
          <KpiCard label="평균 랭킹" value={rankLoading ? '…' : rankStats?.avg_rank ? `${rankStats.avg_rank}위` : '—'} />
          <KpiCard label="최고 순위" value={rankLoading ? '…' : rankStats?.best_rank ? `#${rankStats.best_rank}` : '—'} sub={rankStats?.best_product_name?.slice(0, 14)} />
        </div>
      )}

      {/* 탭 바 */}
      <div style={{ display: 'flex', gap: 4, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {TAB_ITEMS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              flexShrink: 0, padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer',
              border: '1px solid',
              borderColor: tab === t.key ? 'var(--hs)' : 'var(--bd)',
              background: tab === t.key ? 'var(--hs-soft)' : 'var(--sur)',
              color: tab === t.key ? 'var(--hs)' : 'var(--f2)',
            }}>
            {t.label}
            {t.badge != null && <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--f4)', marginLeft: 4 }}>({t.badge})</span>}
          </button>
        ))}
      </div>

      {/* 탭 컨텐츠 */}
      {tab === 'overview' && (
        <TabOverview info={info} brands={brands} financials={financials} rankStats={rankStats} top100Trend={top100Trend} router={router} />
      )}
      {tab === 'ranking' && (
        <TabRanking rankStats={rankStats} top100Trend={top100Trend} brandTrend={brandTrend} productDist={productDist} rankLoading={rankLoading} />
      )}
      {tab === 'financial' && (
        <TabFinancial financials={financials} top100Trend={top100Trend} />
      )}
      {tab === 'disclosure' && (
        <TabDisclosure disclosures={disclosures} />
      )}
      {tab === 'funding' && (
        <TabFundingMobile
          companyId={companyId}
          fundingLastCollectedAt={info.funding_last_collected_at ?? null}
          rounds={fundingRounds}
          briefMd={info.funding_brief_md ?? null}
          briefAt={info.funding_brief_at ?? null}
          onRefresh={() => {
            getFundingRounds(companyId, 50).then(setFundingRounds).catch(() => {});
          }}
        />
      )}
    </div>
  );
}
