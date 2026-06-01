'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { useIsMobile } from '@/hooks/useViewport';
import MobileCompaniesView from './MobileCompaniesView';
import { FilterBlock, CheckRow, DismissChip, SegGroup } from '@/components/ui/filters';
import { IcDownload } from '@/components/ui/icons';
import { fetchCompanyList, type CompanyListRow } from '@/lib/queries';

// ── 유틸 ─────────────────────────────────────────────────────────────────
function fmtB(v: number | null): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000_000) return `${(v / 1_000_000_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}조`;
  if (abs >= 100_000_000)       return `${Math.round(v / 100_000_000).toLocaleString()}억`;
  if (abs >= 10_000)            return `${Math.round(v / 10_000).toLocaleString()}만`;
  return v.toLocaleString();
}
const fmtPct = (v: number | null) => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
const fmtRaw = (v: number | null) => v == null ? '—' : `${v.toFixed(1)}%`;

type Grade = 'good' | 'warn' | 'bad' | 'na';
const GC: Record<Grade, string> = { good: 'var(--slf)', warn: '#F59E0B', bad: 'var(--shf)', na: 'var(--f4)' };
function grade(v: number | null, g: number, w: number, hi = true): Grade {
  if (v == null) return 'na';
  return hi ? (v >= g ? 'good' : v >= w ? 'warn' : 'bad') : (v <= g ? 'good' : v <= w ? 'warn' : 'bad');
}

// ── 매출 규모 분류 ────────────────────────────────────────────────────────
type RevRange = '대기업' | '중견기업' | '소기업' | '미수집';
function revClass(revenue: number | null): RevRange {
  if (revenue == null) return '미수집';
  if (revenue >= 100_000_000_000) return '대기업';
  if (revenue >= 10_000_000_000)  return '중견기업';
  return '소기업';
}
const ALL_REV: RevRange[] = ['대기업', '중견기업', '소기업', '미수집'];
const REV_DESC: Record<RevRange, string> = {
  '대기업':  '1천억+',
  '중견기업': '100억~1천억',
  '소기업':  '100억 미만',
  '미수집':  'DART 없음',
};

// ── 미니 스파크라인 ───────────────────────────────────────────────────────
function Sparkline({ values }: { values: (number | null)[] }) {
  const valid = values.filter(v => v != null) as number[];
  if (valid.length < 2) return <span style={{ color: 'var(--f4)', fontSize: 10 }}>—</span>;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = max - min || 1;
  const W = 64; const H = 26;
  const pts = valid.map((v, i) => [
    (i / (valid.length - 1)) * (W - 4) + 2,
    H - ((v - min) / range) * (H - 6) - 3,
  ]);
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const isUp = valid[valid.length - 1] >= valid[0];
  return (
    <svg width={W} height={H} style={{ display: 'block', flexShrink: 0 }}>
      <path d={d} fill="none" stroke={isUp ? 'var(--slf)' : 'var(--shf)'} strokeWidth={1.5} strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 2.5 : 1.5}
          fill={i === pts.length - 1 ? (isUp ? 'var(--slf)' : 'var(--shf)') : 'var(--bd)'} />
      ))}
    </svg>
  );
}

// ── 정렬 ─────────────────────────────────────────────────────────────────
type SortKey = 'revenue' | 'net_income' | 'op_margin' | 'roe' | 'debt_ratio' | 'rev_yoy' | 'name' | 'dart';

