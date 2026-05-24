'use client';
import React from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import {
  LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot,
} from 'recharts';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { IcSearch, IcEdit } from '@/components/ui/icons';
import BookmarkToggle from '@/components/me/BookmarkToggle';
import NoteDrawer from '@/components/me/NoteDrawer';
import { fetchNoteCountForEntity, logView } from '@/lib/queries-me';
import { searchProducts, fetchProductDetail, fetchProductPriceHistory, fetchProductRankHistory, fetchProductCategoryRanks, fetchReviews, CATEGORY_MAP, type ProductDetail, type ReviewRow, type ProductSearchResult } from '@/lib/queries';

function ProductSearch({ onSelect }: { onSelect: (no: string) => void }) {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<ProductSearchResult[]>([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(-1);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = React.useCallback((kw: string) => {
    if (!kw.trim()) { setResults([]); setOpen(false); return; }
    setLoading(true);
    searchProducts(kw, 15).then(r => {
      setResults(r);
      setOpen(r.length > 0);
      setActiveIdx(-1);
    }).finally(() => setLoading(false));
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(v), 300);
  };

  const handleSelect = (r: ProductSearchResult) => {
    setQuery('');
    setResults([]);
    setOpen(false);
    onSelect(String(r.musinsa_no));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && activeIdx >= 0) { handleSelect(results[activeIdx]); }
    else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
  };

  return (
    <div style={{ position: 'relative' }}>
      <div className="row-flex center gap-4" style={{ background: 'var(--snk)', border: '1px solid var(--bd)', borderRadius: 4, padding: '3px 8px', width: 260 }}>
        <span className="mono dim" style={{ fontSize: 11, flexShrink: 0 }}>
          {loading ? '…' : '⌕'}
        </span>
        <input
          ref={inputRef}
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="상품명 · 상품번호 · 브랜드 · 스타일번호"
          style={{ background: 'none', border: 'none', outline: 'none', fontSize: 11, width: '100%', color: 'var(--f1)' }}
        />
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4, width: 340,
          background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 100, maxHeight: 320, overflowY: 'auto',
        }}>
          {results.map((r, i) => (
            <div
              key={r.musinsa_no}
              onMouseDown={() => handleSelect(r)}
              style={{
                padding: '7px 12px', cursor: 'pointer',
                background: i === activeIdx ? 'var(--snk)' : 'transparent',
                borderBottom: '1px solid var(--snk)',
              }}
            >
              <div className="row-flex between">
                <span style={{ fontSize: 12, color: 'var(--f1)', fontWeight: 500 }}>{r.name}</span>
                {r.is_own && <span className="chip" style={{ fontSize: 9, padding: '1px 5px' }}>자사</span>}
              </div>
              <div className="row-flex gap-8" style={{ marginTop: 2 }}>
                <span className="mono dim" style={{ fontSize: 10 }}>{r.brand_name}</span>
                {r.company_name && <span className="mono dim" style={{ fontSize: 10 }}>{r.company_name}</span>}
                <span className="mono dim" style={{ fontSize: 10 }}>#{r.musinsa_no}</span>
                {r.style_no && <span className="mono dim" style={{ fontSize: 10 }}>{r.style_no}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductPortal({ onSelect }: { onSelect: (no: string) => void }) {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<ProductSearchResult[]>([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(-1);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = React.useCallback((kw: string) => {
    if (!kw.trim()) { setResults([]); setOpen(false); return; }
    setLoading(true);
    searchProducts(kw, 15).then(r => {
      setResults(r); setOpen(r.length > 0); setActiveIdx(-1);
    }).finally(() => setLoading(false));
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value; setQuery(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(v), 300);
  };

  const handleSelect = (r: ProductSearchResult) => {
    setQuery(''); setResults([]); setOpen(false);
    onSelect(String(r.musinsa_no));
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
      {/* 헤더 */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <IcSearch size={20} style={{ color: 'var(--f3)' }} />
          <span style={{ fontSize: 20, fontWeight: 600, color: 'var(--f1)', letterSpacing: '-0.03em' }}>상품 조회</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--f4)' }}>
          상품명 · 브랜드명 · 무신사 번호 · 스타일 번호로 검색할 수 있습니다
        </div>
      </div>

      {/* 검색창 */}
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
            placeholder="상품명 · 상품번호 · 브랜드 · 스타일번호"
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
                key={r.musinsa_no}
                onMouseDown={() => handleSelect(r)}
                style={{
                  padding: '9px 16px', cursor: 'pointer',
                  background: i === activeIdx ? 'var(--snk)' : 'transparent',
                  borderBottom: '1px solid var(--snk)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: 'var(--f1)', fontWeight: 500 }}>{r.name}</span>
                  {r.is_own && <span className="chip" style={{ fontSize: 9, padding: '1px 5px' }}>자사</span>}
                </div>
                <div className="row-flex gap-8" style={{ marginTop: 3 }}>
                  <span className="mono dim" style={{ fontSize: 10 }}>{r.brand_name}</span>
                  {r.company_name && <span className="mono dim" style={{ fontSize: 10 }}>{r.company_name}</span>}
                  <span className="mono dim" style={{ fontSize: 10 }}>#{r.musinsa_no}</span>
                  {r.style_no && <span className="mono dim" style={{ fontSize: 10 }}>{r.style_no}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 하단 힌트 */}
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

const FLAG_LABELS: [string, string][] = [
  ['is_musinsa_monopoly', '무신사 단독'],
  ['is_online_monopoly', '온라인 단독'],
  ['is_first', '퍼스트'],
  ['is_free_return', '무료반품'],
  ['is_drop', '드롭'],
  ['is_limited_quantity', '한정수량'],
  ['is_clearance', '클리어런스'],
  ['is_outlet', '아울렛'],
];

const SEASON_CODE: Record<string, string> = {
  SS: 'S/S', FW: 'F/W', SPRING: '봄', SUMMER: '여름', FALL: '가을', WINTER: '겨울',
};

const GENDER_LABEL: Record<string, string> = {
  M: '남성', F: '여성', A: '공용', U: '공용',
};

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="row-flex between" style={{ padding: '3px 0' }}>
      <span style={{ fontSize: 11, color: 'var(--f4)' }}>{label}</span>
      <span className="mono" style={{ fontSize: 11 }}>{value}</span>
    </div>
  );
}

export default function ProductPage() {
  return (
    <Suspense fallback={<div style={{ padding: '80px 20px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>로딩 중…</div>}>
      <ProductPageInner />
    </Suspense>
  );
}

function ProductPageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const noFromUrl = params.get('no') ?? '';

  const [selectedNo, setSelectedNo] = React.useState(noFromUrl);
  const [detail, setDetail] = React.useState<ProductDetail | null>(null);
  const [priceHistory,   setPriceHistory]   = React.useState<{ date: string; price: number; discount_rate: number | null }[]>([]);
  const [rankHistory,    setRankHistory]    = React.useState<{ date: string; rank: number; category: string }[]>([]);
  const [categoryRanks,  setCategoryRanks]  = React.useState<{ category_code: string; best_rank: number; combo_count: number }[]>([]);
  const [reviews, setReviews] = React.useState<ReviewRow[]>([]);
  const [loading, setLoading] = React.useState(!!noFromUrl);
  const [noteCount, setNoteCount] = React.useState(0);
  const [noteDrawerOpen, setNoteDrawerOpen] = React.useState(
    () => (params.get('notes') === 'open' || !!params.get('note')) && !!noFromUrl,
  );

  React.useEffect(() => {
    if (!noFromUrl) {
      window.dispatchEvent(new CustomEvent('uttu:crumb', { detail: { brand: '', name: '' } }));
    }
  }, [noFromUrl]);

  React.useEffect(() => {
    if (noFromUrl) setSelectedNo(noFromUrl);
  }, [noFromUrl]);

  React.useEffect(() => {
    if (!selectedNo) return;
    setLoading(true);
    setDetail(null);
    setReviews([]);
    setRankHistory([]);
    setCategoryRanks([]);
    Promise.all([
      fetchProductDetail(selectedNo),
      fetchProductPriceHistory(selectedNo),
      fetchProductRankHistory(selectedNo),
      fetchProductCategoryRanks(selectedNo),
    ]).then(async ([d, ph, rh, cr]) => {
      setDetail(d);
      if (d) {
        window.dispatchEvent(new CustomEvent('uttu:crumb', { detail: { brand: d.brand_name, name: d.name } }));
        window.dispatchEvent(new CustomEvent('uttu:ai-context', { detail: [
          `상품 · ${d.name}`,
          `#${d.musinsa_no}`,
          ...(d.final_price ? [`${d.final_price.toLocaleString()}원`] : []),
          ...(d.rank_position ? [`현재 ${d.rank_position}위`] : []),
        ] }));
      }
      setPriceHistory(ph);
      setRankHistory(rh);
      setCategoryRanks(cr);
      if (d) {
        const rv = await fetchReviews({ productId: d.id, sort: 'recent', limit: 10, offset: 0 });
        setReviews(rv.rows);
      }
      setLoading(false);
    }).catch(e => { console.error(e); setLoading(false); });
  }, [selectedNo]);

  React.useEffect(() => {
    if (detail?.id) fetchNoteCountForEntity('product', detail.id).then(setNoteCount);
  }, [detail?.id]);

  React.useEffect(() => {
    if (detail?.id) logView('product', detail.id, detail.name).catch(() => {});
  }, [detail?.id]);

  // ── 가격 차트 ─────────────────────────────────────────────
  const prices = priceHistory.map(p => p.price);
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
  const pricePad = Math.max(Math.round((maxPrice - minPrice) * 0.15), 1000);
  const priceChartData = priceHistory.map(p => ({
    date: p.date.slice(5),   // MM-DD
    price: p.price,
    discount: p.discount_rate ?? 0,
  }));

  // ── 랭킹 차트 ─────────────────────────────────────────────
  const ranks = rankHistory.map(r => r.rank);
  const minRank = ranks.length > 0 ? Math.min(...ranks) : 0;
  const maxRank = ranks.length > 0 ? Math.max(...ranks) : 0;
  const rankPeriodLabel = rankHistory.length >= 2
    ? `${rankHistory[0].date.slice(5)} ~ ${rankHistory[rankHistory.length - 1].date.slice(5)} (${rankHistory.length}일)`
    : rankHistory.length === 1 ? rankHistory[0].date.slice(5) : '';
  const rankChartData = rankHistory.map(r => ({ date: r.date.slice(5), rank: r.rank }));
  // Y축 반전: rank가 낮을수록(좋을수록) 위에 표시 → domain을 [max, min]으로
  const rankFirst = ranks[0];
  const rankLast  = ranks[ranks.length - 1];
  const rankTrend = ranks.length > 1 ? (rankLast < rankFirst ? 'up' : rankLast > rankFirst ? 'dn' : 'flat') : 'flat';
  const rankColor = rankTrend === 'up' ? 'var(--slf)' : rankTrend === 'dn' ? 'var(--shf)' : 'var(--f3)';

  // ── 랭킹 인사이트 계산 ────────────────────────────────────
  const rankMean = ranks.length > 0 ? ranks.reduce((s, r) => s + r, 0) / ranks.length : 0;
  const rankStdDev = ranks.length >= 3
    ? Math.sqrt(ranks.reduce((s, r) => s + (r - rankMean) ** 2, 0) / ranks.length)
    : null;
  const stabilityLabel = rankStdDev === null ? '—' : rankStdDev < 5 ? '안정적' : rankStdDev < 15 ? '보통' : '변동큼';

  const recent7 = ranks.slice(-7);
  const prev7   = ranks.slice(-14, -7);
  const avg7    = (arr: number[]) => arr.length > 0 ? arr.reduce((s, r) => s + r, 0) / arr.length : null;
  const velocity7d = (avg7(recent7) !== null && avg7(prev7) !== null)
    ? Math.round((avg7(prev7) as number) - (avg7(recent7) as number))  // 양수=개선
    : null;

  // 할인 발생 날짜에서 랭킹 변동 계산
  const discountDays = priceHistory.slice(1).flatMap((ph, i) => {
    if (!ph.discount_rate || ph.discount_rate <= 0) return [];
    const rNow  = rankHistory.find(r => r.date === ph.date);
    const rPrev = rankHistory.find(r => r.date === priceHistory[i].date);
    if (!rNow || !rPrev) return [];
    return [rNow.rank - rPrev.rank]; // 음수=개선
  });
  const avgRankOnDiscount = discountDays.length > 0
    ? Math.round(discountDays.reduce((s, d) => s + d, 0) / discountDays.length)
    : null;

  const activeFlags = detail
    ? FLAG_LABELS.filter(([key]) => (detail as any)[key]).map(([, label]) => label)
    : [];

  if (!noFromUrl) {
    return <ProductPortal onSelect={no => router.push(`/product?no=${no}`)} />;
  }

  return (
    <div className="col-flex gap-14">
      {detail?.id && (
        <NoteDrawer
          key={detail.id}
          entity_type="product"
          entity_id={detail.id}
          entity_label={detail.name}
          open={noteDrawerOpen}
          onClose={() => setNoteDrawerOpen(false)}
          onCountChange={setNoteCount}
        />
      )}
      <div className="page-title">
        <div className="col-flex gap-2">
          <h1>{loading ? '…' : (detail?.name ?? '')}</h1>
          {detail?.name_eng && (
            <span style={{ fontSize: 11, color: 'var(--f4)', fontStyle: 'italic' }}>{detail.name_eng}</span>
          )}
        </div>
        {detail && (
          <div className="row-flex center gap-4">
            <Link href={detail.brand_id ? `/brand?id=${detail.brand_id}` : '/brand'} className="chip" style={{ textDecoration: 'none', cursor: 'pointer' }}>
              {detail.brand_name}
            </Link>
            {detail.company_name && (
              <Link href={detail.company_id ? `/company?id=${detail.company_id}` : '/company'} className="chip" style={{ textDecoration: 'none', cursor: 'pointer' }}>
                {detail.company_name}
              </Link>
            )}
          </div>
        )}
        <div className="row-flex gap-6" style={{ marginLeft: 'auto' }}>
          <ProductSearch onSelect={no => router.push(`/product?no=${no}`)} />
          {detail?.id && <BookmarkToggle entity_type="product" entity_id={detail.id} label={detail.name} />}
          {detail?.id && (
            <button className="btn sm" onClick={() => setNoteDrawerOpen(true)} style={{ position: 'relative' }}>
              <IcEdit /> 메모
              {noteCount > 0 && (
                <span style={{ position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, background: 'var(--hs)', color: '#fff', fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
                  {noteCount}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '80px 20px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>로딩 중…</div>
      ) : !detail ? null : (
        <div className="grid" style={{ gridTemplateColumns: '300px 1fr', gap: 14, alignItems: 'start' }}>

          {/* ── LEFT COLUMN ── */}
          <div className="col-flex gap-10">

            {/* Image */}
            <div className="panel compact" style={{ height: 280, background: 'var(--snk)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
              {detail.thumbnail_url ? (
                <img src={detail.thumbnail_url.startsWith('/') ? `https://image.musinsa.com${detail.thumbnail_url}` : detail.thumbnail_url} alt={detail.name} style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }} />
              ) : (
                <span className="mono dim" style={{ fontSize: 11 }}>이미지 없음</span>
              )}
              <a
                href={`https://www.musinsa.com/products/${detail.musinsa_no}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ position: 'absolute', bottom: 8, right: 8, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 10, padding: '2px 8px', borderRadius: 3, textDecoration: 'none' }}
              >
                무신사↗
              </a>
            </div>

            {/* Price */}
            <section className="panel">
              <span className="sec-tag">현재가</span>
              <div className="row-flex baseline gap-6" style={{ marginTop: 6 }}>
                <span className="mono tnum" style={{ fontSize: 26, fontWeight: 500, color: 'var(--f1)' }}>
                  {detail.final_price ? detail.final_price.toLocaleString() : '—'}
                </span>
                <span style={{ fontSize: 12, color: 'var(--f3)' }}>원</span>
                {detail.discount_rate != null && detail.discount_rate > 0 && (
                  <span style={{ fontSize: 12, color: 'var(--dn)', fontWeight: 600 }}>−{detail.discount_rate}%</span>
                )}
              </div>
              {detail.list_price && detail.final_price && detail.list_price !== detail.final_price && (
                <div className="mono dim" style={{ fontSize: 11, marginTop: 2 }}>
                  정가 {detail.list_price.toLocaleString()}원
                </div>
              )}
            </section>

            {/* Basic Info */}
            <section className="panel">
              <span className="sec-tag">기본정보</span>
              <InfoRow label="브랜드" value={detail.brand_name} />
              {detail.company_name && <InfoRow label="회사" value={detail.company_name} />}
              <InfoRow label="SKU" value={String(detail.musinsa_no)} />
              {detail.style_no && <InfoRow label="스타일번호" value={detail.style_no} />}
              <InfoRow
                label="카테고리"
                value={detail.category_d2_name
                  ? `${detail.category_d2_name}${detail.category_d3_name ? ' / ' + detail.category_d3_name : ''}`
                  : (CATEGORY_MAP[detail.category_code] ?? detail.category_code)}
              />
              {detail.gender && <InfoRow label="성별" value={GENDER_LABEL[detail.gender] ?? detail.gender} />}
              {detail.season_year && (
                <InfoRow
                  label="시즌"
                  value={`${detail.season_year} ${detail.season_code ? (SEASON_CODE[detail.season_code] ?? detail.season_code) : ''}`.trim()}
                />
              )}
              <hr className="hr-d" style={{ margin: '8px 0' }} />
              <InfoRow label="현재 랭킹" value={detail.rank_position ? `#${detail.rank_position}` : '—'} />
              <InfoRow label="별점" value={detail.satisfaction_score ? `${detail.satisfaction_score} / 5.0` : '—'} />
              <InfoRow label="리뷰점수" value={detail.review_score != null ? `${detail.review_score}점` : '—'} />
              <InfoRow label="리뷰수" value={`${detail.review_count.toLocaleString()}건`} />
            </section>

            {/* Material / Fit */}
            {(detail.fit || detail.texture || detail.elasticity || detail.transparency || detail.thickness || detail.item_seasons.length > 0) && (
              <section className="panel">
                <span className="sec-tag">소재·핏</span>
                {detail.fit && <InfoRow label="핏" value={detail.fit} />}
                {detail.texture && <InfoRow label="소재감" value={detail.texture} />}
                {detail.elasticity && <InfoRow label="신축성" value={detail.elasticity} />}
                {detail.transparency && <InfoRow label="비침" value={detail.transparency} />}
                {detail.thickness && <InfoRow label="두께감" value={detail.thickness} />}
                {detail.item_seasons.length > 0 && <InfoRow label="착용시즌" value={detail.item_seasons.join(', ')} />}
              </section>
            )}

            {/* Tags / Flags */}
            {(activeFlags.length > 0 || detail.labels.length > 0) && (
              <section className="panel">
                <span className="sec-tag">태그</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {activeFlags.map(label => (
                    <span key={label} className="chip" style={{ fontSize: 10 }}>{label}</span>
                  ))}
                  {detail.labels.map(l => (
                    <span key={l} className="chip" style={{ fontSize: 10, opacity: 0.7 }}>{l}</span>
                  ))}
                </div>
              </section>
            )}

            {/* Colors / Sizes */}
            {(detail.colors.length > 0 || detail.sizes.length > 0) && (
              <section className="panel">
                {detail.colors.length > 0 && (
                  <>
                    <span className="sec-tag">컬러</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6, marginBottom: 10 }}>
                      {detail.colors.map(c => (
                        <span key={c} className="mono dim" style={{ fontSize: 10, background: 'var(--snk)', padding: '2px 6px', borderRadius: 2 }}>{c}</span>
                      ))}
                    </div>
                  </>
                )}
                {detail.sizes.length > 0 && (
                  <>
                    <span className="sec-tag">사이즈</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                      {detail.sizes.map(s => (
                        <span key={s} className="mono dim" style={{ fontSize: 10, background: 'var(--snk)', padding: '2px 6px', borderRadius: 2 }}>{s}</span>
                      ))}
                    </div>
                  </>
                )}
              </section>
            )}
          </div>

          {/* ── RIGHT COLUMN ── */}
          <div className="col-flex gap-12">

            {/* Rank History */}
            <section className="panel">
              <div className="sec-head">
                <h3>랭킹 추이 <span className="sub">{rankHistory.length}일 · 카테고리 최고순위</span></h3>
                {ranks.length > 1 && (
                  <span className="mono" style={{ fontSize: 11, color: rankColor }}>
                    {rankTrend === 'up' ? '↑ ' : rankTrend === 'dn' ? '↓ ' : ''}
                    #{rankFirst} → #{rankLast}
                  </span>
                )}
              </div>
              {rankHistory.length < 2 ? (
                <div style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>
                  데이터 수집 중 — 2일치 이상 쌓이면 차트가 표시됩니다.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={110}>
                  <LineChart data={rankChartData} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--f4)', fontFamily: 'var(--mono)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis
                      reversed        /* rank 1이 위 */
                      domain={[
                        Math.max(1, minRank - Math.max(2, Math.round((maxRank - minRank) * 0.2))),
                        maxRank + Math.max(2, Math.round((maxRank - minRank) * 0.2)),
                      ]}
                      tick={{ fontSize: 9, fill: 'var(--f4)', fontFamily: 'var(--mono)' }}
                      tickLine={false} axisLine={false} width={28}
                      tickFormatter={v => `#${v}`}
                    />
                    <Tooltip
                      contentStyle={{ background: 'var(--sur)', border: '0.5px solid var(--bs)', borderRadius: 4, fontSize: 11, fontFamily: 'var(--mono)' }}
                      formatter={(v: unknown) => [`#${v}`, '순위']}
                      labelStyle={{ color: 'var(--f3)', fontSize: 10 }}
                    />
                    <Line
                      type="monotone" dataKey="rank"
                      stroke={rankColor} strokeWidth={1.5}
                      dot={rankChartData.length <= 7}
                      activeDot={{ r: 3, fill: rankColor }}
                    />
                    {/* 최고점 강조 */}
                    <ReferenceDot
                      x={rankChartData[ranks.indexOf(minRank)]?.date}
                      y={minRank}
                      r={4} fill={rankColor} stroke="var(--sur)" strokeWidth={1.5}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </section>

            {/* Price History */}
            <section className="panel">
              <div className="sec-head">
                <h3>가격 추이 <span className="sub">{priceHistory.length}일 수집</span></h3>
                {prices.length >= 2 && (
                  <span className="mono" style={{ fontSize: 11, color: 'var(--f3)' }}>
                    {minPrice === maxPrice
                      ? `${minPrice.toLocaleString()}원 고정`
                      : `${minPrice.toLocaleString()} ~ ${maxPrice.toLocaleString()}원`}
                  </span>
                )}
              </div>
              {priceHistory.length < 2 ? (
                <div style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>
                  데이터 수집 중 — 2일치 이상 쌓이면 차트가 표시됩니다.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={130}>
                  <LineChart data={priceChartData} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--f4)', fontFamily: 'var(--mono)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis
                      domain={[minPrice - pricePad, maxPrice + pricePad]}
                      tick={{ fontSize: 9, fill: 'var(--f4)', fontFamily: 'var(--mono)' }}
                      tickLine={false} axisLine={false} width={44}
                      tickFormatter={v => `${Math.round(v / 1000)}k`}
                    />
                    <Tooltip
                      contentStyle={{ background: 'var(--sur)', border: '0.5px solid var(--bs)', borderRadius: 4, fontSize: 11, fontFamily: 'var(--mono)' }}
                      formatter={(v: unknown) => [Number(v).toLocaleString() + '원', '가격']}
                      labelStyle={{ color: 'var(--f3)', fontSize: 10 }}
                    />
                    <Line
                      type="monotone" dataKey="price"
                      stroke="var(--f1)" strokeWidth={1.5}
                      dot={priceChartData.length <= 7}
                      activeDot={{ r: 3 }}
                    />
                    {priceChartData
                      .filter(d => d.discount > 0)
                      .map(d => (
                        <ReferenceDot key={d.date} x={d.date} y={d.price}
                          r={4} fill="var(--shf)" stroke="var(--sur)" strokeWidth={1.5} />
                      ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </section>

            {/* Ranking Best Records */}
            {detail.ranking_best_records.length > 0 && (
              <section className="panel">
                <div className="sec-head">
                  <h3>베스트 랭킹 기록 <span className="sub">{detail.ranking_best_records.length}건</span></h3>
                </div>
                <div style={{ overflowX: 'auto', marginTop: 8 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr>
                        {['연도', '월', '순위', '카테고리', '성별'].map(h => (
                          <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--f4)', fontWeight: 500, borderBottom: '1px solid var(--snk)', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...detail.ranking_best_records]
                        .sort((a, b) => a.rank - b.rank)
                        .slice(0, 20)
                        .map((rec, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--snk)' }}>
                            <td className="mono" style={{ padding: '4px 8px', color: 'var(--f3)' }}>{rec.year}</td>
                            <td className="mono" style={{ padding: '4px 8px', color: 'var(--f3)' }}>{rec.month}월</td>
                            <td className="mono" style={{ padding: '4px 8px', fontWeight: 600, color: rec.rank <= 10 ? 'var(--hs)' : rec.rank <= 50 ? 'var(--up)' : 'var(--f2)' }}>
                              #{rec.rank}
                            </td>
                            <td style={{ padding: '4px 8px', color: 'var(--f2)' }}>{rec.depth1CategoryName}</td>
                            <td style={{ padding: '4px 8px', color: 'var(--f4)' }}>{rec.gender}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* 카테고리별 진입 현황 */}
            {categoryRanks.length > 0 && (
              <section className="panel">
                <div className="sec-head">
                  <h3>카테고리 침투율
                    <span className="sub">
                      {categoryRanks.reduce((s, r) => s + r.combo_count, 0)}개 콤보 동시 진입
                    </span>
                  </h3>
                </div>
                <div className="tbl" style={{ border: 'none', borderRadius: 0, marginTop: 4 }}>
                  <div className="row head" style={{ gridTemplateColumns: '1fr 64px 60px' }}>
                    <span>카테고리</span>
                    <span className="cell-r">최고순위</span>
                    <span className="cell-r">콤보수</span>
                  </div>
                  {categoryRanks.map((r, i) => (
                    <div key={i} className={`row ${i % 2 ? 'alt' : ''}`}
                      style={{ gridTemplateColumns: '1fr 64px 60px' }}>
                      <span style={{ fontSize: 12 }}>{CATEGORY_MAP[r.category_code] ?? r.category_code}</span>
                      <span className="mono cell-r" style={{
                        fontWeight: r.best_rank <= 10 ? 600 : 400,
                        color: r.best_rank === 1 ? 'var(--hs)' : r.best_rank <= 10 ? 'var(--slf)' : 'var(--f2)',
                      }}>#{r.best_rank}</span>
                      <span className="mono cell-r dim" style={{ fontSize: 11 }}>{r.combo_count}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 랭킹 인사이트 */}
            {ranks.length >= 2 && (
              <section className="panel">
                <div className="sec-head"><h3>랭킹 인사이트</h3></div>
                <div className="grid grid-3 gap-8" style={{ marginTop: 8 }}>
                  {/* 안정성 지수 */}
                  <div className="kpi">
                    <span className="label">안정성</span>
                    <div className="val" style={{ fontSize: 16 }}>{stabilityLabel}</div>
                    <div className="dlt">
                      <span className="muted">
                        {rankStdDev !== null ? `σ ${rankStdDev.toFixed(1)}` : `${ranks.length}일 데이터`}
                      </span>
                    </div>
                  </div>
                  {/* 7일 속도계 */}
                  <div className="kpi">
                    <span className="label">7일 추세</span>
                    <div className="val" style={{ fontSize: 16, color: velocity7d === null ? 'var(--f4)' : velocity7d > 0 ? 'var(--slf)' : velocity7d < 0 ? 'var(--shf)' : 'var(--f3)' }}>
                      {velocity7d === null ? '—'
                        : velocity7d > 0 ? `↑ ${velocity7d}`
                        : velocity7d < 0 ? `↓ ${Math.abs(velocity7d)}`
                        : '보합'}
                    </div>
                    <div className="dlt"><span className="muted">전전주 평균 대비</span></div>
                  </div>
                  {/* 할인 시 반응 */}
                  <div className="kpi">
                    <span className="label">할인 반응</span>
                    <div className="val" style={{ fontSize: 16, color: avgRankOnDiscount === null ? 'var(--f4)' : avgRankOnDiscount < 0 ? 'var(--slf)' : avgRankOnDiscount > 0 ? 'var(--shf)' : 'var(--f3)' }}>
                      {avgRankOnDiscount === null ? '—'
                        : avgRankOnDiscount < 0 ? `↑ ${Math.abs(avgRankOnDiscount)}`
                        : avgRankOnDiscount > 0 ? `↓ ${avgRankOnDiscount}`
                        : '변화없음'}
                    </div>
                    <div className="dlt">
                      <span className="muted">{discountDays.length > 0 ? `${discountDays.length}일 관측` : '할인 데이터 없음'}</span>
                    </div>
                  </div>
                </div>
                {/* 최고/최저 서브라인 */}
                <div className="row-flex gap-16" style={{ marginTop: 10, paddingTop: 8, borderTop: '0.5px dashed var(--bs)' }}>
                  <InfoRow label={`최고 순위 (${rankPeriodLabel})`} value={`#${minRank}`} />
                  <InfoRow label={`최저 순위 (${rankPeriodLabel})`} value={`#${maxRank}`} />
                  <InfoRow label="평균 순위" value={`#${Math.round(rankMean)}`} />
                </div>
              </section>
            )}

            {/* Reviews — 자사 상품만 */}
            <section className="panel">
              <div className="sec-head"><h3>최근 리뷰 <span className="sub">{detail.is_own ? '최신 10건' : '자사 상품만 수집'}</span></h3></div>
              {!detail.is_own ? (
                <div style={{ fontSize: 12, color: 'var(--f4)', padding: '16px 0' }}>경쟁사 상품 — 리뷰 수집 대상이 아닙니다.</div>
              ) : reviews.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--f4)', padding: '16px 0' }}>수집된 리뷰가 없습니다.</div>
              ) : (
                <div className="col-flex gap-8">
                  {reviews.map((r, i) => (
                    <div key={r.id} className="panel compact" style={{ background: i % 2 ? 'var(--snk)' : 'transparent' }}>
                      <div className="row-flex between center" style={{ marginBottom: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className="mono" style={{ fontSize: 12, color: r.rating >= 4 ? 'var(--up)' : r.rating <= 2 ? 'var(--dn)' : 'var(--f2)' }}>
                            {'★'.repeat(r.rating > 0 ? r.rating : 0)}{'☆'.repeat(r.rating > 0 ? 5 - r.rating : 5)}
                          </span>
                          {r.has_image && (
                            <span style={{ fontSize: 9, background: 'var(--hs)', color: '#fff', padding: '1px 5px', borderRadius: 2 }}>사진</span>
                          )}
                        </div>
                        <span className="mono dim" style={{ fontSize: 10 }}>{r.review_date}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--f2)', lineHeight: '18px' }}>
                        {r.review_text
                          ? r.review_text.slice(0, 200) + (r.review_text.length > 200 ? '…' : '')
                          : <span className="dim">내용 없음</span>}
                      </div>
                      {r.helpful_count > 0 && (
                        <div className="mono dim" style={{ fontSize: 10, marginTop: 4 }}>도움됨 {r.helpful_count}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
