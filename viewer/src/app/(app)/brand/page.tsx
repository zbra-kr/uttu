'use client';
import React from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import { Line, HorizBars, VertBars } from '@/components/ui/charts';
import { IcBookmark, IcBrand } from '@/components/ui/icons';
import Link from 'next/link';
import {
  searchBrands,
  fetchBrandInfo,
  fetchBrandStats,
  fetchBrandProducts,
  fetchBrandRankHistory,
  fetchBrandRankingDistribution,
  CATEGORY_MAP, AGE_MAP,
  type BrandInfo,
  type BrandStats,
  type BrandProduct,
  type BrandRankDay,
  type BrandDistRow,
} from '@/lib/queries';

const GENDER_LABEL: Record<string, string> = { A: '공용', M: '남성', F: '여성' };
const GENDER_ALL = [['A', '공용'], ['M', '남성'], ['F', '여성']];
const AGE_OPTIONS = [
  ['AGE_BAND_ALL', '전체'],
  ['AGE_BAND_MINOR', '20미만'],
  ['AGE_BAND_20', '20~25'],
  ['AGE_BAND_25', '25~30'],
  ['AGE_BAND_30', '30~35'],
  ['AGE_BAND_35', '35~40'],
  ['AGE_BAND_40', '40이상'],
];

