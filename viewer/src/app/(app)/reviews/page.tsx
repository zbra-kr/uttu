'use client';
import React from 'react';
import NoteDrawer from '@/components/me/NoteDrawer';
import { IcArrowUR, IcX } from '@/components/ui/icons';
import { exportBrowseReviews, exportProductReviews } from '@/lib/excel-export';
import { PeriodFilter, FilterBlock, CheckRow } from '@/components/ui/filters';
import {
  fetchReviews, fetchReviewStats, fetchOwnProducts, fetchOwnBrands,
  fetchCsAnomalies, fetchProductBrief, fetchOwnProductsWithPrices,
  CATEGORY_MAP,
  type ReviewRow, type OwnProduct, type CsAnomaly, type OwnProductWithPrice,
} from '@/lib/queries';

const CATEGORY_ENTRIES = Object.entries(CATEGORY_MAP).filter(([code]) => code !== '000');
const ALL_CATEGORY_CODES = new Set(CATEGORY_ENTRIES.map(([code]) => code));

const SATISFACTION_ATTRS = [
  { attribute: '사이즈',  answers: ['조금 작음', '매우 작음', '정사이즈', '조금 큼', '많이 큼'] },
  { attribute: '퀄리티',  answers: ['매우 나쁨', '나쁨', '보통', '좋음', '매우 좋음'] },
  { attribute: '신축성',  answers: ['전혀 없음', '거의 없음', '적당함', '강함', '매우 강함'] },
  { attribute: '두께감',  answers: ['매우 얇음', '얇음', '적당함', '두꺼움', '매우 두꺼움'] },
  { attribute: '보온성',  answers: ['전혀 없음', '거의 없음', '적당함', '좋음', '매우 좋음'] },
  { attribute: '무게감',  answers: ['매우 무거움', '무거움', '적당함', '가벼움', '매우 가벼움'] },
  { attribute: '착용감',  answers: ['조금 불편', '보통', '편함', '매우 편함', '아주 편함'] },
  { attribute: '색감',    answers: ['어두움', '화면과 비슷', '밝음', '매우 밝음'] },
];
const HEIGHT_MIN = 150, HEIGHT_MAX = 195;
const WEIGHT_MIN = 45, WEIGHT_MAX = 110;

function lsRead<T>(key: string, def: T): T {
  if (typeof window === 'undefined') return def;
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : def; } catch { return def; }
}

const CS_LABELS: Record<string, string> = {
  review_rating_drop:    '별점 급락',
  review_negative_surge: '부정 리뷰 급증',
  review_count_surge:    '리뷰 수 급증',
  review_no_activity:    '리뷰 활동 중단',
  review_helpful_surge:  '부정 리뷰 도움됨 급증',
};

const SEV_COLOR = (s: string) =>
  s === 'high' ? 'var(--dn)' : s === 'medium' ? 'var(--warn, #f0a500)' : 'var(--f3)';

// ── 리뷰 카드 ──────────────────────────────────────────────────────────────────
function ReviewCard({
  r, onNote,
}: {
  r: ReviewRow;
  onNote?: (id: string) => void;
}) {
  const [lightboxUrl, setLightboxUrl] = React.useState<string | null>(null);
  const thumb = r.image_urls?.[0];
  const starColor = r.rating <= 2 ? 'var(--dn)' : r.rating === 3 ? 'var(--warn, #f0a500)' : 'var(--slf, #00a651)';

  return (
    <>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '44px 1fr',
        gap: '0 10px',
        padding: '10px 14px',
        borderBottom: '0.5px solid var(--bs)',
      }}>
        {/* 썸네일 */}
        <div style={{ gridRow: '1 / 4', width: 44, height: 44 }}>
          {thumb ? (
            <img src={thumb} alt="" onClick={() => setLightboxUrl(thumb)}
              style={{
                width: 44, height: 44, borderRadius: 4, objectFit: 'cover',
                display: 'block', border: '0.5px solid var(--bs)', cursor: 'zoom-in',
              }} />
          ) : (
            <div style={{
              width: 44, height: 44, borderRadius: 4,
              background: 'var(--snk)', border: '0.5px solid var(--bs)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, color: 'var(--f4)',
            }}>
              {r.has_image ? '📷' : ''}
            </div>
          )}
        </div>

        {/* 메타 행 */}
        <div className="row-flex center gap-8" style={{ flexWrap: 'wrap', minWidth: 0 }}>
          <span style={{ fontWeight: 600, color: starColor, fontSize: 13 }}>
            {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
          </span>
          <span className="mono dim" style={{ fontSize: 11 }}>{r.review_date}</span>
          {r.helpful_count > 0 && (
            <span className="mono dim" style={{ fontSize: 11 }}>♥ {r.helpful_count}</span>
          )}
          {r.has_image && r.image_urls.length > 0 && (
            <span style={{ fontSize: 10, background: 'var(--snk)', padding: '1px 5px', borderRadius: 3, color: 'var(--f3)' }}>
              📷 {r.image_urls.length}장
            </span>
          )}
          <span className="mono" style={{ fontSize: 9, color: 'var(--f4)' }}>#{r.musinsa_review_id}</span>
          <div className="row-flex gap-4" style={{ marginLeft: 'auto', flexShrink: 0 }}>
            {r.musinsa_no && (
              <a href={`https://www.musinsa.com/products/${r.musinsa_no}`}
                target="_blank" rel="noopener noreferrer"
                className="btn sm icon" title="무신사에서 보기"
                onClick={e => e.stopPropagation()}>
                <IcArrowUR size={12} />
              </a>
            )}
            {onNote && (
              <button className="btn sm icon" onClick={() => onNote(r.id)} title="메모">
                ✎
              </button>
            )}
          </div>
        </div>

        {/* 리뷰 텍스트 */}
        <div style={{ fontSize: 12, color: 'var(--f2)', lineHeight: 1.55, marginTop: 4, minWidth: 0 }}>
          {r.review_text ?? <span className="dim">(리뷰 내용 없음)</span>}
        </div>

        {/* 구매옵션 + 체형 정보 */}
        {(r.purchase_option || r.member_height || r.member_weight || r.member_gender || r.satisfactions?.length) ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6, gridColumn: 2 }}>
            {r.purchase_option && (
              <span style={{ fontSize: 10, background: 'var(--hs)', color: '#fff', padding: '2px 6px', borderRadius: 3, fontWeight: 500 }}>
                {r.purchase_option}
              </span>
            )}
            {(r.member_height || r.member_weight) && (
              <span style={{ fontSize: 10, background: 'var(--snk)', padding: '2px 6px', borderRadius: 3, color: 'var(--f3)' }}>
                {[r.member_height ? `${r.member_height}cm` : null, r.member_weight ? `${r.member_weight}kg` : null].filter(Boolean).join(' · ')}
              </span>
            )}
            {r.member_gender && (
              <span style={{ fontSize: 10, background: 'var(--snk)', padding: '2px 6px', borderRadius: 3, color: 'var(--f3)' }}>
                {r.member_gender === 'male' ? '남성' : r.member_gender === 'female' ? '여성' : r.member_gender}
              </span>
            )}
            {r.satisfactions?.map((s, i) => (
              <span key={i} style={{ fontSize: 10, background: 'var(--snk)', padding: '2px 6px', borderRadius: 3, color: 'var(--f4)' }}>
                {s.attribute}: <strong style={{ color: 'var(--f3)' }}>{s.answer}</strong>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* 이미지 라이트박스 */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9000,
            background: 'rgba(0,0,0,0.88)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'zoom-out',
          }}>
          <img
            src={lightboxUrl} alt=""
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '88vw', maxHeight: '88vh', objectFit: 'contain', borderRadius: 6, cursor: 'default' }} />
          <button
            onClick={() => setLightboxUrl(null)}
            style={{
              position: 'absolute', top: 20, right: 20,
              background: 'rgba(255,255,255,0.15)', border: 'none',
              color: '#fff', fontSize: 20, width: 36, height: 36,
              borderRadius: '50%', cursor: 'pointer', lineHeight: 1,
            }}>
            ✕
          </button>
        </div>
      )}
    </>
  );
}

// ── 페이지 ────────────────────────────────────────────────────────────────────
export default function ReviewsPage() {
  const [tab, setTab] = React.useState<'dash' | 'browse' | 'product-browse' | 'anomaly'>(
    () => lsRead('rv_tab', 'dash') as any
  );
  const changeTab = (t: typeof tab) => {
    setTab(t);
    try { localStorage.setItem('rv_tab', t); } catch {}
  };
  return (
    <>
      <div className="page-title">
        <h1>리뷰</h1>
        <span className="sub">자사 리뷰 모니터링 · 조회 · 이상탐지</span>
      </div>
      <div className="tabs">
        <div className={`tab ${tab === 'dash' ? 'active' : ''}`} onClick={() => changeTab('dash')}>대시보드</div>
        <div className={`tab ${tab === 'browse' ? 'active' : ''}`} onClick={() => changeTab('browse')}>조회</div>
        <div className={`tab ${tab === 'product-browse' ? 'active' : ''}`} onClick={() => changeTab('product-browse')}>상품별 조회</div>
        <div className={`tab ${tab === 'anomaly' ? 'active' : ''}`} onClick={() => changeTab('anomaly')}>특이점 리뷰</div>
      </div>
      {tab === 'dash'           && <RvDashboard onAnomalyRoute={() => changeTab('anomaly')} />}
      {tab === 'browse'         && <RvBrowse />}
      {tab === 'product-browse' && <RvProductBrowse />}
      {tab === 'anomaly'        && <RvAnomalyReviews />}
    </>
  );
}

