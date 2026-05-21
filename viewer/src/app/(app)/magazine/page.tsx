'use client';
import React from 'react';
import { HBar } from '@/components/ui/charts';
import { IcDownload } from '@/components/ui/icons';
import { fetchMagazineArticles, fetchMagazineCategories, type MagazineRow } from '@/lib/queries';

export default function MagazinePage() {
  const [rows, setRows] = React.useState<MagazineRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [cats, setCats] = React.useState<string[]>([]);
  const [category, setCategory] = React.useState('all');
  const [page, setPage] = React.useState(0);
  const [sel, setSel] = React.useState(new Set<string>());
  const PAGE_SIZE = 50;

  React.useEffect(() => {
    fetchMagazineCategories().then(setCats).catch(console.error);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMagazineArticles({ category: category === 'all' ? undefined : category, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then(({ rows: r, total: t }) => {
        if (cancelled) return;
        setRows(r);
        setTotal(t);
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [category, page]);

  const toggle = (id: string) =>
    setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selectedRows = rows.filter(r => sel.has(r.id));

  const brandDist = selectedRows.reduce((acc, r) => {
    r.brand_names.forEach(b => { acc[b] = (acc[b] || 0) + 1; });
    return acc;
  }, {} as Record<string, number>);
  const topBrands = Object.entries(brandDist).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxBrand = Math.max(1, ...topBrands.map(([, c]) => c));

  const totalViews = selectedRows.reduce((s, r) => s + r.view_count, 0);
  const totalComments = selectedRows.reduce((s, r) => s + r.comment_count, 0);

  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  const fmtDate = (s: string) => s.slice(0, 10);

  return (
    <>
      <div className="page-title">
        <h1>매거진</h1>
        <span className="chip mono">{total.toLocaleString()}건 수집</span>
        <span className="sub">무신사 매거진 발행물 · 카테고리 필터</span>
      </div>

      <section className="panel" style={{ padding: 0 }}>
        <div className="row-flex between center" style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--bs)' }}>
          <div className="row-flex center gap-10">
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>마스터 그리드</h3>
            <span className="sec-tag">{loading ? '…' : `${total.toLocaleString()}건`} · 클릭해서 선택</span>
          </div>
          <div className="row-flex gap-4 center" style={{ flexWrap: 'wrap' }}>
            <button className={`btn sm ${category === 'all' ? 'active' : ''}`} onClick={() => { setCategory('all'); setPage(0); setSel(new Set()); }}>전체</button>
            {cats.map(c => (
              <button key={c} className={`btn sm ${category === c ? 'active' : ''}`} onClick={() => { setCategory(c); setPage(0); setSel(new Set()); }}>{c}</button>
            ))}
            <span style={{ width: 8 }} />
            <span className="mono dim" style={{ fontSize: 11 }}>· {sel.size} 선택</span>
          </div>
        </div>

        <div className="tbl" style={{ border: 'none', borderRadius: 0, maxHeight: 360, overflowY: 'auto' }}>
          <div className="row head" style={{ gridTemplateColumns: '32px 1fr 110px 100px 80px 60px 1fr' }}>
            <span></span><span>제목</span><span>카테고리</span><span>발행일</span>
            <span className="cell-r">조회</span><span className="cell-r">댓글</span><span>등장 브랜드</span>
          </div>

          {loading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="row" style={{ gridTemplateColumns: '32px 1fr 110px 100px 80px 60px 1fr' }}>
                {Array.from({ length: 7 }).map((_, j) => (
                  <span key={j} style={{ height: 14, background: 'var(--rai)', borderRadius: 3, display: 'block' }} />
                ))}
              </div>
            ))
          ) : rows.map((row, i) => {
            const on = sel.has(row.id);
            return (
              <div key={row.id}
                className={`row hover ${on ? '' : i % 2 ? 'alt' : ''}`}
                style={{ gridTemplateColumns: '32px 1fr 110px 100px 80px 60px 1fr', cursor: 'pointer', background: on ? 'var(--snk)' : undefined }}
                onClick={() => toggle(row.id)}>
                <span><div className={`checkbox ${on ? 'on' : ''}`} style={{ pointerEvents: 'none' }}>{on && '✓'}</div></span>
                <span style={{ fontWeight: on ? 500 : 400 }}>{row.title}</span>
                <span><span className="chip">{row.category ?? '—'}</span></span>
                <span className="mono dim">{fmtDate(row.published_at)}</span>
                <span className="mono muted cell-r">{fmt(row.view_count)}</span>
                <span className="mono muted cell-r">{row.comment_count}</span>
                <span style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {row.brand_names.slice(0, 3).map((b, j) => <span key={j} className="chip" style={{ fontSize: 9, padding: '1px 5px' }}>{b}</span>)}
                  {row.brand_names.length > 3 && <span className="mono dim" style={{ fontSize: 10 }}>+{row.brand_names.length - 3}</span>}
                </span>
              </div>
            );
          })}
        </div>

        {total > PAGE_SIZE && (
          <div className="row-flex between center" style={{ padding: '8px 14px', borderTop: '0.5px solid var(--bs)' }}>
            <span className="mono dim" style={{ fontSize: 11 }}>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} / {total.toLocaleString()}</span>
            <div className="row-flex gap-4">
              <button className="btn sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>←</button>
              <span className="mono dim" style={{ fontSize: 11 }}>{page + 1} / {Math.ceil(total / PAGE_SIZE)}</span>
              <button className="btn sm" onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= total}>→</button>
            </div>
          </div>
        )}
      </section>

      <div className="panel compact snk row-flex center gap-8" style={{ flexWrap: 'wrap' }}>
        <span className="sec-tag">selected</span>
        {sel.size === 0 ? (
          <span className="dim" style={{ fontSize: 12 }}>매거진을 선택하면 브랜드 분포가 나타납니다</span>
        ) : (
          <>
            <span className="chip lg">{sel.size}건 선택</span>
            <span className="mono dim" style={{ fontSize: 11 }}>등장 브랜드 {Object.keys(brandDist).length}종</span>
            <span className="mono dim" style={{ fontSize: 11 }}>조회 합계 {fmt(totalViews)}</span>
          </>
        )}
        <div className="row-flex gap-4" style={{ marginLeft: 'auto' }}>
          <button className="btn sm" onClick={() => setSel(new Set())}>선택 해제</button>
          <button className="btn sm"><IcDownload /> CSV</button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.5fr 1fr', gap: 14 }}>
        <section className="panel col-flex">
          <div className="sec-head">
            <h3>선택된 매거진 <span className="sub">{sel.size}건</span></h3>
          </div>
          {sel.size === 0 ? (
            <div className="col-flex center" style={{ padding: '40px 0', color: 'var(--f4)', alignItems: 'center', gap: 6 }}>
              <span className="mono" style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>no selection</span>
              <span style={{ fontSize: 12 }}>마스터에서 매거진을 선택해 보세요</span>
            </div>
          ) : (
            <div className="tbl flex-1">
              <div className="row head" style={{ gridTemplateColumns: '1fr 100px 80px 60px' }}>
                <span>제목</span><span>카테고리</span><span className="cell-r">조회</span><span className="cell-r">댓글</span>
              </div>
              {selectedRows.map((r, i) => (
                <div key={r.id} className={`row ${i % 2 ? 'alt' : ''}`}
                  style={{ gridTemplateColumns: '1fr 100px 80px 60px' }}>
                  <span style={{ fontWeight: 500 }}>{r.title}</span>
                  <span><span className="chip">{r.category ?? '—'}</span></span>
                  <span className="mono muted cell-r">{fmt(r.view_count)}</span>
                  <span className="mono muted cell-r">{r.comment_count}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="col-flex gap-12">
          <section className="panel">
            <div className="sec-head"><h3>등장 브랜드 분포 <span className="sub">{sel.size === 0 ? '—' : '선택 매거진'}</span></h3></div>
            {sel.size === 0 ? (
              <div style={{ color: 'var(--f4)', fontSize: 12 }}>선택 후 확인</div>
            ) : topBrands.length === 0 ? (
              <div style={{ color: 'var(--f4)', fontSize: 12 }}>브랜드 정보 없음</div>
            ) : topBrands.map(([brand, cnt], i) => (
              <div key={brand} className="row-flex center gap-8" style={{ padding: '4px 0' }}>
                <span style={{ flex: 1, fontSize: 12, color: 'var(--f2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{brand}</span>
                <HBar value={cnt} max={maxBrand} accent={i === 0} w={90} />
                <span className="mono dim" style={{ fontSize: 11, width: 22, textAlign: 'right' }}>{cnt}</span>
              </div>
            ))}
          </section>

          <section className="panel surface flex-1">
            <div className="sec-head"><h3>집계</h3></div>
            {sel.size === 0 ? (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--f4)' }}>매거진을 선택하면 집계가 나타납니다.</p>
            ) : (
              <div className="col-flex gap-8">
                {[
                  ['선택 매거진', `${sel.size}건`],
                  ['등장 브랜드', `${Object.keys(brandDist).length}종`],
                  ['총 조회수', fmt(totalViews)],
                  ['총 댓글', String(totalComments)],
                  ['평균 조회', fmt(Math.round(totalViews / sel.size))],
                ].map(([l, v], i) => (
                  <div key={i} className="row-flex between">
                    <span style={{ fontSize: 12, color: 'var(--f3)' }}>{l}</span>
                    <span className="mono" style={{ fontSize: 12, fontWeight: 500 }}>{v}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
