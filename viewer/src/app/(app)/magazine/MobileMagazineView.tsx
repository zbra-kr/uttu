'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  fetchMagazineArticles, fetchMagazineProducts, fetchMagazineBoostAnomalies,
  fetchBrandIdsByNames,
  type MagazineRow, type MagazineArticleProduct, type MagazineBoostAnomaly,
} from '@/lib/queries';
import MobileFilterChips from '@/components/mobile/MobileFilterChips';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';
import { IcX } from '@/components/ui/icons';

const CAT_CHIPS = [
  { value: '',       label: '전체' },
  { value: 'style',  label: '스타일' },
  { value: 'trend',  label: '트렌드' },
  { value: 'new',    label: '신상' },
];

type DatePreset = 'today' | '7d' | '1m' | '3m' | 'custom';

const DATE_CHIPS: { value: DatePreset; label: string }[] = [
  { value: 'today', label: '오늘' },
  { value: '7d',    label: '7일' },
  { value: '1m',    label: '1개월' },
  { value: '3m',    label: '3개월' },
  { value: 'custom', label: '직접선택' },
];

function getDateRange(preset: DatePreset, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = fmt(now);

  if (preset === 'today') return { from: today, to: today };
  if (preset === '7d') {
    const d = new Date(now); d.setDate(d.getDate() - 7);
    return { from: fmt(d), to: today };
  }
  if (preset === '1m') {
    const d = new Date(now); d.setMonth(d.getMonth() - 1);
    return { from: fmt(d), to: today };
  }
  if (preset === '3m') {
    const d = new Date(now); d.setMonth(d.getMonth() - 3);
    return { from: fmt(d), to: today };
  }
  return { from: customFrom, to: customTo };
}

const SEV_COLOR: Record<string, string> = {
  HIGH: 'var(--shf)', MEDIUM: '#F59E0B', LOW: 'var(--slf)',
};

function fmtDate(dt: string): string {
  return dt.slice(0, 10).replace(/-/g, '.');
}

