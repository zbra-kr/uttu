'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { PeriodFilter, FilterBlock, PillGroup, CheckRow, DismissChip } from '@/components/ui/filters';
import { IcChevL, IcChevR, IcSnap, IcX } from '@/components/ui/icons';
import {
  getLatestSnapDate, getUserSnapRankings, getBrandSnaps, getCodishopSnaps,
  getSnapProducts, getSnapLabels, getProfileRankings, getProfileSnaps,
  getSnapProfilesBySnapIds, getProfileSnapStats, getProfileModelFallbacks, getBrandInfoBySnapIds,
  SNAP_STYLE_FILTERS,
  type SnapRankRow, type SnapRow, type SnapProductRow, type LabelMaster,
  type SnapProfileRow, type SnapProfileInfo, type ProfileSnapStats, type ProfileModelFallback, type BrandSnapInfo,
} from '@/lib/queries-snap';

type Tab        = 'USER' | 'MEMBER' | 'BRAND_PROFILE' | 'BRAND' | 'CODISHOP';
type SortOpt    = 'latest' | 'likes' | 'views';
type SnapSort   = 'rank' | 'likes' | 'views' | 'goods_click';
type MemberSort = 'rank' | 'follower' | 'snap';

const H_MIN = 150, H_MAX = 200;
const W_MIN = 40,  W_MAX = 100;

const GENDER_OPTS: [string, string][] = [['ALL', '전체'], ['WOMEN', '여성'], ['MEN', '남성']];
const SORT_OPTS:   [string, string][] = [['latest', '최신순'], ['likes', '좋아요순'], ['views', '조회순']];
const SNAP_SORT_OPTS:   [SnapSort, string][]   = [['rank', '랭킹순'], ['likes', '좋아요순'], ['views', '조회순'], ['goods_click', '상품클릭순']];
const MEMBER_SORT_OPTS: [MemberSort, string][] = [['rank', '랭킹순'], ['follower', '팔로워순'], ['snap', '게시물순']];
const TAB_OPTS: [Tab, string][] = [
  ['USER',          '스냅 랭킹'],
  ['MEMBER',        '멤버 랭킹'],
  ['BRAND_PROFILE', '브랜드 랭킹'],
  ['BRAND',         '브랜드 스냅'],
  ['CODISHOP',      '코디샵'],
];
const PAGE_SIZE = 50;

function fmt(n: number) {
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000)  return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
function rc(rank: number) {
  return rank === 1 ? '#F59E0B' : rank === 2 ? 'var(--f2)' : rank === 3 ? 'var(--shf)' : 'var(--f3)';
}
function normImgUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('/')) return `https://image.musinsa.com${url}`;
  return url;
}
// ── AlwaysPhoto ────────────────────────────────────────────────────────────────
function AlwaysPhoto({ url }: { url: string | null }) {
  const s: React.CSSProperties = { width: 72, height: 96, borderRadius: 4, flexShrink: 0, display: 'block' };
  if (!url) return (
    <div style={{ ...s, background: 'var(--snk)', border: '0.5px solid var(--bs)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--f4)' }}>
      <IcSnap size={18} />
    </div>
  );
  return <img src={url} alt="" style={{ ...s, objectFit: 'cover' }} loading="lazy" />;
}

// ── ThumbnailCell (BRAND / CODI 탭) ───────────────────────────────────────────
function ThumbnailCell({ url, id, shown, onShow }: { url: string | null; id: string; shown: boolean; onShow: (id: string) => void }) {
  const base: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 48, borderRadius: 3, background: 'var(--snk)', color: 'var(--f4)' };
  if (!url) return <span style={base}><IcSnap size={14} /></span>;
  if (shown) return <img src={url} alt="" style={{ width: 36, height: 48, objectFit: 'cover', borderRadius: 3, display: 'block' }} />;
  return (
    <button onClick={e => { e.stopPropagation(); onShow(id); }} title="클릭하여 이미지 로드"
      style={{ ...base, border: '0.5px solid var(--bs)', cursor: 'pointer' }}>
      <IcSnap size={14} />
    </button>
  );
}

// ── AvatarCell ─────────────────────────────────────────────────────────────────
function AvatarCell({ url, name, size = 28 }: { url: string | null; name: string; size?: number }) {
  if (url) return <img src={url} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', display: 'block', flexShrink: 0 }} />;
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'var(--snk)', border: '0.5px solid var(--bs)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: Math.round(size * 0.36), color: 'var(--f3)', flexShrink: 0 }}>
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

// ── RankChange ─────────────────────────────────────────────────────────────────
function RankChange({ curr, prev }: { curr: number; prev: number | null }) {
  if (prev === null) return <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--tu)' }}>NEW</span>;
  const diff = prev - curr;
  if (diff === 0) return <span className="dim" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>—</span>;
  return <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: diff > 0 ? 'var(--tu)' : 'var(--td)' }}>{diff > 0 ? `▲${diff}` : `▼${Math.abs(diff)}`}</span>;
}

// ── RangeSlider — ranking 페이지와 동일한 구현 ────────────────────────────────
function RangeSlider({ min, max, value, onChange }: {
  min: number; max: number; value: [number, number]; onChange: (v: [number, number]) => void;
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
      <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 4, background: 'var(--snk)', borderRadius: 2, transform: 'translateY(-50%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', top: '50%', left: `${p0}%`, width: `${p1 - p0}%`, height: 4, background: 'var(--f1)', borderRadius: 2, transform: 'translateY(-50%)', pointerEvents: 'none' }} />
      <div onMouseDown={e => { e.preventDefault(); setDragging(0); }} onTouchStart={e => { e.preventDefault(); setDragging(0); }}
        style={{ position: 'absolute', top: '50%', left: `${p0}%`, width: 20, height: 20, borderRadius: '50%', background: 'var(--rai)', border: '2px solid var(--f1)', transform: 'translate(-50%,-50%)', cursor: dragging === 0 ? 'grabbing' : 'grab', zIndex: value[0] >= max - 1 ? 3 : 1, boxSizing: 'border-box', touchAction: 'none' }} />
      <div onMouseDown={e => { e.preventDefault(); setDragging(1); }} onTouchStart={e => { e.preventDefault(); setDragging(1); }}
        style={{ position: 'absolute', top: '50%', left: `${p1}%`, width: 20, height: 20, borderRadius: '50%', background: 'var(--rai)', border: '2px solid var(--f1)', transform: 'translate(-50%,-50%)', cursor: dragging === 1 ? 'grabbing' : 'grab', zIndex: 2, boxSizing: 'border-box', touchAction: 'none' }} />
    </div>
  );
}

