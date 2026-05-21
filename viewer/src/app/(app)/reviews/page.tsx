'use client';
import React from 'react';
import { Spark, Line } from '@/components/ui/charts';
import { FilterBlock, PillGroup, PeriodFilter, DismissChip, SegGroup, CheckRow, SearchSelect } from '@/components/ui/filters';
import { IcSearch, IcArrowUR, IcDownload } from '@/components/ui/icons';
import {
  fetchReviews, fetchReviewStats, fetchOwnProducts, fetchBrandOptions, fetchCompanyOptions,
  CATEGORY_MAP,
  type ReviewRow, type OwnProduct,
} from '@/lib/queries';

const CATEGORY_LABELS = Object.entries(CATEGORY_MAP)
  .filter(([code]) => code !== '000')
  .map(([, label]) => label);

export default function ReviewsPage() {
  const [tab, setTab] = React.useState<'dash' | 'browse' | 'product'>('dash');
  return (
    <>
      <div className="page-title">
        <h1>리뷰</h1>
        <span className="sub">자사 리뷰 모니터링 · 조회 · 특이점</span>
      </div>
      <div className="tabs">
        <div className={`tab ${tab === 'dash' ? 'active' : ''}`} onClick={() => setTab('dash')}>대시보드</div>
        <div className={`tab ${tab === 'browse' ? 'active' : ''}`} onClick={() => setTab('browse')}>조회 (필터 + Excel)</div>
        <div className={`tab ${tab === 'product' ? 'active' : ''}`} onClick={() => setTab('product')}>특이점 상품 리뷰</div>
      </div>
      {tab === 'dash' && <RvDashboard onRoute={() => setTab('product')} />}
      {tab === 'browse' && <RvBrowse />}
      {tab === 'product' && <RvProductReviews />}
    </>
  );
}

// ===========================================================================
// A · Dashboard
// ===========================================================================