function fmtViews(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}만`;
  if (n >= 1000)  return `${(n / 1000).toFixed(1)}천`;
  return n.toLocaleString();
}

// ── 매거진 상세 바텀시트 ────────────────────────────────────────────────
function ArticleDetailSheet({ article, onClose }: { article: MagazineRow; onClose: () => void }) {
  const router = useRouter();
  const [products, setProducts] = useState<MagazineArticleProduct[]>([]);
  const [boosts, setBoosts] = useState<MagazineBoostAnomaly[]>([]);
  const [brandIds, setBrandIds] = useState<Record<string, string>>({});
  const [detailLoading, setDetailLoading] = useState(true);

  useEffect(() => {
    setDetailLoading(true);
    Promise.all([
      fetchMagazineProducts(article.article_id),
      fetchMagazineBoostAnomalies({ articleIds: [article.article_id], limit: 100 }),
      fetchBrandIdsByNames(article.brand_names),
    ]).then(([prods, { rows: bRows }, ids]) => {
      setProducts(prods);
      setBoosts(bRows);
      setBrandIds(ids);
      setDetailLoading(false);
    }).catch(() => setDetailLoading(false));
  }, [article.article_id]);

  // 부스트 정보를 musinsa_no 기준으로 맵핑
  const boostMap = new Map(boosts.map(b => [b.meta?.musinsa_no, b]));

  // 정렬: 부스트 있는 것 먼저(심각도 순), 자사 우선, 나머지
  const SEV_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  const sorted = [...products].sort((a, b) => {
    const ba = boostMap.get(a.musinsa_no);
    const bb = boostMap.get(b.musinsa_no);
    if (ba && !bb) return -1;
    if (!ba && bb) return 1;
    if (ba && bb) {
      const so = (SEV_ORDER[ba.severity] ?? 9) - (SEV_ORDER[bb.severity] ?? 9);
      if (so !== 0) return so;
    }
    if (a.is_own !== b.is_own) return a.is_own ? -1 : 1;
    return 0;
  });

  const musinsaUrl = article.landing_url
    ?? `https://www.musinsa.com/app/contents/detail/${article.article_id}`;

  return (
    <>
      {/* scrim */}
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,.45)', zIndex: 80 }} onClick={onClose} />

      {/* sheet */}
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 90,
        background: 'var(--sur)', borderTop: '1px solid var(--bs)',
        borderRadius: '16px 16px 0 0',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.2)',
        maxHeight: '92dvh', display: 'flex', flexDirection: 'column',
      }}>
        {/* handle */}
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10, paddingBottom: 4, flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--bs)' }} />
        </div>

        {/* 닫기 버튼 */}
        <button onClick={onClose} style={{
          position: 'absolute', top: 12, right: 14,
          width: 28, height: 28, border: '1px solid var(--bs)', borderRadius: 8,
          background: 'var(--snk)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: 'var(--f3)', padding: 0,
        }}>
          <IcX size={14} />
        </button>

        {/* 스크롤 영역 */}
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as 'touch' }}>

          {/* 썸네일 */}
          {article.thumbnail_url && (
            <div style={{ width: '100%', aspectRatio: '16 / 9', overflow: 'hidden', background: 'var(--snk)' }}>
              <img
                src={article.thumbnail_url}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </div>
          )}

          <div style={{ padding: '14px 16px 4px' }}>

            {/* 카테고리 + 날짜 */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              {article.category && (
                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--hs)', background: 'var(--hs-soft)', padding: '2px 7px', borderRadius: 10 }}>
                  {article.category}
                </span>
              )}
              {article.sub_category && (
                <span style={{ fontSize: 10, color: 'var(--f4)', padding: '2px 7px', background: 'var(--snk)', border: '1px solid var(--bd)', borderRadius: 10 }}>
                  {article.sub_category}
                </span>
              )}
              <span style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginLeft: 'auto' }}>
                {fmtDate(article.published_at)}
              </span>
            </div>

            {/* 제목 */}
            <h2 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 700, color: 'var(--f1)', lineHeight: 1.4 }}>
              {article.title}
            </h2>

            {/* 통계 */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>
              <span>👁 {fmtViews(article.view_count)}</span>
              {article.comment_count > 0 && <span>💬 {article.comment_count}</span>}
              {boosts.length > 0 && <span style={{ color: 'var(--shf)' }}>📈 랭킹 변동 {boosts.length}건</span>}
            </div>

            {/* 요약 */}
            {article.summary && (
              <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--f2)', lineHeight: 1.7 }}>
                {article.summary}
              </p>
            )}

            {/* 브랜드 */}
            {article.brand_names.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 7 }}>
                  브랜드 {article.brand_names.length}개
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {article.brand_names.map(name => {
                    const bid = brandIds[name];
                    return (
                      <span
                        key={name}
                        onClick={bid ? () => { onClose(); router.push(`/brand?id=${bid}`); } : undefined}
                        style={{
                          fontSize: 12, padding: '5px 11px', borderRadius: 12,
                          background: bid ? 'var(--hs-soft)' : 'var(--snk)',
                          color: bid ? 'var(--hs)' : 'var(--f2)',
                          border: `1px solid ${bid ? 'var(--hs)' : 'var(--bd)'}`,
                          cursor: bid ? 'pointer' : 'default',
                          fontWeight: bid ? 600 : 400,
                        }}
                      >
                        {name}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 연결 상품 */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 8 }}>
                연결 상품 {products.length}개
                {boosts.length > 0 && ` · 랭킹 변동 ${boosts.length}건 감지`}
              </div>

              {/* 랭킹 효과 요약 배너 */}
              {!detailLoading && boosts.length > 0 && (
                <div style={{
                  marginBottom: 12, padding: '10px 12px', borderRadius: 10,
                  background: 'color-mix(in oklab, var(--shf) 8%, transparent)',
                  border: '1px solid color-mix(in oklab, var(--shf) 25%, transparent)',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--shf)', marginBottom: 6 }}>
                    📈 랭킹 부스트 감지 · {boosts.length}건
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {boosts.map(b => {
                      const isNew = b.anomaly_type === 'magazine_rank_new_entry';
                      const delta = b.meta?.rank_delta;
                      return (
                        <span key={b.id} style={{
                          fontSize: 10, padding: '2px 7px', borderRadius: 8,
                          background: 'var(--sur)', border: `1px solid ${SEV_COLOR[b.severity] ?? 'var(--bd)'}`,
                          color: SEV_COLOR[b.severity] ?? 'var(--f3)', fontFamily: 'var(--mono)', fontWeight: 600,
                        }}>
                          {b.entity_name?.slice(0, 10)}{(b.entity_name?.length ?? 0) > 10 ? '…' : ''}
                          {' '}
                          {isNew ? '신규진입' : delta != null ? (delta > 0 ? `▲${delta}위` : `▼${Math.abs(delta)}위`) : ''}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {detailLoading ? (
                <div style={{ textAlign: 'center', padding: '20px 0', fontSize: 12, color: 'var(--f4)' }}>불러오는 중...</div>
              ) : sorted.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '16px 0', fontSize: 12, color: 'var(--f4)' }}>연결된 상품이 없습니다</div>
              ) : (
                sorted.map((p, i) => {
                  const boost = boostMap.get(p.musinsa_no);
                  const isNew = boost?.anomaly_type === 'magazine_rank_new_entry';
                  const delta = boost?.meta?.rank_delta;
                  const rankBefore = boost?.meta?.rank_before;
                  const rankAfter  = boost?.meta?.rank_after;

                  return (
                    <div
                      key={p.musinsa_no}
                      onClick={() => { onClose(); router.push(`/product?no=${p.musinsa_no}`); }}
                      style={{
                        cursor: 'pointer',
                        padding: '11px 0',
                        borderTop: i > 0 ? '1px solid var(--bd)' : undefined,
                      }}
                    >
                      {/* 상품명 행 */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: boost ? 6 : 0 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.name}
                            </span>
                            {p.is_own && (
                              <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--hs)', background: 'var(--hs-soft)', padding: '1px 4px', borderRadius: 3, flexShrink: 0 }}>
                                자사
                              </span>
                            )}
                          </div>
                          {p.brand_name && (
                            <span style={{ fontSize: 11, color: 'var(--f4)' }}>{p.brand_name}</span>
                          )}
                        </div>
                        <span style={{ fontSize: 14, color: 'var(--f4)', flexShrink: 0 }}>→</span>
                      </div>

                      {/* 랭킹 효과 바 */}
                      {boost && (
                        <div style={{
                          padding: '7px 10px', borderRadius: 8,
                          background: 'color-mix(in oklab, var(--shf) 6%, transparent)',
                          border: `1px solid ${SEV_COLOR[boost.severity] ?? 'var(--bd)'}40`,
                          display: 'flex', alignItems: 'center', gap: 8,
                        }}>
                          {/* 심각도 dot */}
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: SEV_COLOR[boost.severity] ?? 'var(--f4)', flexShrink: 0, display: 'block' }} />

                          {/* 전후 비교 */}
                          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--mono)', fontSize: 11 }}>
                            {isNew ? (
                              <>
                                <span style={{ color: 'var(--f4)', textDecoration: 'line-through' }}>비랭킹</span>
                                <span style={{ color: 'var(--f4)' }}>→</span>
                                <span style={{ color: SEV_COLOR[boost.severity], fontWeight: 700 }}>
                                  #{rankAfter}위 신규진입
                                </span>
                              </>
                            ) : (
                              <>
                                {rankBefore != null && (
                                  <span style={{ color: 'var(--f4)' }}>#{rankBefore}위</span>
                                )}
                                <span style={{ color: 'var(--f4)' }}>→</span>
                                <span style={{ color: SEV_COLOR[boost.severity], fontWeight: 700 }}>
                                  #{rankAfter}위
                                </span>
                                {delta != null && (
                                  <span style={{ color: SEV_COLOR[boost.severity], fontWeight: 700 }}>
                                    ({delta > 0 ? `▲${delta}` : `▼${Math.abs(delta)}`}위)
                                  </span>
                                )}
                              </>
                            )}
                          </div>

                          {/* 심각도 badge */}
                          <span style={{ fontSize: 9, fontWeight: 700, color: SEV_COLOR[boost.severity], flexShrink: 0 }}>
                            {boost.severity}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* 하단 버튼 */}
        <div style={{ padding: '12px 16px', paddingBottom: 'max(12px, env(safe-area-inset-bottom))', borderTop: '1px solid var(--bs)', flexShrink: 0 }}>
          <a
            href={musinsaUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'block', width: '100%', padding: '13px 0', borderRadius: 12,
              background: 'var(--snk)', border: '1px solid var(--bd)', color: 'var(--f1)',
              fontSize: 14, fontWeight: 600, textAlign: 'center', textDecoration: 'none',
            }}
          >
            무신사에서 보기 ↗
          </a>
        </div>
      </div>
    </>
  );
}

type SortKey = 'published_at' | 'view_count' | 'comment_count';

const SORT_CHIPS: { value: SortKey; label: string }[] = [
  { value: 'published_at',  label: '최신순' },
  { value: 'view_count',    label: '조회수순' },
  { value: 'comment_count', label: '댓글순' },
];

// ── 메인 ─────────────────────────────────────────────────────────────────
export default function MobileMagazineView() {
  const [rows, setRows] = useState<MagazineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState('');
  const [sort, setSort] = useState<SortKey>('published_at');
  const [selected, setSelected] = useState<MagazineRow | null>(null);
  const [datePreset, setDatePreset] = useState<DatePreset>('3m');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  useEffect(() => {
    if (datePreset === 'custom' && (!customFrom || !customTo)) return;
    const { from, to } = getDateRange(datePreset, customFrom, customTo);
    setLoading(true);
    fetchMagazineArticles({ category: cat || undefined, sort, limit: 100, dateFrom: from, dateTo: to })
      .then(({ rows: data }) => { setRows(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [cat, sort, datePreset, customFrom, customTo]);

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 12px 20px', width: '100%', minWidth: 0 }}>
        <MobileFilterChips items={CAT_CHIPS} activeValue={cat} onChange={setCat} />
        <MobileFilterChips items={SORT_CHIPS} activeValue={sort} onChange={v => setSort(v as SortKey)} />

        {/* 날짜 필터 */}
        <div style={{ display: 'flex', gap: 6 }}>
          {DATE_CHIPS.map(chip => (
            <button
              key={chip.value}
              onClick={() => setDatePreset(chip.value)}
              style={{
                flex: 1, padding: '6px 0', fontSize: 11, fontWeight: datePreset === chip.value ? 700 : 400,
                background: datePreset === chip.value ? 'var(--hs)' : 'var(--sur)',
                color: datePreset === chip.value ? '#fff' : 'var(--f3)',
                border: '1px solid var(--bd)', borderRadius: 8, cursor: 'pointer',
              }}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* 직접선택 날짜 입력 */}
        {datePreset === 'custom' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              style={{
                flex: 1, height: 36, padding: '0 10px', borderRadius: 8, fontSize: 12,
                border: '1px solid var(--bd)', background: 'var(--snk)', color: 'var(--f1)',
                outline: 'none', boxSizing: 'border-box',
              }}
            />
            <span style={{ fontSize: 12, color: 'var(--f4)' }}>~</span>
            <input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              style={{
                flex: 1, height: 36, padding: '0 10px', borderRadius: 8, fontSize: 12,
                border: '1px solid var(--bd)', background: 'var(--snk)', color: 'var(--f1)',
                outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>
        ) : rows.length === 0 ? (
          <MobileEmptyState icon="📰" title="매거진 데이터가 없습니다" />
        ) : (
          rows.map(r => (
            <div
              key={r.id}
              onClick={() => setSelected(r)}
              style={{
                display: 'flex', gap: 12, padding: '12px 13px',
                background: 'var(--sur)', border: '1px solid var(--bd)',
                borderRadius: 10, cursor: 'pointer',
              }}
            >
              {r.thumbnail_url && (
                <div style={{ width: 72, height: 72, borderRadius: 8, overflow: 'hidden', flexShrink: 0, background: 'var(--snk)' }}>
                  <img
                    src={r.thumbnail_url}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <p style={{
                  margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--f1)', lineHeight: 1.4,
                  display: '-webkit-box', WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>
                  {r.title}
                </p>
                {r.brand_names.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--f3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.brand_names.slice(0, 3).join(' · ')}{r.brand_names.length > 3 ? ` 외 ${r.brand_names.length - 3}개` : ''}
                  </div>
                )}
                <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', display: 'flex', gap: 8 }}>
                  <span>👁 {fmtViews(r.view_count)}</span>
                  {r.comment_count > 0 && <span>💬 {r.comment_count}</span>}
                  <span style={{ marginLeft: 'auto' }}>{fmtDate(r.published_at)}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {selected && (
        <ArticleDetailSheet article={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