function sortRows(rows: CompanyListRow[], key: SortKey): CompanyListRow[] {
  return [...rows].sort((a, b) => {
    switch (key) {
      case 'revenue':    return (b.revenue      ?? -Infinity) - (a.revenue      ?? -Infinity);
      case 'net_income': return (b.net_income   ?? -Infinity) - (a.net_income   ?? -Infinity);
      case 'op_margin':  return (b.op_margin    ?? -Infinity) - (a.op_margin    ?? -Infinity);
      case 'roe':        return (b.roe          ?? -Infinity) - (a.roe          ?? -Infinity);
      case 'debt_ratio': {
        if (a.debt_ratio == null && b.debt_ratio == null) return 0;
        if (a.debt_ratio == null) return 1;
        if (b.debt_ratio == null) return -1;
        return a.debt_ratio - b.debt_ratio;
      }
      case 'rev_yoy':    return (b.rev_yoy      ?? -Infinity) - (a.rev_yoy      ?? -Infinity);
      case 'name':       return a.corp_name.localeCompare(b.corp_name, 'ko');
      case 'dart': {
        if (a.latest_disclosure_dt == null && b.latest_disclosure_dt == null) return 0;
        if (a.latest_disclosure_dt == null) return 1;
        if (b.latest_disclosure_dt == null) return -1;
        return b.latest_disclosure_dt.localeCompare(a.latest_disclosure_dt);
      }
    }
  });
}

// ── 메인 ─────────────────────────────────────────────────────────────────
const GRID = '28px 1fr 52px 108px 96px 88px 76px';
const COMPANIES_SS = 'companies-state-v1';
function readCompaniesSS(): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(sessionStorage.getItem(COMPANIES_SS) ?? '{}'); } catch { return {}; }
}

export default function CompaniesPage() {
  const isMobile = useIsMobile();
  if (isMobile) return <MobileCompaniesView />;
  return <CompaniesDesktopView />;
}

