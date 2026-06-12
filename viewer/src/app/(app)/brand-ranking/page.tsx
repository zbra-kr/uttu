'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { useIsMobile } from '@/hooks/useViewport';
import MobileBrandRankingView from './MobileBrandRankingView';
import { PeriodFilter, FilterBlock, PillGroup, CheckRow, DismissChip, SearchSelect } from '@/components/ui/filters';
import { IcDownload, IcBookmark } from '@/components/ui/icons';
import {
  fetchBrandLeaderboard, fetchCompanyOptions,
  CATEGORY_MAP, AGE_MAP,
  type BrandLeaderRow,
} from '@/lib/queries';
import { kstDaysAgo } from '@/lib/format';

const CATEGORY_DISPLAY = [
  { code: '000', label: '전체' }, { code: '001', label: '상의' }, { code: '002', label: '아우터' },
  { code: '003', label: '바지' }, { code: '004', label: '가방' }, { code: '017', label: '스포츠/레저' },
  { code: '026', label: '속옷/홈웨어' }, { code: '100', label: '원피스/스커트' }, { code: '101', label: '소품' },
  { code: '102', label: '디지털/라이프' }, { code: '103', label: '신발' }, { code: '104', label: '뷰티' }, { code: '106', label: '키즈' },
];
const GENDER_OPTS: [string, string][] = [['A', '전체'], ['M', '남성'], ['F', '여성']];
const AGE_OPTS: [string, string][] = Object.entries(AGE_MAP) as [string, string][];
const SORT_OPTS: [string, string][] = [
  ['top100', '순위'], ['avg_rank', '상품평균'], ['best_rank', '상품최고'], ['sku_count', '랭킹상품수'],
];
const FILTER_KEY = 'uttu-brand-ranking-filters';

