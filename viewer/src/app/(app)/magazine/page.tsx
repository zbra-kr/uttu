'use client';
import React from 'react';
import { useIsMobile } from '@/hooks/useViewport';
import MobileMagazineView from './MobileMagazineView';
import { useSearchParams } from 'next/navigation';
import { IcArrowUR, IcX, IcPlus, IcChevL, IcChevR, IcSearch } from '@/components/ui/icons';
import { HBar } from '@/components/ui/charts';
import NoteDrawer from '@/components/me/NoteDrawer';
import {
  fetchMagazineArticles, fetchMagazineCategories, fetchMagazineProducts, fetchBrandIdsByNames,
  fetchMagazineBoostAnomalies, fetchMagazineArticleProductsForExport,
  type MagazineRow, type MagazineArticleProduct, type MagazineBoostAnomaly,
} from '@/lib/queries';
import { IcDownload } from '@/components/ui/icons';
import { fetchNoteCountForEntity } from '@/lib/queries-me';

const PAGE_SIZE = 50;
const MUSINSA_ARTICLE_URL = (articleId: string) =>
  `https://www.musinsa.com/app/contents/detail/${articleId}`;

// ── 드로어 ────────────────────────────────────────────────────────────────────
function MagazineDrawer({
  item, onClose, onPrev, onNext,
}: {
  item: MagazineRow;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const [noteOpen, setNoteOpen] = React.useState(false);
  const [noteCount, setNoteCount] = React.useState(0);
  const [products, setProducts] = React.useState<MagazineArticleProduct[]>([]);
  const [brandIds, setBrandIds] = React.useState<Record<string, string>>({});
  const [loadingProducts, setLoadingProducts] = React.useState(true);

  React.useEffect(() => {
    setNoteOpen(false);
    setProducts([]);
    setBrandIds({});
    setLoadingProducts(true);

    fetchNoteCountForEntity('magazine', item.id).then(setNoteCount);

    fetchMagazineProducts(item.article_id).then(async prods => {
      setProducts(prods);
      setLoadingProducts(false);
    });

    fetchBrandIdsByNames(item.brand_names).then(setBrandIds);
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer" style={{ width: 400 }}>
        <div className="drawer-head">
          <span className="chip">{item.category ?? '—'}</span>
          {item.sub_category && <span className="chip">{item.sub_category}</span>}
          <div className="flex-1" />
          <button className="btn icon sm" onClick={onClose}><IcX /></button>
        </div>

        <div className="drawer-body" style={{ overflowY: 'auto', flex: 1 }}>
          {item.thumbnail_url && (
            <div style={{ margin: '-4px -4px 14px', borderRadius: 6, overflow: 'hidden', maxHeight: 200 }}>
              <img
                src={item.thumbnail_url}
                alt={item.title}
                style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block' }}
              />
            </div>
          )}

          <h3 style={{ fontSize: 15, fontWeight: 600, lineHeight: '20px', margin: '0 0 6px' }}>
            {item.title}
          </h3>

          {item.summary && (
            <p style={{ fontSize: 12, color: 'var(--f3)', lineHeight: '18px', margin: '0 0 10px' }}>
              {item.summary}
            </p>
          )}

          <div className="row-flex gap-12" style={{ marginBottom: 12 }}>
            <span className="mono dim" style={{ fontSize: 11 }}>{item.published_at.slice(0, 10)}</span>
            <span className="mono dim" style={{ fontSize: 11 }}>조회 {fmt(item.view_count)}</span>
            <span className="mono dim" style={{ fontSize: 11 }}>댓글 {item.comment_count}</span>
            {item.landing_url && (
              <a href={item.landing_url} target="_blank" rel="noreferrer"
                style={{ fontSize: 11, color: 'var(--hs)', display: 'flex', alignItems: 'center', gap: 2, marginLeft: 'auto' }}>
                무신사 원문 <IcArrowUR size={10} />
              </a>
            )}
          </div>

          {item.brand_names.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div className="sec-tag" style={{ marginBottom: 6 }}>등장 브랜드</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {item.brand_names.map((b, i) => {
                  const bid = brandIds[b];
                  return bid ? (
                    <a key={i} href={`/brand?id=${bid}`}
                      className="chip"
                      style={{ textDecoration: 'none', fontSize: 11, cursor: 'pointer', color: 'var(--hs)' }}>
                      {b}
                    </a>
                  ) : (
                    <span key={i} className="chip" style={{ fontSize: 11 }}>{b}</span>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <div className="sec-tag" style={{ marginBottom: 6 }}>
              연결 상품 {loadingProducts ? '…' : `${products.length}건`}
            </div>
            {loadingProducts ? (
              <div className="dim" style={{ fontSize: 12 }}>로딩 중…</div>
            ) : products.length === 0 ? (
              <div className="dim" style={{ fontSize: 12 }}>연결 상품 없음</div>
            ) : (
              <div className="col-flex gap-4">
                {products.map((p, i) => (
                  <a key={i} href={`/product?no=${p.musinsa_no}`}
                    style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6,
                      padding: '5px 8px', borderRadius: 4, background: 'var(--snk)' }}>
                    {p.is_own && (
                      <span style={{ fontSize: 9, background: 'var(--hs)', color: '#fff',
                        padding: '1px 4px', borderRadius: 2, flexShrink: 0 }}>자사</span>
                    )}
                    <span style={{ fontSize: 12, color: 'var(--f2)', flex: 1, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    {p.brand_name && (
                      <span className="mono dim" style={{ fontSize: 10, flexShrink: 0 }}>{p.brand_name}</span>
                    )}
                    <IcArrowUR size={10} />
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="drawer-foot">
          <button className="btn sm icon" onClick={onPrev}><IcChevL /></button>
          <button className="btn sm icon" onClick={onNext}><IcChevR /></button>
          <div className="flex-1" />
          <button className="btn sm" onClick={() => setNoteOpen(true)} style={{ position: 'relative' }}>
            <IcPlus /> 메모
            {noteCount > 0 && (
              <span style={{
                position: 'absolute', top: -4, right: -4,
                minWidth: 14, height: 14, borderRadius: 7, padding: '0 3px',
                background: 'var(--hs)', color: 'var(--bg)',
                fontSize: 9, fontFamily: 'var(--mono)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                lineHeight: 1, pointerEvents: 'none',
              }}>{noteCount}</span>
            )}
          </button>
        </div>
      </aside>

      <NoteDrawer
        entity_type="magazine"
        entity_id={item.id}
        entity_label={item.title}
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        onCountChange={setNoteCount}
      />
    </>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────
function MagazinePage() {
  const params = useSearchParams();
  const jumpId = params.get('id') ?? '';

  const [rows, setRows] = React.useState<MagazineRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [cats, setCats] = React.useState<string[]>([]);
  const [category, setCategory] = React.useState('all');
  const [keyword, setKeyword] = React.useState('');
  const [kwInput, setKwInput] = React.useState('');
  const [dateFrom, setDateFrom] = React.useState('');
  const [dateTo, setDateTo] = React.useState('');
  const [sort, setSort] = React.useState<'published_at' | 'view_count' | 'comment_count'>('published_at');
  const [page, setPage] = React.useState(0);
  const [drawerIdx, setDrawerIdx] = React.useState<number | null>(null);
  const [sel, setSel] = React.useState(new Set<string>());

  // 랭킹 효과 분석
  const [boosts, setBoosts] = React.useState<MagazineBoostAnomaly[]>([]);
  const [boostTotal, setBoostTotal] = React.useState(0);
  const [boostSev, setBoostSev] = React.useState<string>('');
  const [ownOnly, setOwnOnly] = React.useState(false);
  const [boostLoading, setBoostLoading] = React.useState(true);

  React.useEffect(() => {
    fetchMagazineCategories().then(setCats).catch(console.error);
  }, []);

  React.useEffect(() => {
    setBoostLoading(true);
    const articleIds = sel.size > 0 ? rows.filter(r => sel.has(r.id)).map(r => r.article_id) : undefined;
    fetchMagazineBoostAnomalies({ limit: 200, severity: boostSev || undefined, ownOnly, articleIds })
      .then(({ rows: r, total }) => {
        setBoosts(r);
        setBoostTotal(articleIds ? r.length : total);
      })
      .catch(console.error)
      .finally(() => setBoostLoading(false));
  }, [boostSev, ownOnly, sel]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMagazineArticles({ category: category === 'all' ? undefined : category, keyword, dateFrom, dateTo, sort, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then(({ rows: r, total: t }) => {
        if (cancelled) return;
        setRows(r);
        setTotal(t);
        if (jumpId) {
          const idx = r.findIndex(row => row.id === jumpId);
          if (idx >= 0) setDrawerIdx(idx);
        } else {
          setDrawerIdx(null);
        }
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [category, keyword, dateFrom, dateTo, sort, page]);

  const toggle = (id: string) =>
    setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const openDrawer = (i: number) => { setDrawerIdx(i); };

  const selectedRows = rows.filter(r => sel.has(r.id));
  const n = selectedRows.length;

  // 기본 집계
  const totalViews    = selectedRows.reduce((s, r) => s + r.view_count, 0);
  const totalComments = selectedRows.reduce((s, r) => s + r.comment_count, 0);
  const avgViews      = n > 0 ? Math.round(totalViews / n) : 0;
  const avgComments   = n > 0 ? Math.round(totalComments / n) : 0;
  const maxViews      = n > 0 ? Math.max(...selectedRows.map(r => r.view_count)) : 0;

  // 기간 분석
  const dates = selectedRows.map(r => r.published_at.slice(0, 10)).sort();
  const dateFirst = dates[0] ?? '';
  const dateLast  = dates[dates.length - 1] ?? '';
  const spanDays  = dates.length >= 2
    ? Math.round((new Date(dateLast).getTime() - new Date(dateFirst).getTime()) / 86_400_000) + 1
    : 1;
  const perWeek = n > 0 && spanDays > 0 ? Math.round((n / spanDays) * 7 * 10) / 10 : 0;

  // 브랜드별 등장 횟수
  const brandCount: Record<string, number> = {};
  selectedRows.forEach(r => r.brand_names.forEach(b => { brandCount[b] = (brandCount[b] || 0) + 1; }));
  const topBrandsByCount = Object.entries(brandCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // 브랜드별 조회수 합산 (노출 지표)
  const brandViews: Record<string, number> = {};
  selectedRows.forEach(r => r.brand_names.forEach(b => { brandViews[b] = (brandViews[b] || 0) + r.view_count; }));
  const topBrandsByViews = Object.entries(brandViews).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // 카테고리 분포
  const catDist: Record<string, number> = {};
  selectedRows.forEach(r => { const c = r.category ?? '기타'; catDist[c] = (catDist[c] || 0) + 1; });
  const topCats = Object.entries(catDist).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Top 기사
  const topByViews    = [...selectedRows].sort((a, b) => b.view_count - a.view_count).slice(0, 3);
  const topByComments = [...selectedRows].sort((a, b) => b.comment_count - a.comment_count).slice(0, 3);

  const maxBrandCount = Math.max(1, ...topBrandsByCount.map(([, c]) => c));
  const maxBrandViews = Math.max(1, ...topBrandsByViews.map(([, v]) => v));

  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

  const [exporting, setExporting] = React.useState(false);

  const downloadProductsCsv = async () => {
    if (!sel.size || exporting) return;
    setExporting(true);
    try {
      const articleIds = selectedRows.map(r => r.article_id);
      const data = await fetchMagazineArticleProductsForExport(articleIds);

      const header = ['기사ID', '기사제목', '발행일', '기사조회수', '무신사번호', '상품명', '브랜드', '자사여부', '현재순위'];
      const csvRows = data.map(r => [
        r.article_id,
        `"${r.article_title.replace(/"/g, '""')}"`,
        r.published_at,
        r.view_count,
        r.musinsa_no,
        `"${r.product_name.replace(/"/g, '""')}"`,
        `"${(r.brand_name ?? '').replace(/"/g, '""')}"`,
        r.is_own ? 'Y' : 'N',
        r.rank_position ?? '',
      ].join(','));

      const csv = '﻿' + [header.join(','), ...csvRows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `magazine_products_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const downloadArticlesCsv = () => {
    if (!sel.size) return;
    const header = ['기사ID', '기사제목', '카테고리', '발행일', '조회수', '댓글수', '등장브랜드'];
    const csvRows = selectedRows.map(r => [
      r.article_id,
      `"${r.title.replace(/"/g, '""')}"`,
      `"${(r.category ?? '').replace(/"/g, '""')}"`,
      r.published_at.slice(0, 10),
      r.view_count,
      r.comment_count,
      `"${r.brand_names.join(', ').replace(/"/g, '""')}"`,
    ].join(','));

    const csv = '﻿' + [header.join(','), ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `magazine_articles_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetFilters = () => {
    setCategory('all'); setKeyword(''); setKwInput(''); setDateFrom(''); setDateTo('');
    setSort('published_at'); setPage(0); setSel(new Set());
  };

  return (
    <>
      {drawerIdx !== null && rows[drawerIdx] && (
        <MagazineDrawer
          item={rows[drawerIdx]}
          onClose={() => setDrawerIdx(null)}
          onPrev={() => setDrawerIdx(i => Math.max(0, (i ?? 0) - 1))}
          onNext={() => setDrawerIdx(i => Math.min(rows.length - 1, (i ?? 0) + 1))}
        />
      )}

      <div className="page-title">
        <h1>매거진</h1>
        <span className="chip mono">{total.toLocaleString()}건 수집</span>
        <span className="sub">무신사 매거진 발행물 · 클릭해서 상세/메모</span>
      </div>

      {/* 필터 바 */}
      <section className="panel compact" style={{ padding: '10px 14px' }}>
        <div className="row-flex gap-8 center" style={{ flexWrap: 'wrap' }}>
          {/* 검색 */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <IcSearch style={{ position: 'absolute', left: 8, color: 'var(--f4)', pointerEvents: 'none' }} size={13} />
            <input
              value={kwInput}
              onChange={e => setKwInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { setKeyword(kwInput); setPage(0); } }}
              placeholder="제목 검색…"
              style={{ paddingLeft: 26, paddingRight: 8, height: 28, fontSize: 12,
                background: 'var(--snk)', border: '0.5px solid var(--bs)', borderRadius: 4,
                color: 'var(--f1)', width: 180 }}
            />
          </div>

          {/* 날짜 범위 */}
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0); }}
            style={{ height: 28, fontSize: 11, background: 'var(--snk)', border: '0.5px solid var(--bs)',
              borderRadius: 4, padding: '0 6px', color: 'var(--f2)' }} />
          <span className="mono dim" style={{ fontSize: 11 }}>~</span>
          <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0); }}
            style={{ height: 28, fontSize: 11, background: 'var(--snk)', border: '0.5px solid var(--bs)',
              borderRadius: 4, padding: '0 6px', color: 'var(--f2)' }} />

          {/* 정렬 */}
          <select value={sort} onChange={e => { setSort(e.target.value as typeof sort); setPage(0); }}
            style={{ height: 28, fontSize: 11, background: 'var(--snk)', border: '0.5px solid var(--bs)',
              borderRadius: 4, padding: '0 6px', color: 'var(--f2)' }}>
            <option value="published_at">최신순</option>
            <option value="view_count">조회수순</option>
            <option value="comment_count">댓글순</option>
          </select>

          {(keyword || dateFrom || dateTo || sort !== 'published_at' || category !== 'all') && (
            <button className="btn sm" onClick={resetFilters}>초기화</button>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className={`btn sm ${category === 'all' ? 'active' : ''}`}
              onClick={() => { setCategory('all'); setPage(0); setSel(new Set()); }}>전체</button>
            {cats.map(c => (
              <button key={c} className={`btn sm ${category === c ? 'active' : ''}`}
                onClick={() => { setCategory(c); setPage(0); setSel(new Set()); }}>{c}</button>
            ))}
          </div>
        </div>
      </section>

      {/* 마스터 그리드 */}
      <section className="panel" style={{ padding: 0 }}>
        <div className="row-flex between center" style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--bs)' }}>
          <div className="row-flex center gap-8">
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>마스터 그리드</h3>
            <span className="sec-tag">{loading ? '…' : `${total.toLocaleString()}건`}</span>
            {sel.size > 0 && <span className="mono dim" style={{ fontSize: 11 }}>· {sel.size} 선택</span>}
          </div>
          <div className="row-flex gap-4 center">
            {sel.size > 0 && (
              <button className="btn sm" onClick={() => setSel(new Set())}>선택 해제</button>
            )}
          </div>
        </div>

        <div className="tbl" style={{ border: 'none', borderRadius: 0, maxHeight: 400, overflowY: 'auto' }}>
          <div className="row head" style={{ gridTemplateColumns: '32px 44px 1fr 100px 100px 70px 50px 1fr' }}>
            <span></span>
            <span></span>
            <span>제목</span>
            <span>카테고리</span>
            <span>발행일</span>
            <span className="cell-r">조회</span>
            <span className="cell-r">댓글</span>
            <span>등장 브랜드</span>
          </div>

          {loading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="row" style={{ gridTemplateColumns: '32px 44px 1fr 100px 100px 70px 50px 1fr' }}>
                {Array.from({ length: 8 }).map((_, j) => (
                  <span key={j} style={{ height: 14, background: 'var(--rai)', borderRadius: 3, display: 'block' }} />
                ))}
              </div>
            ))
          ) : rows.map((row, i) => {
            const on = sel.has(row.id);
            return (
              <div key={row.id}
                className={`row hover ${on ? '' : i % 2 ? 'alt' : ''}`}
                style={{ gridTemplateColumns: '32px 44px 1fr 100px 100px 70px 50px 1fr', cursor: 'pointer',
                  background: on ? 'var(--snk)' : undefined }}
                onClick={() => openDrawer(i)}>
                <span onClick={e => { e.stopPropagation(); toggle(row.id); }}>
                  <div className={`checkbox ${on ? 'on' : ''}`} style={{ pointerEvents: 'none' }}>{on && '✓'}</div>
                </span>
                <span style={{ padding: '2px 0' }}>
                  {row.thumbnail_url ? (
                    <img src={row.thumbnail_url} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 3, display: 'block' }} />
                  ) : (
                    <div style={{ width: 36, height: 36, borderRadius: 3, background: 'var(--rai)' }} />
                  )}
                </span>
                <span style={{ fontWeight: on ? 500 : 400 }}>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.title}</span>
                  {row.summary && (
                    <span className="dim" style={{ fontSize: 10, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.summary}</span>
                  )}
                </span>
                <span><span className="chip" style={{ fontSize: 10 }}>{row.category ?? '—'}</span></span>
                <span className="mono dim">{row.published_at.slice(0, 10)}</span>
                <span className="mono muted cell-r">{fmt(row.view_count)}</span>
                <span className="mono muted cell-r">{row.comment_count}</span>
                <span style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {row.brand_names.slice(0, 3).map((b, j) => (
                    <span key={j} className="chip" style={{ fontSize: 9, padding: '1px 5px' }}>{b}</span>
                  ))}
                  {row.brand_names.length > 3 && (
                    <span className="mono dim" style={{ fontSize: 10 }}>+{row.brand_names.length - 3}</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        {total > PAGE_SIZE && (
          <div className="row-flex between center" style={{ padding: '8px 14px', borderTop: '0.5px solid var(--bs)' }}>
            <span className="mono dim" style={{ fontSize: 11 }}>
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} / {total.toLocaleString()}
            </span>
            <div className="row-flex gap-4">
              <button className="btn sm icon" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}><IcChevL /></button>
              <span className="mono dim" style={{ fontSize: 11 }}>{page + 1} / {Math.ceil(total / PAGE_SIZE)}</span>
              <button className="btn sm icon" onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= total}><IcChevR /></button>
            </div>
          </div>
        )}
      </section>

      {/* 분석 패널 — 항상 표시, 선택 없으면 안내 */}
      <div className="grid" style={{ gridTemplateColumns: '1.6fr 1fr', gap: 14 }}>

        {/* 왼쪽: 선택 목록 */}
        <section className="panel col-flex" style={{ minHeight: 220 }}>
          <div className="sec-head">
            <h3>선택된 매거진 <span className="sub">{n > 0 ? `${n}건` : '—'}</span></h3>
            {n > 0 && (
              <div className="row-flex gap-4" style={{ marginLeft: 'auto' }}>
                <button className="btn sm" onClick={downloadArticlesCsv} title="기사 목록 CSV">
                  <IcDownload /> 기사
                </button>
                <button className="btn sm" onClick={downloadProductsCsv} disabled={exporting} title="연결 상품 CSV">
                  <IcDownload /> {exporting ? '…' : '상품'}
                </button>
                <button className="btn sm" onClick={() => setSel(new Set())}>해제</button>
              </div>
            )}
          </div>
          {n === 0 ? (
            <div className="col-flex center" style={{ flex: 1, padding: '32px 0', alignItems: 'center', gap: 4, color: 'var(--f4)' }}>
              <span className="mono" style={{ fontSize: 10, letterSpacing: '0.08em' }}>NO SELECTION</span>
              <span style={{ fontSize: 12 }}>체크박스를 클릭해 기사를 선택하세요</span>
            </div>
          ) : (
            <div className="tbl flex-1">
              <div className="row head" style={{ gridTemplateColumns: '1fr 80px 70px 50px' }}>
                <span>제목</span><span>카테고리</span><span className="cell-r">조회</span><span className="cell-r">댓글</span>
              </div>
              {selectedRows.map((r, i) => (
                <div key={r.id} className={`row hover ${i % 2 ? 'alt' : ''}`}
                  style={{ gridTemplateColumns: '1fr 80px 70px 50px', cursor: 'pointer' }}
                  onClick={() => { const idx = rows.indexOf(r); if (idx >= 0) openDrawer(idx); }}>
                  <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                  <span><span className="chip" style={{ fontSize: 10 }}>{r.category ?? '—'}</span></span>
                  <span className="mono muted cell-r">{fmt(r.view_count)}</span>
                  <span className="mono muted cell-r">{r.comment_count}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 오른쪽: 지표 패널 스택 */}
        <div className="col-flex gap-12">

          {/* KPI 카드 */}
          <section className="panel">
            <div className="sec-head"><h3>핵심 지표</h3></div>
            {n === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--f4)', margin: 0 }}>기사를 선택하면 지표가 표시됩니다.</p>
            ) : (
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[
                  ['기사 수', `${n}건`, ''],
                  ['총 조회', fmt(totalViews), ''],
                  ['총 댓글', String(totalComments), ''],
                  ['평균 조회', fmt(avgViews), ''],
                  ['평균 댓글', String(avgComments), ''],
                  ['최고 조회', fmt(maxViews), ''],
                  ['기간', dateFirst === dateLast ? dateFirst : `${dateFirst} ~ ${dateLast}`, ''],
                  ['분석 기간', `${spanDays}일`, ''],
                  ['주당 발행', `${perWeek}건`, ''],
                  ['브랜드 종', `${Object.keys(brandCount).length}종`, ''],
                  ['카테고리', `${Object.keys(catDist).length}종`, ''],
                  ['브랜드×조회', fmt(totalViews > 0 ? Math.round(totalViews / Math.max(1, Object.keys(brandCount).length)) : 0), '평균'],
                ].map(([l, v, s], i) => (
                  <div key={i} style={{ background: 'var(--snk)', borderRadius: 6, padding: '8px 10px' }}>
                    <div style={{ fontSize: 10, color: 'var(--f4)', marginBottom: 2 }}>{l}</div>
                    <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)' }}>
                      {v}{s && <span style={{ fontSize: 10, color: 'var(--f4)', marginLeft: 2 }}>{s}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 브랜드 등장 횟수 */}
          <section className="panel">
            <div className="sec-head"><h3>브랜드 등장 <span className="sub">횟수 기준 TOP5</span></h3></div>
            {topBrandsByCount.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--f4)', margin: 0 }}>선택 후 확인</p>
            ) : topBrandsByCount.map(([brand, cnt], i) => (
              <div key={brand} className="row-flex center gap-8" style={{ padding: '4px 0' }}>
                <span style={{ flex: 1, fontSize: 12, color: 'var(--f2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{brand}</span>
                <HBar value={cnt} max={maxBrandCount} accent={i === 0} w={80} />
                <span className="mono dim" style={{ fontSize: 11, width: 24, textAlign: 'right' }}>{cnt}</span>
              </div>
            ))}
          </section>

          {/* 브랜드 노출 조회수 합산 */}
          <section className="panel">
            <div className="sec-head"><h3>브랜드 노출 <span className="sub">조회수 합산 TOP5</span></h3></div>
            {topBrandsByViews.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--f4)', margin: 0 }}>선택 후 확인</p>
            ) : topBrandsByViews.map(([brand, views], i) => (
              <div key={brand} className="row-flex center gap-8" style={{ padding: '4px 0' }}>
                <span style={{ flex: 1, fontSize: 12, color: 'var(--f2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{brand}</span>
                <HBar value={views} max={maxBrandViews} accent={i === 0} w={80} />
                <span className="mono dim" style={{ fontSize: 11, width: 32, textAlign: 'right' }}>{fmt(views)}</span>
              </div>
            ))}
          </section>

          {/* 카테고리 분포 */}
          <section className="panel">
            <div className="sec-head"><h3>카테고리 분포</h3></div>
            {topCats.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--f4)', margin: 0 }}>선택 후 확인</p>
            ) : topCats.map(([cat, cnt], i) => (
              <div key={cat} className="row-flex center gap-8" style={{ padding: '4px 0' }}>
                <span style={{ flex: 1, fontSize: 12, color: 'var(--f2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat}</span>
                <HBar value={cnt} max={Math.max(1, topCats[0][1])} accent={i === 0} w={80} />
                <span className="mono dim" style={{ fontSize: 11, width: 24, textAlign: 'right' }}>{cnt}</span>
              </div>
            ))}
          </section>
        </div>
      </div>

      {/* Top 기사 — 선택 시 */}
      {n > 0 && (
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <section className="panel">
            <div className="sec-head"><h3>조회수 Top <span className="sub">선택 중</span></h3></div>
            {topByViews.map((r, i) => (
              <div key={r.id} className="row-flex center gap-8" style={{ padding: '5px 0', borderBottom: i < 2 ? '0.5px solid var(--bs)' : undefined, cursor: 'pointer' }}
                onClick={() => { const idx = rows.indexOf(r); if (idx >= 0) openDrawer(idx); }}>
                <span className="mono" style={{ fontSize: 11, color: 'var(--f4)', width: 14 }}>{i + 1}</span>
                {r.thumbnail_url && <img src={r.thumbnail_url} alt="" style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} />}
                <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--hs)', flexShrink: 0 }}>{fmt(r.view_count)}</span>
              </div>
            ))}
          </section>

          <section className="panel">
            <div className="sec-head"><h3>댓글 Top <span className="sub">선택 중</span></h3></div>
            {topByComments.map((r, i) => (
              <div key={r.id} className="row-flex center gap-8" style={{ padding: '5px 0', borderBottom: i < 2 ? '0.5px solid var(--bs)' : undefined, cursor: 'pointer' }}
                onClick={() => { const idx = rows.indexOf(r); if (idx >= 0) openDrawer(idx); }}>
                <span className="mono" style={{ fontSize: 11, color: 'var(--f4)', width: 14 }}>{i + 1}</span>
                {r.thumbnail_url && <img src={r.thumbnail_url} alt="" style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} />}
                <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--hs)', flexShrink: 0 }}>{r.comment_count}</span>
              </div>
            ))}
          </section>
        </div>
      )}

      {/* 랭킹 효과 분석 */}
      <section className="panel" style={{ padding: 0 }}>
        <div className="row-flex between center" style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--bs)' }}>
          <div className="row-flex center gap-8">
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>매거진 → 랭킹 효과</h3>
            <span className="sec-tag">
              {boostLoading ? '…' : `${boostTotal}건 탐지`} · 발행 후 3일 이내 순위 변동
            </span>
            {sel.size > 0 && (
              <span style={{ fontSize: 11, color: 'var(--hs)', fontWeight: 500 }}>
                선택된 {sel.size}개 기사 기준
              </span>
            )}
          </div>
          <div className="row-flex gap-4 center">
            {(['', 'high', 'medium', 'low'] as const).map(s => (
              <button key={s} className={`btn sm ${boostSev === s ? 'active' : ''}`}
                onClick={() => setBoostSev(s)}>
                {s === '' ? '전체' : s === 'high' ? 'HIGH' : s === 'medium' ? 'MED' : 'LOW'}
              </button>
            ))}
            <button className={`btn sm ${ownOnly ? 'active' : ''}`} onClick={() => setOwnOnly(v => !v)}>
              자사만
            </button>
          </div>
        </div>

        <div className="tbl" style={{ border: 'none', borderRadius: 0, maxHeight: 380, overflowY: 'auto' }}>
          <div className="row head" style={{ gridTemplateColumns: '60px 50px 1fr 1fr 90px 90px 80px' }}>
            <span>날짜</span>
            <span>등급</span>
            <span>상품</span>
            <span>기사</span>
            <span className="cell-r">발행 전</span>
            <span className="cell-r">발행 후</span>
            <span className="cell-r">기사 조회</span>
          </div>

          {boostLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="row" style={{ gridTemplateColumns: '60px 50px 1fr 1fr 90px 90px 80px' }}>
                {Array.from({ length: 7 }).map((_, j) => (
                  <span key={j} style={{ height: 14, background: 'var(--rai)', borderRadius: 3, display: 'block' }} />
                ))}
              </div>
            ))
          ) : boosts.length === 0 ? (
            <div style={{ padding: '24px 14px', fontSize: 12, color: 'var(--f4)' }}>
              탐지된 랭킹 효과 없음
            </div>
          ) : boosts.map((b, i) => {
            const rankBefore = b.meta?.rank_before;
            const rankAfter  = b.meta?.rank_after;
            const isNew      = b.anomaly_type === 'magazine_rank_new_entry';
            const sevColor   = b.severity === 'high' ? 'var(--dn)' : b.severity === 'medium' ? 'var(--warn, #f0a500)' : 'var(--f3)';
            const productHref  = b.meta?.musinsa_no ? `/product?no=${b.meta.musinsa_no}` : null;
            const magazineHref = b.meta?.magazine_article_uuid ? `/magazine?id=${b.meta.magazine_article_uuid}` : null;
            return (
              <div key={b.id} className={`row ${i % 2 ? 'alt' : ''}`}
                style={{ gridTemplateColumns: '60px 50px 1fr 1fr 90px 90px 80px' }}>
                <span className="mono dim" style={{ fontSize: 10 }}>{b.detection_date}</span>
                <span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: sevColor,
                    background: `${sevColor}18`, padding: '1px 5px', borderRadius: 3 }}>
                    {b.severity.toUpperCase()}
                  </span>
                </span>
                {/* 상품 링크 */}
                <span style={{ overflow: 'hidden' }}>
                  {productHref ? (
                    <a href={productHref} style={{ textDecoration: 'none', color: 'inherit',
                      display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
                      {b.meta?.is_own && (
                        <span style={{ fontSize: 9, background: 'var(--hs)', color: '#fff',
                          padding: '1px 4px', borderRadius: 2, flexShrink: 0 }}>자사</span>
                      )}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        color: 'var(--hs)' }}>
                        {b.entity_name ?? '—'}
                      </span>
                      <IcArrowUR size={10} style={{ flexShrink: 0, color: 'var(--f4)' }} />
                    </a>
                  ) : (
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                      {b.meta?.is_own && (
                        <span style={{ fontSize: 9, background: 'var(--hs)', color: '#fff',
                          padding: '1px 4px', borderRadius: 2, marginRight: 4 }}>자사</span>
                      )}
                      {b.entity_name ?? '—'}
                    </span>
                  )}
                </span>
                {/* 기사 링크 */}
                <span style={{ overflow: 'hidden' }}>
                  {magazineHref ? (
                    <a href={magazineHref} style={{ textDecoration: 'none', display: 'flex',
                      alignItems: 'center', gap: 3, overflow: 'hidden' }}>
                      <span style={{ fontSize: 11, color: 'var(--f3)', overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {b.meta?.article_title ?? '—'}
                      </span>
                      <IcArrowUR size={10} style={{ flexShrink: 0, color: 'var(--f4)' }} />
                    </a>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--f3)', overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                      {b.meta?.article_title ?? '—'}
                    </span>
                  )}
                </span>
                <span className="mono cell-r" style={{ fontSize: 12, color: 'var(--f4)' }}>
                  {isNew ? '랭킹 외' : rankBefore != null ? `${rankBefore}위` : '—'}
                </span>
                <span className="mono cell-r" style={{ fontSize: 12, fontWeight: 600,
                  color: rankAfter != null && rankAfter <= 30 ? 'var(--dn)' : 'var(--up)' }}>
                  {rankAfter != null ? `${rankAfter}위` : '—'}
                  {!isNew && b.meta?.rank_delta != null && (
                    <span style={{ fontSize: 10, color: 'var(--up)', marginLeft: 3 }}>↑{b.meta.rank_delta}</span>
                  )}
                </span>
                <span className="mono muted cell-r" style={{ fontSize: 11 }}>
                  {fmt(b.meta?.article_views ?? 0)}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

function MagazineRootInner() {
  const isMobile = useIsMobile();
  if (isMobile) return <MobileMagazineView />;
  return (
    <React.Suspense>
      <MagazinePage />
    </React.Suspense>
  );
}

export default function MagazinePageRoot() {
  return (
    <React.Suspense>
      <MagazineRootInner />
    </React.Suspense>
  );
}
