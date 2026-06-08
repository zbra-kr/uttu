'use client';
import React from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import { useIsMobile } from '@/hooks/useViewport';
import MobileCompanyDetailView from './MobileCompanyDetailView';
import {
  LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, Tooltip, Legend, ReferenceLine,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { IcCompany, IcArrowUR, IcEdit } from '@/components/ui/icons';
import NoteDrawer from '@/components/me/NoteDrawer';
import BookmarkToggle from '@/components/me/BookmarkToggle';
import { fetchNoteCountForEntity, logView } from '@/lib/queries-me';
import { Line as ChartLine, HorizBars } from '@/components/ui/charts';
import {
  searchCompanies, fetchCompanyInfo, fetchCompanyBrands,
  fetchCompanyFinancials, fetchCompanyDisclosures,
  fetchCompanyRankStats, fetchCompanyTop100Trend,
  fetchCompanyProductDist, fetchCompanyBrandTrend,
  fetchChildCompanies, fetchParentCompany,
  CATEGORY_MAP,
  type CompanyInfo, type CompanyBrand, type DartFinancial, type DartDisclosure,
  type CompanyRankStats, type CompanyProductDist, type BrandTrendRow,
  type CompanyChild,
} from '@/lib/queries';
import { getFundingRounds, type FundingRound } from '@/lib/queries-funding';
import { FundingCollectButton } from '@/components/uttu/funding-collect-button';
import { FundingTimeline } from '@/components/uttu/funding-timeline';
import { FundingBrief } from '@/components/uttu/funding-brief';

// ── 상수 ──────────────────────────────────────────────────────────────
const TT: any = {
  contentStyle: { background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, fontSize: 11, fontFamily: 'var(--mono)' },
  labelStyle: { color: 'var(--f3)' },
  itemStyle: { color: 'var(--f1)' },
  cursor: { fill: 'var(--snk)' },
};
const AX = { fontSize: 9, fill: 'var(--f4)', fontFamily: 'var(--mono)' };
const CM = { top: 4, right: 12, left: 4, bottom: 0 };
const BRAND_COLORS = ['var(--hs)', '#22C55E', '#F59E0B', '#3B82F6', '#8B5CF6', '#EC4899', '#14B8A6'];

const GENDERS  = [['A', '전체'], ['M', '남성'], ['F', '여성']] as const;
const AGE_KEYS = [
  ['AGE_BAND_ALL', '전체'], ['AGE_BAND_MINOR', '20미만'], ['AGE_BAND_20', '20~25'],
  ['AGE_BAND_25', '25~30'], ['AGE_BAND_30', '30~35'], ['AGE_BAND_35', '35~40'], ['AGE_BAND_40', '40+'],
] as const;

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
      year: f.fiscal_year,
      revenue: f.revenue, op: f.operating_income, net: f.net_income,
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
      revGrowth:   prev?.revenue && prev.revenue > 0 && f.revenue != null
        ? Math.round(((f.revenue - prev.revenue) / prev.revenue) * 1000) / 10 : null,
    };
  });
}

type Grade = 'good' | 'warn' | 'bad' | 'na';
const GC: Record<Grade, string> = { good: 'var(--slf)', warn: '#F59E0B', bad: 'var(--shf)', na: 'var(--f4)' };
const GL: Record<Grade, string> = { good: '양호', warn: '주의', bad: '위험', na: 'N/A' };
function grade(v: number | null, g: number, w: number, hi = true): Grade {
  if (v == null) return 'na';
  return hi ? (v >= g ? 'good' : v >= w ? 'warn' : 'bad') : (v <= g ? 'good' : v <= w ? 'warn' : 'bad');
}

// ── 공시 분류 ──────────────────────────────────────────────────────────
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

// ── 공통 유틸 ──────────────────────────────────────────────────────────
function fmtB(v: number | null): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000_000) return `${(v / 1_000_000_000_000).toFixed(1)}조`;
  if (abs >= 100_000_000)       return `${Math.round(v / 100_000_000)}억`;
  if (abs >= 10_000)            return `${Math.round(v / 10_000)}만`;
  return v.toLocaleString();
}
const fmtPct = (v: number | null) => v == null ? '—' : `${v.toFixed(1)}%`;
const fmtChg = (v: number | null) => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="row-flex between" style={{ padding: '4px 0', borderBottom: '0.5px solid var(--snk)' }}>
      <span style={{ fontSize: 11, color: 'var(--f4)', flexShrink: 0, width: 110 }}>{label}</span>
      <span className="mono" style={{ fontSize: 11, color: 'var(--f1)', textAlign: 'right', wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

function KpiCard({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: string; accent?: boolean }) {
  return (
    <div className="panel" style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 10, color: 'var(--f4)', marginBottom: 4 }}>{label}</div>
      <div className="mono" style={{ fontSize: 20, fontWeight: 700, lineHeight: 1, color: accent ? 'var(--hs)' : 'var(--f1)' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--f3)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
    </div>
  );
}

function FinKpiCard({ label, value, grade: g, suffix = '' }: { label: string; value: string; grade: Grade; suffix?: string }) {
  return (
    <div className="panel" style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 10, color: 'var(--f4)', marginBottom: 4 }}>{label}</div>
      <div className="mono" style={{ fontSize: 18, fontWeight: 700, lineHeight: 1, color: GC[g] }}>{value}{suffix}</div>
      <div style={{ fontSize: 9, color: GC[g], marginTop: 3 }}>{GL[g]}</div>
    </div>
  );
}

function ChartWrap({ h, children }: { h?: number; children: React.ReactNode }) {
  return (
    <div style={{ width: '100%', height: h ?? 160 }}>
      <ResponsiveContainer width="100%" height="100%">{children as any}</ResponsiveContainer>
    </div>
  );
}

function SecPanel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span className="sec-tag">{title}</span>
        {action && <div style={{ flexShrink: 0 }}>{action}</div>}
      </div>
      <div style={{ marginTop: 10 }}>{children}</div>
    </section>
  );
}