// ===========================================================================
// A · 대시보드
// ===========================================================================
function RvDashboard({ onAnomalyRoute }: { onAnomalyRoute: () => void }) {
  const [days, setDays] = React.useState(30);
  const [stats, setStats] = React.useState<{
    total: number; avgRating: number; lowCount: number; ratingDist: number[]; imageCount: number;
  } | null>(null);
  const [ownProducts, setOwnProducts] = React.useState<OwnProduct[]>([]);
  const [csAnomalies, setCsAnomalies] = React.useState<CsAnomaly[]>([]);

  React.useEffect(() => {
    fetchReviewStats(days).then(setStats).catch(console.error);
  }, [days]);

  React.useEffect(() => {
    fetchOwnProducts(10).then(setOwnProducts).catch(console.error);
    fetchCsAnomalies({ limit: 10 }).then(setCsAnomalies).catch(console.error);
  }, []);

  const total      = stats?.total ?? 0;
  const avgRating  = stats?.avgRating ?? 0;
  const lowCount   = stats?.lowCount ?? 0;
  const imageCount = stats?.imageCount ?? 0;
  const ratingDist = stats?.ratingDist ?? [0, 0, 0, 0, 0];
  const distTotal  = ratingDist.reduce((s, n) => s + n, 0) || 1;

  const highAnomaly = csAnomalies.filter(a => a.severity === 'high').length;
  const medAnomaly  = csAnomalies.filter(a => a.severity === 'medium').length;

  return (
    <>
      <div className="row-flex between center">
        <h2 style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>
          자사 리뷰 현황
          <span className="mono dim" style={{ fontSize: 11, fontWeight: 400, marginLeft: 8 }}>
            B.CAVE · 커버낫/리/와키윌리
          </span>
        </h2>
        <div className="row-flex gap-4">
          {[7, 30].map(d => (
            <button key={d} className={`btn sm ${days === d ? 'active' : ''}`} onClick={() => setDays(d)}>{d}D</button>
          ))}
          <button className={`btn sm ${days === 999 ? 'active' : ''}`} onClick={() => setDays(999)}>전체</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-5 gap-8">
        {([
          ['신규 리뷰',    stats ? total.toLocaleString() : '…',    days === 999 ? '전체 기간' : `최근 ${days}일`],
          ['평균 평점',    stats ? `★ ${avgRating.toFixed(2)}` : '…', '자사 전체'],
          ['저점 (★1~2)', stats ? lowCount.toLocaleString() : '…',   `${days === 999 ? '전체' : days + '일'} 내`],
          ['이미지 리뷰',  stats ? imageCount.toLocaleString() : '…', '이미지 첨부'],
          ['CS 이상탐지',  stats ? `H:${highAnomaly} M:${medAnomaly}` : '…', '최근 탐지'],
        ] as [string, string, string][]).map(([l, v, d], i) => (
          <div key={i} className="kpi" onClick={i === 4 ? onAnomalyRoute : undefined}
            style={{ cursor: i === 4 ? 'pointer' : 'default' }}>
            <span className="label">{l}</span>
            <div className="val" style={{ color: i === 4 && highAnomaly > 0 ? 'var(--dn)' : undefined }}>{v}</div>
            <div className="dlt"><span className="muted">{d}</span></div>
          </div>
        ))}
      </div>

      <div className="grid grid-2 gap-12">
        {/* 평점 분포 */}
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
                    <div style={{
                      width: `${pct}%`, height: '100%',
                      background: star <= 2 ? 'var(--dn)' : star === 3 ? 'var(--warn, #f0a500)' : 'var(--f2)',
                      borderRadius: 2,
                    }} />
                  </div>
                  <span className="mono dim" style={{ width: 56, textAlign: 'right', fontSize: 11 }}>
                    {stats ? `${pct}% (${count})` : '…'}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* CS 이상탐지 요약 */}
        <section className="panel">
          <div className="sec-head">
            <h3>CS 이상탐지 <span className="sub">리뷰 기반</span></h3>
            <button className="btn sm" onClick={onAnomalyRoute}>전체 보기 ↗</button>
          </div>
          {csAnomalies.length === 0 ? (
            <div className="dim" style={{ fontSize: 12, padding: '12px 0', textAlign: 'center' }}>
              탐지된 이상 없음
            </div>
          ) : csAnomalies.slice(0, 5).map((a, i) => {
            const color = SEV_COLOR(a.severity);
            return (
              <div key={a.id} className={`row-flex center gap-8 ${i % 2 ? 'alt' : ''}`}
                style={{ padding: '6px 0', cursor: 'pointer' }}
                onClick={onAnomalyRoute}>
                <span style={{
                  fontSize: 10, fontWeight: 700, color, background: `${color}18`,
                  padding: '1px 5px', borderRadius: 3, flexShrink: 0,
                }}>
                  {a.severity.toUpperCase()}
                </span>
                <span style={{ fontSize: 12, fontWeight: 500, flexShrink: 0 }}>
                  {CS_LABELS[a.anomaly_type] ?? a.anomaly_type}
                </span>
                <span className="dim" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.entity_name}
                </span>
                <span className="mono dim" style={{ fontSize: 10, marginLeft: 'auto', flexShrink: 0 }}>
                  {a.detection_date}
                </span>
              </div>
            );
          })}
        </section>
      </div>

      {/* 특이점 상품 */}
      <section className="panel">
        <div className="sec-head">
          <h3>자사 상품 리뷰 현황 <span className="sub">리뷰 수 기준</span></h3>
        </div>
        <div className="tbl">
          <div className="row head" style={{ gridTemplateColumns: '1fr 100px 70px 70px 70px' }}>
            <span>상품</span>
            <span>브랜드</span>
            <span className="cell-r">리뷰</span>
            <span className="cell-r">만족도</span>
            <span></span>
          </div>
          {ownProducts.slice(0, 8).map((p, i) => (
            <div key={p.id} className={`row hover ${i % 2 ? 'alt' : ''}`}
              style={{ gridTemplateColumns: '1fr 100px 70px 70px 70px' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                {(p.style_no || p.erp_style_code) && (
                  <div className="mono dim" style={{ fontSize: 10, marginTop: 1 }}>
                    {[p.style_no, p.erp_style_code].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
              <span className="dim" style={{ fontSize: 11 }}>{p.brand_name}</span>
              <span className="mono cell-r" style={{ fontSize: 12 }}>{(p.review_count ?? 0).toLocaleString()}</span>
              <span className={`mono cell-r ${(p.satisfaction_score ?? 100) < 60 ? 'hs' : ''}`}
                style={{ fontWeight: (p.satisfaction_score ?? 100) < 60 ? 500 : 400, fontSize: 12 }}>
                {p.satisfaction_score != null ? `${p.satisfaction_score}%` : '—'}
              </span>
              <span>
                <a href={`/product?no=${p.musinsa_no}`} className="btn sm icon">
                  <IcArrowUR />
                </a>
              </span>
            </div>
          ))}
          {ownProducts.length === 0 && (
            <div className="row" style={{ gridTemplateColumns: '1fr' }}>
              <span className="dim" style={{ fontSize: 12, textAlign: 'center', padding: '16px 0' }}>
                자사 상품 없음
              </span>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

// ── 커스텀 레인지 슬라이더 (랭킹 페이지와 동일 스타일) ─────────────────────────
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
      if (dragging === 0) onChangeRef.current([Math.min(v, cur[1]), cur[1]]);
      if (dragging === 1) onChangeRef.current([cur[0], Math.max(v, cur[0])]);
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
      <div
        onMouseDown={e => { e.preventDefault(); setDragging(0); }}
        onTouchStart={e => { e.preventDefault(); setDragging(0); }}
        style={{ position: 'absolute', top: '50%', left: `${p0}%`, width: 20, height: 20, borderRadius: '50%', background: 'var(--rai)', border: '2px solid var(--f1)', transform: 'translate(-50%, -50%)', cursor: dragging === 0 ? 'grabbing' : 'grab', zIndex: value[0] >= max ? 3 : 1, boxSizing: 'border-box', touchAction: 'none' }}
      />
      <div
        onMouseDown={e => { e.preventDefault(); setDragging(1); }}
        onTouchStart={e => { e.preventDefault(); setDragging(1); }}
        style={{ position: 'absolute', top: '50%', left: `${p1}%`, width: 20, height: 20, borderRadius: '50%', background: 'var(--rai)', border: '2px solid var(--f1)', transform: 'translate(-50%, -50%)', cursor: dragging === 1 ? 'grabbing' : 'grab', zIndex: 2, boxSizing: 'border-box', touchAction: 'none' }}
      />
    </div>
  );
}

// ===========================================================================
// B · 조회
// ===========================================================================
function RvBrowse() {
  const today = new Date().toISOString().split('T')[0];
  const s = React.useRef(lsRead<Record<string, any>>('rv_browse_filters', {})).current;

  const [period, setPeriod]         = React.useState<string>(s.period ?? 'today');
  const [fromDate, setFromDate]     = React.useState<string>(s.fromDate ?? new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]);
  const [toDate, setToDate]         = React.useState<string>(s.toDate ?? today);
  const [ratingFrom, setRatingFrom] = React.useState<number>(s.ratingFrom ?? 1);
  const [ratingTo, setRatingTo]     = React.useState<number>(s.ratingTo ?? 5);
  const [keyword, setKeyword]       = React.useState<string>(s.keyword ?? '');
  const [kwInput, setKwInput]       = React.useState<string>(s.keyword ?? '');
  const [sort, setSort]             = React.useState<'recent' | 'rating_asc' | 'rating_desc' | 'helpful'>(s.sort ?? 'recent');
  const [page, setPage]             = React.useState(0);

  const [ownBrands, setOwnBrands]       = React.useState<{ id: string; name: string }[]>([]);
  const [selectedBrandIds, setSelectedBrandIds] = React.useState<Set<string>>(new Set(s.brandIds ?? []));
  const [categories, setCategories]     = React.useState<Set<string>>(new Set(s.categories?.length ? s.categories : [...ALL_CATEGORY_CODES]));
  const [selectedProducts, setSelectedProducts] = React.useState<Map<string, string>>(new Map(s.products ?? []));
  const [genders, setGenders]           = React.useState<Set<string>>(new Set(s.genders ?? []));
  const [heightRange, setHeightRange]   = React.useState<[number, number]>(s.heightRange ?? [HEIGHT_MIN, HEIGHT_MAX]);
  const [weightRange, setWeightRange]   = React.useState<[number, number]>(s.weightRange ?? [WEIGHT_MIN, WEIGHT_MAX]);
  const [satFilter, setSatFilter]       = React.useState<Record<string, string>>(s.satFilter ?? {});
  const [satOpen, setSatOpen]           = React.useState(false);

  const [rows, setRows]     = React.useState<ReviewRow[]>([]);
  const [total, setTotal]   = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [exportMsg, setExportMsg] = React.useState('');
  const [noteReviewId, setNoteReviewId] = React.useState<string | null>(null);

  // product picker
  const [pQuery, setPQuery]     = React.useState('');
  const [pDrop, setPDrop]       = React.useState<OwnProductWithPrice[]>([]);
  const [pSearching, setPSearching] = React.useState(false);
  const [pOpen, setPOpen]       = React.useState(false);
  const pRef = React.useRef<HTMLDivElement>(null);
  const pTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const PAGE_SIZE = 30;

  React.useEffect(() => { fetchOwnBrands().then(setOwnBrands).catch(console.error); }, []);

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (pRef.current && !pRef.current.contains(e.target as Node)) setPOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  React.useEffect(() => {
    if (pTimer.current) clearTimeout(pTimer.current);
    if (!pQuery.trim()) { setPDrop([]); return; }
    pTimer.current = setTimeout(async () => {
      setPSearching(true);
      try {
        const { rows: r } = await fetchOwnProductsWithPrices({ keyword: pQuery, limit: 10, offset: 0 });
        setPDrop(r.filter(p => !selectedProducts.has(p.id)));
      } catch {}
      setPSearching(false);
    }, 300);
  }, [pQuery, selectedProducts]);

  // persist filters
  React.useEffect(() => {
    try {
      localStorage.setItem('rv_browse_filters', JSON.stringify({
        period, fromDate, toDate, ratingFrom, ratingTo, keyword, sort,
        brandIds: [...selectedBrandIds],
        categories: [...categories],
        products: [...selectedProducts.entries()],
        genders: [...genders],
        heightRange, weightRange, satFilter,
      }));
    } catch {}
  }, [period, fromDate, toDate, ratingFrom, ratingTo, keyword, sort, selectedBrandIds, categories, selectedProducts, genders, heightRange, weightRange, satFilter]);

  const calcDateFrom = React.useMemo(() => {
    if (period === 'today') return today;
    if (period === '7d') return new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    if (period === '30d') return new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    if (period === '90d') return new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
    if (period === 'custom') return fromDate;
    return undefined;
  }, [period, fromDate, today]);
  const calcDateTo = period === 'today' ? today : period === 'custom' ? toDate : undefined;

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchReviews({
      ratingMin: ratingFrom, ratingMax: ratingTo,
      dateFrom: calcDateFrom, dateTo: calcDateTo,
      keyword: keyword.trim() || undefined,
      brandIds: selectedBrandIds.size > 0 ? [...selectedBrandIds] : undefined,
      categoryCodes: categories.size < ALL_CATEGORY_CODES.size ? [...categories] : undefined,
      productIds: selectedProducts.size > 0 ? [...selectedProducts.keys()] : undefined,
      genders: genders.size > 0 ? [...genders] : undefined,
      heightMin: heightRange[0] > HEIGHT_MIN ? heightRange[0] : undefined,
      heightMax: heightRange[1] < HEIGHT_MAX ? heightRange[1] : undefined,
      weightMin: weightRange[0] > WEIGHT_MIN ? weightRange[0] : undefined,
      weightMax: weightRange[1] < WEIGHT_MAX ? weightRange[1] : undefined,
      satisfactionFilter: Object.keys(satFilter).length > 0 ? satFilter : undefined,
      sort, limit: PAGE_SIZE, offset: page * PAGE_SIZE,
    }).then(({ rows: r, total: t }) => {
      if (cancelled) return;
      setRows(r); setTotal(t);
    }).catch(console.error).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [calcDateFrom, calcDateTo, ratingFrom, ratingTo, keyword, selectedBrandIds, categories, selectedProducts, genders, heightRange, weightRange, satFilter, sort, page]); // eslint-disable-line

  const toggleBrand = (id: string) => { setSelectedBrandIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); setPage(0); };
  const toggleCat   = (code: string) => { setCategories(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n; }); setPage(0); };
  const toggleGender = (g: string) => { setGenders(prev => { const n = new Set(prev); n.has(g) ? n.delete(g) : n.add(g); return n; }); setPage(0); };
  const toggleSat = (attr: string, ans: string) => {
    setSatFilter(prev => { const n = { ...prev }; n[attr] === ans ? delete n[attr] : (n[attr] = ans); return n; });
    setPage(0);
  };
  const addProduct = (p: OwnProductWithPrice) => {
    setSelectedProducts(prev => { const n = new Map(prev); n.set(p.id, p.name); return n; });
    setPQuery(''); setPOpen(false); setPage(0);
  };
  const removeProduct = (id: string) => { setSelectedProducts(prev => { const n = new Map(prev); n.delete(id); return n; }); setPage(0); };

  const reset = () => {
    setPeriod('today'); setRatingFrom(1); setRatingTo(5);
    setKwInput(''); setKeyword(''); setSort('recent'); setPage(0);
    setSelectedBrandIds(new Set()); setCategories(new Set(ALL_CATEGORY_CODES));
    setSelectedProducts(new Map()); setGenders(new Set());
    setHeightRange([HEIGHT_MIN, HEIGHT_MAX]); setWeightRange([WEIGHT_MIN, WEIGHT_MAX]);
    setSatFilter({});
  };

  const handleExport = async () => {
    await exportBrowseReviews({
      ratingMin: ratingFrom, ratingMax: ratingTo,
      dateFrom: calcDateFrom, dateTo: calcDateTo,
      keyword: keyword.trim() || undefined,
      brandIds: selectedBrandIds.size > 0 ? [...selectedBrandIds] : undefined,
      categoryCodes: categories.size < ALL_CATEGORY_CODES.size ? [...categories] : undefined,
      productIds: selectedProducts.size > 0 ? [...selectedProducts.keys()] : undefined,
      genders: genders.size > 0 ? [...genders] : undefined,
      heightMin: heightRange[0] > HEIGHT_MIN ? heightRange[0] : undefined,
      heightMax: heightRange[1] < HEIGHT_MAX ? heightRange[1] : undefined,
      weightMin: weightRange[0] > WEIGHT_MIN ? weightRange[0] : undefined,
      weightMax: weightRange[1] < WEIGHT_MAX ? weightRange[1] : undefined,
      satisfactionFilter: Object.keys(satFilter).length > 0 ? satFilter : undefined,
      sort,
    }, msg => setExportMsg(msg));
    setTimeout(() => setExportMsg(''), 3000);
  };

  return (
    <div className="grid" style={{ gridTemplateColumns: '280px 1fr', gap: 14 }}>
      {/* 필터 레일 */}
      <aside className="filter-rail">
        <div className="frh">
          <h3>조회 조건</h3>
          <button className="btn sm" onClick={reset}>초기화</button>
        </div>
        <div className="frb">
          {/* 브랜드 */}
          <div style={{ padding: '8px 14px', borderBottom: '0.5px solid var(--bs)' }}>
            <div className="row-flex between center" style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--f3)', fontWeight: 500 }}>
                브랜드 {selectedBrandIds.size > 0 ? `· ${selectedBrandIds.size}개 선택` : '· 전체'}
              </span>
              {selectedBrandIds.size > 0 && (
                <button className="btn sm" onClick={() => { setSelectedBrandIds(new Set()); setPage(0); }}>전체</button>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {ownBrands.map(b => (
                <button key={b.id} className={`btn sm ${selectedBrandIds.has(b.id) ? 'active' : ''}`}
                  onClick={() => toggleBrand(b.id)}
                  style={{ textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>{b.name}</button>
              ))}
            </div>
          </div>

          {/* 기간 */}
          <div style={{ padding: '8px 14px', borderBottom: '0.5px solid var(--bs)' }}>
            <PeriodFilter value={period} onChange={v => { setPeriod(v); setPage(0); }}
              from={fromDate} to={toDate} onFromChange={setFromDate} onToChange={setToDate} />
          </div>

          {/* 별점 */}
          <div style={{ padding: '8px 14px', borderBottom: '0.5px solid var(--bs)' }}>
            <div className="row-flex between center" style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--f3)', fontWeight: 500 }}>별점 범위</span>
              <span className="mono dim" style={{ fontSize: 10 }}>★{ratingFrom} ~ ★{ratingTo}</span>
            </div>
            <RangeSlider min={1} max={5} value={[ratingFrom, ratingTo]}
              onChange={([a, b]) => { setRatingFrom(a); setRatingTo(b); setPage(0); }} />
            <div className="row-flex between">
              <span className="mono dim" style={{ fontSize: 10 }}>★1</span>
              <span className="mono dim" style={{ fontSize: 10 }}>★5</span>
            </div>
          </div>

          {/* 카테고리 */}
          <div style={{ padding: '8px 14px', borderBottom: '0.5px solid var(--bs)' }}>
            <FilterBlock label="카테고리" hint={`${categories.size}/${ALL_CATEGORY_CODES.size}`}>
              <div className="check-grid">
                {CATEGORY_ENTRIES.map(([code, label]) => (
                  <CheckRow key={code} on={categories.has(code)} onToggle={() => toggleCat(code)} label={label} />
                ))}
              </div>
              <div className="row-flex gap-4" style={{ marginTop: 4 }}>
                <button className="btn sm" onClick={() => { setCategories(new Set(ALL_CATEGORY_CODES)); setPage(0); }}>전체</button>
                <button className="btn sm" onClick={() => { setCategories(new Set()); setPage(0); }}>해제</button>
              </div>
            </FilterBlock>
          </div>

          {/* 상품 선택 */}
          <div style={{ padding: '8px 14px', borderBottom: '0.5px solid var(--bs)' }}>
            <div className="row-flex between center" style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--f3)', fontWeight: 500 }}>
                상품 {selectedProducts.size > 0 ? `· ${selectedProducts.size}개 선택` : ''}
              </span>
              {selectedProducts.size > 0 && (
                <button className="btn sm" onClick={() => { setSelectedProducts(new Map()); setPage(0); }}>전체</button>
              )}
            </div>
            <div ref={pRef} style={{ position: 'relative' }}>
              <input type="text" value={pQuery}
                onChange={e => { setPQuery(e.target.value); setPOpen(true); }}
                onFocus={() => setPOpen(true)}
                placeholder="상품명/스타일코드 검색"
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--sans)', fontSize: 12, padding: '4px 8px', border: '0.5px solid var(--bs)', borderRadius: 4, background: 'var(--bg)', color: 'var(--f1)' }} />
              {pOpen && pQuery.trim() && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                  background: 'var(--bg)', border: '0.5px solid var(--bs)', borderRadius: 4,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)', marginTop: 2, maxHeight: 180, overflowY: 'auto',
                }}>
                  {pSearching ? (
                    <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--f4)' }}>검색 중…</div>
                  ) : pDrop.length === 0 ? (
                    <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--f4)' }}>결과 없음</div>
                  ) : pDrop.map(p => (
                    <div key={p.id} className="hover"
                      onMouseDown={e => { e.preventDefault(); addProduct(p); }}
                      style={{ padding: '6px 10px', cursor: 'pointer', borderBottom: '0.5px solid var(--bs)' }}>
                      <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                      <div className="mono dim" style={{ fontSize: 10, marginTop: 1 }}>{p.brand_name} · no.{p.musinsa_no}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {selectedProducts.size > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {[...selectedProducts.entries()].map(([id, name]) => (
                  <span key={id} style={{ fontSize: 10, background: 'var(--snk)', border: '0.5px solid var(--bs)', padding: '2px 6px', borderRadius: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                    <span onClick={() => removeProduct(id)} style={{ cursor: 'pointer', color: 'var(--f4)', fontSize: 13, lineHeight: 1, flexShrink: 0 }}>×</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 성별 */}
          <div style={{ padding: '8px 14px', borderBottom: '0.5px solid var(--bs)' }}>
            <div style={{ fontSize: 11, color: 'var(--f3)', fontWeight: 500, marginBottom: 4 }}>성별</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {['남성', '여성'].map(g => (
                <button key={g} className={`btn sm ${genders.has(g) ? 'active' : ''}`}
                  onClick={() => toggleGender(g)}
                  style={{ textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>{g}</button>
              ))}
              {genders.size > 0 && (
                <button className="btn sm" onClick={() => { setGenders(new Set()); setPage(0); }}>전체</button>
              )}
            </div>
          </div>

          {/* 신체 정보 */}
          <div style={{ padding: '8px 14px', borderBottom: '0.5px solid var(--bs)' }}>
            <div style={{ fontSize: 11, color: 'var(--f3)', fontWeight: 500, marginBottom: 6 }}>신체 정보</div>
            <div style={{ marginBottom: 10 }}>
              <div className="row-flex between center" style={{ marginBottom: 2 }}>
                <span className="mono dim" style={{ fontSize: 10 }}>키 (cm)</span>
                <span className="mono dim" style={{ fontSize: 10 }}>
                  {heightRange[0] === HEIGHT_MIN && heightRange[1] === HEIGHT_MAX ? '전체' : `${heightRange[0]}~${heightRange[1]}`}
                </span>
              </div>
              <RangeSlider min={HEIGHT_MIN} max={HEIGHT_MAX} value={heightRange}
                onChange={v => { setHeightRange(v); setPage(0); }} />
              <div className="row-flex between">
                <span className="mono dim" style={{ fontSize: 9 }}>{HEIGHT_MIN}</span>
                <span className="mono dim" style={{ fontSize: 9 }}>{HEIGHT_MAX}</span>
              </div>
            </div>
            <div>
              <div className="row-flex between center" style={{ marginBottom: 2 }}>
                <span className="mono dim" style={{ fontSize: 10 }}>몸무게 (kg)</span>
                <span className="mono dim" style={{ fontSize: 10 }}>
                  {weightRange[0] === WEIGHT_MIN && weightRange[1] === WEIGHT_MAX ? '전체' : `${weightRange[0]}~${weightRange[1]}`}
                </span>
              </div>
              <RangeSlider min={WEIGHT_MIN} max={WEIGHT_MAX} value={weightRange}
                onChange={v => { setWeightRange(v); setPage(0); }} />
              <div className="row-flex between">
                <span className="mono dim" style={{ fontSize: 9 }}>{WEIGHT_MIN}</span>
                <span className="mono dim" style={{ fontSize: 9 }}>{WEIGHT_MAX}</span>
              </div>
            </div>
          </div>

          {/* 만족도 */}
          <div style={{ padding: '8px 14px', borderBottom: '0.5px solid var(--bs)' }}>
            <button onClick={() => setSatOpen(o => !o)}
              style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--f3)', fontWeight: 500 }}>
                만족도 {Object.keys(satFilter).length > 0 && <span style={{ color: 'var(--hs)', fontWeight: 700 }}>· {Object.keys(satFilter).length}개</span>}
              </span>
              <span className="mono dim" style={{ fontSize: 10 }}>{satOpen ? '▲' : '▼'}</span>
            </button>
            {satOpen && (
              <div style={{ marginTop: 8 }}>
                {SATISFACTION_ATTRS.map(({ attribute, answers }) => (
                  <div key={attribute} style={{ marginBottom: 7 }}>
                    <div style={{ fontSize: 10, color: 'var(--f4)', marginBottom: 3 }}>{attribute}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                      {answers.map(ans => (
                        <button key={ans} className={`btn sm ${satFilter[attribute] === ans ? 'active' : ''}`}
                          onClick={() => toggleSat(attribute, ans)}
                          style={{ fontSize: 10, padding: '2px 6px', textTransform: 'none', letterSpacing: 0 }}>{ans}</button>
                      ))}
                    </div>
                  </div>
                ))}
                {Object.keys(satFilter).length > 0 && (
                  <button className="btn sm" style={{ marginTop: 4 }} onClick={() => { setSatFilter({}); setPage(0); }}>초기화</button>
                )}
              </div>
            )}
          </div>

          {/* 키워드 */}
          <div style={{ padding: '8px 14px', borderBottom: '0.5px solid var(--bs)' }}>
            <div style={{ fontSize: 11, color: 'var(--f3)', fontWeight: 500, marginBottom: 4 }}>키워드</div>
            <div className="row-flex gap-4">
              <input type="text" value={kwInput}
                onChange={e => setKwInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { setKeyword(kwInput); setPage(0); } }}
                placeholder="Enter로 검색…"
                style={{ flex: 1, fontFamily: 'var(--sans)', fontSize: 12, padding: '4px 8px', border: '0.5px solid var(--bs)', borderRadius: 4, background: 'var(--bg)', color: 'var(--f1)' }} />
              {keyword && (
                <button className="btn sm icon" onClick={() => { setKwInput(''); setKeyword(''); setPage(0); }}><IcX /></button>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* 메인 */}
      <div className="col-flex gap-10">
        {/* 도구 바 */}
        <div className="row-flex center gap-6 wrap">
          <span className="mono dim" style={{ fontSize: 12 }}>
            {loading ? '…' : `${total.toLocaleString()}건`}
          </span>
          {keyword && (
            <span className="chip" style={{ fontSize: 11, textTransform: 'none', letterSpacing: 0 }}>
              키워드: {keyword}
            </span>
          )}
          <div className="flex-1" />
          {(['recent', 'rating_asc', 'rating_desc', 'helpful'] as const).map((s, i) => (
            <button key={s} className={`btn sm ${sort === s ? 'active' : ''}`}
              onClick={() => { setSort(s); setPage(0); }}>
              {['최신순', '평점↑', '평점↓', '도움순'][i]}
            </button>
          ))}
          <div style={{ width: 1, background: 'var(--bs)', margin: '0 2px', alignSelf: 'stretch' }} />
          {exportMsg ? (
            <span className="mono dim" style={{ fontSize: 11 }}>{exportMsg}</span>
          ) : (
            <button className="btn sm" onClick={handleExport} disabled={total === 0}
              title={`현재 필터 전체 ${total.toLocaleString()}건 Excel 다운로드`}>
              ⬇ Excel
            </button>
          )}
        </div>

        {/* 리뷰 목록 */}
        <section className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          {/* 그리드 헤더 */}
          <div className="row head" style={{
            display: 'grid',
            gridTemplateColumns: '44px 1fr',
            gap: '0 10px',
            padding: '6px 14px',
            borderBottom: '0.5px solid var(--bs)',
            background: 'var(--snk)',
          }}>
            <span style={{ fontSize: 11 }}>이미지</span>
            <span style={{ fontSize: 11 }}>
              평점 · 날짜 · 도움 · 이미지수 · 리뷰ID &nbsp;/&nbsp; 내용 &nbsp;/&nbsp; 상품 → 브랜드
            </span>
          </div>

          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--bs)' }}>
                <div style={{ height: 12, background: 'var(--rai)', borderRadius: 3, width: '60%', marginBottom: 6 }} />
                <div style={{ height: 12, background: 'var(--rai)', borderRadius: 3, width: '90%' }} />
              </div>
            ))
          ) : rows.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>
              조회 결과 없음
            </div>
          ) : rows.map(r => (
            <div key={r.id}>
              <ReviewCard r={r} onNote={id => setNoteReviewId(id)} />
              {/* 상품 정보 행 */}
              <div style={{
                display: 'grid', gridTemplateColumns: '44px 1fr',
                gap: '0 10px', padding: '2px 14px 8px',
                borderBottom: '0.5px solid var(--bs)',
              }}>
                <div />
                <div className="row-flex center gap-6" style={{ flexWrap: 'wrap' }}>
                  <a href={`/product?no=${r.musinsa_no}`}
                    style={{ fontSize: 11, color: 'var(--hs)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}>
                    {r.product_name} <IcArrowUR size={10} />
                  </a>
                  <span className="dim" style={{ fontSize: 11 }}>· {r.brand_name}</span>
                  <span className="mono dim" style={{ fontSize: 10 }}>no.{r.musinsa_no}</span>
                </div>
              </div>
            </div>
          ))}

          {/* 페이지네이션 */}
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

      {/* 리뷰 메모 드로어 */}
      {noteReviewId && (
        <NoteDrawer
          entity_type="review"
          entity_id={noteReviewId}
          entity_label={rows.find(r => r.id === noteReviewId)?.product_name ?? '리뷰'}
          open={true}
          onClose={() => setNoteReviewId(null)}
        />
      )}
    </div>
  );
}

// ===========================================================================
// C · 특이점 리뷰 (CS 이상탐지)
// ===========================================================================
function RvAnomalyReviews() {
  const [csAnomalies, setCsAnomalies] = React.useState<CsAnomaly[]>([]);
  const [sevFilter, setSevFilter]     = React.useState('');
  const [loading, setLoading]         = React.useState(true);

  const [selectedAnomaly, setSelectedAnomaly] = React.useState<CsAnomaly | null>(null);
  const [product, setProduct]   = React.useState<{ name: string; musinsa_no: string; brand_name: string } | null>(null);
  const [reviews, setReviews]   = React.useState<ReviewRow[]>([]);
  const [rvTotal, setRvTotal]   = React.useState(0);
  const [rvPage, setRvPage]     = React.useState(0);
  const [ratingTab, setRatingTab] = React.useState<'all' | 'low' | 'mid' | 'hi'>('all');
  const [rvLoading, setRvLoading] = React.useState(false);
  const [noteReviewId, setNoteReviewId] = React.useState<string | null>(null);

  const RV_PAGE = 20;

  // 이상탐지 목록 로드
  React.useEffect(() => {
    setLoading(true);
    fetchCsAnomalies({ severity: sevFilter || undefined, limit: 200 })
      .then(setCsAnomalies)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [sevFilter]);

  // 선택된 이상 → 상품 정보 + 리뷰 로드
  React.useEffect(() => {
    if (!selectedAnomaly) { setReviews([]); setProduct(null); return; }
    setProduct(null);
    fetchProductBrief(selectedAnomaly.entity_id).then(setProduct).catch(console.error);
  }, [selectedAnomaly]);

  React.useEffect(() => {
    if (!selectedAnomaly) return;
    let cancelled = false;
    setRvLoading(true);
    const ratingMin = ratingTab === 'low' ? 1 : ratingTab === 'mid' ? 3 : 1;
    const ratingMax = ratingTab === 'low' ? 2 : ratingTab === 'mid' ? 3 : ratingTab === 'hi' ? 5 : 5;
    const ratingMinFinal = ratingTab === 'hi' ? 4 : ratingMin;
    fetchReviews({
      productId: selectedAnomaly.entity_id,
      ratingMin: ratingMinFinal,
      ratingMax,
      sort: 'recent',
      limit: RV_PAGE,
      offset: rvPage * RV_PAGE,
    }).then(({ rows: r, total: t }) => {
      if (!cancelled) { setReviews(r); setRvTotal(t); }
    }).catch(console.error)
      .finally(() => { if (!cancelled) setRvLoading(false); });
    return () => { cancelled = true; };
  }, [selectedAnomaly, ratingTab, rvPage]);

  const selectAnomaly = (a: CsAnomaly) => {
    setSelectedAnomaly(a);
    setRvPage(0);
    setRatingTab('all');
  };

  const sevColor = (s: string) => SEV_COLOR(s);

  return (
    <>
      {/* 헤더 */}
      <div className="row-flex between center" style={{ marginBottom: 12 }}>
        <div className="row-flex center gap-8">
          <h2 style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>CS 이상탐지 — 특이점 리뷰</h2>
          <span className="sec-tag">
            {loading ? '…' : `${csAnomalies.length}건 탐지`}
          </span>
        </div>
        <div className="row-flex gap-4">
          {(['', 'high', 'medium', 'low'] as const).map(s => (
            <button key={s} className={`btn sm ${sevFilter === s ? 'active' : ''}`}
              onClick={() => setSevFilter(s)}>
              {s === '' ? '전체' : s === 'high' ? 'HIGH' : s === 'medium' ? 'MED' : 'LOW'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '300px 1fr', gap: 14 }}>
        {/* 좌측: 이상탐지 목록 */}
        <section className="panel" style={{ padding: 0, overflowY: 'auto', maxHeight: 'calc(100vh - 220px)' }}>
          <div style={{ padding: '8px 12px', borderBottom: '0.5px solid var(--bs)', background: 'var(--snk)' }}>
            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--f3)' }}>이상 항목</span>
          </div>
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ padding: '10px 12px', borderBottom: '0.5px solid var(--bs)' }}>
                <div style={{ height: 11, background: 'var(--rai)', borderRadius: 3, width: '70%', marginBottom: 5 }} />
                <div style={{ height: 11, background: 'var(--rai)', borderRadius: 3, width: '40%' }} />
              </div>
            ))
          ) : csAnomalies.length === 0 ? (
            <div style={{ padding: '32px 12px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>
              탐지된 이상 없음
            </div>
          ) : csAnomalies.map(a => {
            const isSelected = selectedAnomaly?.id === a.id;
            const color = sevColor(a.severity);
            return (
              <div key={a.id}
                onClick={() => selectAnomaly(a)}
                style={{
                  padding: '10px 12px',
                  borderBottom: '0.5px solid var(--bs)',
                  cursor: 'pointer',
                  background: isSelected ? 'var(--snk)' : undefined,
                  borderLeft: isSelected ? `3px solid var(--hs)` : '3px solid transparent',
                }}>
                <div className="row-flex center gap-6" style={{ marginBottom: 4 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color, background: `${color}18`,
                    padding: '1px 5px', borderRadius: 3, flexShrink: 0,
                  }}>
                    {a.severity.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>
                    {CS_LABELS[a.anomaly_type] ?? a.anomaly_type}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--f2)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.entity_name}
                </div>
                <div className="row-flex between center">
                  <span style={{ fontSize: 11, color: 'var(--f3)', lineHeight: 1.4 }}>
                    {a.description?.slice(0, 50)}{(a.description?.length ?? 0) > 50 ? '…' : ''}
                  </span>
                  <span className="mono dim" style={{ fontSize: 10, flexShrink: 0 }}>{a.detection_date}</span>
                </div>
              </div>
            );
          })}
        </section>

        {/* 우측: 리뷰 상세 */}
        <div className="col-flex gap-10">
          {!selectedAnomaly ? (
            <section className="panel" style={{ padding: '60px 0', textAlign: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--f4)' }}>← 좌측에서 이상 항목을 선택하세요</span>
            </section>
          ) : (
            <>
              {/* 상품 헤더 */}
              <section className="panel" style={{ padding: '12px 14px' }}>
                <div className="row-flex between center">
                  <div>
                    <div className="row-flex center gap-8">
                      <span style={{ fontSize: 14, fontWeight: 600 }}>
                        {product?.name ?? selectedAnomaly.entity_name}
                      </span>
                      {product && (
                        <span className="dim" style={{ fontSize: 12 }}>{product.brand_name}</span>
                      )}
                    </div>
                    {/* 이상탐지 설명 */}
                    <div style={{
                      marginTop: 8, padding: '6px 10px', borderRadius: 4,
                      background: `${sevColor(selectedAnomaly.severity)}12`,
                      borderLeft: `3px solid ${sevColor(selectedAnomaly.severity)}`,
                    }}>
                      <div className="row-flex center gap-6" style={{ marginBottom: 3 }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, color: sevColor(selectedAnomaly.severity),
                          background: `${sevColor(selectedAnomaly.severity)}20`,
                          padding: '1px 5px', borderRadius: 3,
                        }}>
                          {selectedAnomaly.severity.toUpperCase()}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 500 }}>
                          {CS_LABELS[selectedAnomaly.anomaly_type] ?? selectedAnomaly.anomaly_type}
                        </span>
                        <span className="mono dim" style={{ fontSize: 10 }}>{selectedAnomaly.detection_date}</span>
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--f2)' }}>{selectedAnomaly.description}</span>
                    </div>
                  </div>
                  {product?.musinsa_no && (
                    <a href={`/product?no=${product.musinsa_no}`} className="btn sm"
                      style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                      상품 페이지 <IcArrowUR size={12} />
                    </a>
                  )}
                </div>
              </section>

              {/* 리뷰 필터 탭 */}
              <div className="row-flex center gap-4">
                {([
                  ['all', `전체 (${rvTotal})`],
                  ['low', '★1~2'],
                  ['mid', '★3'],
                  ['hi',  '★4~5'],
                ] as const).map(([key, label]) => (
                  <button key={key}
                    className={`btn sm ${ratingTab === key ? 'active' : ''}`}
                    onClick={() => { setRatingTab(key); setRvPage(0); }}>
                    {label}
                  </button>
                ))}
              </div>

              {/* 리뷰 목록 */}
              <section className="panel" style={{ padding: 0, overflow: 'hidden' }}>
                {rvLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--bs)' }}>
                      <div style={{ height: 12, background: 'var(--rai)', borderRadius: 3, width: '50%', marginBottom: 6 }} />
                      <div style={{ height: 12, background: 'var(--rai)', borderRadius: 3 }} />
                    </div>
                  ))
                ) : reviews.length === 0 ? (
                  <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>
                    리뷰 없음
                  </div>
                ) : reviews.map(r => (
                  <ReviewCard key={r.id} r={r} onNote={id => setNoteReviewId(id)} />
                ))}

                {reviews.length > 0 && (
                  <div className="row-flex between center" style={{ padding: '10px 14px', borderTop: '0.5px solid var(--bs)' }}>
                    <span className="mono dim" style={{ fontSize: 11 }}>
                      {`${rvPage * RV_PAGE + 1}–${Math.min((rvPage + 1) * RV_PAGE, rvTotal)} / ${rvTotal.toLocaleString()}`}
                    </span>
                    <div className="row-flex gap-4">
                      <button className="btn sm" onClick={() => setRvPage(p => Math.max(0, p - 1))} disabled={rvPage === 0}>←</button>
                      <span className="mono dim" style={{ fontSize: 11 }}>{rvPage + 1} / {Math.ceil(rvTotal / RV_PAGE) || 1}</span>
                      <button className="btn sm" onClick={() => setRvPage(p => p + 1)} disabled={(rvPage + 1) * RV_PAGE >= rvTotal}>→</button>
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>

      {/* 리뷰 메모 드로어 */}
      {noteReviewId && (
        <NoteDrawer
          entity_type="review"
          entity_id={noteReviewId}
          entity_label={reviews.find(r => r.id === noteReviewId)?.product_name ?? '리뷰'}
          open={true}
          onClose={() => setNoteReviewId(null)}
        />
      )}
    </>
  );
}