function RvDashboard({ onRoute }: { onRoute: () => void }) {
  const [days, setDays] = React.useState(30);
  const [stats, setStats] = React.useState<{ total: number; avgRating: number; lowCount: number; ratingDist: number[] } | null>(null);
  const [ownProducts, setOwnProducts] = React.useState<OwnProduct[]>([]);

  React.useEffect(() => {
    fetchReviewStats(days).then(setStats).catch(console.error);
  }, [days]);

  React.useEffect(() => {
    fetchOwnProducts(20).then(setOwnProducts).catch(console.error);
  }, []);

  const total = stats?.total ?? 0;
  const avgRating = stats?.avgRating ?? 0;
  const lowCount = stats?.lowCount ?? 0;
  const ratingDist = stats?.ratingDist ?? [0, 0, 0, 0, 0];
  const distTotal = ratingDist.reduce((s, n) => s + n, 0) || 1;

  return (
    <>
      <div className="row-flex between center">
        <h2 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>자사 리뷰 — 전체 현황</h2>
        <div className="row-flex gap-4">
          {[7, 30].map(d => (
            <button key={d} className={`btn sm ${days === d ? 'active' : ''}`} onClick={() => setDays(d)}>{d}D</button>
          ))}
          <button className={`btn sm ${days === 999 ? 'active' : ''}`} onClick={() => setDays(999)}>전체</button>
          <span style={{ width: 8 }} />
          <button className="btn sm" onClick={onRoute}><IcSearch /> 조회로</button>
        </div>
      </div>

      <div className="grid grid-5 gap-8">
        {[
          ['신규 리뷰',   stats ? total.toLocaleString() : '…',  `최근 ${days === 999 ? '전체' : days + '일'}`, ''],
          ['평균 평점',   stats ? avgRating.toFixed(2) : '…',    '자사 상품', ''],
          ['저점 (≤2)',   stats ? String(lowCount) : '…',        `${days === 999 ? '전체' : days + '일'} 내`, ''],
          ['특이점 상품', '—',                                    '', ''],
          ['응답률',      '—',                                    '', ''],
        ].map(([l, v, d], i) => (
          <div key={i} className="kpi">
            <span className="label">{l}</span>
            <div className="val">{v}</div>
            <div className="dlt"><span className="muted">{d}</span></div>
          </div>
        ))}
      </div>

      <div className="grid grid-2 gap-12">
        <section className="panel">
          <div className="sec-head"><h3>평점 분포</h3></div>
          <div className="col-flex gap-6">
            {[5, 4, 3, 2, 1].map((star, i) => {
              const count = ratingDist[i] ?? 0;
              const pct = Math.round(count / distTotal * 100);
              return (
                <div key={star} className="row-flex center gap-10">
                  <span className="mono dim" style={{ width: 24, fontSize: 11 }}>★{star}</span>
                  <div style={{ flex: 1, height: 14, background: 'var(--snk)', borderRadius: 2 }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: star <= 2 ? 'var(--hs)' : 'var(--f2)', borderRadius: 2 }} />
                  </div>
                  <span className="mono dim" style={{ width: 48, textAlign: 'right', fontSize: 11 }}>
                    {stats ? `${pct}% (${count})` : '…'}
                  </span>
                </div>
              );
            })}
          </div>
          <hr className="hr-d" style={{ margin: '14px 0' }} />
          <div className="sec-head"><h3 style={{ fontSize: 13 }}>평점 추이 <span className="sub">30일</span></h3></div>
          <Line h={90} yMin={3.5} yMax={5}
            series={[{ points: [4.5, 4.4, 4.4, 4.3, 4.3, 4.4, 4.3, 4.2, 4.2, 4.1, 4.2, 4.2], color: 'var(--f1)' }]} />
        </section>

        <section className="panel">
          <div className="sec-head"><h3>키워드 (AI 추출) <span className="sub">저점 ↔ 고점</span></h3></div>
          <div className="grid grid-2 gap-10">
            <div>
              <span className="sec-tag" style={{ color: 'var(--shf)' }}>↓ 저점 키워드</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {([['사이즈 작음', 12, true], ['배송 지연', 8, false], ['색감 다름', 7, false], ['실밥', 6, true], ['핏', 5, false], ['교환문의', 4, false]] as [string, number, boolean][]).map(([k, n, hot], i) => (
                  <span key={i} className="chip lg"
                    style={{ background: hot ? 'var(--shb)' : 'var(--snk)', color: hot ? 'var(--shf)' : 'var(--f2)', borderColor: hot ? 'var(--shf)' : 'var(--bs)', textTransform: 'none', letterSpacing: 0 }}>
                    {k} · {n}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <span className="sec-tag" style={{ color: 'var(--tu)' }}>↑ 고점 키워드</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {[['핏 좋음', 42], ['재구매', 28], ['편안함', 24], ['색감', 22], ['가성비', 18], ['포장', 14]].map(([k, n], i) => (
                  <span key={i} className="chip lg"
                    style={{ background: 'var(--slb)', color: 'var(--slf)', borderColor: 'var(--slf)', textTransform: 'none', letterSpacing: 0 }}>
                    {k} · {n}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="sec-head">
          <h3>특이점 상품 <span className="sub">평점 낮은 자사 상품</span></h3>
          <button className="btn sm" onClick={onRoute}>전체 보기 ↗</button>
        </div>
        <div className="tbl">
          <div className="row head" style={{ gridTemplateColumns: '110px 1fr 80px 70px 100px 1fr 60px' }}>
            <span>상품번호</span><span>상품</span>
            <span className="cell-r">리뷰</span><span className="cell-r">평점</span>
            <span>추이</span><span>브랜드</span><span></span>
          </div>
          {ownProducts.slice(0, 5).map((p, i) => (
            <div key={p.id} className={`row hover ${i % 2 ? 'alt' : ''}`} style={{ gridTemplateColumns: '110px 1fr 80px 70px 100px 1fr 60px' }}>
              <span className="mono dim" style={{ fontSize: 10 }}>{p.musinsa_no}</span>
              <span>{p.name}</span>
              <span className="mono muted cell-r">{p.review_count}</span>
              <span className={`mono cell-r ${(p.satisfaction_score ?? 100) < 60 ? 'hs' : ''}`} style={{ fontWeight: 500 }}>
                {p.satisfaction_score != null ? `${p.satisfaction_score}%` : '—'}
              </span>
              <span><Spark w={80} h={20} up={(p.satisfaction_score ?? 80) >= 70} /></span>
              <span className="dim" style={{ fontSize: 11 }}>{p.brand_name}</span>
              <span>
                <button className="btn sm icon" onClick={onRoute}><IcArrowUR /></button>
              </span>
            </div>
          ))}
          {ownProducts.length === 0 && (
            <div className="row" style={{ gridTemplateColumns: '1fr' }}>
              <span className="dim" style={{ fontSize: 12, textAlign: 'center', padding: '16px 0' }}>자사 상품 없음</span>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

// ===========================================================================
// B · Browse (filter + Excel)
// ===========================================================================

function RvBrowse() {
  const today = new Date().toISOString().split('T')[0];
  const thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

  const [target, setTarget] = React.useState('own');
  const [period, setPeriod] = React.useState('30d');
  const [fromDate, setFromDate] = React.useState(thirtyAgo);
  const [toDate, setToDate] = React.useState(today);
  const [ratingFrom, setRatingFrom] = React.useState(1);
  const [ratingTo, setRatingTo] = React.useState(2);
  const [categories, setCategories] = React.useState(new Set(CATEGORY_LABELS));
  const [companies, setCompanies] = React.useState<Set<string>>(new Set());
  const [brands, setBrands] = React.useState<Set<string>>(new Set());
  const [keyword, setKeyword] = React.useState('');
  const [sort, setSort] = React.useState('recent');
  const [page, setPage] = React.useState(0);
  const PAGE_SIZE = 30;

  const [rows, setRows] = React.useState<ReviewRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

  const [brandOpts, setBrandOpts] = React.useState<string[]>([]);
  const [companyOpts, setCompanyOpts] = React.useState<string[]>([]);

  React.useEffect(() => {
    fetchBrandOptions().then(data => setBrandOpts(data.map(d => d.name))).catch(console.error);
    fetchCompanyOptions().then(data => setCompanyOpts(data.map(d => d.corp_name))).catch(console.error);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const dateFrom = period !== 'custom' ? (() => {
      if (period === 'today') return today;
      if (period === '7d') return new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      if (period === '30d') return new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      if (period === '90d') return new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
      return undefined;
    })() : fromDate;
    const dateTo = period === 'custom' ? toDate : undefined;

    fetchReviews({
      ratingMin: ratingFrom,
      ratingMax: ratingTo,
      dateFrom,
      dateTo,
      keyword: keyword.trim() || undefined,
      ownOnly: target === 'own',
      sort: sort as any,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }).then(({ rows: r, total: t }) => {
      if (cancelled) return;
      setRows(r);
      setTotal(t);
    }).catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [target, period, fromDate, toDate, ratingFrom, ratingTo, keyword, sort, page]);

  const allCatSelected = categories.size === CATEGORY_LABELS.length;
  const toggleCat = (c: string) => setCategories(p => { const n = new Set(p); n.has(c) ? n.delete(c) : n.add(c); return n; });

  const periodLabel = period === 'today' ? '오늘' : period === '7d' ? '7일' : period === '30d' ? '30일' : period === '90d' ? '90일' : `${fromDate} ~ ${toDate}`;

  const reset = () => {
    setTarget('own'); setRatingFrom(1); setRatingTo(2);
    setPeriod('30d'); setCategories(new Set(CATEGORY_LABELS));
    setCompanies(new Set()); setBrands(new Set());
    setKeyword(''); setSort('recent'); setPage(0);
  };

  const visibleRows = brands.size > 0
    ? rows.filter(r => brands.has(r.brand_name))
    : rows;

  return (
    <div className="grid" style={{ gridTemplateColumns: '300px 1fr', gap: 14 }}>
      <aside className="filter-rail">
        <div className="frh">
          <h3>조회 조건</h3>
          <button className="btn sm" onClick={reset}>초기화</button>
        </div>
        <div className="frb">
          <FilterBlock label="대상">
            <PillGroup value={target} onChange={v => { setTarget(v); setPage(0); }}
              options={[['own', '자사'], ['all', '전체']]} />
          </FilterBlock>

          <PeriodFilter value={period} onChange={v => { setPeriod(v); setPage(0); }}
            from={fromDate} to={toDate} onFromChange={setFromDate} onToChange={setToDate} />

          <FilterBlock label="별점 범위" hint={`★${ratingFrom} ~ ★${ratingTo}`}>
            <div style={{ position: 'relative', height: 22, marginTop: 2 }}>
              <div style={{ position: 'absolute', top: 9, left: 0, right: 0, height: 4, background: 'var(--snk)', borderRadius: 2 }} />
              <div style={{
                position: 'absolute', top: 9,
                left: `${((ratingFrom - 1) / 4) * 100}%`,
                width: `${((ratingTo - ratingFrom) / 4) * 100}%`,
                height: 4, background: 'var(--f1)', borderRadius: 2,
              }} />
              <div style={{ position: 'absolute', top: 4, left: `${((ratingFrom - 1) / 4) * 100}%`, width: 14, height: 14, borderRadius: 7, background: 'var(--rai)', border: '1.5px solid var(--f1)', transform: 'translateX(-50%)', cursor: 'pointer' }} />
              <div style={{ position: 'absolute', top: 4, left: `${((ratingTo - 1) / 4) * 100}%`, width: 14, height: 14, borderRadius: 7, background: 'var(--rai)', border: '1.5px solid var(--f1)', transform: 'translateX(-50%)', cursor: 'pointer' }} />
              <input type="range" min={1} max={5} step={1} value={ratingFrom}
                onChange={e => { const v = +e.target.value; setRatingFrom(Math.min(v, ratingTo)); setPage(0); }}
                style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', cursor: 'pointer' }} />
              <input type="range" min={1} max={5} step={1} value={ratingTo}
                onChange={e => { const v = +e.target.value; setRatingTo(Math.max(v, ratingFrom)); setPage(0); }}
                style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', cursor: 'pointer' }} />
            </div>
            <div className="row-flex between" style={{ marginTop: 2 }}>
              <span className="mono dim" style={{ fontSize: 10 }}>★1</span>
              <span className="mono dim" style={{ fontSize: 10 }}>★5</span>
            </div>
          </FilterBlock>

          <FilterBlock label="카테고리" hint={`${categories.size}/${CATEGORY_LABELS.length}`}>
            <div className="check-grid" style={{ maxHeight: 116, overflowY: 'auto' }}>
              {CATEGORY_LABELS.map(c => (
                <CheckRow key={c} on={categories.has(c)} onToggle={() => toggleCat(c)} label={c} />
              ))}
            </div>
            <div className="row-flex gap-4" style={{ marginTop: 4 }}>
              <button className="btn sm" onClick={() => setCategories(new Set(CATEGORY_LABELS))}>전체</button>
              <button className="btn sm" onClick={() => setCategories(new Set())}>해제</button>
            </div>
          </FilterBlock>

          <FilterBlock label="회사" hint={companies.size > 0 ? `${companies.size} 적용` : '검색 추가'}>
            <SearchSelect
              options={companyOpts}
              selected={companies}
              onAdd={c => setCompanies(p => new Set([...p, c]))}
              onRemove={c => setCompanies(p => { const n = new Set(p); n.delete(c); return n; })}
              placeholder="회사명 검색…"
            />
          </FilterBlock>

          <FilterBlock label="브랜드" hint={brands.size > 0 ? `${brands.size} 적용` : '검색 추가'}>
            <SearchSelect
              options={brandOpts}
              selected={brands}
              onAdd={b => setBrands(p => new Set([...p, b]))}
              onRemove={b => setBrands(p => { const n = new Set(p); n.delete(b); return n; })}
              placeholder="브랜드명 검색…"
            />
          </FilterBlock>

          <FilterBlock label="키워드">
            <input type="text" value={keyword} onChange={e => { setKeyword(e.target.value); setPage(0); }}
              placeholder="예: 사이즈, 핏, 배송" className="input"
              style={{ width: '100%', fontFamily: 'var(--sans)', fontSize: 12 }} />
          </FilterBlock>
        </div>
      </aside>

      <div className="col-flex gap-10">
        <div className="row-flex center gap-6 wrap">
          <span className="sec-tag">applied</span>
          <DismissChip onDismiss={() => setTarget('all')}
            style={target === 'own' ? { background: 'var(--hs-soft)', color: 'var(--hs)', borderColor: 'var(--hs)' } : {}}>
            {target === 'own' ? '자사' : '전체'}
          </DismissChip>
          <DismissChip onDismiss={() => setPeriod('30d')}>{periodLabel}</DismissChip>
          {(ratingFrom !== 1 || ratingTo !== 5) && (
            <DismissChip onDismiss={() => { setRatingFrom(1); setRatingTo(5); }}>★{ratingFrom}~{ratingTo}</DismissChip>
          )}
          {!allCatSelected && (
            <DismissChip onDismiss={() => setCategories(new Set(CATEGORY_LABELS))}>
              카테고리 {categories.size}/{CATEGORY_LABELS.length}
            </DismissChip>
          )}
          {[...companies].map(c => (
            <DismissChip key={`co-${c}`} onDismiss={() => setCompanies(p => { const n = new Set(p); n.delete(c); return n; })}>
              회사 · {c}
            </DismissChip>
          ))}
          {[...brands].map(b => (
            <DismissChip key={`br-${b}`} onDismiss={() => setBrands(p => { const n = new Set(p); n.delete(b); return n; })}>
              브랜드 · {b}
            </DismissChip>
          ))}
          {keyword.trim() && (
            <DismissChip onDismiss={() => setKeyword('')}>키워드 · {keyword.trim()}</DismissChip>
          )}
          <div className="flex-1" />
          <span className="mono dim" style={{ fontSize: 12 }}>{loading ? '…' : `${total.toLocaleString()}건`}</span>
          <SegGroup value={sort} onChange={v => { setSort(v); setPage(0); }} full={false}
            options={[['recent', '최신순'], ['rating_asc', '평점↑'], ['rating_desc', '평점↓'], ['helpful', '도움']]} />
          <button className="btn brand sm"><IcDownload /> Excel</button>
        </div>

        <section className="panel" style={{ padding: 0 }}>
          <div className="tbl" style={{ border: 'none', borderRadius: 0 }}>
            <div className="row head" style={{ gridTemplateColumns: '120px 180px 36px 80px 110px 1fr 110px' }}>
              <span>sku</span><span>상품</span><span className="cell-c">★</span>
              <span>날짜</span><span>유저 메타</span><span>리뷰</span><span>키워드</span>
            </div>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="row" style={{ gridTemplateColumns: '120px 180px 36px 80px 110px 1fr 110px' }}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <span key={j} style={{ height: 14, background: 'var(--rai)', borderRadius: 3, display: 'block' }} />
                  ))}
                </div>
              ))
            ) : visibleRows.length === 0 ? (
              <div className="row" style={{ gridTemplateColumns: '1fr' }}>
                <span className="dim" style={{ fontSize: 12, textAlign: 'center', padding: '20px 0' }}>조회 결과 없음</span>
              </div>
            ) : visibleRows.map((r, i) => (
              <div key={r.id} className={`row ${i % 2 ? 'alt' : ''}`}
                style={{ gridTemplateColumns: '120px 180px 36px 80px 110px 1fr 110px', alignItems: 'flex-start' }}>
                <span className="mono dim" style={{ fontSize: 10 }}>—</span>
                <span style={{ fontSize: 12 }}>{r.product_name}</span>
                <span className={`mono cell-c ${r.rating <= 2 ? 'hs' : ''}`} style={{ fontWeight: 500 }}>{r.rating}</span>
                <span className="mono dim" style={{ fontSize: 11 }}>{r.review_date}</span>
                <span className="mono dim" style={{ fontSize: 11 }}>—</span>
                <span style={{ fontSize: 12, color: 'var(--f2)', lineHeight: 1.5 }}>{r.review_text ?? '—'}</span>
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                  <span className="chip" style={{ fontSize: 10, padding: '1px 6px', textTransform: 'none', letterSpacing: 0 }}>—</span>
                </span>
              </div>
            ))}
          </div>
          <div className="row-flex between center" style={{ padding: '10px 14px', borderTop: '0.5px solid var(--bs)' }}>
            <span className="mono dim" style={{ fontSize: 11 }}>
              {total === 0 ? '0건' : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} / ${total.toLocaleString()}`}
            </span>
            <div className="row-flex gap-4">
              <button className="btn sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>←</button>
              <span className="mono dim" style={{ fontSize: 11 }}>{page + 1} / {Math.ceil(total / PAGE_SIZE) || 1}</span>
              <button className="btn sm" onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= total}>→</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// ===========================================================================
// C · Product reviews (anomaly)
// ===========================================================================

function RvProductReviews() {
  const [products, setProducts] = React.useState<OwnProduct[]>([]);
  const [selectedId, setSelectedId] = React.useState('');
  const [rows, setRows] = React.useState<ReviewRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [ratingTab, setRatingTab] = React.useState<'all' | 'low' | 'mid' | 'hi'>('all');
  const PAGE_SIZE = 20;

  React.useEffect(() => {
    fetchOwnProducts(500).then(setProducts).catch(console.error);
  }, []);

  const ratingMin = ratingTab === 'low' ? 1 : ratingTab === 'mid' ? 3 : ratingTab === 'hi' ? 4 : 1;
  const ratingMax = ratingTab === 'low' ? 2 : ratingTab === 'mid' ? 3 : ratingTab === 'hi' ? 5 : 5;

  React.useEffect(() => {
    if (!selectedId) { setRows([]); setTotal(0); return; }
    let cancelled = false;
    setLoading(true);
    fetchReviews({
      productId: selectedId,
      ratingMin, ratingMax,
      sort: 'recent',
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }).then(({ rows: r, total: t }) => {
      if (!cancelled) { setRows(r); setTotal(t); }
    }).catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId, ratingTab, page]);

  const selected = products.find(p => p.id === selectedId);

  const lowCount = rows.filter(r => r.rating <= 2).length;
  const midCount = rows.filter(r => r.rating === 3).length;
  const hiCount = rows.filter(r => r.rating >= 4).length;

  return (
    <>
      <div className="row-flex center gap-6" style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--f3)', whiteSpace: 'nowrap' }}>상품 선택</span>
        <select value={selectedId} onChange={e => { setSelectedId(e.target.value); setPage(0); setRatingTab('all'); }}
          style={{ flex: 1, fontFamily: 'var(--sans)', fontSize: 12, padding: '5px 8px', border: '0.5px solid var(--bs)', borderRadius: 4, background: 'var(--bg)', color: 'var(--f1)', maxWidth: 500 }}>
          <option value="">— 자사 상품 선택 ({products.length}개) —</option>
          {products.map(p => (
            <option key={p.id} value={p.id}>{p.brand_name} · {p.name} (리뷰 {p.review_count})</option>
          ))}
        </select>
      </div>

      {!selectedId ? (
        <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--f4)' }}>
          <span style={{ fontSize: 13 }}>상품을 선택하면 리뷰가 표시됩니다</span>
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: '300px 1fr', gap: 14 }}>
          {/* 좌측: 이미지 + 스탯 + AI 요약 */}
          <div className="col-flex gap-10">
            <div className="panel compact" style={{
              height: 240, background: 'var(--snk)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              position: 'relative', overflow: 'hidden',
            }}>
              <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity: 0.4 }}>
                <line x1="0" y1="0" x2="100%" y2="100%" stroke="var(--bs)" strokeDasharray="3 4" />
                <line x1="100%" y1="0" x2="0" y2="100%" stroke="var(--bs)" strokeDasharray="3 4" />
              </svg>
              <span className="mono dim" style={{ fontSize: 11, background: 'var(--rai)', padding: '2px 6px', borderRadius: 2 }}>product image</span>
            </div>

            <section className="panel">
              <div style={{ fontSize: 14, fontWeight: 500 }}>{selected?.name ?? '—'}</div>
              <div className="mono dim" style={{ fontSize: 11 }}>{selected?.brand_name ?? '—'}</div>
              <hr className="hr-d" style={{ margin: '12px 0' }} />
              {([
                ['총 리뷰',    String(selected?.review_count ?? 0), false],
                ['평균 만족도', selected?.satisfaction_score != null ? `${selected.satisfaction_score}%` : '—', (selected?.satisfaction_score ?? 100) < 60],
                ['저점 (≤2)',  loading ? '…' : String(rows.filter(r => r.rating <= 2).length), false],
              ] as [string, string, boolean][]).map(([k, v, hot], i) => (
                <div key={i} className="row-flex between" style={{ padding: '3px 0' }}>
                  <span className="dim" style={{ fontSize: 11 }}>{k}</span>
                  <span className={`mono ${hot ? 'hs' : ''}`} style={{ fontSize: 11, fontWeight: hot ? 500 : 400 }}>{v}</span>
                </div>
              ))}
            </section>

            <section className="panel surface">
              <span className="sec-tag">AI 요약</span>
              <div style={{ fontSize: 12, color: 'var(--f2)', lineHeight: 1.55, marginTop: 6 }}>
                AI 요약 기능은 준비 중입니다. 리뷰 데이터를 수집한 후 자동 분석이 활성화됩니다.
              </div>
            </section>
          </div>

          {/* 우측: 필터 탭 + 키워드 + 리뷰 목록 */}
          <div className="col-flex gap-12">
            <div className="row-flex gap-6 center" style={{ flexWrap: 'wrap' }}>
              <button className={`btn sm ${ratingTab === 'all' ? 'active' : ''}`} onClick={() => { setRatingTab('all'); setPage(0); }}>
                전체 ({total})
              </button>
              <button className={`btn sm ${ratingTab === 'low' ? 'active' : ''}`} onClick={() => { setRatingTab('low'); setPage(0); }}>
                ★1~2 ({lowCount})
              </button>
              <button className={`btn sm ${ratingTab === 'mid' ? 'active' : ''}`} onClick={() => { setRatingTab('mid'); setPage(0); }}>
                ★3 ({midCount})
              </button>
              <button className={`btn sm ${ratingTab === 'hi' ? 'active' : ''}`} onClick={() => { setRatingTab('hi'); setPage(0); }}>
                ★4~5 ({hiCount})
              </button>
              <div className="row-flex gap-4" style={{ marginLeft: 'auto' }}>
                <button className="btn sm">최신순</button>
                <button className="btn brand sm"><IcDownload /> Excel</button>
              </div>
            </div>

            <section className="panel" style={{ padding: 0, overflow: 'hidden' }}>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} style={{ padding: '16px 16px', borderBottom: '0.5px solid var(--bs)' }}>
                    <div style={{ height: 12, background: 'var(--rai)', borderRadius: 3, marginBottom: 8, width: '40%' }} />
                    <div style={{ height: 12, background: 'var(--rai)', borderRadius: 3, width: '90%' }} />
                  </div>
                ))
              ) : rows.length === 0 ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>리뷰 없음</div>
              ) : rows.map((r, i) => (
                <div key={r.id} className={`review-row ${r.rating <= 2 ? 'flag' : ''}`}>
                  <div className="head">
                    <span className="mono dim" style={{ fontSize: 11 }}>{r.review_date}</span>
                    <span className={`mono ${r.rating <= 2 ? 'hs' : ''}`} style={{ fontWeight: 500, fontSize: 13 }}>★ {r.rating}</span>
                    <span className="chip" style={{ fontSize: 10, padding: '1px 6px', textTransform: 'none', letterSpacing: 0 }}>—</span>
                    <span style={{ marginLeft: 'auto' }} className="mono dim">도움 {r.helpful_count}</span>
                  </div>
                  <div className="text">{r.review_text ?? '(리뷰 내용 없음)'}</div>
                </div>
              ))}
              {rows.length > 0 && (
                <div className="row-flex between center" style={{ padding: '10px 14px', borderTop: '0.5px solid var(--bs)' }}>
                  <span className="mono dim" style={{ fontSize: 11 }}>
                    {`${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} / ${total.toLocaleString()}`}
                  </span>
                  <div className="row-flex gap-4">
                    <button className="btn sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>←</button>
                    <span className="mono dim" style={{ fontSize: 11 }}>{page + 1} / {Math.ceil(total / PAGE_SIZE) || 1}</span>
                    <button className="btn sm" onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= total}>→</button>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}