function CompaniesDesktopView() {
  const router = useRouter();
  const ss = React.useRef(readCompaniesSS());

  const [rows,    setRows]    = React.useState<CompanyListRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [errMsg,  setErrMsg]  = React.useState<string | null>(null);
  const [hovIdx,  setHovIdx]  = React.useState<number | null>(null);

  // 필터
  const [search,   setSearch]   = React.useState((ss.current.search as string) ?? '');
  const [listed,   setListed]   = React.useState(new Set<string>((ss.current.listed as string[]) ?? ['listed', 'unlisted']));
  const [revRange, setRevRange] = React.useState(new Set<RevRange>((ss.current.revRange as RevRange[]) ?? ALL_REV));
  const [hasFin,   setHasFin]   = React.useState((ss.current.hasFin as boolean) ?? true);
  const [ownOnly,  setOwnOnly]  = React.useState((ss.current.ownOnly as boolean) ?? false);
  const [sortKey,  setSortKey]  = React.useState<SortKey>((ss.current.sortKey as SortKey) ?? 'revenue');

  React.useEffect(() => {
    sessionStorage.setItem(COMPANIES_SS, JSON.stringify({
      search, listed: [...listed], revRange: [...revRange], hasFin, ownOnly, sortKey,
    }));
  }, [search, listed, revRange, hasFin, ownOnly, sortKey]);

  React.useEffect(() => {
    fetchCompanyList().then(data => {
      setRows(data);
      setLoading(false);
    }).catch(e => {
      setErrMsg(e.message ?? '데이터 로드 실패');
      setLoading(false);
    });
  }, []);

  const toggleRevRange = (k: RevRange) => setRevRange(p => {
    const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n;
  });
  const toggleListed = (k: string) => setListed(p => {
    const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n;
  });

  const filtered = React.useMemo(() => {
    let r = rows;
    if (search.trim()) {
      const kw = search.trim().toLowerCase();
      r = r.filter(c => c.corp_name.toLowerCase().includes(kw));
    }
    if (!listed.has('listed'))   r = r.filter(c => !c.is_listed);
    if (!listed.has('unlisted')) r = r.filter(c => c.is_listed);
    if (revRange.size < ALL_REV.length) r = r.filter(c => revRange.has(revClass(c.revenue)));
    if (hasFin)  r = r.filter(c => c.fiscal_year != null);
    if (ownOnly) r = r.filter(c => c.own_brand_count > 0);
    return sortRows(r, sortKey);
  }, [rows, search, listed, revRange, hasFin, ownOnly, sortKey]);

  const reset = () => {
    setSearch('');
    setListed(new Set(['listed', 'unlisted']));
    setRevRange(new Set<RevRange>(ALL_REV));
    setHasFin(true);
    setOwnOnly(false);
    setSortKey('revenue');
  };

  // KPI
  const total     = rows.length;
  const finCount  = rows.filter(r => r.fiscal_year != null).length;
  const listedCnt = rows.filter(r => r.is_listed).length;
  const ownCnt    = rows.filter(r => r.own_brand_count > 0).length;

  const revCounts = React.useMemo(() => {
    const counts: Record<RevRange, number> = { '대기업': 0, '중견기업': 0, '소기업': 0, '미수집': 0 };
    rows.forEach(r => counts[revClass(r.revenue)]++);
    return counts;
  }, [rows]);

  return (
    <>
      <div className="page-title">
        <h1>회사 목록</h1>
        <span className="chip mono">{loading ? '…' : `${total}개사`}</span>
        <span className="sub">재무·랭킹 데이터가 있는 경쟁사·자사 법인 목록</span>
        <div className="row-flex gap-6" style={{ marginLeft: 'auto' }}>
          <button className="btn sm"><IcDownload /> CSV</button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-4 gap-8">
        {([
          ['전체',     loading ? '…' : String(total),     '등록 법인'],
          ['재무 보유', loading ? '…' : String(finCount),  'DART 연동'],
          ['상장사',   loading ? '…' : String(listedCnt), '코스피/코스닥'],
          ['자사 보유', loading ? '…' : String(ownCnt),    '자사 브랜드 포함'],
        ] as [string, string, string][]).map(([l, v, d]) => (
          <div key={l} className="kpi">
            <span className="label">{l}</span>
            <div className="val">{v}</div>
            <div className="dlt"><span className="muted">{d}</span></div>
          </div>
        ))}
      </div>

      {errMsg && (
        <div style={{ padding: '12px 16px', borderRadius: 8, background: 'var(--shb)', color: 'var(--shf)', fontSize: 13 }}>
          {errMsg}
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '280px 1fr', gap: 14 }}>

        {/* ── 필터 레일 ── */}
        <aside className="filter-rail">
          <div className="frh">
            <h3>필터</h3>
            <button className="btn sm" onClick={reset}>초기화</button>
          </div>
          <div className="frb">

            {/* 검색 */}
            <div style={{ padding: '0 0 12px' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--f3)', marginBottom: 6, letterSpacing: '0.03em' }}>회사 검색</div>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="법인명 입력"
                className="input"
                style={{ width: '100%', fontSize: 12, height: 32, boxSizing: 'border-box' }}
              />
            </div>

            {/* 정렬 */}
            <FilterBlock label="정렬">
              <SegGroup
                value={sortKey}
                onChange={v => setSortKey(v as SortKey)}
                options={[
                  ['revenue',    '매출순'],
                  ['net_income', '순이익순'],
                  ['op_margin',  '이익률순'],
                  ['roe',        'ROE순'],
                ]}
              />
              <SegGroup
                value={sortKey}
                onChange={v => setSortKey(v as SortKey)}
                options={[
                  ['debt_ratio', '부채비율순'],
                  ['rev_yoy',    'YoY순'],
                  ['name',       '가나다순'],
                  ['dart',       'DART 최신순'],
                ]}
              />
            </FilterBlock>

            {/* 매출 규모 */}
            <FilterBlock label="매출 규모" hint={`${revRange.size}/${ALL_REV.length}`}>
              {ALL_REV.map(k => (
                <CheckRow
                  key={k}
                  on={revRange.has(k)}
                  onToggle={() => toggleRevRange(k)}
                  label={`${k} (${REV_DESC[k]})`}
                  count={revCounts[k]}
                />
              ))}
            </FilterBlock>

            {/* 상장 여부 */}
            <FilterBlock label="상장 여부" hint={`${listed.size}/2`}>
              <CheckRow on={listed.has('listed')}   onToggle={() => toggleListed('listed')}   label="상장사" count={rows.filter(r => r.is_listed).length} />
              <CheckRow on={listed.has('unlisted')} onToggle={() => toggleListed('unlisted')} label="비상장" count={rows.filter(r => !r.is_listed).length} />
            </FilterBlock>

            {/* 재무 데이터 */}
            <FilterBlock label="재무 데이터">
              <CheckRow on={hasFin}  onToggle={() => setHasFin(p => !p)}  label="DART 수집 완료만" count={finCount} />
            </FilterBlock>

            {/* 자사 브랜드 */}
            <FilterBlock label="자사 브랜드">
              <CheckRow on={ownOnly} onToggle={() => setOwnOnly(p => !p)} label="자사 브랜드 포함만" count={ownCnt} />
            </FilterBlock>

          </div>
        </aside>

        {/* ── 오른쪽: 결과 ── */}
        <div className="col-flex gap-10">

          {/* 적용 필터 칩 */}
          <div className="row-flex center gap-6 wrap">
            <span className="sec-tag">applied</span>
            {search && <DismissChip onDismiss={() => setSearch('')}>{search}</DismissChip>}
            {!listed.has('listed')   && <DismissChip onDismiss={() => setListed(p => { const n = new Set(p); n.add('listed'); return n; })}>상장사 제외</DismissChip>}
            {!listed.has('unlisted') && <DismissChip onDismiss={() => setListed(p => { const n = new Set(p); n.add('unlisted'); return n; })}>비상장 제외</DismissChip>}
            {ALL_REV.filter(k => !revRange.has(k)).map(k => (
              <DismissChip key={k} onDismiss={() => toggleRevRange(k)}>{k} 제외</DismissChip>
            ))}
            {hasFin  && <DismissChip onDismiss={() => setHasFin(false)}>재무 있음만</DismissChip>}
            {ownOnly && <DismissChip onDismiss={() => setOwnOnly(false)}>자사 포함만</DismissChip>}
            <div className="flex-1" />
            <span className="mono dim" style={{ fontSize: 12 }}>{filtered.length}개 / {rows.length}</span>
          </div>

          {/* 테이블 */}
          <section className="panel" style={{ padding: 0 }}>
            <div className="tbl" style={{ border: 'none', borderRadius: 0 }}>

              {/* 헤더 */}
              <div className="row head" style={{ gridTemplateColumns: GRID }}>
                <span>#</span>
                <span>회사명</span>
                <span>상장</span>
                <span className="cell-r" style={{ lineHeight: 1.4 }}>
                  <div>매출</div>
                  <div style={{ fontSize: 9, color: 'var(--f4)', fontWeight: 400 }}>이익률</div>
                </span>
                <span className="cell-r" style={{ lineHeight: 1.4 }}>
                  <div>영업이익</div>
                  <div style={{ fontSize: 9, color: 'var(--f4)', fontWeight: 400 }}>부채비율</div>
                </span>
                <span className="cell-r" style={{ lineHeight: 1.4 }}>
                  <div>순이익</div>
                  <div style={{ fontSize: 9, color: 'var(--f4)', fontWeight: 400 }}>ROE</div>
                </span>
                <span style={{ textAlign: 'center', lineHeight: 1.4 }}>
                  <div>추이</div>
                  <div style={{ fontSize: 9, color: 'var(--f4)', fontWeight: 400 }}>YoY</div>
                </span>
              </div>

              {/* 로딩 */}
              {loading && (
                <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>
                  <span className="mono dim">로딩 중…</span>
                </div>
              )}

              {/* 행 */}
              {!loading && filtered.map((c, i) => {
                const gOp  = grade(c.op_margin,  10, 0);
                const gDbt = grade(c.debt_ratio, 100, 200, false);
                const gYoy = grade(c.rev_yoy,    10, 0);
                const gRoe = grade(c.roe,         10, 0);
                return (
                  <div
                    key={c.id}
                    style={{
                      borderBottom: '0.5px solid var(--bd)',
                      cursor: 'pointer',
                      background: hovIdx === i ? 'var(--snk)' : 'transparent',
                      transition: 'background 80ms',
                    }}
                    onMouseEnter={() => setHovIdx(i)}
                    onMouseLeave={() => setHovIdx(null)}
                    onClick={() => router.push(`/company?id=${c.id}`)}
                  >
                    {/* 1행: 절댓값 */}
                    <div style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', padding: '9px 14px 3px' }}>
                      <span className="mono dim" style={{ fontSize: 10 }}>{i + 1}</span>

                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                        <span style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.corp_name}
                        </span>
                        {c.own_brand_count > 0 && (
                          <span className="chip" style={{ fontSize: 9, flexShrink: 0, background: 'var(--hs-soft)', color: 'var(--hs)', borderColor: 'var(--hs)' }}>자사</span>
                        )}
                      </span>

                      <span>
                        {c.is_listed
                          ? <span className="chip" style={{ fontSize: 9, color: 'var(--slf)', borderColor: 'var(--slf)' }}>상장</span>
                          : <span className="mono dim" style={{ fontSize: 10 }}>비상장</span>}
                      </span>

                      <span className="cell-r">
                        <div className="mono" style={{ fontSize: 13, fontWeight: 700 }}>{fmtB(c.revenue)}</div>
                        {c.fiscal_year && <div style={{ fontSize: 9, color: 'var(--f4)' }}>{c.fiscal_year}년</div>}
                      </span>

                      <span className="cell-r mono" style={{ fontSize: 12 }}>{fmtB(c.operating_income)}</span>

                      <span className="cell-r mono" style={{ fontSize: 12 }}>{fmtB(c.net_income)}</span>

                      <span style={{ display: 'flex', justifyContent: 'center' }}>
                        <Sparkline values={c.rev_history} />
                      </span>
                    </div>

                    {/* 2행: 비율값 + 브랜드 태그 */}
                    <div style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', padding: '1px 14px 9px' }}>
                      <span />
                      <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                        {c.top_brands.map(name => (
                          <span key={name} className="chip" style={{ fontSize: 9, color: 'var(--f3)' }}>{name}</span>
                        ))}
                        {c.latest_disclosure_dt && (
                          <span style={{ fontSize: 9, color: sortKey === 'dart' ? 'var(--smf)' : 'var(--f4)', marginLeft: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}
                            title={c.latest_disclosure_nm ?? undefined}>
                            DART {c.latest_disclosure_dt.slice(0,4)}.{c.latest_disclosure_dt.slice(4,6)}.{c.latest_disclosure_dt.slice(6,8)}
                            {sortKey === 'dart' && c.latest_disclosure_nm && ` · ${c.latest_disclosure_nm}`}
                          </span>
                        )}
                      </span>
                      <span />
                      <span className="cell-r mono" style={{ fontSize: 11, color: GC[gOp] }}>{fmtRaw(c.op_margin)}</span>
                      <span className="cell-r mono" style={{ fontSize: 11, color: GC[gDbt] }}>{fmtRaw(c.debt_ratio)}</span>
                      <span className="cell-r mono" style={{ fontSize: 11, color: GC[gRoe] }}>{fmtRaw(c.roe)}</span>
                      <span className="cell-r mono" style={{ fontSize: 11, color: GC[gYoy] }}>{fmtPct(c.rev_yoy)}</span>
                    </div>
                  </div>
                );
              })}

              {/* 빈 상태 */}
              {!loading && filtered.length === 0 && (
                <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--f4)' }}>
                  <span className="sec-tag">no results</span>
                  <div style={{ marginTop: 8, fontSize: 12 }}>조건에 맞는 회사가 없습니다.</div>
                </div>
              )}

            </div>
          </section>

        </div>
      </div>
    </>
  );
}