// ===========================================================================
// D · 상품별 조회 (master-detail)
// ===========================================================================
function RvProductBrowse() {
  const today = new Date().toISOString().split('T')[0];
  const s = React.useRef(lsRead<Record<string, any>>('rv_product_filters', {})).current;

  // 필터 상태
  const [ownBrands, setOwnBrands]   = React.useState<{ id: string; name: string }[]>([]);
  const [selectedBrandIds, setSelectedBrandIds] = React.useState<Set<string>>(new Set(s.brandIds ?? []));
  const [categories, setCategories] = React.useState<Set<string>>(new Set(s.categories?.length ? s.categories : [...ALL_CATEGORY_CODES]));
  const [productKw, setProductKw]   = React.useState<string>(s.productKw ?? '');
  const [productKwInput, setProductKwInput] = React.useState<string>(s.productKw ?? '');
  const [period, setPeriod]         = React.useState<string>(s.period ?? 'today');
  const [fromDate, setFromDate]     = React.useState<string>(s.fromDate ?? new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]);
  const [toDate, setToDate]         = React.useState<string>(s.toDate ?? today);
  const [ratingFrom, setRatingFrom] = React.useState<number>(s.ratingFrom ?? 1);
  const [ratingTo, setRatingTo]     = React.useState<number>(s.ratingTo ?? 5);
  const [rvKeyword, setRvKeyword]   = React.useState<string>(s.rvKeyword ?? '');
  const [rvKwInput, setRvKwInput]   = React.useState<string>(s.rvKeyword ?? '');
  const [genders, setGenders]       = React.useState<Set<string>>(new Set(s.genders ?? []));
  const [heightRange, setHeightRange] = React.useState<[number, number]>(s.heightRange ?? [HEIGHT_MIN, HEIGHT_MAX]);
  const [weightRange, setWeightRange] = React.useState<[number, number]>(s.weightRange ?? [WEIGHT_MIN, WEIGHT_MAX]);
  const [satFilter, setSatFilter]   = React.useState<Record<string, string>>(s.satFilter ?? {});
  const [satOpen, setSatOpen]       = React.useState(false);
  const [masterPage, setMasterPage] = React.useState(0);

  // 마스터 그리드
  const [products, setProducts] = React.useState<OwnProductWithPrice[]>([]);
  const [total, setTotal]       = React.useState(0);
  const [masterLoading, setMasterLoading] = React.useState(true);

  // 선택된 상품
  const [selectedProduct, setSelectedProduct] = React.useState<OwnProductWithPrice | null>(null);

  // 리뷰 (디테일)
  const [reviews, setReviews]   = React.useState<ReviewRow[]>([]);
  const [rvTotal, setRvTotal]   = React.useState(0);
  const [rvPage, setRvPage]     = React.useState(0);
  const [ratingTab, setRatingTab] = React.useState<'all' | 'low' | 'mid' | 'hi'>('all');
  const [rvSort, setRvSort]       = React.useState<'recent' | 'rating_asc' | 'rating_desc' | 'helpful'>('recent');
  const [rvLoading, setRvLoading] = React.useState(false);
  const [noteReviewId, setNoteReviewId] = React.useState<string | null>(null);
  const [exportMsg, setExportMsg] = React.useState('');

  const MASTER_SIZE = 30;
  const RV_SIZE     = 20;

  React.useEffect(() => { fetchOwnBrands().then(setOwnBrands).catch(console.error); }, []);

  // persist filters
  React.useEffect(() => {
    try {
      localStorage.setItem('rv_product_filters', JSON.stringify({
        brandIds: [...selectedBrandIds], categories: [...categories],
        productKw, period, fromDate, toDate, ratingFrom, ratingTo,
        rvKeyword, genders: [...genders], heightRange, weightRange, satFilter,
      }));
    } catch {}
  }, [selectedBrandIds, categories, productKw, period, fromDate, toDate, ratingFrom, ratingTo, rvKeyword, genders, heightRange, weightRange, satFilter]);

  // 마스터 그리드 로드
  React.useEffect(() => {
    let cancelled = false;
    setMasterLoading(true);
    fetchOwnProductsWithPrices({
      brandIds:      selectedBrandIds.size > 0 ? [...selectedBrandIds] : undefined,
      categoryCodes: categories.size < ALL_CATEGORY_CODES.size ? [...categories] : undefined,
      keyword:       productKw.trim() || undefined,
      limit:         MASTER_SIZE,
      offset:        masterPage * MASTER_SIZE,
    }).then(({ rows: r, total: t }) => {
      if (cancelled) return;
      setProducts(r); setTotal(t);
      setSelectedProduct(null); setReviews([]);
    }).catch(console.error)
      .finally(() => { if (!cancelled) setMasterLoading(false); });
    return () => { cancelled = true; };
  }, [selectedBrandIds, categories, productKw, masterPage]); // eslint-disable-line react-hooks/exhaustive-deps

  // 디테일 리뷰 로드
  const calcDateFrom = React.useMemo(() => {
    if (period === 'today') return today;
    if (period === '7d') return new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    if (period === '30d') return new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    if (period === '90d') return new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
    if (period === 'custom') return fromDate;
    return undefined;
  }, [period, fromDate, today]);
  const calcDateTo = period === 'today' ? today : period === 'custom' ? toDate : undefined;

  React.useEffect(() => {
    if (!selectedProduct) return;
    let cancelled = false;
    setRvLoading(true);
    const ratingMin = ratingTab === 'low' ? 1 : ratingTab === 'hi' ? 4 : ratingTab === 'mid' ? 3 : ratingFrom;
    const ratingMax = ratingTab === 'low' ? 2 : ratingTab === 'mid' ? 3 : ratingTo;
    fetchReviews({
      productId: selectedProduct.id,
      ratingMin, ratingMax,
      dateFrom:  calcDateFrom,
      dateTo:    calcDateTo,
      keyword:   rvKeyword.trim() || undefined,
      genders:   genders.size > 0 ? [...genders] : undefined,
      heightMin: heightRange[0] > HEIGHT_MIN ? heightRange[0] : undefined,
      heightMax: heightRange[1] < HEIGHT_MAX ? heightRange[1] : undefined,
      weightMin: weightRange[0] > WEIGHT_MIN ? weightRange[0] : undefined,
      weightMax: weightRange[1] < WEIGHT_MAX ? weightRange[1] : undefined,
      satisfactionFilter: Object.keys(satFilter).length > 0 ? satFilter : undefined,
      sort: rvSort, limit: RV_SIZE, offset: rvPage * RV_SIZE,
    }).then(({ rows: r, total: t }) => {
      if (!cancelled) { setReviews(r); setRvTotal(t); }
    }).catch(console.error)
      .finally(() => { if (!cancelled) setRvLoading(false); });
    return () => { cancelled = true; };
  }, [selectedProduct, ratingTab, ratingFrom, ratingTo, calcDateFrom, calcDateTo, rvKeyword, genders, heightRange, weightRange, satFilter, rvSort, rvPage]); // eslint-disable-line

  const toggleBrand = (id: string) => { setSelectedBrandIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); setMasterPage(0); };
  const toggleCat   = (code: string) => { setCategories(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n; }); setMasterPage(0); };
  const toggleGender = (g: string) => { setGenders(prev => { const n = new Set(prev); n.has(g) ? n.delete(g) : n.add(g); return n; }); setRvPage(0); };
  const toggleSat = (attr: string, ans: string) => {
    setSatFilter(prev => { const n = { ...prev }; n[attr] === ans ? delete n[attr] : (n[attr] = ans); return n; });
    setRvPage(0);
  };

  const fmt = (n: number | null, type: 'price' | 'pct') => {
    if (n == null) return '—';
    if (type === 'price') return n.toLocaleString();
    return `${n.toFixed(0)}%`;
  };

  const handleExport = async () => {
    if (!selectedProduct) return;
    const rvRatingMin = ratingTab === 'low' ? 1 : ratingTab === 'hi' ? 4 : ratingTab === 'mid' ? 3 : ratingFrom;
    const rvRatingMax = ratingTab === 'low' ? 2 : ratingTab === 'mid' ? 3 : ratingTo;
    await exportProductReviews(
      selectedProduct.id, selectedProduct.name,
      {
        ratingMin: rvRatingMin, ratingMax: rvRatingMax,
        dateFrom: calcDateFrom, dateTo: calcDateTo,
        keyword: rvKeyword.trim() || undefined,
        genders: genders.size > 0 ? [...genders] : undefined,
        heightMin: heightRange[0] > HEIGHT_MIN ? heightRange[0] : undefined,
        heightMax: heightRange[1] < HEIGHT_MAX ? heightRange[1] : undefined,
        weightMin: weightRange[0] > WEIGHT_MIN ? weightRange[0] : undefined,
        weightMax: weightRange[1] < WEIGHT_MAX ? weightRange[1] : undefined,
        satisfactionFilter: Object.keys(satFilter).length > 0 ? satFilter : undefined,
        sort: rvSort,
      },
      msg => setExportMsg(msg),
    );
    setTimeout(() => setExportMsg(''), 3000);
  };

  return (
    <div className="grid" style={{ gridTemplateColumns: '260px 1fr', gap: 14 }}>
      {/* 필터 레일 */}
      <aside className="filter-rail">
        <div className="frh">
          <h3>조회 조건</h3>
          <button className="btn sm" onClick={() => {
            setSelectedBrandIds(new Set()); setCategories(new Set(ALL_CATEGORY_CODES));
            setProductKwInput(''); setProductKw(''); setMasterPage(0);
            setPeriod('today'); setRatingFrom(1); setRatingTo(5);
            setRvKwInput(''); setRvKeyword(''); setRvPage(0);
            setGenders(new Set()); setHeightRange([HEIGHT_MIN, HEIGHT_MAX]);
            setWeightRange([WEIGHT_MIN, WEIGHT_MAX]); setSatFilter({});
          }}>초기화</button>
        </div>
        <div className="frb">
          {/* 브랜드 */}
          <div style={{ padding: '8px 14px', borderBottom: '0.5px solid var(--bs)' }}>
            <div className="row-flex between center" style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--f3)', fontWeight: 500 }}>
                브랜드 {selectedBrandIds.size > 0 ? `· ${selectedBrandIds.size}개` : '· 전체'}
              </span>
              {selectedBrandIds.size > 0 && (
                <button className="btn sm" onClick={() => { setSelectedBrandIds(new Set()); setMasterPage(0); }}>전체</button>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {ownBrands.map(b => (
                <button key={b.id}
                  className={`btn sm ${selectedBrandIds.has(b.id) ? 'active' : ''}`}
                  onClick={() => toggleBrand(b.id)}
                  style={{ textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>
                  {b.name}
                </button>
              ))}
            </div>
          </div>

          {/* 카테고리 */}
          <div style={{ padding: '8px 14px', borderBottom: '0.5px solid var(--bs)' }}>
            <FilterBlock label="카테고리" hint={`${categories.size}/${ALL_CATEGORY_CODES.size}`}>
              <div className="check-grid">
                {CATEGORY_ENTRIES.map(([code, label]) => (
                  <CheckRow key={code} on={categories.has(code)} onToggle={() => toggleCat(code)} label={label} />
                ))}
              </div>
              <div className="row-flex gap-4" style={{ marginTop: 4 }}>
                <button className="btn sm" onClick={() => { setCategories(new Set(ALL_CATEGORY_CODES)); setMasterPage(0); }}>전체</button>
                <button className="btn sm" onClick={() => { setCategories(new Set()); setMasterPage(0); }}>해제</button>
              </div>
            </FilterBlock>
          </div>

          {/* 상품 검색 */}
          <div style={{ padding: '8px 14px', borderBottom: '0.5px solid var(--bs)' }}>
            <div style={{ fontSize: 11, color: 'var(--f3)', fontWeight: 500, marginBottom: 4 }}>상품 검색</div>
            <div className="row-flex gap-4">
              <input type="text" value={productKwInput}
                onChange={e => setProductKwInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { setProductKw(productKwInput); setMasterPage(0); } }}
                placeholder="상품명 검색 (Enter)"
                style={{ flex: 1, fontFamily: 'var(--sans)', fontSize: 12, padding: '4px 8px', border: '0.5px solid var(--bs)', borderRadius: 4, background: 'var(--bg)', color: 'var(--f1)' }} />
              {productKw && (
                <button className="btn sm icon" onClick={() => { setProductKwInput(''); setProductKw(''); setMasterPage(0); }}><IcX /></button>
              )}
            </div>
          </div>

          <div style={{ padding: '6px 14px 4px', background: 'var(--snk)' }}>
            <span style={{ fontSize: 10, color: 'var(--f4)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 1 }}>리뷰 필터</span>
          </div>

          {/* 기간 */}
          <div style={{ padding: '8px 14px', borderBottom: '0.5px solid var(--bs)' }}>
            <PeriodFilter value={period} onChange={v => { setPeriod(v); setRvPage(0); }}
              from={fromDate} to={toDate} onFromChange={setFromDate} onToChange={setToDate} />
          </div>

          {/* 별점 */}
          <div style={{ padding: '8px 14px', borderBottom: '0.5px solid var(--bs)' }}>
            <div className="row-flex between center" style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--f3)', fontWeight: 500 }}>별점 범위</span>
              <span className="mono dim" style={{ fontSize: 10 }}>★{ratingFrom} ~ ★{ratingTo}</span>
            </div>
            <RangeSlider
              min={1} max={5}
              value={[ratingFrom, ratingTo]}
              onChange={([a, b]) => { setRatingFrom(a); setRatingTo(b); setRvPage(0); }}
            />
            <div className="row-flex between">
              <span className="mono dim" style={{ fontSize: 10 }}>★1</span>
              <span className="mono dim" style={{ fontSize: 10 }}>★5</span>
            </div>
          </div>

          {/* 성별 */}
          <div style={{ padding: '8px 14px', borderBottom: '0.5px solid var(--bs)' }}>
            <div style={{ fontSize: 11, color: 'var(--f3)', fontWeight: 500, marginBottom: 4 }}>성별</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {['남성', '여성'].map(g => (
                <button key={g} className={`btn sm ${genders.has(g) ? 'active' : ''}`}
                  onClick={() => toggleGender(g)}
                  style={{ textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>{g}</button>
              ))}
              {genders.size > 0 && (
                <button className="btn sm" onClick={() => { setGenders(new Set()); setRvPage(0); }}>전체</button>
              )}
            </div>
          </div>

          {/* 신체 정보 */}
          <div style={{ padding: '8px 14px', borderBottom: '0.5px solid var(--bs)' }}>
            <div style={{ fontSize: 11, color: 'var(--f3)', fontWeight: 500, marginBottom: 6 }}>신체 정보</div>
            <div style={{ marginBottom: 10 }}>
              <div className="row-flex between center" style={{ marginBottom: 2 }}>
                <span className="mono dim" style={{ fontSize: 10 }}>키 (cm)</span>
                <span className="mono dim" style={{ fontSize: 10 }}>
                  {heightRange[0] === HEIGHT_MIN && heightRange[1] === HEIGHT_MAX ? '전체' : `${heightRange[0]}~${heightRange[1]}`}
                </span>
              </div>
              <RangeSlider min={HEIGHT_MIN} max={HEIGHT_MAX} value={heightRange}
                onChange={v => { setHeightRange(v); setRvPage(0); }} />
              <div className="row-flex between">
                <span className="mono dim" style={{ fontSize: 9 }}>{HEIGHT_MIN}</span>
                <span className="mono dim" style={{ fontSize: 9 }}>{HEIGHT_MAX}</span>
              </div>
            </div>
            <div>
              <div className="row-flex between center" style={{ marginBottom: 2 }}>
                <span className="mono dim" style={{ fontSize: 10 }}>몸무게 (kg)</span>
                <span className="mono dim" style={{ fontSize: 10 }}>
                  {weightRange[0] === WEIGHT_MIN && weightRange[1] === WEIGHT_MAX ? '전체' : `${weightRange[0]}~${weightRange[1]}`}
                </span>
              </div>
              <RangeSlider min={WEIGHT_MIN} max={WEIGHT_MAX} value={weightRange}
                onChange={v => { setWeightRange(v); setRvPage(0); }} />
              <div className="row-flex between">
                <span className="mono dim" style={{ fontSize: 9 }}>{WEIGHT_MIN}</span>
                <span className="mono dim" style={{ fontSize: 9 }}>{WEIGHT_MAX}</span>
              </div>
            </div>
          </div>

          {/* 만족도 */}
          <div style={{ padding: '8px 14px', borderBottom: '0.5px solid var(--bs)' }}>
            <button onClick={() => setSatOpen(o => !o)}
              style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--f3)', fontWeight: 500 }}>
                만족도 {Object.keys(satFilter).length > 0 && <span style={{ color: 'var(--hs)', fontWeight: 700 }}>· {Object.keys(satFilter).length}개</span>}
              </span>
              <span className="mono dim" style={{ fontSize: 10 }}>{satOpen ? '▲' : '▼'}</span>
            </button>
            {satOpen && (
              <div style={{ marginTop: 8 }}>
                {SATISFACTION_ATTRS.map(({ attribute, answers }) => (
                  <div key={attribute} style={{ marginBottom: 7 }}>
                    <div style={{ fontSize: 10, color: 'var(--f4)', marginBottom: 3 }}>{attribute}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                      {answers.map(ans => (
                        <button key={ans} className={`btn sm ${satFilter[attribute] === ans ? 'active' : ''}`}
                          onClick={() => toggleSat(attribute, ans)}
                          style={{ fontSize: 10, padding: '2px 6px', textTransform: 'none', letterSpacing: 0 }}>{ans}</button>
                      ))}
                    </div>
                  </div>
                ))}
                {Object.keys(satFilter).length > 0 && (
                  <button className="btn sm" style={{ marginTop: 4 }} onClick={() => { setSatFilter({}); setRvPage(0); }}>초기화</button>
                )}
              </div>
            )}
          </div>

          {/* 리뷰 키워드 */}
          <div style={{ padding: '8px 14px', borderBottom: '0.5px solid var(--bs)' }}>
            <div style={{ fontSize: 11, color: 'var(--f3)', fontWeight: 500, marginBottom: 4 }}>리뷰 키워드</div>
            <div className="row-flex gap-4">
              <input type="text" value={rvKwInput}
                onChange={e => setRvKwInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { setRvKeyword(rvKwInput); setRvPage(0); } }}
                placeholder="리뷰 내용 검색 (Enter)"
                style={{ flex: 1, fontFamily: 'var(--sans)', fontSize: 12, padding: '4px 8px', border: '0.5px solid var(--bs)', borderRadius: 4, background: 'var(--bg)', color: 'var(--f1)' }} />
              {rvKeyword && (
                <button className="btn sm icon" onClick={() => { setRvKwInput(''); setRvKeyword(''); setRvPage(0); }}><IcX /></button>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* 메인 */}
      <div className="col-flex gap-10">
        {/* 마스터 그리드: 상품 목록 */}
        <section className="panel" style={{ padding: 0 }}>
          <div className="row-flex between center" style={{ padding: '8px 14px', borderBottom: '0.5px solid var(--bs)' }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>
              상품 목록
              <span className="mono dim" style={{ fontSize: 11, fontWeight: 400, marginLeft: 6 }}>
                {masterLoading ? '…' : `${total.toLocaleString()}개`}
              </span>
            </span>
            {selectedProduct && (
              <span style={{ fontSize: 11, color: 'var(--hs)' }}>
                선택: {selectedProduct.name}
              </span>
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 860 }}>
              {/* 헤더 */}
              <div className="row head" style={{
                display: 'grid',
                gridTemplateColumns: '48px 1fr 90px 80px 90px 90px 70px 55px 60px 70px',
                padding: '5px 10px', gap: '0 6px', background: 'var(--snk)',
                borderBottom: '0.5px solid var(--bs)',
              }}>
                <span style={{ fontSize: 10 }}>이미지</span>
                <span style={{ fontSize: 10 }}>상품명</span>
                <span style={{ fontSize: 10 }}>브랜드</span>
                <span style={{ fontSize: 10 }}>카테고리</span>
                <span className="cell-r" style={{ fontSize: 10 }}>소비자가</span>
                <span className="cell-r" style={{ fontSize: 10 }}>판매가</span>
                <span className="cell-r" style={{ fontSize: 10 }}>할인율</span>
                <span className="cell-c" style={{ fontSize: 10 }}>품절</span>
                <span className="cell-r" style={{ fontSize: 10 }}>리뷰</span>
                <span className="cell-r" style={{ fontSize: 10 }}>만족도</span>
              </div>

              {/* 로딩 스켈레톤 */}
              {masterLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} style={{
                    display: 'grid', gridTemplateColumns: '48px 1fr 90px 80px 90px 90px 70px 55px 60px 70px',
                    padding: '8px 10px', gap: '0 6px', borderBottom: '0.5px solid var(--bs)',
                  }}>
                    {Array.from({ length: 10 }).map((_, j) => (
                      <div key={j} style={{ height: 12, background: 'var(--rai)', borderRadius: 3 }} />
                    ))}
                  </div>
                ))
              ) : products.length === 0 ? (
                <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>
                  상품 없음
                </div>
              ) : products.map((p, i) => {
                const isSelected = selectedProduct?.id === p.id;
                return (
                  <div key={p.id}
                    onClick={() => { setSelectedProduct(p); setRvPage(0); setRatingTab('all'); setRvSort('recent'); }}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '48px 1fr 90px 80px 90px 90px 70px 55px 60px 70px',
                      padding: '6px 10px', gap: '0 6px',
                      borderBottom: '0.5px solid var(--bs)',
                      cursor: 'pointer',
                      background: isSelected ? 'var(--snk)' : i % 2 ? 'var(--rai-light, var(--snk))' : undefined,
                      borderLeft: isSelected ? '3px solid var(--hs)' : '3px solid transparent',
                    }}>
                    {/* 썸네일 */}
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      {p.thumbnail_url ? (
                        <img src={p.thumbnail_url} alt=""
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          style={{ width: 40, height: 40, borderRadius: 3, objectFit: 'cover', display: 'block', border: '0.5px solid var(--bs)' }} />
                      ) : (
                        <div style={{ width: 40, height: 40, borderRadius: 3, background: 'var(--snk)', border: '0.5px solid var(--bs)' }} />
                      )}
                    </div>
                    {/* 상품명 */}
                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
                      <a href={`/product?no=${p.musinsa_no}`} onClick={e => e.stopPropagation()}
                        style={{ fontSize: 12, color: 'var(--hs)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.name}
                      </a>
                      <span className="mono dim" style={{ fontSize: 9, marginTop: 1 }}>
                        no.{p.musinsa_no}{p.season_year ? ` · ${p.season_year}` : ''}
                        {(p.style_no || p.erp_style_code) && ` · ${[p.style_no, p.erp_style_code].filter(Boolean).join(' · ')}`}
                      </span>
                    </div>
                    {/* 브랜드 */}
                    <div style={{ fontSize: 11, display: 'flex', alignItems: 'center', color: 'var(--f2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.brand_name}
                    </div>
                    {/* 카테고리 */}
                    <div style={{ fontSize: 11, display: 'flex', alignItems: 'center', color: 'var(--f3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.category_code ? (CATEGORY_MAP[p.category_code] ?? p.category_code) : '—'}
                    </div>
                    {/* 소비자가 */}
                    <div className="mono cell-r" style={{ fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                      {fmt(p.list_price, 'price')}
                    </div>
                    {/* 판매가 */}
                    <div className="mono cell-r" style={{ fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', fontWeight: p.discount_rate ? 500 : 400 }}>
                      {fmt(p.final_price, 'price')}
                    </div>
                    {/* 할인율 */}
                    <div className="mono cell-r" style={{
                      fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                      color: (p.discount_rate ?? 0) >= 30 ? 'var(--dn)' : undefined,
                      fontWeight: (p.discount_rate ?? 0) >= 30 ? 600 : 400,
                    }}>
                      {fmt(p.discount_rate, 'pct')}
                    </div>
                    {/* 품절 */}
                    <div className="cell-c" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {p.is_sold_out && (
                        <span style={{ fontSize: 9, background: 'var(--dn)', color: '#fff', padding: '1px 4px', borderRadius: 2 }}>품절</span>
                      )}
                    </div>
                    {/* 리뷰수 */}
                    <div className="mono cell-r" style={{ fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                      {(p.review_count ?? 0).toLocaleString()}
                    </div>
                    {/* 만족도 */}
                    <div className="mono cell-r" style={{
                      fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                      color: (p.satisfaction_score ?? 100) < 60 ? 'var(--dn)' : undefined,
                    }}>
                      {p.satisfaction_score != null ? `${p.satisfaction_score}%` : '—'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 마스터 페이지네이션 */}
          <div className="row-flex between center" style={{ padding: '8px 14px', borderTop: '0.5px solid var(--bs)' }}>
            <span className="mono dim" style={{ fontSize: 11 }}>
              {total === 0 ? '0개' : `${masterPage * MASTER_SIZE + 1}–${Math.min((masterPage + 1) * MASTER_SIZE, total)} / ${total.toLocaleString()}`}
            </span>
            <div className="row-flex gap-4">
              <button className="btn sm" onClick={() => setMasterPage(p => Math.max(0, p - 1))} disabled={masterPage === 0}>←</button>
              <span className="mono dim" style={{ fontSize: 11 }}>{masterPage + 1} / {Math.ceil(total / MASTER_SIZE) || 1}</span>
              <button className="btn sm" onClick={() => setMasterPage(p => p + 1)} disabled={(masterPage + 1) * MASTER_SIZE >= total}>→</button>
            </div>
          </div>
        </section>

        {/* 디테일 그리드: 선택된 상품의 리뷰 */}
        {!selectedProduct ? (
          <section className="panel" style={{ padding: '32px 0', textAlign: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--f4)' }}>↑ 상품을 선택하면 리뷰가 표시됩니다</span>
          </section>
        ) : (
          <section className="panel" style={{ padding: 0 }}>
            <div className="row-flex between center" style={{ padding: '8px 14px', borderBottom: '0.5px solid var(--bs)' }}>
              <div className="row-flex center gap-8">
                <span style={{ fontSize: 13, fontWeight: 500 }}>{selectedProduct.name}</span>
                <span className="dim" style={{ fontSize: 12 }}>{selectedProduct.brand_name}</span>
                <span className="sec-tag">{rvLoading ? '…' : `${rvTotal.toLocaleString()}건`}</span>
              </div>
              <div className="row-flex gap-4" style={{ flexWrap: 'wrap' }}>
                {([
                  ['all', '전체'],
                  ['low', '★1~2'],
                  ['mid', '★3'],
                  ['hi',  '★4~5'],
                ] as const).map(([key, label]) => (
                  <button key={key}
                    className={`btn sm ${ratingTab === key ? 'active' : ''}`}
                    onClick={() => { setRatingTab(key); setRvPage(0); }}>
                    {label}
                  </button>
                ))}
                <div style={{ width: 1, background: 'var(--bs)', margin: '0 2px', alignSelf: 'stretch' }} />
                {(['recent', 'rating_asc', 'rating_desc', 'helpful'] as const).map((s, i) => (
                  <button key={s} className={`btn sm ${rvSort === s ? 'active' : ''}`}
                    onClick={() => { setRvSort(s); setRvPage(0); }}>
                    {['최신순', '평점↑', '평점↓', '도움순'][i]}
                  </button>
                ))}
                <a href={`/product?no=${selectedProduct.musinsa_no}`} className="btn sm"
                  style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  상품 페이지 <IcArrowUR size={11} />
                </a>
                <div style={{ width: 1, background: 'var(--bs)', margin: '0 2px', alignSelf: 'stretch' }} />
                {exportMsg ? (
                  <span className="mono dim" style={{ fontSize: 11 }}>{exportMsg}</span>
                ) : (
                  <button className="btn sm" onClick={handleExport}
                    title={`${selectedProduct.name} 전체 리뷰 Excel 다운로드`}>
                    ⬇ Excel
                  </button>
                )}
              </div>
            </div>

            {rvLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--bs)' }}>
                  <div style={{ height: 12, background: 'var(--rai)', borderRadius: 3, width: '50%', marginBottom: 6 }} />
                  <div style={{ height: 12, background: 'var(--rai)', borderRadius: 3 }} />
                </div>
              ))
            ) : reviews.length === 0 ? (
              <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>
                리뷰 없음
              </div>
            ) : reviews.map(r => (
              <ReviewCard key={r.id} r={r} onNote={id => setNoteReviewId(id)} />
            ))}

            {reviews.length > 0 && (
              <div className="row-flex between center" style={{ padding: '8px 14px', borderTop: '0.5px solid var(--bs)' }}>
                <span className="mono dim" style={{ fontSize: 11 }}>
                  {`${rvPage * RV_SIZE + 1}–${Math.min((rvPage + 1) * RV_SIZE, rvTotal)} / ${rvTotal.toLocaleString()}`}
                </span>
                <div className="row-flex gap-4">
                  <button className="btn sm" onClick={() => setRvPage(p => Math.max(0, p - 1))} disabled={rvPage === 0}>←</button>
                  <span className="mono dim" style={{ fontSize: 11 }}>{rvPage + 1} / {Math.ceil(rvTotal / RV_SIZE) || 1}</span>
                  <button className="btn sm" onClick={() => setRvPage(p => p + 1)} disabled={(rvPage + 1) * RV_SIZE >= rvTotal}>→</button>
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      {/* 리뷰 메모 드로어 */}
      {noteReviewId && (
        <NoteDrawer
          entity_type="review"
          entity_id={noteReviewId}
          entity_label={reviews.find(r => r.id === noteReviewId)?.product_name ?? '리뷰'}
          open={true}
          onClose={() => setNoteReviewId(null)}
        />
      )}
    </div>
  );
}
