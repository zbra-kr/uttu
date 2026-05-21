'use client';
import React from 'react';
import { HBar } from '@/components/ui/charts';
import { IcDownload } from '@/components/ui/icons';
import { fetchSnaps, type SnapRow } from '@/lib/queries';

const GENDER_OPTS = [
  ['ALL', '전체'], ['WOMEN', '여성'], ['MEN', '남성'],
];

export default function SnapPage() {
  const [rows, setRows] = React.useState<SnapRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [gender, setGender] = React.useState('ALL');
  const [page, setPage] = React.useState(0);
  const [sel, setSel] = React.useState(new Set<string>());
  const PAGE_SIZE = 50;

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchSnaps({ gender: gender === 'ALL' ? undefined : gender, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then(({ rows: r, total: t }) => {
        if (cancelled) return;
        setRows(r);
        setTotal(t);
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [gender, page]);

  const toggle = (id: string) =>
    setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selectedRows = rows.filter(r => sel.has(r.id));
  const totalLikes = selectedRows.reduce((s, r) => s + r.like_count, 0);
  const totalViews = selectedRows.reduce((s, r) => s + r.view_count, 0);

  // 성별 분포 (선택된 스냅)
  const genderDist = selectedRows.reduce((acc, r) => {
    const g = r.model_gender ?? 'UNKNOWN';
    acc[g] = (acc[g] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const maxGender = Math.max(1, ...Object.values(genderDist));

  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  const fmtDate = (s: string) => s.slice(0, 10);

  return (
    <>
      <div className="page-title">
        <h1>스냅샷</h1>
        <span className="chip mono">{total.toLocaleString()}건 수집</span>
        <span className="sub">무신사 코디샵 스냅 · 성별·날짜 필터</span>
      </div>

      <section className="panel" style={{ padding: 0 }}>
        <div className="row-flex between center" style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--bs)' }}>
          <div className="row-flex center gap-10">
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>마스터 그리드</h3>
            <span className="sec-tag">{loading ? '…' : `${total.toLocaleString()}건`} · 클릭해서 선택</span>
          </div>
          <div className="row-flex gap-4 center">
            {GENDER_OPTS.map(([k, label]) => (
              <button key={k} className={`btn sm ${gender === k ? 'active' : ''}`} onClick={() => { setGender(k); setPage(0); setSel(new Set()); }}>{label}</button>
            ))}
            <span style={{ width: 8 }} />
            <span className="mono dim" style={{ fontSize: 11 }}>· {sel.size} 선택</span>
          </div>
        </div>

        <div className="tbl" style={{ border: 'none', borderRadius: 0, maxHeight: 360, overflowY: 'auto' }}>
          <div className="row head" style={{ gridTemplateColumns: '32px 160px 90px 90px 90px 80px 70px 60px' }}>
            <span></span><span>스냅 ID</span><span>유형</span><span>성별</span><span>등록일</span>
            <span className="cell-r">조회</span><span className="cell-r">♥</span><span className="cell-r">클릭</span>
          </div>

          {loading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="row" style={{ gridTemplateColumns: '32px 160px 90px 90px 90px 80px 70px 60px' }}>
                {Array.from({ length: 8 }).map((_, j) => (
                  <span key={j} style={{ height: 14, background: 'var(--rai)', borderRadius: 3, display: 'block' }} />
                ))}
              </div>
            ))
          ) : rows.map((row, i) => {
            const on = sel.has(row.id);
            const gLabel = row.model_gender === 'WOMEN' ? '여성' : row.model_gender === 'MEN' ? '남성' : '—';
            const typeLabel = row.content_type === 'CODISHOP_SNAP' ? '코디샵' : row.content_type === 'MUSINSA_SNAP' ? '무신사' : row.content_type;
            return (
              <div key={row.id}
                className={`row hover ${on ? '' : i % 2 ? 'alt' : ''}`}
                style={{ gridTemplateColumns: '32px 160px 90px 90px 90px 80px 70px 60px', cursor: 'pointer', background: on ? 'var(--snk)' : undefined }}
                onClick={() => toggle(row.id)}>
                <span><div className={`checkbox ${on ? 'on' : ''}`} style={{ pointerEvents: 'none' }}>{on && '✓'}</div></span>
                <span className="mono dim" style={{ fontSize: 11 }}>{row.snap_id.slice(-12)}</span>
                <span><span className="chip">{typeLabel}</span></span>
                <span className="mono dim" style={{ fontSize: 11 }}>{gLabel}</span>
                <span className="mono dim">{fmtDate(row.published_at)}</span>
                <span className="mono muted cell-r">{fmt(row.view_count)}</span>
                <span className="mono muted cell-r">{fmt(row.like_count)}</span>
                <span className="mono muted cell-r">{fmt(row.goods_click_count)}</span>
              </div>
            );
          })}
        </div>

        {/* 페이지네이션 */}
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

      {/* 선택 요약 바 */}
      <div className="panel compact snk row-flex center gap-8" style={{ flexWrap: 'wrap' }}>
        <span className="sec-tag">selected</span>
        {sel.size === 0 ? (
          <span className="dim" style={{ fontSize: 12 }}>스냅을 선택하면 집계가 나타납니다</span>
        ) : (
          <>
            <span className="chip lg">{sel.size}건 선택</span>
            <span className="mono dim" style={{ fontSize: 11 }}>조회 합계 {fmt(totalViews)}</span>
            <span className="mono dim" style={{ fontSize: 11 }}>좋아요 합계 {fmt(totalLikes)}</span>
          </>
        )}
        <div className="row-flex gap-4" style={{ marginLeft: 'auto' }}>
          <button className="btn sm" onClick={() => setSel(new Set())}>선택 해제</button>
          <button className="btn sm"><IcDownload /> CSV</button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.5fr 1fr', gap: 14 }}>
        {/* 선택 스냅 상세 */}
        <section className="panel col-flex">
          <div className="sec-head">
            <h3>선택된 스냅 상세 <span className="sub">{sel.size}건</span></h3>
          </div>
          {sel.size === 0 ? (
            <div className="col-flex center" style={{ padding: '40px 0', color: 'var(--f4)', alignItems: 'center', gap: 6 }}>
              <span className="mono" style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>no selection</span>
              <span style={{ fontSize: 12 }}>마스터에서 스냅을 선택해 보세요</span>
            </div>
          ) : (
            <div className="tbl flex-1">
              <div className="row head" style={{ gridTemplateColumns: '160px 80px 80px 70px 70px 60px' }}>
                <span>스냅 ID</span><span>성별</span><span>날짜</span>
                <span className="cell-r">조회</span><span className="cell-r">♥</span><span className="cell-r">클릭</span>
              </div>
              {selectedRows.map((r, i) => (
                <div key={r.id} className={`row ${i % 2 ? 'alt' : ''}`}
                  style={{ gridTemplateColumns: '160px 80px 80px 70px 70px 60px' }}>
                  <span className="mono dim" style={{ fontSize: 11 }}>{r.snap_id.slice(-12)}</span>
                  <span className="mono dim" style={{ fontSize: 11 }}>{r.model_gender === 'WOMEN' ? '여성' : r.model_gender === 'MEN' ? '남성' : '—'}</span>
                  <span className="mono dim">{fmtDate(r.published_at)}</span>
                  <span className="mono muted cell-r">{fmt(r.view_count)}</span>
                  <span className="mono muted cell-r">{fmt(r.like_count)}</span>
                  <span className="mono muted cell-r">{fmt(r.goods_click_count)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 사이드 패널 */}
        <div className="col-flex gap-12">
          <section className="panel">
            <div className="sec-head"><h3>성별 분포 <span className="sub">{sel.size === 0 ? '—' : '선택 스냅'}</span></h3></div>
            {sel.size === 0 ? (
              <div style={{ color: 'var(--f4)', fontSize: 12 }}>선택 후 확인</div>
            ) : Object.entries(genderDist).map(([g, cnt], i) => {
              const label = g === 'WOMEN' ? '여성' : g === 'MEN' ? '남성' : '미분류';
              return (
                <div key={g} className="row-flex center gap-8" style={{ padding: '4px 0' }}>
                  <span style={{ flex: 1, fontSize: 12, color: 'var(--f2)' }}>{label}</span>
                  <HBar value={cnt} max={maxGender} accent={i === 0} w={90} />
                  <span className="mono dim" style={{ fontSize: 11, width: 22, textAlign: 'right' }}>{cnt}</span>
                </div>
              );
            })}
          </section>

          <section className="panel surface flex-1">
            <div className="sec-head"><h3>집계</h3></div>
            {sel.size === 0 ? (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--f4)' }}>스냅을 선택하면 집계가 나타납니다.</p>
            ) : (
              <div className="col-flex gap-8">
                {[
                  ['선택 스냅', `${sel.size}건`],
                  ['총 조회수', fmt(totalViews)],
                  ['총 좋아요', fmt(totalLikes)],
                  ['평균 조회', fmt(Math.round(totalViews / sel.size))],
                  ['평균 좋아요', fmt(Math.round(totalLikes / sel.size))],
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