function BrandSearch({ onSelect }: { onSelect: (id: string) => void }) {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<{ id: string; name: string; slug: string; company_name?: string | null }[]>([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(-1);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = (kw: string) => {
    if (!kw.trim()) { setResults([]); setOpen(false); return; }
    setLoading(true);
    searchBrands(kw, 15).then(r => { setResults(r); setOpen(r.length > 0); setActiveIdx(-1); }).finally(() => setLoading(false));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value; setQuery(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(v), 300);
  };

  const pick = (r: { id: string; name: string }) => { setQuery(''); setResults([]); setOpen(false); onSelect(r.id); };

  return (
    <div style={{ position: 'relative' }}>
      <div className="row-flex center gap-4" style={{ background: 'var(--snk)', border: '1px solid var(--bd)', borderRadius: 4, padding: '3px 8px', width: 220 }}>
        <span className="mono dim" style={{ fontSize: 11, flexShrink: 0 }}>{loading ? '…' : '⌕'}</span>
        <input value={query} onChange={handleChange}
          onKeyDown={e => {
            if (!open) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter' && activeIdx >= 0) pick(results[activeIdx]);
            else if (e.key === 'Escape') setOpen(false);
          }}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="브랜드명 · 회사명"
          style={{ background: 'none', border: 'none', outline: 'none', fontSize: 11, width: '100%', color: 'var(--f1)' }}
        />
      </div>
      {open && (
        <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, width: 260, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 100, maxHeight: 280, overflowY: 'auto' }}>
          {results.map((r, i) => (
            <div key={r.id} onMouseDown={() => pick(r)}
              style={{ padding: '7px 12px', cursor: 'pointer', background: i === activeIdx ? 'var(--snk)' : 'transparent', borderBottom: '1px solid var(--snk)' }}>
              <div style={{ fontSize: 12, color: 'var(--f1)' }}>{r.name}</div>
              <div className="mono dim" style={{ fontSize: 10 }}>{[r.slug, r.company_name].filter(Boolean).join(' · ')}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BrandPortal({ onSelect }: { onSelect: (id: string) => void }) {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<{ id: string; name: string; slug: string; company_name?: string | null }[]>([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(-1);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = (kw: string) => {
    if (!kw.trim()) { setResults([]); setOpen(false); return; }
    setLoading(true);
    searchBrands(kw, 15).then(r => { setResults(r); setOpen(r.length > 0); setActiveIdx(-1); }).finally(() => setLoading(false));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value; setQuery(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(v), 300);
  };

  const handleSelect = (r: { id: string; name: string }) => {
    setQuery(''); setResults([]); setOpen(false); onSelect(r.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && activeIdx >= 0) handleSelect(results[activeIdx]);
    else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '68vh', gap: 0 }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <IcBrand size={20} style={{ color: 'var(--f3)' }} />
          <span style={{ fontSize: 20, fontWeight: 600, color: 'var(--f1)', letterSpacing: '-0.03em' }}>브랜드 조회</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--f4)' }}>
          브랜드명 또는 소속 회사명으로 검색할 수 있습니다
        </div>
      </div>

      <div style={{ width: 520, position: 'relative' }}>
        <div style={{
          position: 'relative',
          background: 'var(--sur)', border: '1.5px solid var(--bd)',
          borderRadius: 28, padding: '12px 20px',
          boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        }}>
          <span style={{
            position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)',
            fontSize: 16, color: loading ? 'var(--hs)' : 'var(--f4)', pointerEvents: 'none',
          }}>⌕</span>
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => results.length > 0 && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="브랜드명 · 회사명"
            style={{ background: 'none', border: 'none', outline: 'none', fontSize: 14, width: '100%', color: 'var(--f1)', textAlign: 'center' }}
          />
        </div>
        {open && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 8,
            background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 100,
            maxHeight: 380, overflowY: 'auto',
          }}>
            {results.map((r, i) => (
              <div
                key={r.id}
                onMouseDown={() => handleSelect(r)}
                style={{
                  padding: '9px 16px', cursor: 'pointer',
                  background: i === activeIdx ? 'var(--snk)' : 'transparent',
                  borderBottom: '1px solid var(--snk)',
                }}
              >
                <div style={{ fontSize: 13, color: 'var(--f1)', fontWeight: 500 }}>{r.name}</div>
                <div className="mono dim" style={{ fontSize: 10, marginTop: 2 }}>{[r.slug, r.company_name].filter(Boolean).join(' · ')}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 16, marginTop: 16, alignItems: 'center' }}>
        <span className="mono" style={{ fontSize: 10, color: 'var(--f4)' }}>↑↓ 선택</span>
        <span style={{ width: 1, height: 10, background: 'var(--bs)' }} />
        <span className="mono" style={{ fontSize: 10, color: 'var(--f4)' }}>Enter 이동</span>
        <span style={{ width: 1, height: 10, background: 'var(--bs)' }} />
        <span className="mono" style={{ fontSize: 10, color: 'var(--f4)' }}>Esc 닫기</span>
      </div>
    </div>
  );
}

export default function BrandPage() {
  return (
    <Suspense fallback={<div style={{ padding: '80px 20px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>로딩 중…</div>}>
      <BrandPageInner />
    </Suspense>
  );
}

function BrandPageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const idFromUrl = params.get('id') ?? '';

  const [selectedId, setSelectedId] = React.useState(idFromUrl);
  const [info, setInfo] = React.useState<BrandInfo | null>(null);
  const [stats, setStats] = React.useState<BrandStats | null>(null);
  const [products, setProducts] = React.useState<BrandProduct[]>([]);
  const [rankHistory, setRankHistory] = React.useState<BrandRankDay[]>([]);
  const [distribution, setDistribution] = React.useState<BrandDistRow[]>([]);
  const [loading, setLoading] = React.useState(!!idFromUrl);

  // 분포 필터
  const [distGender, setDistGender] = React.useState('');
  const [distAge, setDistAge] = React.useState('');

  React.useEffect(() => {
    if (!idFromUrl) {
      window.dispatchEvent(new CustomEvent('uttu:brand-crumb', { detail: { company: '', name: '' } }));
    }
  }, [idFromUrl]);

  React.useEffect(() => { if (idFromUrl) setSelectedId(idFromUrl); }, [idFromUrl]);

  React.useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    fetchBrandInfo(selectedId).then(async bi => {
      setInfo(bi);
      if (!bi) { setLoading(false); return; }
      window.dispatchEvent(new CustomEvent('uttu:brand-crumb', { detail: { company: bi.company_name ?? '', name: bi.name } }));
      const [st, prods, rh, dist] = await Promise.all([
        fetchBrandStats(bi.name),
        fetchBrandProducts(bi.name, 100),
        fetchBrandRankHistory(bi.name),
        fetchBrandRankingDistribution(bi.name),
      ]);
      setStats(st); setProducts(prods); setRankHistory(rh); setDistribution(dist);
      setLoading(false);
    }).catch(e => { console.error(e); setLoading(false); });
  }, [selectedId]);

  const handleBrandSelect = (id: string) => { setSelectedId(id); router.push(`/brand?id=${id}`); };
  const brandName = info?.name ?? '—';

  // ── KPI 계산 ────────────────────────────────────────────────
  const withDiscount = products.filter(p => p.discount_rate && p.discount_rate > 0);
  const avgDiscount = withDiscount.length > 0
    ? Math.round(withDiscount.reduce((s, p) => s + (p.discount_rate ?? 0), 0) / withDiscount.length)
    : null;

  // 성별 분포 (distribution 기반, 전체 콤보)
  const genderMap: Record<string, number> = { M: 0, F: 0, A: 0 };
  distribution.forEach(d => { if (d.gender_filter in genderMap) genderMap[d.gender_filter] += d.count; });
  const genderTotal = Object.values(genderMap).reduce((s, v) => s + v, 0) || 1;

  // 카테고리 집중도 (상위 5개)
  const catMap = new Map<string, number>();
  distribution.forEach(d => catMap.set(d.category_code, (catMap.get(d.category_code) ?? 0) + d.count));
  const topCats = [...catMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const catTotal = [...catMap.values()].reduce((s, v) => s + v, 0) || 1;

  // 30일 추이 (rankHistory 첫날 vs 마지막날 top100 차이)
  const trend30 = rankHistory.length >= 2
    ? rankHistory[rankHistory.length - 1].top100_count - rankHistory[0].top100_count
    : null;
  const trendLabel = trend30 === null ? '—'
    : trend30 > 0 ? `+${trend30} SKU` : trend30 < 0 ? `${trend30} SKU` : '변동없음';
  const trendColor = trend30 === null ? 'var(--f3)'
    : trend30 > 0 ? 'var(--slf)' : trend30 < 0 ? 'var(--shf)' : 'var(--f3)';

  // ── 분포 필터 적용 ───────────────────────────────────────────
  const filteredDist = distribution.filter(d =>
    (!distGender || d.gender_filter === distGender) &&
    (!distAge || d.age_filter === distAge)
  );

  // 필터된 분포 집계
  const filteredTotal = filteredDist.reduce((s, d) => s + d.count, 0);
  const filteredBest = filteredDist.length > 0 ? Math.min(...filteredDist.map(d => d.best_rank)) : null;
  const filteredTop100 = filteredDist.reduce((s, d) => s + (d.best_rank <= 100 ? d.count : 0), 0);

  // 카테고리별 집계 (차트용)
  const catBarMap = new Map<string, number>();
  filteredDist.forEach(d => catBarMap.set(d.category_code, (catBarMap.get(d.category_code) ?? 0) + d.count));
  const catBars = [...catBarMap.entries()].sort((a, b) => b[1] - a[1]);
  const catBarMax = catBars[0]?.[1] || 1;

  if (!idFromUrl) {
    return <BrandPortal onSelect={id => router.push(`/brand?id=${id}`)} />;
  }

  return (
    <>
      <div className="page-title">
        <h1>{loading ? '…' : brandName}</h1>
        {info?.company_name && (
          <Link href={info.company_id ? `/company?id=${info.company_id}` : '/company'} className="chip" style={{ textDecoration: 'none', cursor: 'pointer' }}>
            {info.company_name}
          </Link>
        )}
        <span className="sub">{loading ? '' : info?.introduction?.slice(0, 50) ?? `${stats?.skuCount ?? 0} SKU`}</span>
        <div className="row-flex gap-6" style={{ marginLeft: 'auto' }}>
          <BrandSearch onSelect={handleBrandSelect} />
          <button className="btn sm"><IcBookmark /> 북마크</button>
        </div>
      </div>

      {/* ── KPI 8-카드 그리드 ── */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>

        {/* 1. TOP100 진입 */}
        <div className="kpi">
          <span className="label">TOP100 진입</span>
          <div className="val">{loading ? '…' : stats?.top100Count ?? 0}</div>
          <div className="dlt"><span className="muted">전체 카테고리</span></div>
        </div>

        {/* 2. 평균 랭킹 */}
        <div className="kpi">
          <span className="label">평균 랭킹</span>
          <div className="val">{loading ? '…' : stats?.avgRank ? `${stats.avgRank}위` : '—'}</div>
          <div className="dlt"><span className="muted">전체·공용·전체연령</span></div>
        </div>

        {/* 3. 랭킹 진입 SKU */}
        <div className="kpi">
          <span className="label">랭킹 진입 SKU</span>
          <div className="val">{loading ? '…' : products.length}</div>
          <div className="dlt"><span className="muted">최신 스냅샷 기준</span></div>
        </div>

        {/* 4. 평균 할인율 */}
        <div className="kpi">
          <span className="label">평균 할인율</span>
          <div className="val">{loading ? '…' : avgDiscount != null ? `${avgDiscount}%` : '—'}</div>
          <div className="dlt"><span className="muted">{withDiscount.length}개 할인 상품</span></div>
        </div>

        {/* 5. TOP100 추이 */}
        <div className="kpi">
          <span className="label">TOP100 추이</span>
          <div className="val" style={{ color: trendColor }}>{loading ? '…' : trendLabel}</div>
          <div className="dlt">
            <span className="muted">
              {rankHistory.length >= 2 ? `${rankHistory[0].date} → ${rankHistory[rankHistory.length - 1].date}` : '수집 중'}
            </span>
          </div>
        </div>

        {/* 6. 진행 프로모션 */}
        <div className="kpi">
          <span className="label">진행 프로모션</span>
          <div className="val">{loading ? '…' : stats?.promoCount ?? 0}</div>
          <div className="dlt"><span className="muted">현재 진행 중</span></div>
        </div>

        {/* 7. 성별 분포 */}
        <div className="kpi">
          <span className="label">성별 분포</span>
          <div style={{ display: 'flex', gap: 0, marginTop: 8, height: 8, borderRadius: 3, overflow: 'hidden', background: 'var(--bs)' }}>
            {loading ? null : GENDER_ALL.map(([k, l], i) => {
              const cnt = genderMap[k] ?? 0;
              const pct = Math.round(cnt / genderTotal * 100);
              const colors = ['var(--f3)', '#5a9fd4', 'var(--shf)'];
              return pct > 0 ? <div key={k} title={`${l}: ${pct}% (${cnt}개)`} style={{ width: `${pct}%`, background: colors[i], transition: 'width 0.3s', cursor: 'default' }} /> : null;
            })}
          </div>
          <div className="dlt" style={{ marginTop: 6 }}>
            {loading ? <span className="muted">…</span> : GENDER_ALL.map(([k, l], i) => {
              const colors = ['var(--f3)', '#5a9fd4', 'var(--shf)'];
              return <span key={k} style={{ color: colors[i] }}>{l} {Math.round((genderMap[k] ?? 0) / genderTotal * 100)}%</span>;
            })}
          </div>
        </div>

        {/* 8. 카테고리 집중도 */}
        <div className="kpi">
          <span className="label">카테고리 집중도</span>
          {(() => {
            const CAT_COLORS = ['var(--hs)', '#5a9fd4', 'var(--slf)', '#c4944a', 'var(--f3)'];
            return (
              <>
                <div style={{ display: 'flex', gap: 0, marginTop: 8, height: 8, borderRadius: 3, overflow: 'hidden', background: 'var(--bs)' }}>
                  {loading ? null : topCats.map(([code, cnt], i) => {
                    const pct = Math.round((cnt / catTotal) * 100);
                    return pct > 0 ? <div key={code} title={`${CATEGORY_MAP[code] ?? code}: ${pct}% (${cnt}개)`} style={{ width: `${pct}%`, background: CAT_COLORS[i], transition: 'width 0.3s', cursor: 'default' }} /> : null;
                  })}
                </div>
                <div className="dlt" style={{ marginTop: 6 }}>
                  {loading ? <span className="muted">…</span> : topCats.map(([code, cnt], i) => (
                    <span key={code} style={{ color: CAT_COLORS[i] }}>
                      {CATEGORY_MAP[code] ?? code} {Math.round((cnt / catTotal) * 100)}%
                    </span>
                  ))}
                </div>
              </>
            );
          })()}
        </div>

      </div>

      {/* ── 랭킹 추이 차트 ── */}
      <section className="panel">
        <div className="sec-head">
          <h3>평균 랭킹 추이 <span className="sub">전체 카테고리 · 공용 · 일별 평균 (낮을수록 좋음)</span></h3>
        </div>
        {loading ? (
          <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span className="mono dim" style={{ fontSize: 11 }}>로딩 중…</span>
          </div>
        ) : rankHistory.length < 2 ? (
          <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--snk)', borderRadius: 4 }}>
            <span className="mono dim" style={{ fontSize: 11 }}>스냅샷 2일 이상 수집 후 표시됩니다</span>
          </div>
        ) : (
          <Line h={200}
            series={[{ points: rankHistory.map(r => r.avg_rank), color: 'var(--f1)', label: '평균 랭킹' }]}
            labels={rankHistory.map(r => r.date)}
            reversed
          />
        )}
      </section>

      <div className="grid" style={{ gridTemplateColumns: '1.6fr 1fr', gap: 14 }}>
        {/* ── 상품 랭킹 테이블 ── */}
        <section className="panel col-flex">
          <div className="sec-head">
            <h3>상품 랭킹 <span className="sub">최신 스냅샷 · 전 콤보 최고순위 기준</span></h3>
          </div>
          {loading ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>로딩 중…</div>
          ) : products.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>랭킹에 진입한 상품이 없습니다.</div>
          ) : (
            <div className="tbl flex-1">
              <div className="row head" style={{ gridTemplateColumns: '36px 1fr 60px 54px 54px 60px 60px 58px' }}>
                <span>#</span>
                <span>상품명</span>
                <span>카테고리</span>
                <span>성별</span>
                <span>연령</span>
                <span className="cell-r">현재가</span>
                <span className="cell-r">소비자가</span>
                <span>할인율</span>
              </div>
              {products.map((p, i) => (
                <div key={i}
                  className={`row hover ${i % 2 ? 'alt' : ''}`}
                  style={{ gridTemplateColumns: '36px 1fr 60px 54px 54px 60px 60px 58px', cursor: 'pointer' }}
                  onClick={() => router.push(`/product?no=${p.musinsa_no}`)}
                >
                  <span className="mono muted">{p.rank_position ?? '—'}</span>
                  <span style={{ fontWeight: 500 }}>{p.product_name}</span>
                  <span className="mono dim" style={{ fontSize: 10 }}>{CATEGORY_MAP[p.category_code] ?? p.category_code}</span>
                  <span className="mono dim" style={{ fontSize: 10 }}>{GENDER_LABEL[p.gender_filter] ?? p.gender_filter}</span>
                  <span className="mono dim" style={{ fontSize: 10 }}>{AGE_MAP[p.age_filter]?.split('세')[0] ?? p.age_filter}</span>
                  <span className="mono muted cell-r" style={{ fontSize: 11 }}>{p.final_price ? `${(p.final_price / 10000).toFixed(1)}만` : '—'}</span>
                  <span className="mono dim cell-r" style={{ fontSize: 11 }}>{p.list_price ? `${(p.list_price / 10000).toFixed(1)}만` : '—'}</span>
                  <span>
                    {p.discount_rate ? (
                      <span className="chip" style={{ fontSize: 9, color: p.discount_rate >= 30 ? 'var(--shf)' : 'var(--f3)', borderColor: p.discount_rate >= 30 ? 'var(--shf)' : 'var(--bs)', background: p.discount_rate >= 30 ? 'var(--shb)' : 'var(--snk)' }}>
                        −{p.discount_rate}%
                      </span>
                    ) : <span className="dim mono" style={{ fontSize: 10 }}>—</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="col-flex gap-12">
          {/* ── 랭킹 분포 ── */}
          <section className="panel">
            <div className="sec-head"><h3>랭킹 분포 <span className="sub">카테고리별 SKU</span></h3></div>

            {/* 성별 · 연령 필터 */}
            <div className="col-flex gap-4" style={{ marginBottom: 10 }}>
              <div className="row-flex gap-4">
                {[['', '전체성별'], ['A', '공용'], ['M', '남성'], ['F', '여성']].map(([v, l]) => (
                  <button key={v} className={`btn sm${distGender === v ? ' active' : ''}`}
                    onClick={() => setDistGender(v)}>{l}</button>
                ))}
              </div>
              <div className="row-flex gap-4 wrap">
                {AGE_OPTIONS.map(([v, l]) => {
                  const val = v === 'AGE_BAND_ALL' ? '' : v;
                  return (
                    <button key={v} className={`btn sm${distAge === val ? ' active' : ''}`}
                      onClick={() => setDistAge(val)}>{l}</button>
                  );
                })}
              </div>
            </div>

            {/* 집계 요약 */}
            {!loading && distribution.length > 0 && (
              <div className="row-flex gap-14" style={{ marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid var(--bs)' }}>
                {[['총 SKU', filteredTotal], ['TOP100', filteredTop100], ['최고순위', filteredBest ?? '—']].map(([l, v]) => (
                  <div key={l as string} className="col-flex">
                    <span style={{ fontSize: 16, fontWeight: 600, fontFamily: 'var(--mono)', color: 'var(--f1)' }}>{v}</span>
                    <span style={{ fontSize: 10, color: 'var(--f4)' }}>{l}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 카테고리별 바 차트 */}
            {loading ? (
              <div style={{ fontSize: 12, color: 'var(--f4)', padding: '12px 0', textAlign: 'center' }}>로딩 중…</div>
            ) : catBars.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--f4)', padding: '12px 0', textAlign: 'center' }}>해당 조건 데이터 없음</div>
            ) : (
              <HorizBars
                data={catBars.map(([code, cnt]) => ({ name: CATEGORY_MAP[code] ?? code, value: cnt }))}
                labelWidth={60}
              />
            )}
          </section>

          {/* ── 가격대 분포 ── */}
          <section className="panel">
            <div className="sec-head"><h3>가격대 분포 <span className="sub">{products.length} SKU</span></h3></div>
            {loading || products.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--f4)', padding: '20px 0', textAlign: 'center' }}>데이터 없음</div>
            ) : (() => {
              const prices = products.map(p => p.final_price ?? 0).filter(Boolean);
              const bins = [0, 30000, 50000, 80000, 100000, 150000, 200000, Infinity];
              const labels = ['~3만', '~5만', '~8만', '~10만', '~15만', '~20만', '20만+'];
              const data = labels.map((name, i) => ({
                name,
                value: prices.filter(p => p >= bins[i] && p < bins[i + 1]).length,
              }));
              return <VertBars data={data} h={80} />;
            })()}
          </section>

          {/* ── 브랜드 정보 ── */}
          <section className="panel">
            <div className="sec-head"><h3>브랜드 정보</h3></div>
            {info ? (
              <>
                {[
                  ['국가', info.nation_name ?? '—'],
                  ['설립', info.since_year ? `${info.since_year}년` : '—'],
                  ['자사 브랜드', info.is_own ? 'Yes' : 'No'],
                  ['법인', info.company_name ?? '—'],
                  ['slug', info.slug],
                ].map(([k, v], i) => (
                  <div key={i} className="row-flex between" style={{ padding: '3px 0' }}>
                    <span className="dim" style={{ fontSize: 11 }}>{k}</span>
                    <span className="mono" style={{ fontSize: 11 }}>{v}</span>
                  </div>
                ))}
                {info.introduction && (
                  <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--f2)', lineHeight: '18px' }}>
                    {info.introduction.slice(0, 120)}{info.introduction.length > 120 ? '…' : ''}
                  </p>
                )}
              </>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--f4)', padding: '12px 0' }}>브랜드를 선택하세요.</div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