const daysAgoStr = (n: number) => kstDaysAgo(n);
function periodToCompareDate(period: string, fromDate: string): string | undefined {
  if (period === 'today') return daysAgoStr(1);
  if (period === '7d')  return daysAgoStr(7);
  if (period === '30d') return daysAgoStr(30);
  if (period === '90d') return daysAgoStr(90);
  if (period === 'custom') return fromDate || undefined;
  return undefined;
}
function fmt만(v: number | null) {
  if (v == null) return '';
  return (v / 10000).toFixed(1) + '만';
}
function downloadCsv(rows: BrandLeaderRow[], hasTrend: boolean) {
  const headers = ['순위', '브랜드', '국가', '회사', '자사', 'TOP100', hasTrend ? 'TOP100변동' : null,
    '평균순위', hasTrend ? '순위변동' : null, '최고순위', '총SKU', '평균할인율', '평균가격', '가격범위', '평균리뷰점수', '리뷰수합계']
    .filter(Boolean).join(',');
  const lines = rows.map((r, i) => [
    i + 1, r.brand_name, r.nation_name ?? '', r.company_name ?? '', r.is_own ? '자사' : '',
    r.top100_count, hasTrend ? (r.top100_change ?? '') : null,
    r.avg_rank, hasTrend ? (r.avg_rank_change ?? '') : null,
    r.best_rank, r.sku_count,
    r.avg_discount != null ? `${r.avg_discount}%` : '',
    r.avg_price != null ? (r.avg_price / 10000).toFixed(1) : '',
    r.min_price != null && r.max_price != null ? `${(r.min_price / 10000).toFixed(1)}~${(r.max_price / 10000).toFixed(1)}만` : '',
    r.avg_review_score ?? '', r.total_review_count,
  ].filter(v => v !== null).join(','));
  const blob = new Blob([headers + '\n' + lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `brand-ranking-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
}

function loadFilters() {
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return { ...p, companies: new Set<string>(p.companies ?? []) };
  } catch { return null; }
}

export default function BrandRankingPage() {
  const isMobile = useIsMobile();
  if (isMobile) return <MobileBrandRankingView />;
  return <BrandRankingDesktopView />;
}

function BrandRankingDesktopView() {
  const router = useRouter();

  const saved = React.useMemo(() => loadFilters(), []);
  const [period, setPeriod]       = React.useState(saved?.period ?? 'today');
  const [fromDate, setFromDate]   = React.useState(saved?.fromDate ?? daysAgoStr(30));
  const [toDate, setToDate]       = React.useState(saved?.toDate ?? daysAgoStr(0));
  const [categoryCode, setCategory] = React.useState(saved?.categoryCode ?? '000');
  const [genderFilter, setGender] = React.useState(saved?.genderFilter ?? 'A');
  const [ageFilter, setAge]       = React.useState(saved?.ageFilter ?? 'AGE_BAND_ALL');
  const [ownOnly, setOwnOnly]     = React.useState(saved?.ownOnly ?? false);
  const [companies, setCompanies] = React.useState<Set<string>>(saved?.companies ?? new Set());
  const [sort, setSort]           = React.useState('top100');
  const [sortDir, setSortDir]     = React.useState<'asc' | 'desc'>('asc');

  const [rows, setRows]           = React.useState<BrandLeaderRow[]>([]);
  const [loading, setLoading]     = React.useState(true);
  const [companyOpts, setCompanyOpts] = React.useState<{ id: string; corp_name: string }[]>([]);

  const compareDate = periodToCompareDate(period, fromDate);
  const targetDate  = period === 'custom' ? toDate : undefined;
  const hasTrend    = !!compareDate;

  React.useEffect(() => {
    fetchCompanyOptions().then(opts => setCompanyOpts(opts));
  }, []);

  // 필터 변경 시 자동 저장 (페이지 이탈 후 복귀해도 유지)
  React.useEffect(() => {
    localStorage.setItem(FILTER_KEY, JSON.stringify({
      period, fromDate, toDate, categoryCode, genderFilter, ageFilter, ownOnly,
      companies: [...companies],
    }));
  }, [period, fromDate, toDate, categoryCode, genderFilter, ageFilter, ownOnly, companies]);

  React.useEffect(() => {
    setLoading(true);
    fetchBrandLeaderboard({ categoryCode, genderFilter, ageFilter, targetDate, compareDate })
      .then(data => { setRows(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [categoryCode, genderFilter, ageFilter, targetDate, compareDate]);

  const addCompany    = (c: string) => setCompanies(s => new Set([...s, c]));
  const removeCompany = (c: string) => setCompanies(s => { const n = new Set(s); n.delete(c); return n; });

  const reset = () => {
    setPeriod('today'); setCategory('000'); setGender('A'); setAge('AGE_BAND_ALL');
    setOwnOnly(false); setCompanies(new Set());
  };
  const saveFilters = () => {
    localStorage.setItem(FILTER_KEY, JSON.stringify({
      period, fromDate, toDate, categoryCode, genderFilter, ageFilter, ownOnly,
      companies: [...companies],
    }));
  };

  // 클라이언트 필터 + 정렬
  const sorted = React.useMemo(() => {
    const filtered = rows.filter(r =>
      (!ownOnly || r.is_own) &&
      (companies.size === 0 || (r.company_name != null && companies.has(r.company_name)))
    );
    return [...filtered].sort((a, b) => {
      const d = sortDir === 'asc' ? 1 : -1;
      switch (sort) {
        case 'avg_rank':  return d * ((a.avg_rank ?? 99999) - (b.avg_rank ?? 99999));
        case 'best_rank': return d * ((a.best_rank ?? 99999) - (b.best_rank ?? 99999));
        case 'sku_count': return d * (b.sku_count - a.sku_count);
        default: {
          // brand_ranking_snapshots 실제 순위 기준 (없으면 맨 뒤)
          const aRank = a.brand_rank ?? 99999;
          const bRank = b.brand_rank ?? 99999;
          return d * (aRank - bRank);
        }
      }
    });
  }, [rows, sort, sortDir, ownOnly, companies]);

  const snapshotDate = rows[0]?.snapshot_date ?? '';
  const catLabel     = CATEGORY_MAP[categoryCode] ?? '전체';
  const genderLabel  = genderFilter !== 'A' ? (genderFilter === 'M' ? '남성' : '여성') : '';
  const ageLabel     = ageFilter !== 'AGE_BAND_ALL' ? (AGE_MAP[ageFilter] ?? ageFilter) : '';

  // 그리드 컬럼 — 변동 열은 항상 표시 (brand_ranking_snapshots 기준)
  const cols = '36px 1fr 44px 80px 64px 44px 52px 64px 86px 52px';

  return (
    <>
      <div className="page-title">
        <h1>브랜드 랭킹</h1>
        {snapshotDate && <span className="chip mono">{snapshotDate} 수집</span>}
        <span className="sub">카테고리·성별·연령별 브랜드 집계 순위</span>
        <div className="row-flex gap-6" style={{ marginLeft: 'auto' }}>
          <button className="btn sm" onClick={() => downloadCsv(sorted, hasTrend)}><IcDownload /> CSV</button>
          <button className="btn sm" onClick={saveFilters}><IcBookmark /> 필터 저장</button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '300px 1fr', gap: 14 }}>
        {/* ===== 필터 레일 ===== */}
        <aside className="filter-rail">
          <div className="frh">
            <h3>필터</h3>
            <button className="btn sm" onClick={reset}>초기화</button>
          </div>
          <div className="frb">
            <PeriodFilter
              value={period} onChange={setPeriod}
              from={fromDate} to={toDate}
              onFromChange={setFromDate} onToChange={setToDate}
            />
            <FilterBlock label="카테고리" hint={catLabel}>
              <div className="check-grid" style={{ maxHeight: 160, overflowY: 'auto' }}>
                {CATEGORY_DISPLAY.map(c => (
                  <CheckRow key={c.code} on={categoryCode === c.code}
                    onToggle={() => setCategory(c.code)} label={c.label} />
                ))}
              </div>
            </FilterBlock>
            <FilterBlock label="성별">
              <PillGroup value={genderFilter} onChange={setGender} options={GENDER_OPTS} />
            </FilterBlock>
            <FilterBlock label="연령대">
              <PillGroup value={ageFilter} onChange={setAge} options={AGE_OPTS} />
            </FilterBlock>
            <FilterBlock label="옵션">
              <CheckRow on={ownOnly} onToggle={() => setOwnOnly((v: boolean) => !v)} label="자사 브랜드만" />
            </FilterBlock>
            <FilterBlock label="회사" hint={companies.size > 0 ? `${companies.size} 적용` : '검색 추가'}>
              <SearchSelect
                options={companyOpts.map(c => c.corp_name)}
                selected={companies}
                onAdd={addCompany}
                onRemove={removeCompany}
                placeholder="회사명 검색…"
              />
            </FilterBlock>
          </div>
        </aside>

        {/* ===== 결과 영역 ===== */}
        <div className="col-flex gap-10">
          {/* applied 필터 + 정렬 */}
          <div className="row-flex center gap-6 wrap">
            <span className="sec-tag">applied</span>
            <DismissChip onDismiss={() => setPeriod('today')}>{period === 'today' ? '오늘' : period === '7d' ? '7일' : period === '30d' ? '30일' : period === '90d' ? '90일' : `${fromDate}~${toDate}`}</DismissChip>
            {categoryCode !== '000' && (
              <DismissChip onDismiss={() => setCategory('000')}>{catLabel}</DismissChip>
            )}
            {genderLabel && <DismissChip onDismiss={() => setGender('A')}>{genderLabel}</DismissChip>}
            {ageLabel && <DismissChip onDismiss={() => setAge('AGE_BAND_ALL')}>{ageLabel}</DismissChip>}
            {ownOnly && (
              <DismissChip onDismiss={() => setOwnOnly(false)} style={{ background: 'var(--hs-soft)', color: 'var(--hs)', borderColor: 'var(--hs)' }}>자사 브랜드만</DismissChip>
            )}
            {[...companies].map(c => (
              <DismissChip key={c} onDismiss={() => removeCompany(c)}>회사 · {c}</DismissChip>
            ))}
            <div className="flex-1" />
            <span className="mono dim" style={{ fontSize: 12 }}>{sorted.length}건 / {rows.length}</span>
            <div className="row-flex gap-4">
              {SORT_OPTS.map(([key, label]) => {
                const active = sort === key;
                return (
                  <button key={key} className={`btn sm${active ? ' active' : ''}`}
                    onClick={() => { if (active) setSortDir((d: 'asc' | 'desc') => d === 'asc' ? 'desc' : 'asc'); else { setSort(key); setSortDir('asc'); } }}>
                    {label}{active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                );
              })}
            </div>
          </div>

          <section className="panel" style={{ padding: 0, overflowX: 'auto' }}>
            <div className="tbl" style={{ border: 'none', borderRadius: 0, minWidth: 860 }}>
              <div className="row head" style={{ gridTemplateColumns: cols, lineHeight: 1.3 }}>
                <span className="cell-r">순위</span>
                <span>브랜드</span>
                <span>국가</span>
                <span>회사</span>
                <span className="cell-r">상품최고<br /><span style={{ color: 'var(--f4)', fontWeight: 400 }}>상품평균</span></span>
                <span className="cell-r">TOP100<br /><span style={{ color: 'var(--f4)', fontWeight: 400 }}>변동</span></span>
                <span className="cell-r">랭킹<br />상품수</span>
                <span className="cell-r">할인율<br /><span style={{ color: 'var(--f4)', fontWeight: 400 }}>평균가</span></span>
                <span className="cell-r">가격범위</span>
                <span className="cell-r">리뷰점수<br /><span style={{ color: 'var(--f4)', fontWeight: 400 }}>리뷰수</span></span>
              </div>

              {loading ? (
                Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="row" style={{ gridTemplateColumns: cols }}>
                    {Array.from({ length: 10 }).map((_, j) => (
                      <span key={j} style={{ height: 14, background: 'var(--rai)', borderRadius: 3, display: 'block' }} />
                    ))}
                  </div>
                ))
              ) : sorted.length === 0 ? (
                <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>
                  {rows.length === 0 ? '수집된 랭킹 데이터가 없습니다.' : '조건에 맞는 브랜드가 없습니다. 필터를 완화해 보세요.'}
                </div>
              ) : sorted.map((r, i) => {
                const brc = r.brand_rank_change;
                const brcColor = brc != null && brc !== 0 ? (brc > 0 ? 'var(--tu)' : 'var(--td)') : 'var(--f4)';
                const brcLabel = brc != null && brc !== 0 ? (brc > 0 ? `↑${brc}` : `↓${Math.abs(brc)}`) : '';
                const t100c = r.top100_change;
                const t100cColor = t100c != null && t100c !== 0 ? (t100c > 0 ? 'var(--tu)' : 'var(--td)') : 'var(--f4)';
                const t100cLabel = t100c != null && t100c !== 0 ? (t100c > 0 ? `+${t100c}` : String(t100c)) : '';
                return (
                  <div key={r.brand_name}
                    className={`row hover ${i % 2 ? 'alt' : ''}`}
                    style={{ gridTemplateColumns: cols, cursor: 'pointer' }}
                    onClick={() => router.push(r.brand_id ? `/brand?id=${r.brand_id}` : '/brand')}
                  >
                    {/* 브랜드 랭킹 순위(위) / 전일 변동(아래) */}
                    <span className="cell-r">
                      <div className="mono" style={{ fontSize: 11, fontWeight: 500, color: r.brand_rank != null ? (i < 3 ? 'var(--hs)' : 'var(--f1)') : 'var(--f4)' }}>
                        {r.brand_rank != null ? `${r.brand_rank}위` : `${i + 1}`}
                      </div>
                      <div className="mono" style={{ fontSize: 10, color: brcColor }}>{brcLabel}</div>
                    </span>
                    <span style={{ fontWeight: 500, color: r.is_own ? 'var(--hs)' : 'var(--f1)' }}>{r.brand_name}</span>
                    <span className="mono dim" style={{ fontSize: 10 }}>{r.nation_name ?? ''}</span>
                    <span className="mono dim ellip" style={{ fontSize: 10 }} title={r.company_name ?? ''}>{r.company_name ?? ''}</span>
                    {/* 최고순위(위) / 평균순위(아래) 병합 */}
                    <span className="cell-r">
                      <div className="mono" style={{ fontSize: 11, color: 'var(--f1)' }}>
                        {r.best_rank != null ? `${r.best_rank}위` : ''}
                      </div>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--f4)' }}>
                        {r.avg_rank != null ? `${r.avg_rank}위` : ''}
                      </div>
                    </span>
                    {/* TOP100 수(위) / 전일 변동(아래) */}
                    <span className="cell-r">
                      <div className="mono" style={{ fontSize: 11, color: 'var(--f1)' }}>{r.top100_count || ''}</div>
                      <div className="mono" style={{ fontSize: 10, color: t100cColor }}>{t100cLabel}</div>
                    </span>
                    <span className="mono cell-r" style={{ color: r.sku_count > 0 ? 'var(--hs)' : 'var(--f4)', fontWeight: r.sku_count > 0 ? 500 : 400 }}>
                      {r.sku_count || ''}
                    </span>
                    {/* 할인율(위) / 평균가(아래) 병합 */}
                    <span className="cell-r">
                      <div className="mono" style={{ fontSize: 11, color: 'var(--f2)' }}>
                        {r.avg_discount ? `${r.avg_discount}%` : ''}
                      </div>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--f4)' }}>{fmt만(r.avg_price)}</div>
                    </span>
                    <span className="mono dim cell-r" style={{ fontSize: 10 }}>
                      {r.min_price != null && r.max_price != null ? `${fmt만(r.min_price)}~${fmt만(r.max_price)}` : ''}
                    </span>
                    {/* 리뷰점수(위) / 리뷰수(아래) 병합 */}
                    <span className="cell-r">
                      <div className="mono" style={{ fontSize: 11, color: 'var(--f2)' }}>
                        {r.avg_review_score != null ? String(r.avg_review_score) : ''}
                      </div>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--f4)' }}>
                        {r.total_review_count > 0 ? r.total_review_count.toLocaleString() : ''}
                      </div>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