// ── HashtagSearch ──────────────────────────────────────────────────────────────
function HashtagSearch({ allTags, selected, onAdd, onRemove }: {
  allTags: string[]; selected: Set<string>; onAdd: (t: string) => void; onRemove: (t: string) => void;
}) {
  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const suggestions = React.useMemo(() => {
    if (!q.trim()) return [];
    const lower = q.toLowerCase().replace(/^#/, '');
    return allTags.filter(t => t.toLowerCase().includes(lower) && !selected.has(t)).slice(0, 10);
  }, [q, allTags, selected]);

  React.useEffect(() => { setOpen(suggestions.length > 0); }, [suggestions.length]);

  return (
    <div>
      {[...selected].length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
          {[...selected].map(t => (
            <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--f2)', background: 'var(--snk)', border: '0.5px solid var(--bs)', borderRadius: 3, padding: '2px 6px' }}>
              #{t}
              <button onClick={() => onRemove(t)} style={{ background: 'none', border: 'none', padding: '0 0 0 2px', cursor: 'pointer', color: 'var(--f4)', fontSize: 12, lineHeight: 1 }}>×</button>
            </span>
          ))}
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <input value={q} onChange={e => setQ(e.target.value)}
          onFocus={() => setOpen(suggestions.length > 0)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="태그 검색…"
          style={{ width: '100%', height: 26, padding: '0 8px', background: 'var(--rai)', border: '0.5px solid var(--bd)', borderRadius: 'var(--r-2)', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--f1)', outline: 'none', boxSizing: 'border-box' }} />
        {open && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 40, background: 'var(--sur)', border: '0.5px solid var(--bs)', borderRadius: 'var(--r-2)', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: 200, overflowY: 'auto', marginTop: 2 }}>
            {suggestions.map(t => (
              <button key={t} onMouseDown={() => { onAdd(t); setQ(''); setOpen(false); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 10px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--f2)', background: 'none', border: 'none', cursor: 'pointer', borderBottom: '0.5px solid var(--bs)' }}>
                #{t}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── LightboxOverlay ───────────────────────────────────────────────────────────
function LightboxOverlay({ url, onClose }: { url: string; onClose: () => void }) {
  React.useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 70, cursor: 'zoom-out' }} />
      <div style={{ position: 'fixed', inset: 0, zIndex: 71, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <img src={url} alt="" style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 6, boxShadow: '0 8px 48px rgba(0,0,0,0.5)', pointerEvents: 'auto' }} onClick={e => e.stopPropagation()} />
      </div>
    </>
  );
}

// ── SnapModal ──────────────────────────────────────────────────────────────────
function SnapModal({ snap, rankRow, onClose, onHashtagClick, onLightbox }: {
  snap: SnapRow; rankRow?: SnapRankRow; onClose: () => void; onHashtagClick?: (tag: string) => void;
  onLightbox: (url: string) => void;
}) {
  const router = useRouter();
  const [products,     setProducts]     = React.useState<SnapProductRow[]>([]);
  const [prodLoading,  setProdLoading]  = React.useState(true);
  const [textExpanded, setTextExpanded] = React.useState(false);
  const [imgFit,       setImgFit]       = React.useState<'cover' | 'contain'>('cover');

  React.useEffect(() => {
    getSnapProducts(snap.snap_id)
      .then(rows => setProducts(rows.filter(p => p.product_name !== '(stub)')))
      .catch(() => setProducts([]))
      .finally(() => setProdLoading(false));
  }, [snap.snap_id]);

  React.useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  const rank      = rankRow?.rank_position;
  const prev      = rankRow?.prev_rank_position ?? null;
  const diff      = rank !== undefined && prev !== null ? prev - rank : null;
  const color     = rank !== undefined ? rc(rank) : 'var(--f1)';
  const gLabel    = snap.model_gender === 'WOMEN' ? '여성' : snap.model_gender === 'MEN' ? '남성' : (snap.model_gender ?? null);
  const hasText   = !!snap.content_text?.trim();
  const isLong    = hasText && snap.content_text!.length > 100;
  const typeLabel = snap.content_type === 'BRAND_SNAP' ? 'BRAND SNAP' : snap.content_type === 'CODISHOP_SNAP' ? 'CODISHOP' : 'USER SNAP';
  const SL: React.CSSProperties = { fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--f4)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.28)', backdropFilter: 'blur(2px)', zIndex: 50 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 720, maxWidth: '94vw', maxHeight: '92vh', background: 'var(--sur)', borderRadius: 'var(--r-4)', border: '0.5px solid var(--bs)', boxShadow: '0 8px 32px rgba(0,0,0,0.14)', zIndex: 51, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', borderBottom: '0.5px solid var(--bs)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--f4)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{typeLabel}</span>
            {rank !== undefined && <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, color }}># {rank}</span>}
            {rank !== undefined && (prev === null
              ? <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--tu)' }}>NEW</span>
              : diff !== null && diff !== 0
                ? <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: diff > 0 ? 'var(--tu)' : 'var(--td)' }}>{diff > 0 ? `▲${diff}` : `▼${Math.abs(diff)}`}</span>
                : null)}
            {rankRow?.highlight && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: '#F59E0B', background: 'rgba(245,158,11,0.1)', borderRadius: 3, padding: '1px 5px', border: '0.5px solid rgba(245,158,11,0.3)' }}>{rankRow.highlight}</span>}
          </div>
          <button onClick={onClose} style={{ width: 26, height: 26, border: '0.5px solid var(--bd)', borderRadius: 'var(--r-2)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--f3)' }}><IcX size={14} /></button>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* 이미지 — 280×280, 비율 토글 */}
          <div style={{ width: 280, height: 280, flexShrink: 0, background: 'var(--snk)', borderRight: '0.5px solid var(--bs)', overflow: 'hidden', alignSelf: 'flex-start', position: 'relative' }}>
            {snap.thumbnail_url
              ? <img src={snap.thumbnail_url} alt="" loading="lazy"
                  onClick={() => onLightbox(snap.thumbnail_url!)}
                  style={{ width: '100%', height: '100%', objectFit: imgFit, display: 'block', cursor: 'zoom-in' }} />
              : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--f4)' }}>
                  <IcSnap size={36} />
                </div>}
            {/* 비율 토글 버튼 */}
            <button onClick={() => setImgFit(f => f === 'cover' ? 'contain' : 'cover')}
              title={imgFit === 'cover' ? '원본 비율 보기' : '크롭 보기'}
              style={{ position: 'absolute', bottom: 8, left: 8, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 10, padding: '2px 7px', borderRadius: 3, border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)' }}>
              {imgFit === 'cover' ? '원본비율' : '크롭'}
            </button>
            {/* 무신사 링크 */}
            {snap.thumbnail_url && (
              <a href={`https://www.musinsa.com/snap/${snap.snap_id}`} target="_blank" rel="noopener noreferrer"
                style={{ position: 'absolute', bottom: 8, right: 8, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 10, padding: '2px 8px', borderRadius: 3, textDecoration: 'none', fontFamily: 'var(--mono)' }}>
                무신사↗
              </a>
            )}
          </div>

          {/* 정보 + 상품 (스크롤) */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--f4)' }}>{snap.published_at.slice(0, 10)}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--bd)' }}>{snap.snap_id.slice(-12)}</span>
              </div>

              {(gLabel || snap.model_height || snap.model_weight || snap.model_skin_tone) && (
                <div>
                  <div style={SL}>MODEL</div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {gLabel               && <span className="chip">{gLabel}</span>}
                    {snap.model_height    && <span className="chip mono">{snap.model_height}cm</span>}
                    {snap.model_weight    && <span className="chip mono">{snap.model_weight}kg</span>}
                    {snap.model_skin_tone && <span className="chip">{snap.model_skin_tone}</span>}
                  </div>
                </div>
              )}

              {hasText && (
                <div>
                  <div style={SL}>DESCRIPTION</div>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--f2)', lineHeight: 1.7, whiteSpace: 'pre-wrap', overflow: 'hidden', display: '-webkit-box' as any, WebkitBoxOrient: 'vertical', WebkitLineClamp: textExpanded ? ('unset' as any) : 4 }}>{snap.content_text}</p>
                  {isLong && <button onClick={() => setTextExpanded(v => !v)} style={{ marginTop: 3, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--f4)' }}>{textExpanded ? '접기 ↑' : '더 보기 ↓'}</button>}
                </div>
              )}

              {snap.hashtags && snap.hashtags.length > 0 && (
                <div>
                  <div style={SL}>TAGS</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {snap.hashtags.map((t, i) => (
                      <span key={i}
                        onClick={onHashtagClick ? () => { onHashtagClick(t); onClose(); } : undefined}
                        style={{ fontFamily: 'var(--mono)', fontSize: 10, color: onHashtagClick ? 'var(--f2)' : 'var(--f3)', background: 'var(--snk)', borderRadius: 3, padding: '2px 6px', border: '0.5px solid var(--bs)', cursor: onHashtagClick ? 'pointer' : 'default' }}>
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div style={SL}>STATS</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 16px' }}>
                  {([['❤ 좋아요', snap.like_count], ['👁 조회수', snap.view_count], ['🔖 스크랩', snap.scrap_count], ['🛍 상품클릭', snap.goods_click_count], ['💬 댓글', snap.comment_count], ['👆 클릭', snap.click_count]] as [string, number][]).map(([label, val], i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 11, color: 'var(--f4)' }}>{label}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--f2)', fontWeight: 500 }}>{val.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ padding: '14px 16px', borderTop: '0.5px solid var(--bs)' }}>
              <div style={SL}>연결 상품 {!prodLoading && `(${products.length}건)`}</div>
              {prodLoading
                ? Array.from({ length: 3 }).map((_, i) => <div key={i} style={{ height: 44, background: 'var(--rai)', borderRadius: 4, marginBottom: 6 }} />)
                : products.length === 0
                  ? <p style={{ margin: 0, fontSize: 12, color: 'var(--f4)' }}>연결된 상품 없음</p>
                  : products.map((p, i) => (
                      <div key={i} onClick={() => { if (p.musinsa_no) { onClose(); router.push(`/product?no=${p.musinsa_no}`); } }}
                        style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 0', borderBottom: i < products.length - 1 ? '0.5px solid var(--bs)' : 'none', cursor: p.musinsa_no ? 'pointer' : 'default' }}>
                        {normImgUrl(p.thumbnail_url) ? <img src={normImgUrl(p.thumbnail_url)!} alt="" style={{ width: 38, height: 38, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} /> : <div style={{ width: 38, height: 38, background: 'var(--snk)', borderRadius: 4, flexShrink: 0 }} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, color: p.musinsa_no ? 'var(--f1)' : 'var(--f3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.product_name}</div>
                          <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 1 }}>{p.brand_name}{p.option_name ? ` · ${p.option_name}` : ''}</div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                          {p.list_price != null && p.list_price > 0 && (
                            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--f4)', textDecoration: 'line-through' }}>{p.list_price.toLocaleString()}원</span>
                          )}
                          {p.final_price != null && p.final_price > 0 && (
                            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--f1)', fontWeight: 600 }}>{p.final_price.toLocaleString()}원</span>
                          )}
                          {p.discount_rate != null && p.discount_rate > 0 && (
                            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--shf)', fontWeight: 500 }}>-{Math.round(Number(p.discount_rate))}%</span>
                          )}
                        </div>
                      </div>
                    ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── ProfilePanel ───────────────────────────────────────────────────────────────
function ProfilePanel({ profile, date, onSnapClick, onClose }: { profile: SnapProfileRow; date: string; onSnapClick: (s: SnapRow) => void; onClose: () => void }) {
  const [snaps,   setSnaps]   = React.useState<SnapRow[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    setLoading(true);
    getProfileSnaps(profile.id, date).then(setSnaps).catch(() => setSnaps([])).finally(() => setLoading(false));
  }, [profile.id, date]);

  React.useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  const rank   = profile.rank_position;
  const prev   = profile.prev_rank_position;
  const isUser = profile.profile_type === 'USER';
  const SL: React.CSSProperties = { fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--f4)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 };

  // 프로필에 값 없을 때 최근 스냅 model_* 필드로 fallback
  const modelFallback = React.useMemo(() => {
    const sorted = [...snaps].sort((a, b) => b.published_at.localeCompare(a.published_at));
    let gender: string | null = null, height: number | null = null;
    let weight: number | null = null, skin_tone: string | null = null;
    for (const s of sorted) {
      if (!gender    && s.model_gender)    gender    = s.model_gender;
      if (!height    && s.model_height)    height    = s.model_height;
      if (!weight    && s.model_weight)    weight    = s.model_weight;
      if (!skin_tone && s.model_skin_tone) skin_tone = s.model_skin_tone;
      if (gender && height && weight && skin_tone) break;
    }
    return { gender, height, weight, skin_tone };
  }, [snaps]);
  const dGender  = profile.gender    ?? modelFallback.gender;
  const dHeight  = profile.height    ?? modelFallback.height;
  const dWeight  = profile.weight    ?? modelFallback.weight;
  const dSkinTone = profile.skin_tone ?? modelFallback.skin_tone;

  const totalLikes      = snaps.reduce((s, r) => s + (r.like_count       ?? 0), 0);
  const totalViews      = snaps.reduce((s, r) => s + (r.view_count       ?? 0), 0);
  const totalScraps     = snaps.reduce((s, r) => s + (r.scrap_count      ?? 0), 0);
  const totalGoodsClick = snaps.reduce((s, r) => s + (r.goods_click_count ?? 0), 0);
  const totalComments   = snaps.reduce((s, r) => s + (r.comment_count    ?? 0), 0);

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.28)', backdropFilter: 'blur(2px)', zIndex: 50 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 680, maxWidth: '94vw', maxHeight: '92vh', background: 'var(--sur)', borderRadius: 'var(--r-4)', border: '0.5px solid var(--bs)', boxShadow: '0 8px 32px rgba(0,0,0,0.14)', zIndex: 51, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', borderBottom: '0.5px solid var(--bs)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <AvatarCell url={profile.profile_image_url} name={profile.nickname} size={38} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.nickname}</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, color: rc(rank) }}>#{rank}</span>
                <RankChange curr={rank} prev={prev} />
                {isUser && profile.badge_title && <span className="chip" style={{ fontSize: 10 }}>{profile.badge_title}</span>}
                {isUser && profile.skin_tone    && <span className="chip" style={{ fontSize: 10 }}>{profile.skin_tone}</span>}
                {!isUser && profile.brand_code  && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--f4)' }}>{profile.brand_code}</span>}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <a href={`https://www.musinsa.com/snap/profiles/${profile.id}`} target="_blank" rel="noopener noreferrer"
              style={{ height: 26, padding: '0 10px', display: 'inline-flex', alignItems: 'center', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--f3)', background: 'transparent', border: '0.5px solid var(--bd)', borderRadius: 'var(--r-2)', textDecoration: 'none', letterSpacing: '0.03em', whiteSpace: 'nowrap' }}>
              무신사↗
            </a>
            <button onClick={onClose} style={{ width: 26, height: 26, border: '0.5px solid var(--bd)', borderRadius: 'var(--r-2)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--f3)', flexShrink: 0 }}><IcX size={14} /></button>
          </div>
        </div>

        {/* 본문 — 좌: 기본정보, 우: 스냅 그리드 */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* 좌 */}
          <div style={{ width: 230, flexShrink: 0, padding: 16, display: 'flex', flexDirection: 'column', gap: 14, borderRight: '0.5px solid var(--bs)', overflowY: 'auto' }}>
            {profile.bio && (
              <div>
                <div style={SL}>BIO</div>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--f3)', lineHeight: 1.65 }}>{profile.bio}</p>
              </div>
            )}

            {/* 프로필 기본 수치 */}
            <div>
              <div style={SL}>프로필</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1 }}>
                {([
                  ['팔로워', profile.follower_count > 0 ? profile.follower_count.toLocaleString() : '—'],
                  ['팔로잉', profile.following_count > 0 ? profile.following_count.toLocaleString() : '—'],
                  ['게시물', profile.snap_count > 0 ? profile.snap_count.toLocaleString() : '—'],
                ] as [string, string][]).map(([label, val], i, arr) => (
                  <div key={i} style={{ padding: '8px 0', textAlign: 'center', background: 'var(--snk)', borderRadius: i === 0 ? '4px 0 0 4px' : i === arr.length - 1 ? '0 4px 4px 0' : '0', border: '0.5px solid var(--bs)' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: 'var(--f1)' }}>{val}</div>
                    <div style={{ fontSize: 10, color: 'var(--f4)', marginTop: 2 }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 개인 정보 (USER만, 항상 표시) */}
            {isUser && (
              <div>
                <div style={SL}>개인 정보</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {([
                    ['성별',   dGender   ? (dGender === 'WOMEN' ? '여성' : dGender === 'MEN' ? '남성' : dGender) : '—'],
                    ['키',     dHeight   ? `${dHeight}cm` : '—'],
                    ['몸무게', dWeight   ? `${dWeight}kg` : '—'],
                    ['피부톤', dSkinTone ?? '—'],
                  ] as [string, string][]).map(([label, val]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '0.5px solid var(--bs)' }}>
                      <span style={{ fontSize: 11, color: 'var(--f4)' }}>{label}</span>
                      <span style={{ fontFamily: val === '—' ? 'inherit' : 'var(--mono)', fontSize: 11, color: val === '—' ? 'var(--f4)' : 'var(--f2)' }}>{val}</span>
                    </div>
                  ))}
                  {profile.badge_title && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '0.5px solid var(--bs)' }}>
                      <span style={{ fontSize: 11, color: 'var(--f4)' }}>뱃지</span>
                      <span style={{ fontSize: 11, color: 'var(--f2)' }}>{profile.badge_title}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 스냅 집계 (스냅 로드 완료 후) */}
            {!loading && snaps.length > 0 && (
              <div>
                <div style={SL}>스냅 집계 ({snaps.length}건)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {([
                    ['❤ 좋아요',   totalLikes],
                    ['👁 조회',     totalViews],
                    ['🔖 스크랩',   totalScraps],
                    ['🛍 상품클릭', totalGoodsClick],
                    ['💬 댓글',     totalComments],
                  ] as [string, number][]).map(([label, val]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '0.5px solid var(--bs)' }}>
                      <span style={{ fontSize: 11, color: 'var(--f4)' }}>{label}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--f2)', fontWeight: 500 }}>{val.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 우 — 스냅 그리드 */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            <div style={SL}>RECENT SNAPS</div>
            {loading ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                {Array.from({ length: 6 }).map((_, i) => <div key={i} style={{ aspectRatio: '3/4', background: 'var(--rai)', borderRadius: 'var(--r-2)' }} />)}
              </div>
            ) : snaps.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--f4)' }}>수집된 스냅 없음</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                {snaps.map(snap => (
                  <div key={snap.snap_id} onClick={() => onSnapClick(snap)}
                    style={{ aspectRatio: '3/4', background: 'var(--snk)', borderRadius: 'var(--r-2)', overflow: 'hidden', cursor: 'pointer', position: 'relative', border: '0.5px solid var(--bs)' }}>
                    {snap.thumbnail_url
                      ? <img src={snap.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--f4)' }}><IcSnap size={18} /></div>}
                    <div style={{ position: 'absolute', bottom: 5, right: 5, background: 'rgba(0,0,0,0.55)', borderRadius: 3, padding: '1px 5px', fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--rai)' }}>
                      ❤ {fmt(snap.like_count)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── SnapPage ───────────────────────────────────────────────────────────────────
export default function SnapPage() {
  const [tab, setTab] = React.useState<Tab>('USER');

  // common
  const [snapDate,  setSnapDate]  = React.useState('');
  const [labels,    setLabels]    = React.useState<LabelMaster[]>([]);

  // USER 서버 필터 (기간 + 스타일)
  const [period,     setPeriod]     = React.useState('today');
  const [fromDate,   setFromDate]   = React.useState('');
  const [toDate,     setToDate]     = React.useState('');
  const [selStyles,  setSelStyles]  = React.useState<Set<string>>(new Set(['ALL'])); // 'ALL'이 하나의 스타일 카테고리

  const { snapFromDate, snapToDate } = React.useMemo(() => {
    const todayKST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    if (period === 'today')  return { snapFromDate: todayKST, snapToDate: todayKST };
    if (period === 'custom') return { snapFromDate: fromDate || todayKST, snapToDate: toDate || todayKST };
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    d.setDate(d.getDate() - (days - 1));
    const fromKST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
    return { snapFromDate: fromKST, snapToDate: todayKST };
  }, [period, fromDate, toDate]);

  // USER 클라이언트 필터 (model_* 기준 — DB 실제 값: '여'/'남')
  const [filterGender, setFilterGender] = React.useState('ALL');
  const [heightRange,  setHeightRange]  = React.useState<[number, number]>([H_MIN, H_MAX]);
  const [weightRange,  setWeightRange]  = React.useState<[number, number]>([W_MIN, W_MAX]);
  const [selHashtags,  setSelHashtags]  = React.useState<Set<string>>(new Set());
  const [snapSort,     setSnapSort]     = React.useState<SnapSort>('rank');
  const [snapSortDir,  setSnapSortDir]  = React.useState<'asc' | 'desc'>('asc');

  // MEMBER 정렬 & 필터
  const [memberSort,        setMemberSort]        = React.useState<MemberSort>('rank');
  const [memberSortDir,     setMemberSortDir]     = React.useState<'asc' | 'desc'>('asc');
  const [memberGender,      setMemberGender]      = React.useState('ALL');
  const [memberHeightRange, setMemberHeightRange] = React.useState<[number, number]>([H_MIN, H_MAX]);
  const [memberWeightRange, setMemberWeightRange] = React.useState<[number, number]>([W_MIN, W_MAX]);
  const [memberSkinTones,   setMemberSkinTones]   = React.useState<Set<string>>(new Set());
  const [memberFollower,    setMemberFollower]    = React.useState<[number, number]>([0, 1000000]);
  const [memberFallbacks,   setMemberFallbacks]   = React.useState<Map<string, ProfileModelFallback>>(new Map());

  // BRAND 필터
  const [brandSort,        setBrandSort]        = React.useState<SortOpt>('latest');
  const [brandSortDir,     setBrandSortDir]     = React.useState<'asc' | 'desc'>('desc');
  const [brandGender,      setBrandGender]      = React.useState('ALL');
  const [brandHeightRange, setBrandHeightRange] = React.useState<[number, number]>([H_MIN, H_MAX]);
  const [brandWeightRange, setBrandWeightRange] = React.useState<[number, number]>([W_MIN, W_MAX]);
  const [brandHashtags,    setBrandHashtags]    = React.useState<Set<string>>(new Set());
  const [brandLabelIds,    setBrandLabelIds]    = React.useState<Set<number>>(new Set());
  // CODISHOP 필터
  const [codiSort,         setCodiSort]         = React.useState<SortOpt>('latest');
  const [codiSortDir,      setCodiSortDir]      = React.useState<'asc' | 'desc'>('desc');
  const [codiGender,       setCodiGender]       = React.useState('ALL');
  const [codiHeightRange,  setCodiHeightRange]  = React.useState<[number, number]>([H_MIN, H_MAX]);
  const [codiWeightRange,  setCodiWeightRange]  = React.useState<[number, number]>([W_MIN, W_MAX]);
  const [codiHashtags,     setCodiHashtags]     = React.useState<Set<string>>(new Set());
  const [codiLabelIds,     setCodiLabelIds]     = React.useState<Set<number>>(new Set());

  // 데이터
  const [userRows,      setUserRows]      = React.useState<SnapRankRow[]>([]);
  const [memberRows,    setMemberRows]    = React.useState<SnapProfileRow[]>([]);
  const [brandProfiles, setBrandProfiles] = React.useState<SnapProfileRow[]>([]);
  const [brandRows,     setBrandRows]     = React.useState<SnapRow[]>([]);
  const [codiRows,      setCodiRows]      = React.useState<SnapRow[]>([]);
  const [brandTotal,    setBrandTotal]    = React.useState(0);
  const [codiTotal,     setCodiTotal]     = React.useState(0);
  const [brandPage,     setBrandPage]     = React.useState(0);
  const [codiPage,      setCodiPage]      = React.useState(0);
  const [loading,       setLoading]       = React.useState(false);
  const [error,         setError]         = React.useState<string | null>(null);
  const [filtersLoaded, setFiltersLoaded] = React.useState(false);

  const [shownImages, setShownImages] = React.useState<Set<string>>(new Set());
  const showImage = (id: string) => setShownImages(p => new Set([...p, id]));

  const [modal,         setModal]         = React.useState<{ snap: SnapRow; rankRow?: SnapRankRow } | null>(null);
  const [profile,       setProfile]       = React.useState<SnapProfileRow | null>(null);
  const [lightboxUrl,   setLightboxUrl]   = React.useState<string | null>(null);
  const [snapProfiles,    setSnapProfiles]    = React.useState<Map<string, SnapProfileInfo>>(new Map());
  const [brandInfoMap,    setBrandInfoMap]    = React.useState<Map<string, BrandSnapInfo>>(new Map());
  const [memberStats,     setMemberStats]     = React.useState<Map<string, ProfileSnapStats>>(new Map());

  const brandLabelIdsArr = React.useMemo(() => [...brandLabelIds], [brandLabelIds]);
  const codiLabelIdsArr  = React.useMemo(() => [...codiLabelIds],  [codiLabelIds]);
  const multiDay = period !== 'today';

  const allHashtags = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of userRows) { if (r.hashtags) for (const t of r.hashtags) set.add(t); }
    return [...set].sort();
  }, [userRows]);

  const allBrandTags = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of brandRows) { if (r.hashtags) for (const t of r.hashtags) set.add(t); }
    return [...set].sort();
  }, [brandRows]);

  const allCodiTags = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of codiRows) { if (r.hashtags) for (const t of r.hashtags) set.add(t); }
    return [...set].sort();
  }, [codiRows]);

  const filteredUserRows = React.useMemo(() => {
    let rows = userRows;
    // model_gender: DB 실제 값 '여'/'남' — 서버 gender_filter는 항상 'ALL'이라 클라이언트 처리
    if (filterGender !== 'ALL')
      rows = rows.filter(r => r.model_gender === filterGender);
    if (heightRange[0] > H_MIN || heightRange[1] < H_MAX)
      rows = rows.filter(r => r.model_height == null || (r.model_height >= heightRange[0] && r.model_height <= heightRange[1]));
    if (weightRange[0] > W_MIN || weightRange[1] < W_MAX)
      rows = rows.filter(r => r.model_weight == null || (r.model_weight >= weightRange[0] && r.model_weight <= weightRange[1]));
    if (selHashtags.size > 0)
      rows = rows.filter(r => r.hashtags && [...selHashtags].every(t => r.hashtags!.includes(t)));
    return rows;
  }, [userRows, filterGender, heightRange, weightRange, selHashtags]);

  const sortedUserRows = React.useMemo(() => {
    const a = [...filteredUserRows];
    const asc = snapSortDir === 'asc';
    if (snapSort === 'likes')       return a.sort((x, y) => asc ? x.like_count - y.like_count : y.like_count - x.like_count);
    if (snapSort === 'views')       return a.sort((x, y) => asc ? x.view_count - y.view_count : y.view_count - x.view_count);
    if (snapSort === 'goods_click') return a.sort((x, y) => asc ? x.goods_click_count - y.goods_click_count : y.goods_click_count - x.goods_click_count);
    return a.sort((x, y) => asc ? x.rank_position - y.rank_position : y.rank_position - x.rank_position);
  }, [filteredUserRows, snapSort, snapSortDir]);

  const memberFollowerBounds = React.useMemo((): [number, number] => {
    if (memberRows.length === 0) return [0, 1000000];
    const counts = memberRows.map(r => r.follower_count);
    const lo = Math.min(...counts), hi = Math.max(...counts);
    return [lo, hi > lo ? hi : lo + 1];
  }, [memberRows]);

  // 데이터 로드마다 슬라이더를 전체 범위로 초기화
  React.useEffect(() => {
    setMemberFollower(memberFollowerBounds);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberFollowerBounds[0], memberFollowerBounds[1]]);

  const allMemberSkinTones = React.useMemo(() => {
    const s = new Set<string>();
    for (const r of memberRows) {
      const st = r.skin_tone ?? memberFallbacks.get(r.id)?.skin_tone;
      if (st) s.add(st);
    }
    return [...s].sort();
  }, [memberRows, memberFallbacks]);

  const filteredMemberRows = React.useMemo(() => {
    const fb = (r: SnapProfileRow) => memberFallbacks.get(r.id);
    const getG  = (r: SnapProfileRow) => r.gender    ?? fb(r)?.gender    ?? null;
    const getH  = (r: SnapProfileRow) => r.height    ?? fb(r)?.height    ?? null;
    const getW  = (r: SnapProfileRow) => r.weight    ?? fb(r)?.weight    ?? null;
    const getST = (r: SnapProfileRow) => r.skin_tone ?? fb(r)?.skin_tone ?? null;
    let rows = memberRows;
    if (memberGender !== 'ALL')
      rows = rows.filter(r => getG(r) === memberGender);
    if (memberHeightRange[0] > H_MIN || memberHeightRange[1] < H_MAX)
      rows = rows.filter(r => { const h = getH(r); return h == null || (h >= memberHeightRange[0] && h <= memberHeightRange[1]); });
    if (memberWeightRange[0] > W_MIN || memberWeightRange[1] < W_MAX)
      rows = rows.filter(r => { const w = getW(r); return w == null || (w >= memberWeightRange[0] && w <= memberWeightRange[1]); });
    if (memberSkinTones.size > 0)
      rows = rows.filter(r => { const st = getST(r); return st !== null && memberSkinTones.has(st); });
    if (memberFollower[0] > memberFollowerBounds[0] || memberFollower[1] < memberFollowerBounds[1])
      rows = rows.filter(r => r.follower_count >= memberFollower[0] && r.follower_count <= memberFollower[1]);
    return rows;
  }, [memberRows, memberGender, memberHeightRange, memberWeightRange, memberSkinTones, memberFollower, memberFollowerBounds, memberFallbacks]);

  const sortedMemberRows = React.useMemo(() => {
    const a = [...filteredMemberRows];
    const asc = memberSortDir === 'asc';
    if (memberSort === 'follower') return a.sort((x, y) => asc ? x.follower_count - y.follower_count : y.follower_count - x.follower_count);
    if (memberSort === 'snap')     return a.sort((x, y) => asc ? x.snap_count - y.snap_count : y.snap_count - x.snap_count);
    return a.sort((x, y) => asc ? x.rank_position - y.rank_position : y.rank_position - x.rank_position);
  }, [filteredMemberRows, memberSort, memberSortDir]);

  // 필터 복원 (localStorage) — 가장 먼저 실행
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem('snap-filters-v1');
      if (raw) {
        const s = JSON.parse(raw);
        if (s.tab)                    setTab(s.tab as Tab);
        if (s.period)                 setPeriod(s.period);
        if (s.fromDate)               setFromDate(s.fromDate);
        if (s.toDate)                 setToDate(s.toDate);
        if (Array.isArray(s.styles) && s.styles.length > 0)  setSelStyles(new Set(s.styles));
        if (s.filterGender)           setFilterGender(s.filterGender);
        if (Array.isArray(s.heightRange)) setHeightRange(s.heightRange as [number, number]);
        if (Array.isArray(s.weightRange)) setWeightRange(s.weightRange as [number, number]);
        if (Array.isArray(s.selHashtags)) setSelHashtags(new Set(s.selHashtags));
        if (s.snapSort)               setSnapSort(s.snapSort as SnapSort);
        if (s.snapSortDir)            setSnapSortDir(s.snapSortDir as 'asc' | 'desc');
        if (s.memberSort)             setMemberSort(s.memberSort as MemberSort);
        if (s.memberSortDir)          setMemberSortDir(s.memberSortDir as 'asc' | 'desc');
        if (s.memberGender)           setMemberGender(s.memberGender);
        if (Array.isArray(s.memberHeightRange)) setMemberHeightRange(s.memberHeightRange as [number, number]);
        if (Array.isArray(s.memberWeightRange)) setMemberWeightRange(s.memberWeightRange as [number, number]);
        if (Array.isArray(s.memberSkinTones))   setMemberSkinTones(new Set(s.memberSkinTones));
        if (Array.isArray(s.memberFollower))    setMemberFollower(s.memberFollower as [number, number]);
        if (s.brandSort)                        setBrandSort(s.brandSort as SortOpt);
        if (s.brandSortDir)                     setBrandSortDir(s.brandSortDir as 'asc' | 'desc');
        if (s.brandGender)                      setBrandGender(s.brandGender);
        if (Array.isArray(s.brandHeightRange))  setBrandHeightRange(s.brandHeightRange as [number, number]);
        if (Array.isArray(s.brandWeightRange))  setBrandWeightRange(s.brandWeightRange as [number, number]);
        if (Array.isArray(s.brandHashtags))     setBrandHashtags(new Set(s.brandHashtags));
        if (s.codiSort)                         setCodiSort(s.codiSort as SortOpt);
        if (s.codiSortDir)                      setCodiSortDir(s.codiSortDir as 'asc' | 'desc');
        if (s.codiGender)                       setCodiGender(s.codiGender);
        if (Array.isArray(s.codiHeightRange))   setCodiHeightRange(s.codiHeightRange as [number, number]);
        if (Array.isArray(s.codiWeightRange))   setCodiWeightRange(s.codiWeightRange as [number, number]);
        if (Array.isArray(s.codiHashtags))      setCodiHashtags(new Set(s.codiHashtags));
        if (Array.isArray(s.brandLabelIds))     setBrandLabelIds(new Set(s.brandLabelIds));
        if (Array.isArray(s.codiLabelIds))      setCodiLabelIds(new Set(s.codiLabelIds));
      }
    } catch {}
    setFiltersLoaded(true);
  }, []);

  // 필터 저장 (filtersLoaded=true 이후만)
  React.useEffect(() => {
    if (!filtersLoaded) return;
    try {
      localStorage.setItem('snap-filters-v1', JSON.stringify({
        tab, period, fromDate, toDate,
        styles:      [...selStyles],
        filterGender, heightRange, weightRange,
        selHashtags: [...selHashtags],
        snapSort, snapSortDir, memberSort, memberSortDir,
        memberGender, memberHeightRange, memberWeightRange,
        memberSkinTones: [...memberSkinTones], memberFollower,
        brandSort, brandSortDir, brandGender, brandHeightRange, brandWeightRange,
        brandHashtags: [...brandHashtags],
        codiSort, codiSortDir, codiGender, codiHeightRange, codiWeightRange,
        codiHashtags: [...codiHashtags],
        brandLabelIds: [...brandLabelIds], codiLabelIds: [...codiLabelIds],
      }));
    } catch {}
  }, [filtersLoaded, tab, period, fromDate, toDate, selStyles, filterGender, heightRange, weightRange, selHashtags, snapSort, snapSortDir, memberSort, memberSortDir, brandSort, brandSortDir, brandGender, brandHeightRange, brandWeightRange, brandHashtags, codiSort, codiSortDir, codiGender, codiHeightRange, codiWeightRange, codiHashtags, brandLabelIds, codiLabelIds]);

  // 초기 로드
  React.useEffect(() => {
    getLatestSnapDate().then(d => setSnapDate(d)).catch(console.error);
    getSnapLabels().then(setLabels).catch(console.error);
  }, []);

  // USER 탭
  const stylesKey = React.useMemo(
    () => selStyles.size > 0 ? [...selStyles].sort().join(',') : 'ALL',
    [selStyles],
  );
  React.useEffect(() => {
    if (tab !== 'USER' || !filtersLoaded) return;
    let c = false;
    setLoading(true); setError(null);
    const styles = stylesKey.split(',');
    getUserSnapRankings(snapFromDate, snapToDate, styles)
      .then(rows => { if (!c) setUserRows(rows); })
      .catch(e  => { if (!c) setError(String(e?.message ?? e)); })
      .finally(() => { if (!c) setLoading(false); });
    return () => { c = true; };
  }, [tab, snapFromDate, snapToDate, stylesKey, filtersLoaded]);

  // USER 탭 — 스냅 프로필 조인 (snap_profile_snaps 커버리지 내 snap_id만)
  React.useEffect(() => {
    if (tab !== 'USER' || userRows.length === 0) return;
    const ids = [...new Set(userRows.map(r => r.snap_id))];
    getSnapProfilesBySnapIds(ids).then(setSnapProfiles).catch(() => setSnapProfiles(new Map()));
  }, [tab, userRows]);

  // BRAND 탭 — 스냅별 브랜드 정보 조인
  React.useEffect(() => {
    if (brandRows.length === 0) { setBrandInfoMap(new Map()); return; }
    const ids = brandRows.map(r => r.snap_id);
    getBrandInfoBySnapIds(ids).then(setBrandInfoMap).catch(() => setBrandInfoMap(new Map()));
  }, [brandRows]);

  // MEMBER 탭 — 스냅 집계 통계
  React.useEffect(() => {
    if (memberRows.length === 0) { setMemberStats(new Map()); return; }
    const ids = [...new Set(memberRows.map(r => r.id))];
    getProfileSnapStats(ids, snapFromDate, snapToDate)
      .then(setMemberStats)
      .catch(() => setMemberStats(new Map()));
  }, [memberRows, snapFromDate, snapToDate]);

  // MEMBER 탭 — 프로필 모델 정보 fallback (프로필 값 없을 때 최근 스냅에서)
  React.useEffect(() => {
    if (memberRows.length === 0) { setMemberFallbacks(new Map()); return; }
    const needIds = memberRows
      .filter(r => !r.gender || !r.height || !r.weight || !r.skin_tone)
      .map(r => r.id);
    if (needIds.length === 0) { setMemberFallbacks(new Map()); return; }
    getProfileModelFallbacks(needIds)
      .then(setMemberFallbacks)
      .catch(() => setMemberFallbacks(new Map()));
  }, [memberRows]);

  // MEMBER 탭
  React.useEffect(() => {
    if (tab !== 'MEMBER' || !filtersLoaded) return;
    let c = false;
    setLoading(true); setError(null);
    getProfileRankings(snapFromDate, snapToDate, 'USER')
      .then(rows => { if (!c) setMemberRows(rows); })
      .catch(e  => { if (!c) setError(String(e?.message ?? e)); })
      .finally(() => { if (!c) setLoading(false); });
    return () => { c = true; };
  }, [tab, snapFromDate, snapToDate, filtersLoaded]);

  // BRAND_PROFILE 탭
  React.useEffect(() => {
    if (tab !== 'BRAND_PROFILE' || !snapDate || !filtersLoaded) return;
    let c = false;
    setLoading(true); setError(null);
    getProfileRankings(snapDate, snapDate, 'BRAND')
      .then(rows => { if (!c) setBrandProfiles(rows); })
      .catch(e  => { if (!c) setError(String(e?.message ?? e)); })
      .finally(() => { if (!c) setLoading(false); });
    return () => { c = true; };
  }, [tab, snapDate, filtersLoaded]);

  // BRAND 탭
  React.useEffect(() => {
    if (tab !== 'BRAND' || !filtersLoaded) return;
    let c = false;
    setLoading(true); setError(null);
    getBrandSnaps(brandPage, brandSort, {
      labelIds: brandLabelIdsArr, ascending: brandSortDir === 'asc',
      fromDate: snapFromDate, toDate: snapToDate, gender: brandGender,
      minHeight: brandHeightRange[0] > H_MIN ? brandHeightRange[0] : undefined,
      maxHeight: brandHeightRange[1] < H_MAX ? brandHeightRange[1] : undefined,
      minWeight: brandWeightRange[0] > W_MIN ? brandWeightRange[0] : undefined,
      maxWeight: brandWeightRange[1] < W_MAX ? brandWeightRange[1] : undefined,
      hashtags: brandHashtags.size > 0 ? [...brandHashtags] : undefined,
    })
      .then(({ rows, total }) => { if (!c) { setBrandRows(rows); setBrandTotal(total); } })
      .catch(e => { if (!c) setError(String(e?.message ?? e)); })
      .finally(() => { if (!c) setLoading(false); });
    return () => { c = true; };
  }, [tab, brandSort, brandSortDir, brandGender, brandHeightRange, brandWeightRange, brandHashtags, brandLabelIdsArr, brandPage, snapFromDate, snapToDate, filtersLoaded]);

  // CODISHOP 탭
  React.useEffect(() => {
    if (tab !== 'CODISHOP' || !filtersLoaded) return;
    let c = false;
    setLoading(true); setError(null);
    getCodishopSnaps(codiPage, codiSort, {
      labelIds: codiLabelIdsArr, ascending: codiSortDir === 'asc',
      fromDate: snapFromDate, toDate: snapToDate, gender: codiGender,
      minHeight: codiHeightRange[0] > H_MIN ? codiHeightRange[0] : undefined,
      maxHeight: codiHeightRange[1] < H_MAX ? codiHeightRange[1] : undefined,
      minWeight: codiWeightRange[0] > W_MIN ? codiWeightRange[0] : undefined,
      maxWeight: codiWeightRange[1] < W_MAX ? codiWeightRange[1] : undefined,
      hashtags: codiHashtags.size > 0 ? [...codiHashtags] : undefined,
    })
      .then(({ rows, total }) => { if (!c) { setCodiRows(rows); setCodiTotal(total); } })
      .catch(e => { if (!c) setError(String(e?.message ?? e)); })
      .finally(() => { if (!c) setLoading(false); });
    return () => { c = true; };
  }, [tab, codiSort, codiSortDir, codiGender, codiHeightRange, codiWeightRange, codiHashtags, codiLabelIdsArr, codiPage, snapFromDate, snapToDate, filtersLoaded]);

  // helpers
  const toggleLabel = (id: number) => {
    if (tab === 'BRAND') {
      setBrandLabelIds(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
      setBrandPage(0);
    } else {
      setCodiLabelIds(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
      setCodiPage(0);
    }
  };

  const addHashtag = (tag: string) => { setSelHashtags(p => new Set([...p, tag])); setTab('USER'); setModal(null); };

  const openProfile = (p: SnapProfileRow) => { setProfile(prev => prev?.id === p.id ? null : p); setModal(null); };

  const reset = () => {
    setPeriod('today'); setFromDate(''); setToDate('');
    setSelStyles(new Set(['ALL'])); setFilterGender('ALL');
    setHeightRange([H_MIN, H_MAX]); setWeightRange([W_MIN, W_MAX]);
    setSelHashtags(new Set()); setSnapSort('rank'); setSnapSortDir('asc');
    setMemberSort('rank'); setMemberSortDir('asc');
    setMemberGender('ALL'); setMemberHeightRange([H_MIN, H_MAX]);
    setMemberWeightRange([W_MIN, W_MAX]); setMemberSkinTones(new Set());
    setMemberFollower([0, 1000000]);
    setBrandSort('latest'); setBrandSortDir('desc'); setBrandGender('ALL');
    setBrandHeightRange([H_MIN, H_MAX]); setBrandWeightRange([W_MIN, W_MAX]); setBrandHashtags(new Set());
    setCodiSort('latest');  setCodiSortDir('desc');  setCodiGender('ALL');
    setCodiHeightRange([H_MIN, H_MAX]);  setCodiWeightRange([W_MIN, W_MAX]);  setCodiHashtags(new Set());
    setBrandLabelIds(new Set()); setCodiLabelIds(new Set());
    setBrandPage(0); setCodiPage(0);
  };

  const switchTab = (t: Tab) => { setTab(t); setProfile(null); setModal(null); };
  const setPage   = (p: number) => { if (tab === 'BRAND') setBrandPage(p); else setCodiPage(p); };

  // 컬럼 정의 (프로필 닉네임 + 팔로워 추가)
  const snapCols  = multiDay
    ? '72px 54px 38px 80px 50px 46px 52px 1fr 54px 54px 54px 60px'
    : '72px 54px 38px 50px 46px 52px 80px 1fr 54px 54px 54px 60px';
  const memberHas = React.useMemo(() => ({
    stats: memberStats.size > 0,
  }), [memberStats]);

  const memberCols = React.useMemo(() => [
    '40px',                          // 프로필 사진
    '48px',                          // 순위/변동
    multiDay ? '80px' : null,        // 날짜 (멀티데이만)
    '1fr',                           // 닉네임/성별
    '52px',                          // 키/몸무게
    '76px',                          // 팔로워/게시물
    memberHas.stats ? '60px' : null, // 조회/좋아요
  ].filter((x): x is string => x !== null).join(' '), [multiDay, memberHas]);
  const bprofCols     = '36px 38px 1fr 120px 80px 70px';
  const brandSnapCols = '72px 150px 42px 52px 76px 1fr 56px 56px';
  const listCols      = '72px 50px 46px 52px 80px 1fr 54px 54px 54px 60px';
  const cols = tab === 'USER' ? snapCols : tab === 'MEMBER' ? memberCols : tab === 'BRAND_PROFILE' ? bprofCols : tab === 'BRAND' ? brandSnapCols : listCols;
  const colCount = cols.split(' ').length;

  const currentTotal = tab === 'USER' ? sortedUserRows.length : tab === 'MEMBER' ? sortedMemberRows.length : tab === 'BRAND_PROFILE' ? brandProfiles.length : tab === 'BRAND' ? brandTotal : codiTotal;
  const currentPage  = tab === 'BRAND' ? brandPage : codiPage;
  const rawTotal     = tab === 'BRAND' ? brandTotal : codiTotal;
  const totalPages   = Math.ceil(rawTotal / PAGE_SIZE);

  // 적용된 칩 (USER 탭)
  const userChips: { key: string; label: string; dismiss: () => void }[] = [];
  if (tab === 'USER') {
    if (filterGender !== 'ALL') userChips.push({ key: 'g', label: GENDER_OPTS.find(([k]) => k === filterGender)?.[1] ?? filterGender, dismiss: () => setFilterGender('ALL') });
    for (const s of selStyles) {
      if (s === 'ALL' && selStyles.size === 1) continue; // 기본값 — 칩 불필요
      userChips.push({ key: `st-${s}`, label: SNAP_STYLE_FILTERS.find(f => f.value === s)?.label ?? s, dismiss: () => setSelStyles(p => { const n = new Set(p); n.delete(s); if (n.size === 0) n.add('ALL'); return n; }) });
    }
    if (heightRange[0] > H_MIN || heightRange[1] < H_MAX) userChips.push({ key: 'h', label: `키 ${heightRange[0]}~${heightRange[1]}cm`, dismiss: () => setHeightRange([H_MIN, H_MAX]) });
    if (weightRange[0] > W_MIN || weightRange[1] < W_MAX) userChips.push({ key: 'w', label: `몸무게 ${weightRange[0]}~${weightRange[1]}kg`, dismiss: () => setWeightRange([W_MIN, W_MAX]) });
    for (const t of selHashtags) userChips.push({ key: `ht-${t}`, label: `#${t}`, dismiss: () => setSelHashtags(p => { const n = new Set(p); n.delete(t); return n; }) });
  }

  // 라벨 그룹 (BRAND/CODI)
  const labelGroups = React.useMemo(() => {
    const map = new Map<string, typeof labels>();
    for (const l of labels) {
      if (!map.has(l.category_name)) map.set(l.category_name, []);
      map.get(l.category_name)!.push(l);
    }
    return [...map.entries()];
  }, [labels]);

  return (
    <>
      <div className="page-title">
        <h1>스냅</h1>
        <span className="chip mono">{currentTotal.toLocaleString()}건</span>
        <span className="sub">무신사 스냅 랭킹</span>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '300px 1fr', gap: 14 }}>

        {/* ===== 필터 레일 ===== */}
        <aside className="filter-rail">
          <div className="frh">
            <h3>필터</h3>
            <button className="btn sm" onClick={reset}>초기화</button>
          </div>
          <div className="frb">

            {/* ── USER 탭 필터 ─────────────────────────── */}
            {tab === 'USER' && (
              <>
                <PeriodFilter
                  value={period} onChange={setPeriod}
                  from={fromDate} to={toDate}
                  onFromChange={setFromDate} onToChange={setToDate}
                />

                <FilterBlock label="성별">
                  <PillGroup value={filterGender} onChange={setFilterGender} options={GENDER_OPTS} />
                </FilterBlock>

                <FilterBlock label="스타일" hint={!(selStyles.size === 0 || (selStyles.size === 1 && selStyles.has('ALL'))) ? `${selStyles.size}개 선택` : undefined}>
                  <div className="check-grid">
                    {SNAP_STYLE_FILTERS.map(f => (
                      <CheckRow key={f.value}
                        on={selStyles.size === 0 ? f.value === 'ALL' : selStyles.has(f.value)}
                        onToggle={() => setSelStyles(p => {
                          const n = new Set(p);
                          if (n.has(f.value)) { n.delete(f.value); if (n.size === 0) n.add('ALL'); }
                          else { n.add(f.value); }
                          return n;
                        })}
                        label={f.label}
                      />
                    ))}
                  </div>
                </FilterBlock>

                <FilterBlock label="모델 키" hint={`${heightRange[0]}~${heightRange[1]}cm`}>
                  <RangeSlider min={H_MIN} max={H_MAX} value={heightRange} onChange={setHeightRange} />
                  <div className="row-flex between" style={{ marginTop: 2, marginBottom: 6 }}>
                    <span className="mono dim" style={{ fontSize: 10 }}>{H_MIN}cm</span>
                    <span className="mono dim" style={{ fontSize: 10 }}>{H_MAX}cm</span>
                  </div>
                </FilterBlock>

                <FilterBlock label="모델 몸무게" hint={`${weightRange[0]}~${weightRange[1]}kg`}>
                  <RangeSlider min={W_MIN} max={W_MAX} value={weightRange} onChange={setWeightRange} />
                  <div className="row-flex between" style={{ marginTop: 2, marginBottom: 6 }}>
                    <span className="mono dim" style={{ fontSize: 10 }}>{W_MIN}kg</span>
                    <span className="mono dim" style={{ fontSize: 10 }}>{W_MAX}kg</span>
                  </div>
                </FilterBlock>

                <FilterBlock label="해시태그" hint={selHashtags.size > 0 ? `${selHashtags.size}개 적용` : undefined}>
                  <HashtagSearch allTags={allHashtags} selected={selHashtags}
                    onAdd={t => setSelHashtags(p => new Set([...p, t]))}
                    onRemove={t => setSelHashtags(p => { const n = new Set(p); n.delete(t); return n; })} />
                </FilterBlock>
              </>
            )}

            {/* ── MEMBER 탭 필터 ───────────────────────── */}
            {tab === 'MEMBER' && (
              <>
                <PeriodFilter
                  value={period} onChange={setPeriod}
                  from={fromDate} to={toDate}
                  onFromChange={setFromDate} onToChange={setToDate}
                />

                <FilterBlock label="성별">
                  <PillGroup value={memberGender} onChange={setMemberGender} options={GENDER_OPTS} />
                </FilterBlock>

                <FilterBlock label="키" hint={`${memberHeightRange[0]}~${memberHeightRange[1]}cm`}>
                  <RangeSlider min={H_MIN} max={H_MAX} value={memberHeightRange} onChange={setMemberHeightRange} />
                  <div className="row-flex between" style={{ marginTop: 2, marginBottom: 6 }}>
                    <span className="mono dim" style={{ fontSize: 10 }}>{H_MIN}cm</span>
                    <span className="mono dim" style={{ fontSize: 10 }}>{H_MAX}cm</span>
                  </div>
                </FilterBlock>

                <FilterBlock label="몸무게" hint={`${memberWeightRange[0]}~${memberWeightRange[1]}kg`}>
                  <RangeSlider min={W_MIN} max={W_MAX} value={memberWeightRange} onChange={setMemberWeightRange} />
                  <div className="row-flex between" style={{ marginTop: 2, marginBottom: 6 }}>
                    <span className="mono dim" style={{ fontSize: 10 }}>{W_MIN}kg</span>
                    <span className="mono dim" style={{ fontSize: 10 }}>{W_MAX}kg</span>
                  </div>
                </FilterBlock>

                {allMemberSkinTones.length > 0 && (
                  <FilterBlock label="피부톤" hint={memberSkinTones.size > 0 ? `${memberSkinTones.size}개 선택` : undefined}>
                    <div className="check-grid">
                      {allMemberSkinTones.map(st => (
                        <CheckRow key={st} on={memberSkinTones.has(st)} label={st}
                          onToggle={() => setMemberSkinTones(p => { const n = new Set(p); n.has(st) ? n.delete(st) : n.add(st); return n; })} />
                      ))}
                    </div>
                  </FilterBlock>
                )}

                <FilterBlock label="팔로워" hint={`${fmt(memberFollower[0])}~${fmt(memberFollower[1])}`}>
                  <RangeSlider min={memberFollowerBounds[0]} max={memberFollowerBounds[1]} value={memberFollower} onChange={setMemberFollower} />
                  <div className="row-flex between" style={{ marginTop: 2, marginBottom: 6 }}>
                    <span className="mono dim" style={{ fontSize: 10 }}>{fmt(memberFollowerBounds[0])}</span>
                    <span className="mono dim" style={{ fontSize: 10 }}>{fmt(memberFollowerBounds[1])}</span>
                  </div>
                </FilterBlock>
              </>
            )}

            {/* ── BRAND_PROFILE 탭 필터 ────────────────── */}
            {tab === 'BRAND_PROFILE' && (
              <FilterBlock label="날짜">
                <input type="date" value={snapDate} onChange={e => setSnapDate(e.target.value)}
                  style={{ width: '100%', height: 26, padding: '0 8px', background: 'var(--rai)', border: '0.5px solid var(--bd)', borderRadius: 'var(--r-2)', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--f1)', outline: 'none', boxSizing: 'border-box' }} />
              </FilterBlock>
            )}

            {/* ── BRAND 탭 필터 ────────────────────────── */}
            {tab === 'BRAND' && (
              <>
                <PeriodFilter
                  value={period} onChange={v => { setPeriod(v); setBrandPage(0); }}
                  from={fromDate} to={toDate}
                  onFromChange={setFromDate} onToChange={setToDate}
                />

                <FilterBlock label="성별">
                  <PillGroup value={brandGender} onChange={v => { setBrandGender(v); setBrandPage(0); }} options={GENDER_OPTS} />
                </FilterBlock>

                {labelGroups.length > 0 && labelGroups.map(([cat, items]) => (
                  <FilterBlock key={cat} label={cat} hint={items.some(l => brandLabelIds.has(l.id)) ? `${items.filter(l => brandLabelIds.has(l.id)).length}개 선택` : undefined}>
                    <div className="check-grid">
                      {items.map(l => (
                        <CheckRow key={l.id} on={brandLabelIds.has(l.id)} onToggle={() => toggleLabel(l.id)} label={l.name} />
                      ))}
                    </div>
                  </FilterBlock>
                ))}

                <FilterBlock label="모델 키" hint={`${brandHeightRange[0]}~${brandHeightRange[1]}cm`}>
                  <RangeSlider min={H_MIN} max={H_MAX} value={brandHeightRange} onChange={v => { setBrandHeightRange(v); setBrandPage(0); }} />
                  <div className="row-flex between" style={{ marginTop: 2, marginBottom: 6 }}>
                    <span className="mono dim" style={{ fontSize: 10 }}>{H_MIN}cm</span>
                    <span className="mono dim" style={{ fontSize: 10 }}>{H_MAX}cm</span>
                  </div>
                </FilterBlock>

                <FilterBlock label="모델 몸무게" hint={`${brandWeightRange[0]}~${brandWeightRange[1]}kg`}>
                  <RangeSlider min={W_MIN} max={W_MAX} value={brandWeightRange} onChange={v => { setBrandWeightRange(v); setBrandPage(0); }} />
                  <div className="row-flex between" style={{ marginTop: 2, marginBottom: 6 }}>
                    <span className="mono dim" style={{ fontSize: 10 }}>{W_MIN}kg</span>
                    <span className="mono dim" style={{ fontSize: 10 }}>{W_MAX}kg</span>
                  </div>
                </FilterBlock>

                <FilterBlock label="해시태그" hint={brandHashtags.size > 0 ? `${brandHashtags.size}개 적용` : undefined}>
                  <HashtagSearch allTags={allBrandTags} selected={brandHashtags}
                    onAdd={t => { setBrandHashtags(p => new Set([...p, t])); setBrandPage(0); }}
                    onRemove={t => { setBrandHashtags(p => { const n = new Set(p); n.delete(t); return n; }); setBrandPage(0); }} />
                </FilterBlock>
              </>
            )}

            {/* ── CODISHOP 탭 필터 ─────────────────────── */}
            {tab === 'CODISHOP' && (
              <>
                <PeriodFilter
                  value={period} onChange={v => { setPeriod(v); setCodiPage(0); }}
                  from={fromDate} to={toDate}
                  onFromChange={setFromDate} onToChange={setToDate}
                />

                <FilterBlock label="성별">
                  <PillGroup value={codiGender} onChange={v => { setCodiGender(v); setCodiPage(0); }} options={GENDER_OPTS} />
                </FilterBlock>

                {labelGroups.length > 0 && labelGroups.map(([cat, items]) => (
                  <FilterBlock key={cat} label={cat} hint={items.some(l => codiLabelIds.has(l.id)) ? `${items.filter(l => codiLabelIds.has(l.id)).length}개 선택` : undefined}>
                    <div className="check-grid">
                      {items.map(l => (
                        <CheckRow key={l.id} on={codiLabelIds.has(l.id)} onToggle={() => toggleLabel(l.id)} label={l.name} />
                      ))}
                    </div>
                  </FilterBlock>
                ))}

                <FilterBlock label="모델 키" hint={`${codiHeightRange[0]}~${codiHeightRange[1]}cm`}>
                  <RangeSlider min={H_MIN} max={H_MAX} value={codiHeightRange} onChange={v => { setCodiHeightRange(v); setCodiPage(0); }} />
                  <div className="row-flex between" style={{ marginTop: 2, marginBottom: 6 }}>
                    <span className="mono dim" style={{ fontSize: 10 }}>{H_MIN}cm</span>
                    <span className="mono dim" style={{ fontSize: 10 }}>{H_MAX}cm</span>
                  </div>
                </FilterBlock>

                <FilterBlock label="모델 몸무게" hint={`${codiWeightRange[0]}~${codiWeightRange[1]}kg`}>
                  <RangeSlider min={W_MIN} max={W_MAX} value={codiWeightRange} onChange={v => { setCodiWeightRange(v); setCodiPage(0); }} />
                  <div className="row-flex between" style={{ marginTop: 2, marginBottom: 6 }}>
                    <span className="mono dim" style={{ fontSize: 10 }}>{W_MIN}kg</span>
                    <span className="mono dim" style={{ fontSize: 10 }}>{W_MAX}kg</span>
                  </div>
                </FilterBlock>

                <FilterBlock label="해시태그" hint={codiHashtags.size > 0 ? `${codiHashtags.size}개 적용` : undefined}>
                  <HashtagSearch allTags={allCodiTags} selected={codiHashtags}
                    onAdd={t => { setCodiHashtags(p => new Set([...p, t])); setCodiPage(0); }}
                    onRemove={t => { setCodiHashtags(p => { const n = new Set(p); n.delete(t); return n; }); setCodiPage(0); }} />
                </FilterBlock>
              </>
            )}
          </div>
        </aside>

        {/* ===== 결과 영역 ===== */}
        <div className="col-flex gap-10" style={{ minWidth: 0 }}>

          {/* 탭 네비게이션 */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '0.5px solid var(--bs)' }}>
            {TAB_OPTS.map(([key, label]) => (
              <button key={key} onClick={() => switchTab(key)} style={{
                padding: '7px 16px', border: 'none', borderBottom: `2px solid ${tab === key ? 'var(--f1)' : 'transparent'}`,
                background: 'transparent', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 13,
                fontWeight: tab === key ? 600 : 400, color: tab === key ? 'var(--f1)' : 'var(--f3)',
                transition: 'color 100ms ease, border-color 100ms ease', marginBottom: -1,
              }}>{label}</button>
            ))}
          </div>

          {/* 적용 칩 + 정렬 (USER 탭) */}
          {tab === 'USER' && (
            <div className="row-flex center gap-6 wrap">
              <span className="sec-tag">applied</span>
              <DismissChip onDismiss={() => { setPeriod('today'); setFromDate(''); setToDate(''); }}>
                {period === 'today' ? '오늘' : period === '7d' ? '7일' : period === '30d' ? '30일' : period === '90d' ? '90일' : `${snapFromDate} ~ ${snapToDate}`}
              </DismissChip>
              {userChips.map(c => <DismissChip key={c.key} onDismiss={c.dismiss}>{c.label}</DismissChip>)}
              <div className="flex-1" />
              <span className="mono dim" style={{ fontSize: 12 }}>{sortedUserRows.length} / {userRows.length}건</span>
              <div className="row-flex gap-4">
                {SNAP_SORT_OPTS.map(([k, label]) => {
                  const active = snapSort === k;
                  const defaultDir: 'asc' | 'desc' = k === 'rank' ? 'asc' : 'desc';
                  return (
                    <button key={k} className={`btn sm${active ? ' active' : ''}`}
                      onClick={() => {
                        if (active) setSnapSortDir(d => d === 'asc' ? 'desc' : 'asc');
                        else { setSnapSort(k as SnapSort); setSnapSortDir(defaultDir); }
                      }}>
                      {label}{active ? (snapSortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 적용 칩 + 정렬 (MEMBER 탭) */}
          {tab === 'MEMBER' && (
            <div className="row-flex center gap-6 wrap">
              <span className="sec-tag">applied</span>
              <DismissChip onDismiss={() => { setPeriod('today'); setFromDate(''); setToDate(''); }}>
                {period === 'today' ? '오늘' : period === '7d' ? '7일' : period === '30d' ? '30일' : period === '90d' ? '90일' : `${snapFromDate} ~ ${snapToDate}`}
              </DismissChip>
              {memberGender !== 'ALL' && <DismissChip onDismiss={() => setMemberGender('ALL')}>{GENDER_OPTS.find(([k]) => k === memberGender)?.[1] ?? memberGender}</DismissChip>}
              {(memberHeightRange[0] > H_MIN || memberHeightRange[1] < H_MAX) && <DismissChip onDismiss={() => setMemberHeightRange([H_MIN, H_MAX])}>키 {memberHeightRange[0]}~{memberHeightRange[1]}cm</DismissChip>}
              {(memberWeightRange[0] > W_MIN || memberWeightRange[1] < W_MAX) && <DismissChip onDismiss={() => setMemberWeightRange([W_MIN, W_MAX])}>몸무게 {memberWeightRange[0]}~{memberWeightRange[1]}kg</DismissChip>}
              {[...memberSkinTones].map(st => <DismissChip key={st} onDismiss={() => setMemberSkinTones(p => { const n = new Set(p); n.delete(st); return n; })}>{st}</DismissChip>)}
              {(memberFollower[0] > memberFollowerBounds[0] || memberFollower[1] < memberFollowerBounds[1]) && <DismissChip onDismiss={() => setMemberFollower(memberFollowerBounds)}>팔로워 {fmt(memberFollower[0])}~{fmt(memberFollower[1])}</DismissChip>}
              <span className="mono dim" style={{ fontSize: 12 }}>{sortedMemberRows.length} / {memberRows.length}건</span>
              <div className="flex-1" />
              <div className="row-flex gap-4">
                {MEMBER_SORT_OPTS.map(([k, label]) => {
                  const active = memberSort === k;
                  return (
                    <button key={k} className={`btn sm${active ? ' active' : ''}`}
                      onClick={() => {
                        if (active) setMemberSortDir(d => d === 'asc' ? 'desc' : 'asc');
                        else { setMemberSort(k); setMemberSortDir(k === 'rank' ? 'asc' : 'desc'); }
                      }}>
                      {label}{active ? (memberSortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 건수 (BRAND_PROFILE 탭) */}
          {tab === 'BRAND_PROFILE' && (
            <div className="row-flex center gap-6">
              <div className="flex-1" />
              <span className="mono dim" style={{ fontSize: 12 }}>{currentTotal}건</span>
            </div>
          )}

          {/* 적용 칩 + 정렬 (BRAND 탭) */}
          {tab === 'BRAND' && (
            <div className="row-flex center gap-6 wrap">
              <span className="sec-tag">applied</span>
              <DismissChip onDismiss={() => { setPeriod('today'); setFromDate(''); setToDate(''); setBrandPage(0); }}>
                {period === 'today' ? '오늘' : period === '7d' ? '7일' : period === '30d' ? '30일' : period === '90d' ? '90일' : `${snapFromDate} ~ ${snapToDate}`}
              </DismissChip>
              {brandGender !== 'ALL' && <DismissChip onDismiss={() => { setBrandGender('ALL'); setBrandPage(0); }}>{GENDER_OPTS.find(([k]) => k === brandGender)?.[1] ?? brandGender}</DismissChip>}
              {(brandHeightRange[0] > H_MIN || brandHeightRange[1] < H_MAX) && <DismissChip onDismiss={() => { setBrandHeightRange([H_MIN, H_MAX]); setBrandPage(0); }}>키 {brandHeightRange[0]}~{brandHeightRange[1]}cm</DismissChip>}
              {(brandWeightRange[0] > W_MIN || brandWeightRange[1] < W_MAX) && <DismissChip onDismiss={() => { setBrandWeightRange([W_MIN, W_MAX]); setBrandPage(0); }}>몸무게 {brandWeightRange[0]}~{brandWeightRange[1]}kg</DismissChip>}
              {[...brandHashtags].map(t => <DismissChip key={t} onDismiss={() => { setBrandHashtags(p => { const n = new Set(p); n.delete(t); return n; }); setBrandPage(0); }}>#{t}</DismissChip>)}
              {[...brandLabelIds].map(id => {
                const l = labels.find(x => x.id === id);
                return l ? <DismissChip key={id} onDismiss={() => toggleLabel(id)}>{l.name}</DismissChip> : null;
              })}
              <div className="flex-1" />
              <span className="mono dim" style={{ fontSize: 12 }}>{currentTotal.toLocaleString()}건</span>
              <div className="row-flex gap-4">
                {SORT_OPTS.map(([k, label]) => {
                  const active = brandSort === k;
                  return (
                    <button key={k} className={`btn sm${active ? ' active' : ''}`}
                      onClick={() => {
                        if (active) setBrandSortDir(d => d === 'asc' ? 'desc' : 'asc');
                        else { setBrandSort(k as SortOpt); setBrandSortDir('desc'); setBrandPage(0); }
                      }}>
                      {label}{active ? (brandSortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 적용 칩 + 정렬 (CODISHOP 탭) */}
          {tab === 'CODISHOP' && (
            <div className="row-flex center gap-6 wrap">
              <span className="sec-tag">applied</span>
              <DismissChip onDismiss={() => { setPeriod('today'); setFromDate(''); setToDate(''); setCodiPage(0); }}>
                {period === 'today' ? '오늘' : period === '7d' ? '7일' : period === '30d' ? '30일' : period === '90d' ? '90일' : `${snapFromDate} ~ ${snapToDate}`}
              </DismissChip>
              {codiGender !== 'ALL' && <DismissChip onDismiss={() => { setCodiGender('ALL'); setCodiPage(0); }}>{GENDER_OPTS.find(([k]) => k === codiGender)?.[1] ?? codiGender}</DismissChip>}
              {(codiHeightRange[0] > H_MIN || codiHeightRange[1] < H_MAX) && <DismissChip onDismiss={() => { setCodiHeightRange([H_MIN, H_MAX]); setCodiPage(0); }}>키 {codiHeightRange[0]}~{codiHeightRange[1]}cm</DismissChip>}
              {(codiWeightRange[0] > W_MIN || codiWeightRange[1] < W_MAX) && <DismissChip onDismiss={() => { setCodiWeightRange([W_MIN, W_MAX]); setCodiPage(0); }}>몸무게 {codiWeightRange[0]}~{codiWeightRange[1]}kg</DismissChip>}
              {[...codiHashtags].map(t => <DismissChip key={t} onDismiss={() => { setCodiHashtags(p => { const n = new Set(p); n.delete(t); return n; }); setCodiPage(0); }}>#{t}</DismissChip>)}
              {[...codiLabelIds].map(id => {
                const l = labels.find(x => x.id === id);
                return l ? <DismissChip key={id} onDismiss={() => toggleLabel(id)}>{l.name}</DismissChip> : null;
              })}
              <div className="flex-1" />
              <span className="mono dim" style={{ fontSize: 12 }}>{currentTotal.toLocaleString()}건</span>
              <div className="row-flex gap-4">
                {SORT_OPTS.map(([k, label]) => {
                  const active = codiSort === k;
                  return (
                    <button key={k} className={`btn sm${active ? ' active' : ''}`}
                      onClick={() => {
                        if (active) setCodiSortDir(d => d === 'asc' ? 'desc' : 'asc');
                        else { setCodiSort(k as SortOpt); setCodiSortDir('desc'); setCodiPage(0); }
                      }}>
                      {label}{active ? (codiSortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 에러 */}
          {error && (
            <div style={{ padding: '12px 14px', color: 'var(--shf)', fontSize: 12, background: 'var(--shb)', borderRadius: 'var(--r-2)' }}>
              데이터 로드 실패: {error}
            </div>
          )}

          {/* 테이블 */}
          <section className="panel" style={{ padding: 0, overflowX: 'auto' }}>
            <div className="tbl" style={{ border: 'none', borderRadius: 0 }}>

              {/* 헤더 */}
              {tab === 'USER' && (
                <div className="row head" style={{ gridTemplateColumns: cols }}>
                  <span>사진</span><span>순위</span><span>변동</span>
                  {multiDay && <span>날짜</span>}
                  <span>성별</span><span>키</span><span>몸무게</span>
                  {!multiDay && <span>등록일</span>}
                  <span>닉네임</span><span className="cell-r">팔로워</span>
                  <span className="cell-r">좋아요</span><span className="cell-r">조회</span><span className="cell-r">상품클릭</span>
                </div>
              )}
              {tab === 'MEMBER' && (
                <div className="row head" style={{ gridTemplateColumns: cols }}>
                  <span>프로필</span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, lineHeight: 1.3 }}>
                    <span>순위</span><span style={{ fontWeight: 400, color: 'var(--f4)' }}>변동</span>
                  </span>
                  {multiDay && <span>날짜</span>}
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, lineHeight: 1.3 }}>
                    <span>닉네임</span><span style={{ fontWeight: 400, color: 'var(--f4)' }}>성별</span>
                  </span>
                  <span className="cell-r" style={{ display: 'flex', flexDirection: 'column', gap: 1, lineHeight: 1.3, alignItems: 'flex-end' }}>
                    <span>키</span><span style={{ fontWeight: 400, color: 'var(--f4)' }}>몸무게</span>
                  </span>
                  <span className="cell-r" style={{ display: 'flex', flexDirection: 'column', gap: 1, lineHeight: 1.3, alignItems: 'flex-end' }}>
                    <span>팔로워</span><span style={{ fontWeight: 400, color: 'var(--f4)' }}>게시물</span>
                  </span>
                  {memberHas.stats && (
                    <span className="cell-r" style={{ display: 'flex', flexDirection: 'column', gap: 1, lineHeight: 1.3, alignItems: 'flex-end' }}>
                      <span>조회</span><span style={{ fontWeight: 400, color: 'var(--f4)' }}>좋아요</span>
                    </span>
                  )}
                </div>
              )}
              {tab === 'BRAND_PROFILE' && (
                <div className="row head" style={{ gridTemplateColumns: cols }}>
                  <span>순위</span><span>변동</span><span>브랜드</span>
                  <span>코드</span><span className="cell-r">팔로워</span><span className="cell-r">게시물</span>
                </div>
              )}
              {tab === 'BRAND' && (
                <div className="row head" style={{ gridTemplateColumns: cols }}>
                  <span>사진</span>
                  <span>브랜드</span>
                  <span>성별</span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.3 }}>
                    <span>키</span>
                    <span style={{ fontWeight: 400, color: 'var(--f4)' }}>몸무게</span>
                  </span>
                  <span>등록일</span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.3 }}>
                    <span>스냅 ID</span>
                    <span style={{ fontWeight: 400, color: 'var(--f4)' }}>설명</span>
                  </span>
                  <span className="cell-r" style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.3, alignItems: 'flex-end' }}>
                    <span>스크랩</span>
                    <span style={{ fontWeight: 400, color: 'var(--f4)' }}>/ 좋아요</span>
                  </span>
                  <span className="cell-r" style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.3, alignItems: 'flex-end' }}>
                    <span>조회</span>
                    <span style={{ fontWeight: 400, color: 'var(--f4)' }}>/ 상품클릭</span>
                  </span>
                </div>
              )}
              {tab === 'CODISHOP' && (
                <div className="row head" style={{ gridTemplateColumns: cols }}>
                  <span>사진</span>
                  <span>성별</span><span>키</span><span>몸무게</span>
                  <span>등록일</span>
                  <span>스냅 ID</span>
                  <span className="cell-r">스크랩</span>
                  <span className="cell-r">좋아요</span>
                  <span className="cell-r">조회</span>
                  <span className="cell-r">상품클릭</span>
                </div>
              )}

              {/* 스켈레톤 */}
              {loading && Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="row" style={{ gridTemplateColumns: cols }}>
                  {Array.from({ length: colCount }).map((_, j) => (
                    <span key={j} style={{ height: 14, background: 'var(--rai)', borderRadius: 3, display: 'block' }} />
                  ))}
                </div>
              ))}

              {/* USER 행 */}
              {!loading && tab === 'USER' && (sortedUserRows.length === 0
                ? <EmptyState msg="해당 조건의 랭킹 데이터가 없습니다" />
                : sortedUserRows.map((row, i) => {
                    const gLabel = row.model_gender === 'WOMEN' ? '여성' : row.model_gender === 'MEN' ? '남성' : '—';
                    return (
                      <div key={`${row.snap_id}-${row.snapshot_date}-${row.style_filter}`} className={`row hover ${i % 2 ? 'alt' : ''}`}
                        style={{ gridTemplateColumns: cols, cursor: 'pointer', alignItems: 'center', minHeight: 104 }}
                        onClick={() => setModal({ snap: row, rankRow: row })}>
                        <span style={{ display: 'flex', alignItems: 'center' }}
                          onClick={row.thumbnail_url ? e => { e.stopPropagation(); setLightboxUrl(row.thumbnail_url); } : undefined}>
                          <AlwaysPhoto url={row.thumbnail_url} />
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                          <span className="mono" style={{ fontWeight: 600, color: rc(row.rank_position), fontSize: 13 }}>{String(row.rank_position).padStart(2, '0')}</span>
                          {row.highlight && <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: '#F59E0B', background: 'rgba(245,158,11,0.1)', borderRadius: 3, padding: '1px 5px', border: '0.5px solid rgba(245,158,11,0.3)', whiteSpace: 'nowrap' }}>{row.highlight}</span>}
                        </span>
                        <span><RankChange curr={row.rank_position} prev={row.prev_rank_position} /></span>
                        {multiDay && <span className="mono dim" style={{ fontSize: 11 }}>{row.snapshot_date}</span>}
                        <span className="mono" style={{ fontSize: 11, color: row.model_gender ? 'var(--f2)' : 'var(--f4)' }}>{gLabel}</span>
                        <span className="mono" style={{ fontSize: 11, color: row.model_height ? 'var(--f2)' : 'var(--f4)' }}>{row.model_height ?? '—'}</span>
                        <span className="mono" style={{ fontSize: 11, color: row.model_weight ? 'var(--f2)' : 'var(--f4)' }}>{row.model_weight ?? '—'}</span>
                        {!multiDay && <span className="mono dim" style={{ fontSize: 11 }}>{row.published_at.slice(0, 10)}</span>}
                        {(() => {
                          const prof = snapProfiles.get(row.snap_id);
                          return (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                              <AvatarCell url={prof?.profile_image_url ?? null} name={prof?.nickname ?? '?'} size={22} />
                              <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                                <span className="ellip" style={{ fontSize: 11, color: prof ? 'var(--f2)' : 'var(--f4)' }}>{prof?.nickname ?? '—'}</span>
                                {prof?.badge_title && <span className="ellip" style={{ fontSize: 9, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>{prof.badge_title}</span>}
                              </span>
                            </span>
                          );
                        })()}
                        {(() => {
                          const prof = snapProfiles.get(row.snap_id);
                          return <span className="mono muted cell-r" style={{ fontSize: 11 }}>{prof ? fmt(prof.follower_count) : '—'}</span>;
                        })()}
                        <span className="mono muted cell-r" style={{ fontSize: 11 }}>{fmt(row.like_count)}</span>
                        <span className="mono muted cell-r" style={{ fontSize: 11 }}>{fmt(row.view_count)}</span>
                        <span className="mono muted cell-r" style={{ fontSize: 11 }}>{fmt(row.goods_click_count)}</span>
                      </div>
                    );
                  })
              )}

              {/* MEMBER 행 */}
              {!loading && tab === 'MEMBER' && (sortedMemberRows.length === 0
                ? <EmptyState msg="해당 기간의 멤버 랭킹 데이터가 없습니다" />
                : sortedMemberRows.map((row, i) => {
                    const ms = memberStats.get(row.id);
                    const fb = memberFallbacks.get(row.id);
                    const dg = row.gender ?? fb?.gender ?? null;
                    const dh = row.height ?? fb?.height ?? null;
                    const dw = row.weight ?? fb?.weight ?? null;
                    const S2: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
                    return (
                      <div key={`${row.id}-${row.snapshot_date}`} className={`row hover ${i % 2 ? 'alt' : ''}${profile?.id === row.id ? ' active' : ''}`}
                        style={{ gridTemplateColumns: cols, cursor: 'pointer', alignItems: 'center', minHeight: 56 }} onClick={() => openProfile(row)}>
                        {/* 프로필 사진 */}
                        <span style={{ display: 'flex', alignItems: 'center' }}>
                          <AvatarCell url={row.profile_image_url} name={row.nickname} size={32} />
                        </span>
                        {/* 순위/변동 */}
                        <span style={S2}>
                          <span className="mono" style={{ fontWeight: 600, color: rc(row.rank_position), fontSize: 13 }}>{String(row.rank_position).padStart(2, '0')}</span>
                          <RankChange curr={row.rank_position} prev={row.prev_rank_position} />
                        </span>
                        {/* 날짜 (멀티데이) */}
                        {multiDay && <span className="mono dim" style={{ fontSize: 10 }}>{row.snapshot_date}</span>}
                        {/* 닉네임/성별 */}
                        <span style={{ ...S2, minWidth: 0 }}>
                          <span className="ellip" style={{ fontSize: 13, fontWeight: 500 }}>{row.nickname}</span>
                          <span className="mono dim" style={{ fontSize: 11 }}>{dg === 'WOMEN' ? '여성' : dg === 'MEN' ? '남성' : dg ?? '—'}</span>
                        </span>
                        {/* 키/몸무게 */}
                        <span style={{ ...S2, alignItems: 'flex-end' }}>
                          <span className="mono dim" style={{ fontSize: 11 }}>{dh ? `${dh}cm` : '—'}</span>
                          <span className="mono dim" style={{ fontSize: 11 }}>{dw ? `${dw}kg` : '—'}</span>
                        </span>
                        {/* 팔로워/게시물 */}
                        <span style={{ ...S2, alignItems: 'flex-end' }}>
                          <span className="mono muted" style={{ fontSize: 11 }}>{fmt(row.follower_count)}</span>
                          <span className="mono muted" style={{ fontSize: 11 }}>{row.snap_count > 0 ? fmt(row.snap_count) : '—'}</span>
                        </span>
                        {/* 조회/좋아요 */}
                        {memberHas.stats && (
                          <span style={{ ...S2, alignItems: 'flex-end' }}>
                            <span className="mono muted" style={{ fontSize: 11 }}>{ms ? fmt(ms.total_views) : '—'}</span>
                            <span className="mono muted" style={{ fontSize: 11 }}>{ms ? fmt(ms.total_likes) : '—'}</span>
                          </span>
                        )}
                      </div>
                    );
                  })
              )}

              {/* BRAND_PROFILE 행 */}
              {!loading && tab === 'BRAND_PROFILE' && (brandProfiles.length === 0
                ? <EmptyState msg="해당 날짜의 브랜드 랭킹 데이터가 없습니다" />
                : brandProfiles.map((row, i) => (
                    <div key={row.id} className={`row hover ${i % 2 ? 'alt' : ''}${profile?.id === row.id ? ' active' : ''}`}
                      style={{ gridTemplateColumns: cols, cursor: 'pointer', alignItems: 'center' }} onClick={() => openProfile(row)}>
                      <span className="mono" style={{ fontWeight: 600, color: rc(row.rank_position), fontSize: 13 }}>{String(row.rank_position).padStart(2, '0')}</span>
                      <span><RankChange curr={row.rank_position} prev={row.prev_rank_position} /></span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <AvatarCell url={row.profile_image_url} name={row.nickname} size={28} />
                        <span className="ellip" style={{ fontSize: 13 }}>{row.nickname}</span>
                      </span>
                      <span className="mono dim ellip" style={{ fontSize: 11 }}>{row.brand_code ?? '—'}</span>
                      <span className="mono muted cell-r" style={{ fontSize: 11 }}>{row.follower_count.toLocaleString()}</span>
                      <span className="mono muted cell-r" style={{ fontSize: 11 }}>{row.snap_count > 0 ? row.snap_count.toLocaleString() : '—'}</span>
                    </div>
                  ))
              )}

              {/* BRAND 행 */}
              {!loading && tab === 'BRAND' && (() => {
                if (brandRows.length === 0) return <EmptyState msg="수집된 스냅이 없습니다" />;
                const S2: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
                return brandRows.map((row, i) => {
                  const gLabel = row.model_gender === 'WOMEN' ? '여성' : row.model_gender === 'MEN' ? '남성' : null;
                  const brandInfo = brandInfoMap.get(row.snap_id);
                  return (
                    <div key={row.snap_id} className={`row hover ${i % 2 ? 'alt' : ''}`}
                      style={{ gridTemplateColumns: cols, cursor: 'pointer', alignItems: 'center', minHeight: 104 }}
                      onClick={() => setModal({ snap: row })}>
                      {/* 사진 */}
                      <span style={{ display: 'flex', alignItems: 'center' }}
                        onClick={row.thumbnail_url ? e => { e.stopPropagation(); setLightboxUrl(row.thumbnail_url); } : undefined}>
                        <AlwaysPhoto url={row.thumbnail_url} />
                      </span>
                      {/* 브랜드 */}
                      {brandInfo ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <AvatarCell url={brandInfo.profile_image_url} name={brandInfo.nickname} size={28} />
                          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                            <span className="ellip" style={{ fontSize: 12, fontWeight: 500, color: 'var(--f1)' }}>{brandInfo.nickname}</span>
                            {brandInfo.brand_code && <span className="mono ellip" style={{ fontSize: 10, color: 'var(--f4)' }}>{brandInfo.brand_code}</span>}
                          </span>
                        </span>
                      ) : (
                        <span className="mono dim" style={{ fontSize: 11 }}>—</span>
                      )}
                      {/* 성별 */}
                      <span className="mono" style={{ fontSize: 11, color: gLabel ? 'var(--f2)' : 'var(--f4)' }}>{gLabel ?? '—'}</span>
                      {/* 키/몸무게 */}
                      <span style={S2}>
                        <span className="mono dim" style={{ fontSize: 11 }}>{row.model_height ? `${row.model_height}cm` : '—'}</span>
                        <span className="mono dim" style={{ fontSize: 11 }}>{row.model_weight ? `${row.model_weight}kg` : '—'}</span>
                      </span>
                      {/* 등록일 */}
                      <span className="mono" style={{ fontSize: 10, color: 'var(--f4)' }}>{row.published_at.slice(0, 10)}</span>
                      {/* 스냅ID/설명 */}
                      <span style={{ ...S2, minWidth: 0 }}>
                        <span className="mono dim ellip" style={{ fontSize: 10 }} title={row.snap_id}>{row.snap_id.slice(-14)}</span>
                        {row.content_text && <span className="ellip" style={{ fontSize: 10, color: 'var(--f4)' }}>{row.content_text.slice(0, 50)}</span>}
                      </span>
                      {/* 스크랩 / 좋아요 */}
                      <span style={{ ...S2, alignItems: 'flex-end' }}>
                        <span className="mono muted" style={{ fontSize: 11 }}>{fmt(row.scrap_count)}</span>
                        <span className="mono" style={{ fontSize: 11, color: 'var(--f4)' }}>/ {fmt(row.like_count)}</span>
                      </span>
                      {/* 조회/상품클릭 */}
                      <span style={{ ...S2, alignItems: 'flex-end' }}>
                        <span className="mono muted" style={{ fontSize: 11 }}>{fmt(row.view_count)}</span>
                        <span className="mono" style={{ fontSize: 11, color: 'var(--f4)' }}>/ {fmt(row.goods_click_count)}</span>
                      </span>
                    </div>
                  );
                });
              })()}

              {/* CODISHOP 행 */}
              {!loading && tab === 'CODISHOP' && (() => {
                if (codiRows.length === 0) return <EmptyState msg="수집된 스냅이 없습니다" />;
                return codiRows.map((row, i) => {
                  const gLabel = row.model_gender === 'WOMEN' ? '여성' : row.model_gender === 'MEN' ? '남성' : '—';
                  return (
                    <div key={row.snap_id} className={`row hover ${i % 2 ? 'alt' : ''}`}
                      style={{ gridTemplateColumns: cols, cursor: 'pointer', alignItems: 'center', minHeight: 104 }}
                      onClick={() => setModal({ snap: row })}>
                      <span style={{ display: 'flex', alignItems: 'center' }}
                        onClick={row.thumbnail_url ? e => { e.stopPropagation(); setLightboxUrl(row.thumbnail_url); } : undefined}>
                        <AlwaysPhoto url={row.thumbnail_url} />
                      </span>
                      <span className="mono" style={{ fontSize: 11, color: row.model_gender ? 'var(--f2)' : 'var(--f4)' }}>{gLabel}</span>
                      <span className="mono" style={{ fontSize: 11, color: row.model_height ? 'var(--f2)' : 'var(--f4)' }}>{row.model_height ?? '—'}</span>
                      <span className="mono" style={{ fontSize: 11, color: row.model_weight ? 'var(--f2)' : 'var(--f4)' }}>{row.model_weight ?? '—'}</span>
                      <span className="mono dim" style={{ fontSize: 11 }}>{row.published_at.slice(0, 10)}</span>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                        <span className="mono dim ellip" style={{ fontSize: 11 }} title={row.snap_id}>{row.snap_id.slice(-14)}</span>
                        {row.content_text && <span className="ellip" style={{ fontSize: 10, color: 'var(--f4)' }}>{row.content_text.slice(0, 40)}</span>}
                      </span>
                      <span className="mono muted cell-r" style={{ fontSize: 11 }}>{fmt(row.scrap_count)}</span>
                      <span className="mono muted cell-r" style={{ fontSize: 11 }}>{fmt(row.like_count)}</span>
                      <span className="mono muted cell-r" style={{ fontSize: 11 }}>{fmt(row.view_count)}</span>
                      <span className="mono muted cell-r" style={{ fontSize: 11 }}>{fmt(row.goods_click_count)}</span>
                    </div>
                  );
                });
              })()}
            </div>

            {/* 페이지네이션 */}
            {!loading && (tab === 'BRAND' || tab === 'CODISHOP') && totalPages > 1 && (
              <div className="row-flex between center" style={{ padding: '10px 14px', borderTop: '0.5px solid var(--bs)' }}>
                <span className="mono dim" style={{ fontSize: 11 }}>
                  {currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, rawTotal)} / {rawTotal.toLocaleString()}
                </span>
                <div className="row-flex gap-4">
                  <button className="btn sm icon" onClick={() => setPage(Math.max(0, currentPage - 1))} disabled={currentPage === 0}><IcChevL /></button>
                  {(() => {
                    let start = Math.max(0, currentPage - 3);
                    const end  = Math.min(totalPages - 1, start + 6);
                    start = Math.max(0, end - 6);
                    return Array.from({ length: end - start + 1 }, (_, i) => start + i).map(p => (
                      <button key={p} className={`btn sm${currentPage === p ? ' active' : ''}`} onClick={() => setPage(p)}>{p + 1}</button>
                    ));
                  })()}
                  <button className="btn sm icon" onClick={() => setPage(Math.min(totalPages - 1, currentPage + 1))} disabled={currentPage >= totalPages - 1}><IcChevR /></button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* 프로필 패널 */}
      {profile && (tab === 'MEMBER' || tab === 'BRAND_PROFILE') && (
        <ProfilePanel profile={profile} date={profile.snapshot_date || snapDate} onSnapClick={snap => setModal({ snap })} onClose={() => setProfile(null)} />
      )}

      {/* 스냅 모달 */}
      {modal && <SnapModal snap={modal.snap} rankRow={modal.rankRow} onClose={() => setModal(null)} onHashtagClick={addHashtag} onLightbox={url => setLightboxUrl(url)} />}

      {/* 라이트박스 */}
      {lightboxUrl && <LightboxOverlay url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--f4)' }}>
      <span className="sec-tag">no data</span>
      <div style={{ marginTop: 8, fontSize: 12 }}>{msg}</div>
    </div>
  );
}