// ── 포털 ──────────────────────────────────────────────────────────────
function CompanyPortal({ onSelect }: { onSelect: (id: string) => void }) {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<{ id: string; corp_name: string }[]>([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(-1);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = (kw: string) => {
    if (!kw.trim()) { setResults([]); setOpen(false); return; }
    setLoading(true);
    searchCompanies(kw, 15).then(r => { setResults(r); setOpen(r.length > 0); setActiveIdx(-1); }).finally(() => setLoading(false));
  };
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value; setQuery(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => doSearch(v), 300);
  };
  const handleSelect = (r: { id: string }) => { setQuery(''); setResults([]); setOpen(false); onSelect(r.id); };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && activeIdx >= 0) handleSelect(results[activeIdx]);
    else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '68vh' }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <IcCompany size={20} style={{ color: 'var(--f3)' }} />
          <span style={{ fontSize: 20, fontWeight: 600, color: 'var(--f1)', letterSpacing: '-0.03em' }}>회사 조회</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--f4)' }}>법인명으로 회사를 검색할 수 있습니다</div>
      </div>
      <div style={{ width: 520, position: 'relative' }}>
        <div style={{ position: 'relative', background: 'var(--sur)', border: '1.5px solid var(--bd)', borderRadius: 28, padding: '12px 20px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
          <span style={{ position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)', fontSize: 16, color: loading ? 'var(--hs)' : 'var(--f4)', pointerEvents: 'none' }}>⌕</span>
          <input ref={inputRef} autoFocus value={query} onChange={handleChange} onKeyDown={handleKeyDown}
            onFocus={() => results.length > 0 && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="법인명 검색"
            style={{ background: 'none', border: 'none', outline: 'none', fontSize: 14, width: '100%', color: 'var(--f1)', textAlign: 'center' }} />
        </div>
        {open && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 8, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 100, maxHeight: 380, overflowY: 'auto' }}>
            {results.map((r, i) => (
              <div key={r.id} onMouseDown={() => handleSelect(r)}
                style={{ padding: '10px 16px', cursor: 'pointer', background: i === activeIdx ? 'var(--snk)' : 'transparent', borderBottom: '1px solid var(--snk)' }}>
                <div style={{ fontSize: 13, color: 'var(--f1)', fontWeight: 500 }}>{r.corp_name}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 16, alignItems: 'center' }}>
        {['↑↓ 선택', 'Enter 이동', 'Esc 닫기'].map((t, i) => (
          <React.Fragment key={t}>
            {i > 0 && <span style={{ width: 1, height: 10, background: 'var(--bs)' }} />}
            <span className="mono" style={{ fontSize: 10, color: 'var(--f4)' }}>{t}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ── 탭: 개요 (기본정보 + 산하브랜드 통합) ────────────────────────────
function TabOverview({ info, brands, financials, rankStats, top100Trend, latestRceptNo, childCompanies, onSelectCompany, onSelectBrand }: {
  info: CompanyInfo;
  brands: CompanyBrand[];
  financials: DartFinancial[];
  rankStats: CompanyRankStats | null;
  top100Trend: { date: string; top100_count: number }[];
  latestRceptNo: string | null;
  childCompanies: CompanyChild[];
  onSelectCompany: (id: string) => void;
  onSelectBrand: (id: string) => void;
}) {
  const latest = financials[0] ?? null;
  const metrics = React.useMemo(() => computeMetrics(financials), [financials]);
  const m0 = metrics[0] ?? null;
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

  const hasFinancials = financials.length > 0;
  const hasTrend = top100Trend.length > 1;

  return (
    <div className="col-flex gap-14">
      {/* KPI 카드 행 */}
      {(hasFinancials || rankStats) && (
        <div className="row-flex gap-10" style={{ flexWrap: 'wrap' }}>
          {hasFinancials && m0 && (
            <>
              <KpiCard label={`매출 (${m0.year})`} value={fmtB(m0.revenue)} sub={m0.revGrowth != null ? `YoY ${fmtChg(m0.revGrowth)}` : undefined} />
              <FinKpiCard label="영업이익률" value={fmtPct(m0.opMargin)} grade={grade(m0.opMargin, 10, 0)} />
              <FinKpiCard label="순이익률"   value={fmtPct(m0.netMargin)} grade={grade(m0.netMargin, 5, 0)} />
              <FinKpiCard label="부채비율"   value={fmtPct(m0.debtRatio)} grade={grade(m0.debtRatio, 100, 200, false)} />
              <FinKpiCard label="ROE"        value={fmtPct(m0.roe)}       grade={grade(m0.roe, 10, 0)} />
            </>
          )}
          {rankStats && (
            <>
              <KpiCard label="TOP 100" value={rankStats.top100_count} accent sub={rankStats.snapshot_date} />
              <KpiCard label="평균 랭킹" value={`${rankStats.avg_rank}위`} sub={`${rankStats.sku_count} SKU`} />
            </>
          )}
        </div>
      )}

      {/* 차트 행 — 2-col 반응형 */}
      {(billionData.length > 0 || hasTrend) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
          {billionData.length > 0 && (
            <SecPanel title="매출 · 영업이익 (억원)">
              <ChartWrap h={140}>
                <BarChart data={billionData} margin={CM} barGap={2}>
                  <XAxis dataKey="year" tick={AX} axisLine={false} tickLine={false} />
                  <YAxis tick={AX} axisLine={false} tickLine={false} width={36} />
                  <Tooltip {...TT} formatter={(v: any) => [`${v}억`, undefined]} />
                  <Bar dataKey="rev" name="매출"     fill="var(--hs)"  radius={[2,2,0,0]} maxBarSize={18} />
                  <Bar dataKey="op"  name="영업이익" fill="var(--slf)" radius={[2,2,0,0]} maxBarSize={18} />
                  <ReferenceLine y={0} stroke="var(--bd)" />
                </BarChart>
              </ChartWrap>
            </SecPanel>
          )}
          {hasTrend && (
            <SecPanel title="TOP 100 추이 (30일)">
              <ChartLine h={140}
                series={[{ points: top100Trend.map(d => d.top100_count), color: 'var(--hs)', label: 'TOP100' }]}
                labels={top100Trend.map(d => d.date)} dots={false} />
            </SecPanel>
          )}
          {billionData.length > 0 && (
            <SecPanel title="이익률 추이 (%)">
              <ChartLine h={140}
                series={[
                  { points: [...metrics].reverse().map(m => m.opMargin  ?? 0), color: 'var(--slf)', label: '영업이익률' },
                  { points: [...metrics].reverse().map(m => m.netMargin ?? 0), color: 'var(--f3)',  label: '순이익률', dashed: true },
                ]}
                labels={[...metrics].reverse().map(m => String(m.year))} dots />
            </SecPanel>
          )}
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
      {/* 좌: 정보 패널 묶음 */}
      <div className="col-flex gap-14">
        <SecPanel title="법인 기본정보">
          <InfoRow label="대표자" value={info.ceo_name ?? '—'} />
          <InfoRow label="사업자번호" value={info.business_number ?? '—'} />
          <InfoRow label="통신판매업번호" value={info.mail_order_no ?? '—'} />
          <InfoRow label="주소" value={info.address ?? '—'} />
          <InfoRow label="전화" value={info.phone ?? '—'} />
          <InfoRow label="이메일" value={info.email ?? '—'} />
          {info.website && (
            <div className="row-flex between" style={{ padding: '4px 0', borderBottom: '0.5px solid var(--snk)' }}>
              <span style={{ fontSize: 11, color: 'var(--f4)', flexShrink: 0, width: 110 }}>웹사이트</span>
              <a href={info.website.startsWith('http') ? info.website : `https://${info.website}`}
                target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: 11, color: 'var(--hs)', textDecoration: 'none' }}>
                {info.website} ↗
              </a>
            </div>
          )}
        </SecPanel>

        <SecPanel title="DART · 증권" action={
          latestRceptNo
            ? <a href={`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${latestRceptNo}`}
                target="_blank" rel="noopener noreferrer"
                className="btn sm" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <IcArrowUR /> DART 원문
              </a>
            : undefined
        }>
          <InfoRow label="상장 여부" value={<span style={{ color: info.is_listed ? 'var(--slf)' : 'var(--f3)' }}>{info.is_listed ? '상장' : '비상장'}</span>} />
          <InfoRow label="종목코드" value={info.stock_code ?? '—'} />
          <InfoRow label="DART 고유번호" value={info.corp_code ?? '—'} />
          <InfoRow label="DART 조회일" value={info.dart_fetched_at ? info.dart_fetched_at.slice(0, 10) : '—'} />
        </SecPanel>

        {latest && (
          <SecPanel title={`재무 스냅샷 (${latest.fiscal_year}년)`}>
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
          </SecPanel>
        )}

        {rankStats && (
          <SecPanel title={`랭킹 스냅샷 (${rankStats.snapshot_date})`}>
            <InfoRow label="랭킹 진입 SKU" value={rankStats.sku_count.toLocaleString()} />
            <InfoRow label="TOP 100" value={<span style={{ color: 'var(--hs)', fontWeight: 600 }}>{rankStats.top100_count}</span>} />
            <InfoRow label="평균 랭킹" value={`${rankStats.avg_rank}위`} />
            <InfoRow label="최고 순위" value={
              <span>
                <span style={{ color: 'var(--hs)', fontWeight: 600 }}>#{rankStats.best_rank}</span>
                <span style={{ color: 'var(--f4)', marginLeft: 6, fontSize: 10 }}>{rankStats.best_product_name.slice(0, 18)}{rankStats.best_product_name.length > 18 ? '…' : ''}</span>
              </span>
            } />
          </SecPanel>
        )}
      </div>

      {/* 우: 산하 브랜드 전체 (직접 + 자회사) + 자회사 링크 */}
      <div className="col-flex gap-14">
        {(() => {
          const totalCount = brands.length + childCompanies.reduce((s, c) => s + c.brands.length, 0);
          const hasAny = totalCount > 0;
          const COL = '1fr 52px 72px';
          const BrandRow = ({ b, idx }: { b: { id: string; name: string; slug: string; is_own: boolean; nation_name: string | null }; idx: number }) => (
            <div className={`row hover ${idx % 2 ? 'alt' : ''}`} style={{ gridTemplateColumns: COL, cursor: 'pointer' }}
              onClick={() => onSelectBrand(b.id)}>
              <span style={{ fontWeight: b.is_own ? 500 : 400, color: b.is_own ? 'var(--hs)' : 'var(--f1)' }}>{b.name}</span>
              <span>
                {b.is_own
                  ? <span className="chip" style={{ fontSize: 9, background: 'var(--hs-soft)', color: 'var(--hs)', borderColor: 'var(--hs)' }}>자사</span>
                  : <span className="mono dim" style={{ fontSize: 10 }}>경쟁사</span>}
              </span>
              <span className="mono dim" style={{ fontSize: 10 }}>{b.nation_name ?? '—'}</span>
            </div>
          );
          return (
            <SecPanel title={`산하 브랜드 (${totalCount}개)`}>
              {!hasAny
                ? <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>등록된 브랜드가 없습니다.</div>
                : (
                  <div className="tbl" style={{ border: 'none', borderRadius: 0 }}>
                    <div className="row head" style={{ gridTemplateColumns: COL }}>
                      <span>브랜드</span><span>구분</span><span>국가</span>
                    </div>
                    {brands.map((b, i) => <BrandRow key={b.id} b={b} idx={i} />)}
                    {childCompanies.filter(c => c.brands.length > 0).map(child => (
                      <React.Fragment key={child.id}>
                        <div style={{ padding: '4px 8px', background: 'var(--snk)', borderTop: '1px solid var(--bd)', borderBottom: '1px solid var(--bd)', fontSize: 10, color: 'var(--f4)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color: 'var(--f3)', fontWeight: 500 }}>{child.corp_name}</span>
                          <span style={{ padding: '1px 4px', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 3 }}>자회사</span>
                        </div>
                        {child.brands.map((b, i) => <BrandRow key={b.id} b={b} idx={brands.length + i} />)}
                      </React.Fragment>
                    ))}
                  </div>
                )
              }
            </SecPanel>
          );
        })()}

        {childCompanies.length > 0 && (
          <SecPanel title={`자회사 (${childCompanies.length}개)`}>
            <div className="tbl" style={{ border: 'none', borderRadius: 0 }}>
              {childCompanies.map((child, i) => (
                <div key={child.id} className={`row hover ${i % 2 ? 'alt' : ''}`} style={{ gridTemplateColumns: '1fr auto', cursor: 'pointer' }}
                  onClick={() => onSelectCompany(child.id)}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--f1)' }}>{child.corp_name}</span>
                  <span style={{ fontSize: 11, color: 'var(--f4)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    브랜드 {child.brands.length}개 <IcArrowUR size={10} />
                  </span>
                </div>
              ))}
            </div>
          </SecPanel>
        )}
      </div>
      </div>
    </div>
  );
}

// ── 탭: 랭킹·상품 ─────────────────────────────────────────────────────
function GenderAgeHeatmap({ data }: { data: { gender: string; age: string; sku_count: number }[] }) {
  const maxVal = Math.max(...data.map(d => d.sku_count), 1);
  const get = (g: string, a: string) => data.find(d => d.gender === g && d.age === a)?.sku_count ?? 0;
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `52px repeat(${AGE_KEYS.length}, 1fr)`, gap: 2, minWidth: 360 }}>
        <div />
        {AGE_KEYS.map(([k, l]) => <div key={k} style={{ fontSize: 8, color: 'var(--f4)', textAlign: 'center', padding: '2px 0' }}>{l}</div>)}
        {GENDERS.map(([gk, gl]) => (
          <React.Fragment key={gk}>
            <div style={{ fontSize: 9, color: 'var(--f3)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 4 }}>{gl}</div>
            {AGE_KEYS.map(([ak]) => {
              const v = get(gk, ak); const intensity = v / maxVal;
              return (
                <div key={ak} style={{ height: 26, background: `color-mix(in oklab, var(--hs) ${Math.max(4, intensity * 80)}%, var(--snk))`, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: intensity > 0.55 ? 'white' : 'var(--f3)', fontFamily: 'var(--mono)' }}>
                  {v > 0 ? v : ''}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function TabRanking({ rankStats, top100Trend, brandTrend, productDist, rankLoading, brands }: {
  rankStats: CompanyRankStats | null;
  top100Trend: { date: string; top100_count: number }[];
  brandTrend: BrandTrendRow[];
  productDist: CompanyProductDist | null;
  rankLoading: boolean;
  brands: CompanyBrand[];
}) {
  if (rankLoading) return <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>랭킹 데이터 로딩 중…</div>;
  if (!rankStats || rankStats.sku_count === 0) return <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>무신사 랭킹 진입 데이터가 없습니다.</div>;

  const catData = rankStats.by_category.slice(0, 8).map(c => ({ name: CATEGORY_MAP[c.category_code] ?? c.category_code, value: c.sku_count }));
  const hasMultiBrand = rankStats.by_brand.length > 1;
  const trendChartData = brandTrend.map(row => {
    const obj: Record<string, any> = { date: row.date };
    for (const c of row.counts) obj[c.brand] = c.top100;
    return obj;
  });

  return (
    <div className="col-flex gap-14">
      {/* Row 1: TOP100 추이 + 카테고리 */}
      <div className="grid" style={{ gridTemplateColumns: '3fr 2fr', gap: 14 }}>
        <SecPanel title="TOP 100 추이 (30일)">
          {top100Trend.length > 1
            ? <ChartLine h={160} series={[{ points: top100Trend.map(d => d.top100_count), color: 'var(--hs)', label: 'TOP100' }]} labels={top100Trend.map(d => d.date)} dots={false} />
            : <div style={{ padding: '40px 0', textAlign: 'center', fontSize: 11, color: 'var(--f4)' }}>데이터 누적 중</div>}
        </SecPanel>
        <SecPanel title="카테고리 분포">
          {catData.length > 0
            ? <HorizBars data={catData} labelWidth={72} rowH={22} />
            : <div style={{ padding: '40px 0', textAlign: 'center', fontSize: 11, color: 'var(--f4)' }}>—</div>}
        </SecPanel>
      </div>

      {/* Row 2: 성별×연령 히트맵 + 가격대 */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <SecPanel title="C1 · 성별 × 연령대 히트맵">
          {productDist?.genderAge.length
            ? <GenderAgeHeatmap data={productDist.genderAge} />
            : <div style={{ padding: '30px 0', textAlign: 'center', fontSize: 11, color: 'var(--f4)' }}>데이터 없음</div>}
        </SecPanel>
        <SecPanel title="C2 · 가격대 분포">
          {productDist?.priceBuckets.length
            ? <HorizBars data={productDist.priceBuckets.filter(b => b.count > 0).map(b => ({ name: b.label, value: b.count }))} labelWidth={56} rowH={22} />
            : <div style={{ padding: '30px 0', textAlign: 'center', fontSize: 11, color: 'var(--f4)' }}>—</div>}
        </SecPanel>
      </div>

      {/* Row 3: 할인율 + 리뷰점수 */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <SecPanel title="C3 · 할인율 분포">
          {productDist?.discountBuckets.length ? (
            <ChartWrap h={140}>
              <BarChart data={productDist.discountBuckets} margin={CM}>
                <CartesianGrid strokeDasharray="3 4" stroke="var(--bs)" vertical={false} />
                <XAxis dataKey="label" tick={AX} axisLine={false} tickLine={false} />
                <YAxis tick={AX} axisLine={false} tickLine={false} />
                <Tooltip {...TT} />
                <Bar dataKey="count" name="상품수" fill="var(--hs)" opacity={0.85} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ChartWrap>
          ) : <div style={{ padding: '30px 0', textAlign: 'center', fontSize: 11, color: 'var(--f4)' }}>—</div>}
        </SecPanel>
        <SecPanel title="C5 · 리뷰 만족도 분포">
          {productDist?.reviewBuckets.length ? (
            <ChartWrap h={140}>
              <BarChart data={productDist.reviewBuckets.filter(b => b.count > 0)} margin={CM}>
                <CartesianGrid strokeDasharray="3 4" stroke="var(--bs)" vertical={false} />
                <XAxis dataKey="label" tick={AX} axisLine={false} tickLine={false} />
                <YAxis tick={AX} axisLine={false} tickLine={false} />
                <Tooltip {...TT} />
                <Bar dataKey="count" name="상품수" fill="#22C55E" opacity={0.85} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ChartWrap>
          ) : <div style={{ padding: '30px 0', textAlign: 'center', fontSize: 11, color: 'var(--f4)' }}>—</div>}
        </SecPanel>
      </div>

      {/* C4: 브랜드별 TOP100 멀티라인 (복수 브랜드) */}
      {hasMultiBrand && trendChartData.length > 1 && (
        <SecPanel title="C4 · 브랜드별 TOP 100 추이 (30일)">
          <ChartWrap h={180}>
            <LineChart data={trendChartData} margin={CM}>
              <CartesianGrid strokeDasharray="3 4" stroke="var(--bs)" vertical={false} />
              <XAxis dataKey="date" tick={AX} axisLine={false} tickLine={false} />
              <YAxis tick={AX} axisLine={false} tickLine={false} />
              <Tooltip {...TT} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {rankStats.by_brand.map((b, i) => (
                <Line key={b.brand_name} type="monotone" dataKey={b.brand_name}
                  stroke={BRAND_COLORS[i % BRAND_COLORS.length]} strokeWidth={1.5} dot={false} connectNulls />
              ))}
            </LineChart>
          </ChartWrap>
        </SecPanel>
      )}

      {/* 브랜드별 테이블 */}
      {hasMultiBrand && (
        <SecPanel title="브랜드별 랭킹 현황">
          <div className="tbl" style={{ border: 'none', borderRadius: 0 }}>
            <div className="row head" style={{ gridTemplateColumns: '1fr 52px 52px 52px' }}>
              <span>브랜드</span><span className="cell-r">SKU</span><span className="cell-r">TOP100</span><span className="cell-r">비율</span>
            </div>
            {rankStats.by_brand.map((b, i) => (
              <div key={b.brand_name} className={`row ${i % 2 ? 'alt' : ''}`} style={{ gridTemplateColumns: '1fr 52px 52px 52px' }}>
                <span style={{ fontSize: 12 }}>{b.brand_name}</span>
                <span className="cell-r mono dim" style={{ fontSize: 11 }}>{b.sku_count}</span>
                <span className="cell-r mono" style={{ fontSize: 11, color: b.top100_count > 0 ? 'var(--hs)' : 'var(--f4)' }}>{b.top100_count}</span>
                <span className="cell-r mono dim" style={{ fontSize: 10 }}>{b.sku_count > 0 ? Math.round((b.top100_count / b.sku_count) * 100) : 0}%</span>
              </div>
            ))}
          </div>
        </SecPanel>
      )}
    </div>
  );
}

// ── 탭: 재무 ──────────────────────────────────────────────────────────
function TabFinancial({ financials, top100Trend, rankStats }: {
  financials: DartFinancial[];
  top100Trend: { date: string; top100_count: number }[];
  rankStats: CompanyRankStats | null;
}) {
  if (!financials.length) {
    return (
      <SecPanel title="재무 데이터 없음">
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>DART 재무 데이터가 수집되면 자동으로 표시됩니다.</div>
      </SecPanel>
    );
  }

  const metrics = computeMetrics(financials);
  const latest = metrics[0];
  const chartData = [...metrics].reverse(); // 오래된 연도부터 (왼→오른쪽)

  const billionData = chartData.map(m => ({
    name: `${m.year}년`,
    매출: m.revenue != null ? Math.round(m.revenue / 100_000_000) : null,
    영업이익: m.op != null ? Math.round(m.op / 100_000_000) : null,
    순이익: m.net != null ? Math.round(m.net / 100_000_000) : null,
  }));

  const assetData = chartData.map(m => ({
    name: `${m.year}년`,
    자기자본: m.equity != null ? Math.round(m.equity / 100_000_000) : 0,
    부채: m.liab != null ? Math.round(m.liab / 100_000_000) : 0,
  }));

  const rateData = chartData.map(m => ({ name: `${m.year}년`, 영업이익률: m.opMargin, 순이익률: m.netMargin }));
  const roeData  = chartData.map(m => ({ name: `${m.year}년`, ROA: m.roa, ROE: m.roe }));
  const debtData = chartData.map(m => ({ name: `${m.year}년`, 부채비율: m.debtRatio }));
  const growData = chartData.map(m => ({ name: `${m.year}년`, 매출성장률: m.revGrowth }));
  const turnData = chartData.map(m => ({ name: `${m.year}년`, 자산회전율: m.assetTurnover, 자본회전율: m.capTurnover }));

  // E1 스코어카드
  const scoreItems = [
    { label: '영업이익률', val: fmtPct(latest.opMargin),   g: grade(latest.opMargin,   10, 0)      },
    { label: '순이익률',   val: fmtPct(latest.netMargin),  g: grade(latest.netMargin,   5, 0)      },
    { label: '부채비율',   val: fmtPct(latest.debtRatio),  g: grade(latest.debtRatio,  100, 200, false) },
    { label: '자기자본비율', val: fmtPct(latest.equityRatio), g: grade(latest.equityRatio, 50, 30)   },
    { label: 'ROA',        val: fmtPct(latest.roa),        g: grade(latest.roa,         5, 0)      },
    { label: 'ROE',        val: fmtPct(latest.roe),        g: grade(latest.roe,        10, 0)      },
    { label: '매출 YoY',  val: fmtChg(latest.revGrowth),  g: grade(latest.revGrowth,  10, 0)      },
  ];

  const avgTop100 = top100Trend.length > 0 ? Math.round(top100Trend.reduce((s, d) => s + d.top100_count, 0) / top100Trend.length) : null;

  return (
    <div className="col-flex gap-14">
      {/* A1-A8: 재무 KPI 카드 */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        <FinKpiCard label="영업이익률" value={fmtPct(latest.opMargin)}  grade={grade(latest.opMargin, 10, 0)} />
        <FinKpiCard label="순이익률"   value={fmtPct(latest.netMargin)} grade={grade(latest.netMargin, 5, 0)} />
        <FinKpiCard label="부채비율"   value={fmtPct(latest.debtRatio)} grade={grade(latest.debtRatio, 100, 200, false)} />
        <FinKpiCard label="자기자본비율" value={fmtPct(latest.equityRatio)} grade={grade(latest.equityRatio, 50, 30)} />
        <FinKpiCard label="ROA"        value={fmtPct(latest.roa)}       grade={grade(latest.roa, 5, 0)} />
        <FinKpiCard label="ROE"        value={fmtPct(latest.roe)}       grade={grade(latest.roe, 10, 0)} />
        <FinKpiCard label="매출 YoY"  value={fmtChg(latest.revGrowth)} grade={grade(latest.revGrowth, 10, 0)} />
        <FinKpiCard label="최신 연도"  value={`${latest.year}년`}       grade="na" />
      </div>

      {/* E1: 재무 스코어카드 */}
      <SecPanel title="E1 · 재무 건전성 스코어카드">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {scoreItems.map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'var(--snk)', borderRadius: 6, border: `1px solid ${GC[s.g]}30` }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: GC[s.g], flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'var(--f3)' }}>{s.label}</span>
              <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: GC[s.g] }}>{s.val}</span>
            </div>
          ))}
        </div>
      </SecPanel>

      {/* E2: 연도별 핵심지표 테이블 */}
      <SecPanel title="E2 · 연도별 핵심지표 비교">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                {['연도', '매출', '영업이익', '순이익', '영업이익률', '순이익률', '부채비율', 'ROE', '매출성장률'].map(h => (
                  <th key={h} style={{ textAlign: 'right', padding: '5px 8px', color: 'var(--f4)', fontWeight: 500, borderBottom: '1px solid var(--snk)', whiteSpace: 'nowrap', ...(h === '연도' ? { textAlign: 'left' } : {}) }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map(m => (
                <tr key={m.year} style={{ borderBottom: '1px solid var(--snk)' }}>
                  <td className="mono" style={{ padding: '5px 8px', color: 'var(--f2)', fontWeight: 500 }}>{m.year}년</td>
                  <td className="mono" style={{ padding: '5px 8px', textAlign: 'right' }}>{fmtB(m.revenue)}</td>
                  <td className="mono" style={{ padding: '5px 8px', textAlign: 'right', color: m.op != null && m.op < 0 ? 'var(--shf)' : 'var(--f1)' }}>{fmtB(m.op)}</td>
                  <td className="mono" style={{ padding: '5px 8px', textAlign: 'right', color: m.net != null && m.net < 0 ? 'var(--shf)' : 'var(--f1)' }}>{fmtB(m.net)}</td>
                  <td className="mono" style={{ padding: '5px 8px', textAlign: 'right', color: GC[grade(m.opMargin, 10, 0)] }}>{fmtPct(m.opMargin)}</td>
                  <td className="mono" style={{ padding: '5px 8px', textAlign: 'right', color: GC[grade(m.netMargin, 5, 0)] }}>{fmtPct(m.netMargin)}</td>
                  <td className="mono" style={{ padding: '5px 8px', textAlign: 'right', color: GC[grade(m.debtRatio, 100, 200, false)] }}>{fmtPct(m.debtRatio)}</td>
                  <td className="mono" style={{ padding: '5px 8px', textAlign: 'right', color: GC[grade(m.roe, 10, 0)] }}>{fmtPct(m.roe)}</td>
                  <td className="mono" style={{ padding: '5px 8px', textAlign: 'right', color: GC[grade(m.revGrowth, 10, 0)] }}>{fmtChg(m.revGrowth)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SecPanel>

      {/* B1+B2: 매출/이익 + 수익률 */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <SecPanel title="B1 · 매출 · 영업이익 · 순이익 (억 원)">
          <ChartWrap h={180}>
            <BarChart data={billionData} margin={CM}>
              <CartesianGrid strokeDasharray="3 4" stroke="var(--bs)" vertical={false} />
              <XAxis dataKey="name" tick={AX} axisLine={false} tickLine={false} />
              <YAxis tick={AX} axisLine={false} tickLine={false} />
              <Tooltip {...TT} formatter={(v: any) => [`${v}억`, '']} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="매출" fill="var(--f3)" opacity={0.6} radius={[2, 2, 0, 0]} />
              <Bar dataKey="영업이익" fill="var(--hs)" opacity={0.85} radius={[2, 2, 0, 0]} />
              <Bar dataKey="순이익" fill="#22C55E" opacity={0.85} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ChartWrap>
        </SecPanel>
        <SecPanel title="B2 · 수익률 추이 (%)">
          <ChartWrap h={180}>
            <LineChart data={rateData} margin={CM}>
              <CartesianGrid strokeDasharray="3 4" stroke="var(--bs)" vertical={false} />
              <XAxis dataKey="name" tick={AX} axisLine={false} tickLine={false} />
              <YAxis tick={AX} axisLine={false} tickLine={false} />
              <Tooltip {...TT} formatter={(v: any) => [`${v}%`, '']} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <ReferenceLine y={0} stroke="var(--bs)" strokeDasharray="3 3" />
              <Line type="monotone" dataKey="영업이익률" stroke="var(--hs)" strokeWidth={1.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="순이익률"   stroke="#22C55E" strokeWidth={1.5} dot={{ r: 3 }} />
            </LineChart>
          </ChartWrap>
        </SecPanel>
      </div>

      {/* B3+B4: 부채비율 + ROA/ROE */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <SecPanel title="B3 · 부채비율 추이 (%)">
          <ChartWrap h={160}>
            <LineChart data={debtData} margin={CM}>
              <CartesianGrid strokeDasharray="3 4" stroke="var(--bs)" vertical={false} />
              <XAxis dataKey="name" tick={AX} axisLine={false} tickLine={false} />
              <YAxis tick={AX} axisLine={false} tickLine={false} />
              <Tooltip {...TT} formatter={(v: any) => [`${v}%`, '']} />
              <ReferenceLine y={200} stroke="var(--shf)" strokeDasharray="4 3" label={{ value: '위험선 200%', fill: 'var(--shf)', fontSize: 9, position: 'insideTopRight' }} />
              <ReferenceLine y={100} stroke="#F59E0B" strokeDasharray="4 3" label={{ value: '주의 100%', fill: '#F59E0B', fontSize: 9, position: 'insideTopRight' }} />
              <Line type="monotone" dataKey="부채비율" stroke="var(--shf)" strokeWidth={1.5} dot={{ r: 3 }} />
            </LineChart>
          </ChartWrap>
        </SecPanel>
        <SecPanel title="B4 · ROA / ROE 추이 (%)">
          <ChartWrap h={160}>
            <LineChart data={roeData} margin={CM}>
              <CartesianGrid strokeDasharray="3 4" stroke="var(--bs)" vertical={false} />
              <XAxis dataKey="name" tick={AX} axisLine={false} tickLine={false} />
              <YAxis tick={AX} axisLine={false} tickLine={false} />
              <Tooltip {...TT} formatter={(v: any) => [`${v}%`, '']} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <ReferenceLine y={0} stroke="var(--bs)" strokeDasharray="3 3" />
              <Line type="monotone" dataKey="ROA" stroke="var(--hs)" strokeWidth={1.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="ROE" stroke="#3B82F6" strokeWidth={1.5} dot={{ r: 3 }} />
            </LineChart>
          </ChartWrap>
        </SecPanel>
      </div>

      {/* B5+B6: 자산구성 + 매출성장률 */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <SecPanel title="B5 · 자산 구성 (억 원)">
          <ChartWrap h={160}>
            <BarChart data={assetData} margin={CM}>
              <CartesianGrid strokeDasharray="3 4" stroke="var(--bs)" vertical={false} />
              <XAxis dataKey="name" tick={AX} axisLine={false} tickLine={false} />
              <YAxis tick={AX} axisLine={false} tickLine={false} />
              <Tooltip {...TT} formatter={(v: any) => [`${v}억`, '']} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="자기자본" stackId="a" fill="#22C55E" opacity={0.8} />
              <Bar dataKey="부채"   stackId="a" fill="var(--shf)" opacity={0.6} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ChartWrap>
        </SecPanel>
        <SecPanel title="B6 · 매출 성장률 (%)">
          <ChartWrap h={160}>
            <BarChart data={growData} margin={CM}>
              <CartesianGrid strokeDasharray="3 4" stroke="var(--bs)" vertical={false} />
              <XAxis dataKey="name" tick={AX} axisLine={false} tickLine={false} />
              <YAxis tick={AX} axisLine={false} tickLine={false} />
              <Tooltip {...TT} formatter={(v: any) => [`${v}%`, '']} />
              <ReferenceLine y={0} stroke="var(--bs)" />
              <Bar dataKey="매출성장률" radius={[2, 2, 0, 0]}>
                {growData.map((d, i) => (
                  <Cell key={i} fill={(d.매출성장률 ?? 0) >= 0 ? 'var(--hs)' : 'var(--shf)'} opacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ChartWrap>
        </SecPanel>
      </div>

      {/* B7: 회전율 추이 */}
      <SecPanel title="B7 · 자산·자본 회전율 추이 (배)">
        <div style={{ fontSize: 10, color: 'var(--f4)', marginBottom: 6 }}>
          자산회전율 = 매출 ÷ 총자산 &nbsp;·&nbsp; 자본회전율 = 매출 ÷ 자기자본 &nbsp;— 높을수록 자산 활용 효율 우수
        </div>
        <ChartWrap h={170}>
          <LineChart data={turnData} margin={CM}>
            <CartesianGrid strokeDasharray="3 4" stroke="var(--bs)" vertical={false} />
            <XAxis dataKey="name" tick={AX} axisLine={false} tickLine={false} />
            <YAxis tick={AX} axisLine={false} tickLine={false} />
            <Tooltip {...TT} formatter={(v: any) => [`${v}배`, '']} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <ReferenceLine y={1} stroke="var(--f4)" strokeDasharray="3 3" label={{ value: '기준 1배', fill: 'var(--f4)', fontSize: 9, position: 'insideTopRight' }} />
            <Line type="monotone" dataKey="자산회전율" stroke="var(--hs)"  strokeWidth={1.5} dot={{ r: 3 }} connectNulls />
            <Line type="monotone" dataKey="자본회전율" stroke="#3B82F6" strokeWidth={1.5} dot={{ r: 3 }} connectNulls />
          </LineChart>
        </ChartWrap>
      </SecPanel>

      {/* E3: 랭킹-매출 상관 뷰 */}
      <SecPanel title="E3 · 랭킹 퍼포먼스 × 재무 성과">
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--f4)', marginBottom: 6 }}>무신사 TOP100 추이 (최근 30일)</div>
            {top100Trend.length > 1
              ? <ChartLine h={120} series={[{ points: top100Trend.map(d => d.top100_count), color: 'var(--hs)' }]} labels={top100Trend.map(d => d.date)} dots={false} />
              : <div style={{ padding: '30px 0', textAlign: 'center', fontSize: 11, color: 'var(--f4)' }}>데이터 누적 중</div>}
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--f4)', marginBottom: 6 }}>연도별 매출 (억 원)</div>
            <ChartWrap h={120}>
              <BarChart data={billionData} margin={CM}>
                <XAxis dataKey="name" tick={AX} axisLine={false} tickLine={false} />
                <YAxis tick={AX} axisLine={false} tickLine={false} />
                <Tooltip {...TT} formatter={(v: any) => [`${v}억`, '']} />
                <Bar dataKey="매출" fill="var(--hs)" opacity={0.7} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ChartWrap>
          </div>
        </div>
        {avgTop100 != null && (
          <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--snk)', borderRadius: 6, fontSize: 11, color: 'var(--f3)' }}>
            최근 30일 일평균 TOP100 <span className="mono" style={{ color: 'var(--hs)', fontWeight: 600 }}>{avgTop100}개</span> · 최신 매출 <span className="mono" style={{ color: 'var(--f1)', fontWeight: 600 }}>{fmtB(financials[0]?.revenue)}</span>
          </div>
        )}
      </SecPanel>
    </div>
  );
}

// ── 탭: 공시 ──────────────────────────────────────────────────────────
function TabDisclosure({ disclosures }: { disclosures: DartDisclosure[] }) {
  if (!disclosures.length) {
    return (
      <SecPanel title="공시 없음">
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>DART 공시 데이터가 수집되면 자동으로 표시됩니다.</div>
      </SecPanel>
    );
  }

  const typeData = classifyDisc(disclosures);
  const monthData = monthlyDisc(disclosures);
  const corrections = disclosures.filter(d => d.rm === '유');

  return (
    <div className="col-flex gap-14">
      {/* D3: 정정 공시 알림 */}
      {corrections.length > 0 && (
        <div style={{ padding: '10px 14px', background: 'color-mix(in oklab, var(--shf) 8%, transparent)', border: '1px solid color-mix(in oklab, var(--shf) 30%, transparent)', borderRadius: 8, fontSize: 12, color: 'var(--shf)' }}>
          ⚠ 정정 공시 {corrections.length}건 포함 — {corrections.slice(0, 2).map(d => d.report_nm).join(', ')}{corrections.length > 2 ? ` 외 ${corrections.length - 2}건` : ''}
        </div>
      )}

      {/* D1+D2: 유형 분류 + 월별 빈도 */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <SecPanel title="D1 · 공시 유형 분류">
          <HorizBars data={typeData.map(d => ({ name: d.name, value: d.value }))} labelWidth={72} rowH={26} />
        </SecPanel>
        <SecPanel title="D2 · 월별 공시 빈도">
          {monthData.length > 0 ? (
            <ChartWrap h={130}>
              <BarChart data={monthData} margin={CM}>
                <XAxis dataKey="name" tick={AX} axisLine={false} tickLine={false} />
                <YAxis tick={AX} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip {...TT} />
                <Bar dataKey="value" name="건수" fill="var(--hs)" opacity={0.8} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ChartWrap>
          ) : <div style={{ padding: '30px 0', textAlign: 'center', fontSize: 11, color: 'var(--f4)' }}>—</div>}
        </SecPanel>
      </div>

      {/* 공시 목록 */}
      <SecPanel title={`공시 목록 (${disclosures.length}건)`}>
        <div className="tbl" style={{ border: 'none', borderRadius: 0 }}>
          <div className="row head" style={{ gridTemplateColumns: '110px 1fr 90px' }}>
            <span>접수일</span><span>공시명</span><span>제출인</span>
          </div>
          {disclosures.map((d, i) => (
            <div key={d.id} className={`row ${i % 2 ? 'alt' : ''}`} style={{ gridTemplateColumns: '110px 1fr 90px' }}>
              <span className="mono dim" style={{ fontSize: 10 }}>{d.rcept_dt}</span>
              <span style={{ fontSize: 12 }}>
                <a href={`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${d.rcept_no}`}
                  target="_blank" rel="noopener noreferrer" style={{ color: 'var(--f1)', textDecoration: 'none' }}>
                  {d.report_nm}
                  {d.rm === '유' && <span className="mono" style={{ fontSize: 9, color: 'var(--shf)', marginLeft: 4 }}>정정</span>}
                </a>
              </span>
              <span className="mono dim ellip" style={{ fontSize: 10 }}>{d.flr_nm ?? '—'}</span>
            </div>
          ))}
        </div>
      </SecPanel>
    </div>
  );
}

// ── 탭: 투자정보 ──────────────────────────────────────────────────────
function TabFunding({
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
    <div className="col-flex gap-14">
      <SecPanel title="투자정보 수집" action={
        <FundingCollectButton
          companyId={companyId}
          fundingLastCollectedAt={fundingLastCollectedAt}
          onDone={onRefresh}
        />
      }>
        <div style={{ fontSize: 11, color: 'var(--f4)' }}>
          DART 공시 + 뉴스 NLP 추출 (on-demand) · 비상장 사모 라운드는 뉴스에만 의존
        </div>
      </SecPanel>

      <SecPanel title={`투자 라운드 타임라인${rounds.length > 0 ? ` (${rounds.length}건)` : ''}`}>
        <FundingTimeline rounds={rounds} />
      </SecPanel>

      <SecPanel title="AI 투자 브리핑">
        <FundingBrief companyId={companyId} briefMd={briefMd} briefAt={briefAt} />
      </SecPanel>
    </div>
  );
}

function CompanyPageRoot() {
  const isMobile = useIsMobile();
  if (isMobile) return <MobileCompanyDetailView />;
  return (
    <Suspense fallback={<div style={{ padding: '80px 20px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>로딩 중…</div>}>
      <CompanyPageInner />
    </Suspense>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────────────
export default function CompanyPage() {
  return (
    <Suspense fallback={<div style={{ padding: '80px 20px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>로딩 중…</div>}>
      <CompanyPageRoot />
    </Suspense>
  );
}

function CompanyPageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const idFromUrl = params.get('id') ?? '';

  const [info,          setInfo]          = React.useState<CompanyInfo | null>(null);
  const [brands,        setBrands]        = React.useState<CompanyBrand[]>([]);
  const [financials,    setFinancials]    = React.useState<DartFinancial[]>([]);
  const [disclosures,   setDisclosures]   = React.useState<DartDisclosure[]>([]);
  const [rankStats,     setRankStats]     = React.useState<CompanyRankStats | null>(null);
  const [top100Trend,   setTop100Trend]   = React.useState<{ date: string; top100_count: number }[]>([]);
  const [productDist,   setProductDist]   = React.useState<CompanyProductDist | null>(null);
  const [brandTrend,    setBrandTrend]    = React.useState<BrandTrendRow[]>([]);
  const [fundingRounds, setFundingRounds] = React.useState<FundingRound[]>([]);
  const [childCompanies, setChildCompanies] = React.useState<CompanyChild[]>([]);
  const [parentCompany,  setParentCompany]  = React.useState<{ id: string; corp_name: string } | null>(null);
  const [loading,        setLoading]        = React.useState(!!idFromUrl);
  const [rankLoading,    setRankLoading]    = React.useState(false);
  const [tab, setTab] = React.useState<'overview' | 'ranking' | 'financial' | 'disclosure' | 'funding'>('overview');
  const [noteCount, setNoteCount] = React.useState(0);
  const [noteDrawerOpen, setNoteDrawerOpen] = React.useState(
    () => (params.get('notes') === 'open' || !!params.get('note')) && !!idFromUrl,
  );

  React.useEffect(() => {
    if (!idFromUrl) {
      window.dispatchEvent(new CustomEvent('uttu:crumb', { detail: { brand: '', name: '' } }));
      return;
    }
    setLoading(true);
    setRankStats(null); setTop100Trend([]); setProductDist(null); setBrandTrend([]);
    setFundingRounds([]); setChildCompanies([]); setParentCompany(null);
    Promise.all([
      fetchCompanyInfo(idFromUrl),
      fetchCompanyBrands(idFromUrl),
      fetchCompanyFinancials(idFromUrl),
      fetchCompanyDisclosures(idFromUrl),
      getFundingRounds(idFromUrl, 50),
      fetchChildCompanies(idFromUrl),
    ]).then(async ([ci, cb, cf, cd, fr, children]) => {
      setInfo(ci); setBrands(cb); setFinancials(cf); setDisclosures(cd);
      setFundingRounds(fr); setChildCompanies(children);
      if (ci?.parent_company_id) {
        fetchParentCompany(ci.parent_company_id).then(setParentCompany).catch(() => {});
      }
      if (ci) {
        window.dispatchEvent(new CustomEvent('uttu:crumb', { detail: { brand: ci.corp_name, name: '' } }));
        window.dispatchEvent(new CustomEvent('uttu:ai-context', { detail: [
          `회사 · ${ci.corp_name}`,
          ci.corp_code ?? (ci.stock_code ?? '비상장'),
          `${cb.length}개 브랜드`,
        ] }));
      }
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
  }, [idFromUrl]);

  React.useEffect(() => {
    if (idFromUrl) fetchNoteCountForEntity('company', idFromUrl).then(setNoteCount);
  }, [idFromUrl]);

  React.useEffect(() => {
    if (idFromUrl && info?.corp_name) logView('company', idFromUrl, info.corp_name).catch(() => {});
  }, [idFromUrl, info?.corp_name]);

  // 투자정보 수집 완료 후 라운드 목록 갱신
  const handleFundingDone = React.useCallback(() => {
    getFundingRounds(idFromUrl, 50).then(setFundingRounds).catch(() => {});
  }, [idFromUrl]);

  if (!idFromUrl) return <CompanyPortal onSelect={id => router.push(`/company?id=${id}`)} />;

  const corpName = loading ? '…' : (info?.corp_name ?? '—');
  const childBrandCount = childCompanies.reduce((s, c) => s + c.brands.length, 0);
  const totalBrandCount = brands.length + childBrandCount;
  const ownCount =
    brands.filter(b => b.is_own).length +
    childCompanies.reduce((s, c) => s + c.brands.filter(b => b.is_own).length, 0);

  const handleSelectCompany = React.useCallback((id: string) => {
    router.push(`/company?id=${id}`);
  }, [router]);

  return (
    <div className="col-flex gap-14">
      <NoteDrawer
        entity_type="company"
        entity_id={idFromUrl}
        entity_label={corpName}
        open={noteDrawerOpen}
        onClose={() => setNoteDrawerOpen(false)}
        onCountChange={setNoteCount}
      />
      {parentCompany && (
        <div style={{ marginBottom: -6 }}>
          <button
            onClick={() => handleSelectCompany(parentCompany.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 11, color: 'var(--f4)', display: 'inline-flex', alignItems: 'center', gap: 5 }}
          >
            ←
            <span style={{ color: 'var(--f3)' }}>{parentCompany.corp_name}</span>
            <span style={{ fontSize: 10, padding: '1px 5px', background: 'var(--snk)', border: '1px solid var(--bd)', borderRadius: 4 }}>모회사</span>
          </button>
        </div>
      )}
      <div className="page-title">
        <h1>{corpName}</h1>
        {info?.is_listed && info.stock_code && <span className="chip mono">{info.stock_code}</span>}
        {info?.is_listed !== undefined && (
          <span className="chip" style={{ color: info.is_listed ? 'var(--slf)' : 'var(--f3)' }}>{info.is_listed ? '상장' : '비상장'}</span>
        )}
        {totalBrandCount > 0 && <span className="sub">산하 브랜드 {totalBrandCount}개{ownCount > 0 ? ` · 자사 ${ownCount}개` : ''}</span>}
        <div className="row-flex gap-6" style={{ marginLeft: 'auto' }}>
          <BookmarkToggle entity_type="company" entity_id={idFromUrl} label={corpName !== '…' && corpName !== '—' ? corpName : undefined} />
          <button className="btn sm" onClick={() => setNoteDrawerOpen(true)} style={{ position: 'relative' }}>
            <IcEdit /> 메모
            {noteCount > 0 && (
              <span style={{ position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, background: 'var(--hs)', color: '#fff', fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
                {noteCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* 상단 KPI 카드 */}
      {!loading && (rankStats || rankLoading) && (
        <div className="row-flex gap-8" style={{ alignItems: 'stretch' }}>
          <KpiCard label="랭킹 진입 SKU" value={rankLoading ? '…' : rankStats?.sku_count.toLocaleString() ?? '—'} sub={rankStats?.snapshot_date} />
          <KpiCard label="TOP 100" value={rankLoading ? '…' : rankStats?.top100_count.toLocaleString() ?? '—'} accent />
          <KpiCard label="평균 랭킹" value={rankLoading ? '…' : rankStats?.avg_rank ? `${rankStats.avg_rank}위` : '—'} />
          <KpiCard label="최고 순위 상품" value={rankLoading ? '…' : rankStats?.best_rank ? `#${rankStats.best_rank}` : '—'} sub={rankStats?.best_product_name} />
          <KpiCard label="산하 브랜드" value={totalBrandCount} sub={ownCount > 0 ? `자사 ${ownCount}개 포함` : undefined} />
        </div>
      )}

      {/* 탭 */}
      <div className="tabs">
        {([
          ['overview',    '개요',     null],
          ['ranking',     '랭킹·상품', rankStats?.sku_count ? `${rankStats.sku_count} SKU` : null],
          ['financial',   '재무',     financials.length ? `${financials.length}개년` : null],
          ['disclosure',  '공시',     disclosures.length || null],
          ['funding',     '투자정보',  fundingRounds.length || null],
        ] as [string, string, string | number | null][]).map(([key, label, badge]) => (
          <div key={key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key as any)}>
            {label}
            {badge != null && <span className="mono dim" style={{ fontSize: 10, marginLeft: 4 }}>({badge})</span>}
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>로딩 중…</div>
      ) : !info ? (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>회사 정보를 찾을 수 없습니다.</div>
      ) : (
        <>
          {tab === 'overview'    && <TabOverview info={info} brands={brands} financials={financials} rankStats={rankStats} top100Trend={top100Trend} latestRceptNo={disclosures[0]?.rcept_no ?? null} childCompanies={childCompanies} onSelectCompany={handleSelectCompany} onSelectBrand={(id) => router.push(`/brand?id=${id}`)} />}
          {tab === 'ranking'     && <TabRanking rankStats={rankStats} top100Trend={top100Trend} brandTrend={brandTrend} productDist={productDist} rankLoading={rankLoading} brands={brands} />}
          {tab === 'financial'   && <TabFinancial financials={financials} top100Trend={top100Trend} rankStats={rankStats} />}
          {tab === 'disclosure'  && <TabDisclosure disclosures={disclosures} />}
          {tab === 'funding'     && <TabFunding companyId={idFromUrl} fundingLastCollectedAt={info.funding_last_collected_at ?? null} rounds={fundingRounds} briefMd={info.funding_brief_md ?? null} briefAt={info.funding_brief_at ?? null} onRefresh={handleFundingDone} />}
        </>
      )}
    </div>
  );
}
