'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { PeriodFilter, FilterBlock, PillGroup, CheckRow, DismissChip, SearchSelect } from '@/components/ui/filters';
import { IcDownload, IcChevL, IcChevR, IcBookmark } from '@/components/ui/icons';
import {
  fetchLatestRanking, fetchBrandOptions, fetchCompanyOptions,
  CATEGORY_MAP, AGE_MAP, type RankingRow,
} from '@/lib/queries';

const CATEGORY_DISPLAY = [
  { code: '000', label: '전체' },
  { code: '001', label: '상의' },
  { code: '002', label: '아우터' },
  { code: '003', label: '바지' },
  { code: '004', label: '가방' },
  { code: '017', label: '스포츠/레저' },
  { code: '026', label: '속옷/홈웨어' },
  { code: '100', label: '원피스/스커트' },
  { code: '101', label: '소품' },
  { code: '102', label: '디지털/라이프' },
  { code: '103', label: '신발' },
  { code: '104', label: '뷰티' },
  { code: '106', label: '키즈' },
];

const AGE_OPTS: [string, string][] = [
  ['AGE_BAND_ALL',   '전체'],
  ['AGE_BAND_MINOR', '20세 미만'],
  ['AGE_BAND_20',    '20~25세'],
  ['AGE_BAND_25',    '25~30세'],
  ['AGE_BAND_30',    '30~35세'],
  ['AGE_BAND_35',    '35~40세'],
  ['AGE_BAND_40',    '40세 이상'],
];

const GENDER_OPTS: [string, string][] = [['A', '전체'], ['M', '남성'], ['F', '여성']];

const PAGE_SIZE = 50;
const PRICE_MAX = 50; // 만원 단위 — 50 = 50만+

const FILTER_KEY = 'uttu-ranking-filters';

