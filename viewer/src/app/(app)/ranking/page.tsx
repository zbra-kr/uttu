'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { PeriodFilter, FilterBlock, PillGroup, CheckRow, DismissChip, SegGroup, SearchSelect } from '@/components/ui/filters';
import { IcDownload, IcChevL, IcChevR, IcBookmark } from '@/components/ui/icons';
import {
  fetchLatestRanking, fetchBrandOptions, fetchCompanyOptions,
  CATEGORY_MAP, AGE_MAP, type RankingRow,
} from '@/lib/queries';

// 카테고리 표시 목록 — '000'이 전체 랭킹, 나머지는 카테고리별 랭킹
const CATEGORY_DISPLAY = [
  { code: '000', label: '전체' },
  { code: '001', label: '상의' },
  { code: '002', label: '아우터' },
  { code: '003', label: '하의' },
  { code: '004', label: '신발' },
  { code: '017', label: '가방' },
  { code: '026', label: '모자' },
  { code: '100', label: '뷰티' },
  { code: '101', label: '액세서리' },
  { code: '102', label: '속옷' },
  { code: '103', label: '양말' },
  { code: '104', label: '스포츠' },
  { code: '106', label: '라이프' },
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

export default function RankingPage() {
  const router = useRouter();

  // ── 서버 데이터 ──────────────────────────────────────────
  const [allRows, setAllRows] = React.useState<RankingRow[]>([]);
  const [loading, setLoading]     = React.useState(true);
  const [error,   setError]       = React.useState<string | null>(null);
  const [snapshotDate, setSnapshotDate] = React.useState('');

  // ── 필터 옵션 목록 ────────────────────────────────────────
  const [brandOpts,   setBrandOpts]   = React.useState<string[]>([]);
  const [companyOpts, setCompanyOpts] = React.useState<string[]>([]);

  // ── 필터 상태 ─────────────────────────────────────────────
  const [period,           setPeriod]          = React.useState('today');
  const [fromDate,         setFromDate]         = React.useState('');
  const [toDate,           setToDate]           = React.useState('');
  const [selectedCategory, setSelectedCategory] = React.useState('000');  // 단일 선택
  const [gender,           setGender]           = React.useState('A');
  const [age,              setAge]              = React.useState('AGE_BAND_ALL');
  const [price,       setPrice]     = React.useState<[number, number]>([0, 200]);
  const [companies,   setCompanies] = React.useState<Set<string>>(new Set());
  const [brands,      setBrands]    = React.useState<Set<string>>(new Set());
  const [ownOnly,     setOwnOnly]   = React.useState(false);
  const [moverOnly,   setMoverOnly] = React.useState(false);
  const [sort,        setSort]      = React.useState('rank');
  const [page,        setPage]      = React.useState(1);

  // ── 초기 로드 ─────────────────────────────────────────────
  React.useEffect(() => {
    Promise.all([
      fetchBrandOptions(),
      fetchCompanyOptions(),
    ]).then(([bList, cList]) => {
      setBrandOpts(bList.map(b => b.name));
      setCompanyOpts(cList.map(c => c.corp_name));
    }).catch(console.error);
  }, []);

  // ── 랭킹 데이터 로드 — category/gender/age 변경 시 재쿼리 ─
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchLatestRanking({ categoryCode: selectedCategory, genderFilter: gender, ageFilter: age, limit: 300 })
      .then(data => {
        if (cancelled) return;
        setAllRows(data);
        if (data.length > 0) setSnapshotDate(data[0].snapshot_date);
        setPage(1);
      })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedCategory, gender, age]);

  // ── 클라이언트 필터 (카테고리는 API에서 처리됨) ──────────
  const filtered = React.useMemo(() => {
    return allRows.filter(r => {
      if (brands.size > 0 && !brands.has(r.brand_name)) return false;
      if (companies.size > 0 && (!r.company_name || !companies.has(r.company_name))) return false;
      const fp = (r.final_price ?? 0) / 10000;
      if (fp < price[0] || (price[1] < 200 && fp > price[1])) return false;
      if (ownOnly && !r.is_own) return false;
      return true;
    });
  }, [allRows, brands, companies, price, ownOnly]);

  const sorted = React.useMemo(() => {
    const c = [...filtered];
    if (sort === 'rank')    c.sort((a, b) => a.rank_position - b.rank_position);
    if (sort === 'rating')  c.sort((a, b) => b.review_score - a.review_score);
    if (sort === 'reviews') c.sort((a, b) => b.review_count - a.review_count);
    if (sort === 'price')   c.sort((a, b) => (a.final_price ?? 0) - (b.final_price ?? 0));
    return c;
  }, [filtered, sort]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageRows   = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const ownCount  = allRows.filter(r => r.is_own).length;

  const periodLabel = period === 'today' ? '오늘' : period === '7d' ? '7일' :
    period === '30d' ? '30일' : period === '90d' ? '90일' :
    (fromDate && toDate ? `${fromDate} ~ ${toDate}` : '직접');

  const genderLabel = gender === 'M' ? '남성' : gender === 'F' ? '여성' : null;
  const ageLabel    = AGE_MAP[age];

  const addCompany    = (c: string) => setCompanies(p => new Set([...p, c]));
  const removeCompany = (c: string) => setCompanies(p => { const n = new Set(p); n.delete(c); return n; });
  const addBrand      = (b: string) => setBrands(p => new Set([...p, b]));
  const removeBrand   = (b: string) => setBrands(p => { const n = new Set(p); n.delete(b); return n; });

  const reset = () => {
    setPeriod('today');
    setSelectedCategory('000');
    setGender('A'); setAge('AGE_BAND_ALL');
    setPrice([0, 200]);
    setCompanies(new Set()); setBrands(new Set());
    setOwnOnly(false); setMoverOnly(false);
    setPage(1);
  };

  const catLabel = CATEGORY_DISPLAY.find(c => c.code === selectedCategory)?.label ?? '전체';

  return (
    <>
      <div className="page-title">
        <h1>랭킹</h1>
        {snapshotDate && <span className="chip mono">{periodLabel} · {snapshotDate} 수집</span>}
        <span className="sub">전체 상품 랭킹 · 회사·브랜드·필터 적용</span>
        <div className="row-flex gap-6" style={{ marginLeft: 'auto' }}>
          <button className="btn sm"><IcDownload /> CSV</button>
          <button className="btn sm"><IcBookmark /> 필터 저장</button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-6 gap-8">
        {[
          ['추적 상품',  loading ? '…' : allRows.length.toLocaleString(), '수집 완료'],
          ['랭킹 변동',  '—', '개발 예정'],
          ['TOP10 진입', loading ? '…' : String(allRows.filter(r => r.rank_position <= 10).length), '개'],
          ['신규 세일',  loading ? '…' : String(allRows.filter(r => r.discount_rate && r.discount_rate > 0).length), '할인 상품'],
          ['자사 진입',  loading ? '…' : String(ownCount), '개'],
          ['자사 평점',  loading ? '…' : (allRows.filter(r => r.is_own && r.review_score > 0).length > 0
            ? `${Math.round(allRows.filter(r => r.is_own && r.review_score > 0).reduce((s, r) => s + r.review_score, 0) / allRows.filter(r => r.is_own && r.review_score > 0).length)}%`
            : '—'), '자사 만족도'],
        ].map(([l, v, d], i) => (
          <div key={i} className="kpi">
            <span className="label">{l}</span>
            <div className="val">{v}</div>
            <div className="dlt"><span className="muted">{d}</span></div>
          </div>
        ))}
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
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                {CATEGORY_DISPLAY.map(c => (
                  <button key={c.code}
                    className={`pill ${selectedCategory === c.code ? 'on' : ''}`}
                    onClick={() => { setSelectedCategory(c.code); setPage(1); }}>
                    {c.label}
                  </button>
                ))}
              </div>
            </FilterBlock>

            <FilterBlock label="성별">
              <PillGroup value={gender} onChange={v => { setGender(v); setPage(1); }} options={GENDER_OPTS} />
            </FilterBlock>

            <FilterBlock label="연령대">
              <PillGroup value={age} onChange={v => { setAge(v); setPage(1); }} options={AGE_OPTS} />
            </FilterBlock>

            <FilterBlock label="가격대" hint={`${price[0]}만 ~ ${price[1] < 200 ? price[1] + '만' : '200만+'}`}>
              <div style={{ position: 'relative', height: 22, marginTop: 4 }}>
                <div style={{ position: 'absolute', top: 9, left: 0, right: 0, height: 4, background: 'var(--snk)', borderRadius: 2 }} />
                <div style={{
                  position: 'absolute', top: 9,
                  left: `${(price[0] / 200) * 100}%`,
                  width: `${((price[1] - price[0]) / 200) * 100}%`,
                  height: 4, background: 'var(--f1)', borderRadius: 2,
                }} />
                <input type="range" min={0} max={200} step={5} value={price[0]}
                  onChange={e => { const v = +e.target.value; if (v < price[1]) setPrice([v, price[1]]); }}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, width: '100%', opacity: 0, height: 22, cursor: 'pointer' }} />
                <input type="range" min={0} max={200} step={5} value={price[1]}
                  onChange={e => { const v = +e.target.value; if (v > price[0]) setPrice([price[0], v]); }}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, width: '100%', opacity: 0, height: 22, cursor: 'pointer' }} />
                <div style={{ position: 'absolute', top: 4, left: `${(price[0] / 200) * 100}%`, width: 14, height: 14, borderRadius: 7, background: 'var(--rai)', border: '1.5px solid var(--f1)', transform: 'translateX(-50%)', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', top: 4, left: `${(price[1] / 200) * 100}%`, width: 14, height: 14, borderRadius: 7, background: 'var(--rai)', border: '1.5px solid var(--f1)', transform: 'translateX(-50%)', pointerEvents: 'none' }} />
              </div>
              <div className="row-flex between" style={{ marginTop: 2 }}>
                <span className="mono dim" style={{ fontSize: 10 }}>0만</span>
                <span className="mono dim" style={{ fontSize: 10 }}>200만+</span>
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
              <DismissChip onDismiss={() => { setSelectedCategory('000'); setPage(1); }}>
                {catLabel}
              </DismissChip>
            )}
            {genderLabel && <DismissChip onDismiss={() => setGender('A')}>{genderLabel}</DismissChip>}
            {age !== 'AGE_BAND_ALL' && <DismissChip onDismiss={() => setAge('AGE_BAND_ALL')}>{ageLabel}</DismissChip>}
            {(price[0] > 0 || price[1] < 200) && (
              <DismissChip onDismiss={() => setPrice([0, 200])}>{price[0]}~{price[1]}만원</DismissChip>
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
            <SegGroup value={sort} onChange={s => { setSort(s); setPage(1); }} full={false}
              options={[['rank', '랭킹'], ['price', '가격'], ['rating', '★'], ['reviews', '리뷰']]} />
          </div>

          {error && (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--shf)', fontSize: 13 }}>
              데이터 로드 실패: {error}
            </div>
          )}

          <section className="panel" style={{ padding: 0 }}>
            <div className="tbl" style={{ border: 'none', borderRadius: 0 }}>
              {/* 설계 10-컬럼 헤더 */}
              <div className="row head" style={{ gridTemplateColumns: '36px 1fr 116px 60px 60px 88px 54px 46px 56px 56px', lineHeight: 1.3 }}>
                <span>#</span>
                <span>상품</span>
                <span>브랜드<br />회사</span>
                <span>카테고리</span>
                <span>성별<br />연령</span>
                <span className="cell-r">가격<br />소비자가</span>
                <span className="cell-r">할인</span>
                <span className="cell-r">변동</span>
                <span className="cell-r">만족도<br />리뷰수</span>
                <span className="cell-r">리뷰</span>
              </div>

              {loading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="row" style={{ gridTemplateColumns: '36px 1fr 116px 60px 60px 88px 54px 46px 56px 56px' }}>
                    {Array.from({ length: 10 }).map((_, j) => (
                      <span key={j} style={{ height: 16, background: 'var(--rai)', borderRadius: 3, display: 'block' }} />
                    ))}
                  </div>
                ))
              ) : pageRows.map((r, i) => {
                const hasDisc  = r.discount_rate != null && r.discount_rate > 0;
                const catLabel = CATEGORY_MAP[r.category_code] || r.category_code;
                const gTxt     = r.gender_filter === 'M' ? '남성' : r.gender_filter === 'F' ? '여성' : '전체';
                const aTxt     = AGE_MAP[r.age_filter] || r.age_filter;
                return (
                  <div key={`${r.rank_position}-${i}`}
                    className={`row hover ${i % 2 ? 'alt' : ''}`}
                    style={{ gridTemplateColumns: '36px 1fr 116px 60px 60px 88px 54px 46px 56px 56px', cursor: 'pointer' }}
                    onClick={() => router.push(`/product?id=${r.product_id || r.musinsa_no}`)}>

                    {/* # */}
                    <span className="mono" style={{ fontWeight: 500, color: r.rank_position <= 10 ? 'var(--f1)' : 'var(--f3)' }}>
                      {String(r.rank_position).padStart(2, '0')}
                    </span>

                    {/* 상품명 */}
                    <span className="ellip" style={{ fontWeight: r.is_own ? 500 : 400, color: r.is_own ? 'var(--hs)' : 'var(--f1)' }} title={r.product_name}>
                      {r.product_name}
                    </span>

                    {/* 브랜드 / 회사 (dual-cell) */}
                    <span>
                      <div className="brand-cell">
                        <span className="bname" style={{ color: r.is_own ? 'var(--hs)' : 'var(--f1)' }}>{r.brand_name}</span>
                        <span className="cname">{r.company_name ?? '—'}</span>
                      </div>
                    </span>

                    {/* 카테고리 */}
                    <span className="mono dim ellip" style={{ fontSize: 11 }} title={catLabel}>{catLabel}</span>

                    {/* 성별 / 연령 (dual-cell) */}
                    <span>
                      <div className="dual-cell">
                        <span className="top">{gTxt}</span>
                        <span className="bot">{aTxt}</span>
                      </div>
                    </span>

                    {/* 가격 / 소비자가 (dual-cell r) */}
                    <span>
                      <div className="dual-cell r">
                        <span className="top mono">{r.final_price ? r.final_price.toLocaleString() : '—'}</span>
                        {hasDisc && r.list_price
                          ? <span className="bot strike">{r.list_price.toLocaleString()}</span>
                          : <span className="bot">—</span>}
                      </div>
                    </span>

                    {/* 할인 */}
                    <span className="cell-r">
                      {hasDisc
                        ? <span className="chip" style={{
                            color: r.discount_rate! >= 30 ? 'var(--shf)' : 'var(--f3)',
                            borderColor: r.discount_rate! >= 30 ? 'var(--shf)' : 'var(--bs)',
                            background: r.discount_rate! >= 30 ? 'var(--shb)' : 'var(--snk)',
                          }}>{Math.round(r.discount_rate!)}%↓</span>
                        : <span className="dim mono">—</span>}
                    </span>

                    {/* 변동 — DB 미수집 */}
                    <span className="mono dim cell-r" style={{ fontSize: 11 }}>—</span>

                    {/* 만족도 / 리뷰수 (dual-cell r) */}
                    <span>
                      <div className="dual-cell r">
                        <span className="top mono" style={{ fontSize: 11 }}>{r.review_score > 0 ? `${r.review_score}%` : '—'}</span>
                        <span className="bot">{r.review_count.toLocaleString()}</span>
                      </div>
                    </span>

                    {/* 리뷰 */}
                    <span className="mono muted cell-r">{r.review_count.toLocaleString()}</span>
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

            {/* 페이지네이션 */}
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
