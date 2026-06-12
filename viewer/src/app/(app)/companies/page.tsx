'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { useIsMobile } from '@/hooks/useViewport';
import MobileCompaniesView from './MobileCompaniesView';
import { FilterBlock, CheckRow, DismissChip, SegGroup } from '@/components/ui/filters';
import { IcDownload } from '@/components/ui/icons';
import { fetchCompanyPage, type CompanyListRow, type CompanySortKey, type RevRange } from '@/lib/queries';

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
const GC: Record<Grade, string> = { good: 'var(--slf)', warn: 'var(--warn)', bad: 'var(--shf)', na: 'var(--f4)' };
function grade(v: number | null, g: number, w: number, hi = true): Grade {
  if (v == null) return 'na';
  return hi ? (v >= g ? 'good' : v >= w ? 'warn' : 'bad') : (v <= g ? 'good' : v <= w ? 'warn' : 'bad');
}

const ALL_REV: RevRange[] = ['대기업', '중견기업', '소기업', '미수집'];
const REV_DESC: Record<RevRange, string> = {
  '대기업':  '1천억+',
  '중견기업': '100억~1천억',
  '소기업':  '100억 미만',
  '미수집':  'DART 없음',
};

const LIMIT = 100;
const GRID = '28px 1fr 52px 108px 96px 88px 76px';
const SS_KEY = 'companies-state-v2';

// sessionStorage 읽기 — 클라이언트에서만 호출
function readSS(): Record<string, unknown> {
  try { return JSON.parse(sessionStorage.getItem(SS_KEY) ?? '{}'); } catch { return {}; }
}

// ── 메인 ─────────────────────────────────────────────────────────────────
export default function CompaniesPage() {
  const isMobile = useIsMobile();
  // useIsMobile은 초기 false → useEffect 후 실제값. SSR에서는 항상 false이므로
  // 서버/클라이언트 불일치를 막기 위해 mount 후에만 mobile 분기
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => { setMounted(true); }, []);

  if (!mounted) return <CompaniesDesktopView />;
  if (isMobile)  return <MobileCompaniesView />;
  return <CompaniesDesktopView />;
}