function downloadCsv(rows: RankingRow[], multiDay: boolean) {
  const headers = [
    multiDay ? '날짜' : null, '순위', '변동', '상품명', '무신사번호',
    '브랜드', '회사', '자사', '카테고리', '성별', '연령',
    '판매가격', '소비자가', '할인율', '리뷰점수', '리뷰수',
  ].filter(Boolean).join(',');
  const lines = rows.map(r => [
    multiDay ? r.snapshot_date : null,
    r.rank_position,
    r.rank_change ?? '',
    `"${r.product_name.replace(/"/g, '""')}"`,
    r.musinsa_no,
    `"${r.brand_name}"`,
    r.company_name ? `"${r.company_name}"` : '',
    r.is_own ? '자사' : '',
    r.category_code,
    r.gender_filter,
    r.age_filter,
    r.final_price ?? '',
    r.list_price ?? '',
    r.discount_rate != null ? `${Math.round(r.discount_rate)}%` : '',
    r.review_score || '',
    r.review_count || '',
  ].filter(v => v !== null).join(','));
  const blob = new Blob([headers + '\n' + lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `ranking-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
}

function loadSavedFilters() {
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return {
      ...p,
      companies: new Set<string>(p.companies ?? []),
      brands:    new Set<string>(p.brands ?? []),
      price:     Array.isArray(p.price) ? p.price as [number, number] : [0, PRICE_MAX],
    };
  } catch { return null; }
}

// 가격 직접 입력 — 블러/엔터 커밋, 소숫점 허용 (3.5 = 3만5천원)
function PriceInput({
  value, placeholder, min, max,
  onCommit,
}: {
  value: number | null; placeholder: string; min: number; max: number;
  onCommit: (v: number | null) => void;
}) {
  const [text, setText] = React.useState(value != null ? String(value) : '');
  React.useEffect(() => { setText(value != null ? String(value) : ''); }, [value]);

  const commit = () => {
    const raw = text.trim();
    if (raw === '') { onCommit(null); return; }
    const n = parseFloat(raw);
    if (!isNaN(n) && n >= min && n <= max) { onCommit(Math.round(n * 10) / 10); }
    else { setText(value != null ? String(value) : ''); }
  };

  return (
    <input
      type="number" min={min} max={max} step="0.5"
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setText(value != null ? String(value) : ''); }}
      placeholder={placeholder}
      style={{
        width: 54, padding: '3px 6px', background: 'var(--snk)',
        border: '0.5px solid var(--bs)', borderRadius: 4,
        fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--f1)',
        outline: 'none', textAlign: 'right', boxSizing: 'border-box', flexShrink: 0,
      }}
    />
  );
}

// 커스텀 레인지 슬라이더 — thumb만 드래그 가능, track은 비활성
function RangeSlider({ min, max, value, onChange }: {
  min: number; max: number; value: [number, number];
  onChange: (v: [number, number]) => void;
}) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = React.useState<null | 0 | 1>(null);
  const valueRef = React.useRef(value);
  valueRef.current = value;
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  const getVal = React.useCallback((clientX: number) => {
    if (!trackRef.current) return null;
    const rect = trackRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(pct * (max - min) + min);
  }, [min, max]);

  React.useEffect(() => {
    if (dragging === null) return;
    const onMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const v = getVal(clientX);
      if (v === null) return;
      const cur = valueRef.current;
      if (dragging === 0 && v < cur[1]) onChangeRef.current([v, cur[1]]);
      if (dragging === 1 && v > cur[0]) onChangeRef.current([cur[0], v]);
    };
    const onUp = () => setDragging(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false } as any);
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [dragging, getVal]);

  const p0 = ((value[0] - min) / (max - min)) * 100;
  const p1 = ((value[1] - min) / (max - min)) * 100;

  return (
    <div ref={trackRef} style={{ position: 'relative', height: 28, marginTop: 4, userSelect: 'none' }}>
      {/* track */}
      <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 4, background: 'var(--snk)', borderRadius: 2, transform: 'translateY(-50%)', pointerEvents: 'none' }} />
      {/* active range */}
      <div style={{ position: 'absolute', top: '50%', left: `${p0}%`, width: `${p1 - p0}%`, height: 4, background: 'var(--f1)', borderRadius: 2, transform: 'translateY(-50%)', pointerEvents: 'none' }} />
      {/* thumb 0 (min) */}
      <div
        onMouseDown={e => { e.preventDefault(); setDragging(0); }}
        onTouchStart={e => { e.preventDefault(); setDragging(0); }}
        style={{ position: 'absolute', top: '50%', left: `${p0}%`, width: 20, height: 20, borderRadius: '50%', background: 'var(--rai)', border: '2px solid var(--f1)', transform: 'translate(-50%, -50%)', cursor: dragging === 0 ? 'grabbing' : 'grab', zIndex: value[0] >= max - 1 ? 3 : 1, boxSizing: 'border-box', touchAction: 'none' }}
      />
      {/* thumb 1 (max) */}
      <div
        onMouseDown={e => { e.preventDefault(); setDragging(1); }}
        onTouchStart={e => { e.preventDefault(); setDragging(1); }}
        style={{ position: 'absolute', top: '50%', left: `${p1}%`, width: 20, height: 20, borderRadius: '50%', background: 'var(--rai)', border: '2px solid var(--f1)', transform: 'translate(-50%, -50%)', cursor: dragging === 1 ? 'grabbing' : 'grab', zIndex: 2, boxSizing: 'border-box', touchAction: 'none' }}
      />
    </div>
  );
}

export default function RankingPage() {
  const router = useRouter();

  // localStorage에서 초기값 로드 (컴포넌트 마운트 시 1회)
  const [saved] = React.useState(() => loadSavedFilters());

  // ── 서버 데이터 ──────────────────────────────────────────
  const [allRows,      setAllRows]      = React.useState<RankingRow[]>([]);
  const [loading,      setLoading]      = React.useState(true);
  const [error,        setError]        = React.useState<string | null>(null);
  const [snapshotDate, setSnapshotDate] = React.useState('');

  // ── 필터 옵션 목록 ────────────────────────────────────────
  const [brandOpts,   setBrandOpts]   = React.useState<string[]>([]);
  const [companyOpts, setCompanyOpts] = React.useState<string[]>([]);

  // ── 필터 상태 (localStorage에서 복원) ────────────────────
  const [period,           setPeriod]          = React.useState(saved?.period           ?? 'today');
  const [fromDate,         setFromDate]         = React.useState(saved?.fromDate         ?? '');
  const [toDate,           setToDate]           = React.useState(saved?.toDate           ?? '');
  const [selectedCategory, setSelectedCategory] = React.useState(saved?.selectedCategory ?? '000');
  const [gender,           setGender]           = React.useState(saved?.gender           ?? 'A');
  const [age,              setAge]              = React.useState(saved?.age              ?? 'AGE_BAND_ALL');
  const [price,       setPrice]     = React.useState<[number, number]>(saved?.price     ?? [0, PRICE_MAX]);
  const [companies,   setCompanies] = React.useState<Set<string>>(saved?.companies      ?? new Set());
  const [brands,      setBrands]    = React.useState<Set<string>>(saved?.brands         ?? new Set());
  const [ownOnly,     setOwnOnly]   = React.useState<boolean>(saved?.ownOnly            ?? false);
  const [moverOnly,   setMoverOnly] = React.useState<boolean>(saved?.moverOnly          ?? false);
  const [sort,        setSort]      = React.useState<string>(saved?.sort        ?? 'rank');
  const [sortDir,     setSortDir]   = React.useState<'asc'|'desc'>(saved?.sortDir ?? 'asc');
  const [page,        setPage]      = React.useState<number>(saved?.page ?? 1);

  // ── 필터 상태 → localStorage 자동 저장 ───────────────────
  React.useEffect(() => {
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify({
        period, fromDate, toDate, selectedCategory, gender, age,
        price, companies: [...companies], brands: [...brands],
        ownOnly, moverOnly, sort, sortDir, page,
      }));
    } catch {}
  }, [period, fromDate, toDate, selectedCategory, gender, age, price, companies, brands, ownOnly, moverOnly, sort, sortDir, page]);

  // ── 초기 로드 ─────────────────────────────────────────────
  React.useEffect(() => {
    Promise.all([fetchBrandOptions(), fetchCompanyOptions()])
      .then(([bList, cList]) => {
        setBrandOpts(bList.map(b => b.name));
        setCompanyOpts(cList.map(c => c.corp_name));
      }).catch(console.error);
  }, []);

  // period → fromDate/toDate 변환 (KST 기준)
  const { queryFrom, queryTo } = React.useMemo(() => {
    const todayKST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    if (period === 'today') return { queryFrom: undefined, queryTo: undefined };
    if (period === 'custom') return { queryFrom: fromDate || undefined, queryTo: toDate || todayKST };
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    d.setDate(d.getDate() - (days - 1)); // 오늘 포함 N일
    const fromKST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
    return { queryFrom: fromKST, queryTo: todayKST };
  }, [period, fromDate, toDate]);

  const multiDay = period !== 'today';

  // ── 랭킹 데이터 로드 — category/gender/age/기간 변경 시 재쿼리 ─
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchLatestRanking({ categoryCode: selectedCategory, genderFilter: gender, ageFilter: age, limit: 300, fromDate: queryFrom, toDate: queryTo })
      .then(data => {
        if (cancelled) return;
        setAllRows(data);
        if (data.length > 0) setSnapshotDate(data[0].snapshot_date);
        setPage(1);
      })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedCategory, gender, age, queryFrom, queryTo]);

  // ── 클라이언트 필터 ───────────────────────────────────────
  const filtered = React.useMemo(() => {
    return allRows.filter(r => {
      if (brands.size > 0 && !brands.has(r.brand_name)) return false;
      if (companies.size > 0 && (!r.company_name || !companies.has(r.company_name))) return false;
      const fp = (r.final_price ?? 0) / 10000;
      if (fp < price[0]) return false;
      if (price[1] < PRICE_MAX && fp > price[1]) return false;
      if (ownOnly && !r.is_own) return false;
      return true;
    });
  }, [allRows, brands, companies, price, ownOnly]);

  const sorted = React.useMemo(() => {
    const c = [...filtered];
    const d = sortDir === 'asc' ? 1 : -1;
    if (sort === 'rank')    c.sort((a, b) => d * (a.rank_position - b.rank_position));
    if (sort === 'change')  c.sort((a, b) => d * (Math.abs(a.rank_change ?? 0) - Math.abs(b.rank_change ?? 0)));
    if (sort === 'rating')  c.sort((a, b) => d * (a.review_score - b.review_score));
    if (sort === 'reviews') c.sort((a, b) => d * (a.review_count - b.review_count));
    if (sort === 'name')    c.sort((a, b) => d * a.product_name.localeCompare(b.product_name, 'ko'));
    return c;
  }, [filtered, sort, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageRows   = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const ownCount   = allRows.filter(r => r.is_own).length;

  const periodLabel = period === 'today' ? '오늘' : period === '7d' ? '7일' :
    period === '30d' ? '30일' : period === '90d' ? '90일' :
    (fromDate && toDate ? `${fromDate} ~ ${toDate}` : '직접');

  const genderLabel = gender === 'M' ? '남성' : gender === 'F' ? '여성' : null;
  const ageLabel    = AGE_MAP[age];

  const priceLabel = `${price[0]}만 ~ ${price[1] < PRICE_MAX ? price[1] + '만' : PRICE_MAX + '만+'}`;
  const priceActive = price[0] > 0 || price[1] < PRICE_MAX;

  const addCompany    = (c: string) => setCompanies(p => new Set([...p, c]));
  const removeCompany = (c: string) => setCompanies(p => { const n = new Set(p); n.delete(c); return n; });
  const addBrand      = (b: string) => setBrands(p => new Set([...p, b]));
  const removeBrand   = (b: string) => setBrands(p => { const n = new Set(p); n.delete(b); return n; });

  const reset = () => {
    setPeriod('today'); setFromDate(''); setToDate('');
    setSelectedCategory('000');
    setGender('A'); setAge('AGE_BAND_ALL');
    setPrice([0, PRICE_MAX]);
    setCompanies(new Set()); setBrands(new Set());
    setOwnOnly(false); setMoverOnly(false);
    setSort('rank'); setSortDir('asc'); setPage(1);
  };

  const catLabel = CATEGORY_DISPLAY.find(c => c.code === selectedCategory)?.label ?? '전체';

  return (
    <>
      <div className="page-title">
        <h1>상품 랭킹</h1>
        {snapshotDate && <span className="chip mono">{periodLabel} · {snapshotDate} 수집</span>}
        <span className="sub">전체 상품 랭킹 · 회사·브랜드·필터 적용</span>
        <div className="row-flex gap-6" style={{ marginLeft: 'auto' }}>
          <button className="btn sm" onClick={() => downloadCsv(sorted, multiDay)}><IcDownload /> CSV</button>
          <button className="btn sm"><IcBookmark /> 필터 저장</button>
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
              value={period} onChange={p => { setPeriod(p); setPage(1); }}
              from={fromDate} to={toDate}
              onFromChange={setFromDate} onToChange={setToDate}
            />

            <FilterBlock label="카테고리" hint={catLabel}>
              <div className="check-grid" style={{ maxHeight: 160, overflowY: 'auto' }}>
                {CATEGORY_DISPLAY.map(c => (
                  <CheckRow key={c.code}
                    on={selectedCategory === c.code}
                    onToggle={() => { setSelectedCategory(c.code); setPage(1); }}
                    label={c.label}
                  />
                ))}
              </div>
            </FilterBlock>

            <FilterBlock label="성별">
              <PillGroup value={gender} onChange={v => { setGender(v); setPage(1); }} options={GENDER_OPTS} />
            </FilterBlock>

            <FilterBlock label="연령대">
              <PillGroup value={age} onChange={v => { setAge(v); setPage(1); }} options={AGE_OPTS} />
            </FilterBlock>

            <FilterBlock label="가격대" hint={priceLabel}>
              <RangeSlider
                min={0} max={PRICE_MAX}
                value={price}
                onChange={v => { setPrice(v); setPage(1); }}
              />
              <div className="row-flex between" style={{ marginTop: 2, marginBottom: 6 }}>
                <span className="mono dim" style={{ fontSize: 10 }}>0만</span>
                <span className="mono dim" style={{ fontSize: 10 }}>{PRICE_MAX}만+</span>
              </div>
              {/* 직접 입력 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <PriceInput
                  value={price[0] === 0 ? null : price[0]}
                  placeholder="0"
                  min={0} max={PRICE_MAX - 0.5}
                  onCommit={v => {
                    const next = v ?? 0;
                    if (next < price[1]) { setPrice([next, price[1]]); setPage(1); }
                  }}
                />
                <span className="mono dim" style={{ fontSize: 11, flexShrink: 0 }}>~</span>
                <PriceInput
                  value={price[1] >= PRICE_MAX ? null : price[1]}
                  placeholder={`${PRICE_MAX}+`}
                  min={0.5} max={PRICE_MAX}
                  onCommit={v => {
                    const next = v ?? PRICE_MAX;
                    if (next > price[0]) { setPrice([price[0], next]); setPage(1); }
                  }}
                />
                <span className="mono dim" style={{ fontSize: 11, flexShrink: 0, whiteSpace: 'nowrap' }}>만원</span>
              </div>
            </FilterBlock>

            <FilterBlock label="회사" hint={companies.size > 0 ? `${companies.size} 적용` : '검색 추가'}>
              <SearchSelect
                options={companyOpts}
                selected={companies}
                onAdd={c => { addCompany(c); setPage(1); }}
                onRemove={c => { removeCompany(c); setPage(1); }}
                placeholder="회사명 검색…"
              />
            </FilterBlock>

            <FilterBlock label="브랜드" hint={brands.size > 0 ? `${brands.size} 적용` : '검색 추가'}>
              <SearchSelect
                options={brandOpts}
                selected={brands}
                onAdd={b => { addBrand(b); setPage(1); }}
                onRemove={b => { removeBrand(b); setPage(1); }}
                placeholder="브랜드명 검색…"
              />
            </FilterBlock>

            <FilterBlock label="옵션">
              <CheckRow on={ownOnly}   onToggle={() => { setOwnOnly(v => !v);   setPage(1); }} label="자사 상품만" count={ownCount} />
              <CheckRow on={moverOnly} onToggle={() => { setMoverOnly(v => !v); setPage(1); }} label="변동 항목만 (↑/↓)" />
            </FilterBlock>
          </div>
        </aside>

        {/* ===== 결과 영역 ===== */}
        <div className="col-flex gap-10">
          {/* 적용된 필터 칩 + 정렬 */}
          <div className="row-flex center gap-6 wrap">
            <span className="sec-tag">applied</span>
            <DismissChip onDismiss={() => setPeriod('today')}>{periodLabel}</DismissChip>
            {selectedCategory !== '000' && (
              <DismissChip onDismiss={() => { setSelectedCategory('000'); setPage(1); }}>{catLabel}</DismissChip>
            )}
            {genderLabel && <DismissChip onDismiss={() => setGender('A')}>{genderLabel}</DismissChip>}
            {age !== 'AGE_BAND_ALL' && <DismissChip onDismiss={() => setAge('AGE_BAND_ALL')}>{ageLabel}</DismissChip>}
            {priceActive && (
              <DismissChip onDismiss={() => { setPrice([0, PRICE_MAX]); setPage(1); }}>
                {price[0]}~{price[1] < PRICE_MAX ? price[1] + '만원' : PRICE_MAX + '만+'}
              </DismissChip>
            )}
            {[...companies].map(c => (
              <DismissChip key={`co-${c}`} onDismiss={() => removeCompany(c)}>회사 · {c}</DismissChip>
            ))}
            {[...brands].map(b => (
              <DismissChip key={`br-${b}`} onDismiss={() => removeBrand(b)}>브랜드 · {b}</DismissChip>
            ))}
            {ownOnly && (
              <DismissChip onDismiss={() => setOwnOnly(false)} style={{ background: 'var(--hs-soft)', color: 'var(--hs)', borderColor: 'var(--hs)' }}>자사 상품만</DismissChip>
            )}
            {moverOnly && <DismissChip onDismiss={() => setMoverOnly(false)}>변동만</DismissChip>}
            <div className="flex-1" />
            <span className="mono dim" style={{ fontSize: 12 }}>{sorted.length}건 / {allRows.length}</span>
            <div className="row-flex gap-4">
              {([['rank','순위'], ['change','변동'], ['rating','리뷰점수'], ['reviews','리뷰수'], ['name','상품명']] as [string, string][]).map(([key, label]) => {
                const active = sort === key;
                return (
                  <button key={key}
                    className={`btn sm${active ? ' active' : ''}`}
                    onClick={() => {
                      if (active) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }
                      else { setSort(key); setSortDir('asc'); }
                      setPage(1);
                    }}>
                    {label}{active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--shf)', fontSize: 13 }}>
              데이터 로드 실패: {error}
            </div>
          )}

          <section className="panel" style={{ padding: 0 }}>
            <div className="tbl" style={{ border: 'none', borderRadius: 0 }}>
              {(() => {
                const cols = multiDay
                  ? '54px 36px 1fr 116px 60px 60px 88px 54px 46px 56px 56px'
                  : '36px 1fr 116px 60px 60px 88px 54px 46px 56px 56px';
                return (
                  <div className="row head" style={{ gridTemplateColumns: cols, lineHeight: 1.3 }}>
                    {multiDay && <span>날짜</span>}
                    <span>순위</span>
                    <span>상품명</span>
                    <span>브랜드<br />회사</span>
                    <span>카테고리</span>
                    <span>성별<br />연령</span>
                    <span className="cell-r">판매가격<br />소비자가</span>
                    <span className="cell-r">할인율</span>
                    <span className="cell-r">변동</span>
                    <span className="cell-r">리뷰점수</span>
                    <span className="cell-r">리뷰수</span>
                  </div>
                );
              })()}

              {loading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="row" style={{ gridTemplateColumns: multiDay ? '54px 36px 1fr 116px 60px 60px 88px 54px 46px 56px 56px' : '36px 1fr 116px 60px 60px 88px 54px 46px 56px 56px' }}>
                    {Array.from({ length: multiDay ? 11 : 10 }).map((_, j) => (
                      <span key={j} style={{ height: 16, background: 'var(--rai)', borderRadius: 3, display: 'block' }} />
                    ))}
                  </div>
                ))
              ) : pageRows.map((r, i) => {
                const hasDisc = r.discount_rate != null && r.discount_rate > 0;
                const catLbl  = CATEGORY_MAP[r.category_code] || r.category_code;
                const gTxt    = r.gender_filter === 'M' ? '남성' : r.gender_filter === 'F' ? '여성' : '전체';
                const aTxt    = AGE_MAP[r.age_filter] || r.age_filter;
                const chg     = r.rank_change;
                const cols    = multiDay
                  ? '54px 36px 1fr 116px 60px 60px 88px 54px 46px 56px 56px'
                  : '36px 1fr 116px 60px 60px 88px 54px 46px 56px 56px';
                return (
                  <div key={`${r.snapshot_date}-${r.rank_position}-${i}`}
                    className={`row hover ${i % 2 ? 'alt' : ''}`}
                    style={{ gridTemplateColumns: cols, cursor: 'pointer' }}
                    onClick={() => router.push(`/product?no=${r.musinsa_no}`)}>

                    {multiDay && (
                      <span className="mono dim" style={{ fontSize: 10 }}>{r.snapshot_date.slice(5)}</span>
                    )}

                    <span className="mono" style={{ fontWeight: 500, color: r.rank_position <= 10 ? 'var(--f1)' : 'var(--f3)' }}>
                      {String(r.rank_position).padStart(2, '0')}
                    </span>

                    <span className="ellip" style={{ fontWeight: r.is_own ? 500 : 400, color: r.is_own ? 'var(--hs)' : 'var(--f1)' }} title={r.product_name}>
                      {r.product_name}
                    </span>

                    <span>
                      <div className="brand-cell">
                        <span className="bname" style={{ color: r.is_own ? 'var(--hs)' : 'var(--f1)' }}>{r.brand_name}</span>
                        <span className="cname">{r.company_name ?? '—'}</span>
                      </div>
                    </span>

                    <span className="mono dim ellip" style={{ fontSize: 11 }} title={catLbl}>{catLbl}</span>

                    <span>
                      <div className="dual-cell">
                        <span className="top">{gTxt}</span>
                        <span className="bot">{aTxt}</span>
                      </div>
                    </span>

                    <span>
                      <div className="dual-cell r">
                        <span className="top mono">{r.final_price ? r.final_price.toLocaleString() : '—'}</span>
                        {hasDisc && r.list_price
                          ? <span className="bot strike">{r.list_price.toLocaleString()}</span>
                          : <span className="bot">—</span>}
                      </div>
                    </span>

                    <span className="cell-r">
                      {hasDisc
                        ? <span className="chip" style={{
                            color:       r.discount_rate! >= 30 ? 'var(--shf)' : 'var(--f3)',
                            borderColor: r.discount_rate! >= 30 ? 'var(--shf)' : 'var(--bs)',
                            background:  r.discount_rate! >= 30 ? 'var(--shb)' : 'var(--snk)',
                          }}>{Math.round(r.discount_rate!)}%↓</span>
                        : <span className="dim mono">—</span>}
                    </span>

                    <span className="mono cell-r" style={{ fontSize: 11 }}>
                      {chg === null
                        ? <span style={{ color: 'var(--tu)', fontSize: 10 }}>NEW</span>
                        : chg === 0
                          ? <span className="dim">—</span>
                          : chg > 0
                            ? <span style={{ color: 'var(--slf)' }}>▲{chg}</span>
                            : <span style={{ color: 'var(--shf)' }}>▼{Math.abs(chg)}</span>}
                    </span>

                    <span className="mono cell-r" style={{ fontSize: 11 }}>
                      {r.review_score > 0 ? r.review_score : '—'}
                    </span>

                    <span className="mono cell-r" style={{ fontSize: 11 }}>
                      {r.review_count > 0 ? r.review_count.toLocaleString() : '—'}
                    </span>
                  </div>
                );
              })}

              {!loading && pageRows.length === 0 && (
                <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--f4)' }}>
                  <span className="sec-tag">no results</span>
                  <div style={{ marginTop: 8, fontSize: 12 }}>
                    {allRows.length === 0 ? '수집된 랭킹 데이터가 없습니다.' : '조건에 맞는 상품이 없습니다. 필터를 완화해 보세요.'}
                  </div>
                </div>
              )}
            </div>

            {totalPages > 1 && (
              <div className="row-flex between center" style={{ padding: '10px 14px', borderTop: '0.5px solid var(--bs)' }}>
                <span className="mono dim" style={{ fontSize: 11 }}>
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} / {sorted.length.toLocaleString()}
                </span>
                <div className="row-flex gap-4">
                  <button className="btn sm icon" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}><IcChevL /></button>
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    let p = i + 1;
                    if (totalPages > 7) {
                      if (page <= 4) p = i + 1;
                      else if (page >= totalPages - 3) p = totalPages - 6 + i;
                      else p = page - 3 + i;
                    }
                    return (
                      <button key={p} className={`btn sm ${page === p ? 'active' : ''}`} onClick={() => setPage(p)}>{p}</button>
                    );
                  })}
                  <button className="btn sm icon" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}><IcChevR /></button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