// ── 데스크톱 뷰 ───────────────────────────────────────────────────────────
function CompaniesDesktopView() {
  const router = useRouter();

  // ── 상태 (hydration 안전: 기본값만, sessionStorage는 mount 후 복원) ──
  const [rows,       setRows]       = React.useState<CompanyListRow[]>([]);
  const [total,      setTotal]      = React.useState<number | null>(null);
  const [loading,    setLoading]    = React.useState(false);
  const [errMsg,     setErrMsg]     = React.useState<string | null>(null);
  const [hovIdx,     setHovIdx]     = React.useState<number | null>(null);
  const [page,       setPage]       = React.useState(0);

  // 필터 — 기본값
  const [search,    setSearch]    = React.useState('');
  const [sortKey,   setSortKey]   = React.useState<CompanySortKey>('revenue');
  const [listed,    setListed]    = React.useState(new Set<string>(['listed', 'unlisted']));
  const [revRange,  setRevRange]  = React.useState(new Set<RevRange>(ALL_REV));
  const [hasFin,    setHasFin]    = React.useState(false);
  const [ownOnly,   setOwnOnly]   = React.useState(false);

  // mount 후 sessionStorage 복원 (hydration 이후이므로 안전)
  const [ssRestored, setSsRestored] = React.useState(false);
  React.useEffect(() => {
    const ss = readSS();
    if (ss.search)    setSearch(ss.search as string);
    if (ss.sortKey)   setSortKey(ss.sortKey as CompanySortKey);
    if (ss.listed)    setListed(new Set(ss.listed as string[]));
    if (ss.revRange)  setRevRange(new Set(ss.revRange as RevRange[]));
    if (typeof ss.hasFin  === 'boolean') setHasFin(ss.hasFin);
    if (typeof ss.ownOnly === 'boolean') setOwnOnly(ss.ownOnly);
    setSsRestored(true);
  }, []);

  // sessionStorage 저장
  React.useEffect(() => {
    if (!ssRestored) return;
    sessionStorage.setItem(SS_KEY, JSON.stringify({
      search, sortKey, listed: [...listed], revRange: [...revRange], hasFin, ownOnly,
    }));
  }, [search, sortKey, listed, revRange, hasFin, ownOnly, ssRestored]);

  // 검색어 변경 시 page 리셋
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearch = (v: string) => {
    setSearch(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { setDebouncedSearch(v); setPage(0); }, 350);
  };

  // 필터 변경 → page 리셋
  const applyFilter = (fn: () => void) => { fn(); setPage(0); };

  // ── 패치 ─────────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!ssRestored) return;
    setLoading(true);
    setErrMsg(null);
    const revRanges = revRange.size === ALL_REV.length ? null : [...revRange] as RevRange[];
    const listedOnly = listed.size === 1 && listed.has('listed');
    fetchCompanyPage({
      page, limit: LIMIT,
      search: debouncedSearch,
      sort: sortKey,
      listedOnly,
      ownOnly,
      hasFin,
      revRanges,
    }).then(res => {
      setRows(res.rows);
      setTotal(res.total);
      setLoading(false);
    }).catch(e => {
      setErrMsg(e.message ?? '데이터 로드 실패');
      setLoading(false);
    });
  }, [ssRestored, page, debouncedSearch, sortKey, listed, revRange, hasFin, ownOnly]);

  const totalPages = total != null ? Math.ceil(total / LIMIT) : null;

  const reset = () => {
    setSearch(''); setDebouncedSearch('');
    setSortKey('revenue');
    setListed(new Set(['listed', 'unlisted']));
    setRevRange(new Set<RevRange>(ALL_REV));
    setHasFin(false); setOwnOnly(false);
    setPage(0);
  };

  const toggleRevRange = (k: RevRange) => applyFilter(() => setRevRange(p => {
    const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n;
  }));
  const toggleListed = (k: string) => applyFilter(() => setListed(p => {
    const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n;
  }));

  return (
    <>
      <div className="page-title">
        <h1>회사 목록</h1>
        {total != null && <span className="chip mono">{total.toLocaleString()}개사</span>}
        <span className="sub">재무·랭킹 데이터가 있는 경쟁사·자사 법인 목록</span>
        <div className="row-flex gap-6" style={{ marginLeft: 'auto' }}>
          <button className="btn sm"><IcDownload /> CSV</button>
        </div>
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
                onChange={e => handleSearch(e.target.value)}
                placeholder="법인명·브랜드명 입력"
                className="input"
                style={{ width: '100%', fontSize: 12, height: 32, boxSizing: 'border-box' }}
              />
            </div>

            {/* 정렬 */}
            <FilterBlock label="정렬">
              <SegGroup
                value={sortKey}
                onChange={v => applyFilter(() => setSortKey(v as CompanySortKey))}
                options={[
                  ['revenue',    '매출순'],
                  ['net_income', '순이익순'],
                  ['op_margin',  '이익률순'],
                  ['roe',        'ROE순'],
                ]}
              />
              <SegGroup
                value={sortKey}
                onChange={v => applyFilter(() => setSortKey(v as CompanySortKey))}
                options={[
                  ['debt_ratio', '부채비율순'],
                  ['rev_yoy',    'YoY순'],
                  ['name',       '가나다순'],
                  ['dart',       'DART 최신순'],
                ]}
              />
            </FilterBlock>

            {/* 매출 규모 */}
            <FilterBlock label="매출 규모">
              {ALL_REV.map(k => (
                <CheckRow
                  key={k}
                  on={revRange.has(k)}
                  onToggle={() => toggleRevRange(k)}
                  label={`${k} (${REV_DESC[k]})`}
                />
              ))}
            </FilterBlock>

            {/* 상장 여부 */}
            <FilterBlock label="상장 여부">
              <CheckRow on={listed.has('listed')}   onToggle={() => toggleListed('listed')}   label="상장사" />
              <CheckRow on={listed.has('unlisted')} onToggle={() => toggleListed('unlisted')} label="비상장" />
            </FilterBlock>

            {/* 재무 데이터 */}
            <FilterBlock label="재무 데이터">
              <CheckRow on={hasFin}  onToggle={() => applyFilter(() => setHasFin(p => !p))}  label="DART 수집 완료만" />
            </FilterBlock>

            {/* 자사 브랜드 */}
            <FilterBlock label="자사 브랜드">
              <CheckRow on={ownOnly} onToggle={() => applyFilter(() => setOwnOnly(p => !p))} label="자사 브랜드 포함만" />
            </FilterBlock>

          </div>
        </aside>

        {/* ── 오른쪽: 결과 ── */}
        <div className="col-flex gap-10">

          {/* 적용 필터 칩 */}
          <div className="row-flex center gap-6 wrap">
            <span className="sec-tag">applied</span>
            {search && <DismissChip onDismiss={() => handleSearch('')}>{search}</DismissChip>}
            {!listed.has('listed')   && <DismissChip onDismiss={() => toggleListed('listed')}>상장사 제외</DismissChip>}
            {!listed.has('unlisted') && <DismissChip onDismiss={() => toggleListed('unlisted')}>비상장 제외</DismissChip>}
            {ALL_REV.filter(k => !revRange.has(k)).map(k => (
              <DismissChip key={k} onDismiss={() => toggleRevRange(k)}>{k} 제외</DismissChip>
            ))}
            {hasFin  && <DismissChip onDismiss={() => applyFilter(() => setHasFin(false))}>재무 있음만</DismissChip>}
            {ownOnly && <DismissChip onDismiss={() => applyFilter(() => setOwnOnly(false))}>자사 포함만</DismissChip>}
            <div className="flex-1" />
            {total != null && (
              <span className="mono dim" style={{ fontSize: 12 }}>
                {total.toLocaleString()}개
                {totalPages != null && totalPages > 1 && ` (${page + 1}/${totalPages} 페이지)`}
              </span>
            )}
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
                <span className="cell-r" style={{ lineHeight: 1.4 }}>
                  <div>YoY</div>
                  <div style={{ fontSize: 9, color: 'var(--f4)', fontWeight: 400 }}>매출성장률</div>
                </span>
              </div>

              {/* 로딩 */}
              {loading && (
                <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>
                  <span className="mono dim">로딩 중…</span>
                </div>
              )}

              {/* 행 */}
              {!loading && rows.map((c, i) => {
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
                      <span className="mono dim" style={{ fontSize: 10 }}>{page * LIMIT + i + 1}</span>

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

                      <span className="cell-r mono" style={{ fontSize: 12, color: GC[gYoy] }}>{fmtPct(c.rev_yoy)}</span>
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
                      <span />
                    </div>
                  </div>
                );
              })}

              {/* 빈 상태 */}
              {!loading && rows.length === 0 && (
                <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--f4)' }}>
                  <span className="sec-tag">no results</span>
                  <div style={{ marginTop: 8, fontSize: 12 }}>조건에 맞는 회사가 없습니다.</div>
                </div>
              )}

            </div>
          </section>

          {/* 페이지네이션 */}
          {totalPages != null && totalPages > 1 && !loading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="btn sm"
                style={{ opacity: page === 0 ? 0.4 : 1 }}
              >
                ← 이전
              </button>
              <span className="mono dim" style={{ fontSize: 12 }}>
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="btn sm"
                style={{ opacity: page >= totalPages - 1 ? 0.4 : 1 }}
              >
                다음 →
              </button>
            </div>
          )}

        </div>
      </div>
    </>
  );
}
