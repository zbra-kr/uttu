'use client';
import { useState, useEffect, useRef } from 'react';
import { fetchReviews, fetchOwnBrands, normImgUrl, type ReviewRow } from '@/lib/queries';
import { supabaseBrowser } from '@/lib/supabase/client';
import MobileFilterChips from '@/components/mobile/MobileFilterChips';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';
import ReviewDetailSheet from '@/components/mobile/ReviewDetailSheet';

const RATING_CHIPS = [
  { value: 'all',  label: '전체' },
  { value: 'low',  label: '1~2점 (문제)' },
  { value: 'high', label: '4~5점 (강점)' },
];

function Stars({ rating }: { rating: number }) {
  return (
    <span style={{ fontSize: 13, color: rating >= 4 ? 'var(--smf)' : rating <= 2 ? 'var(--shf)' : 'var(--f4)', fontFamily: 'var(--mono)', letterSpacing: 1 }}>
      {'★'.repeat(rating)}{'☆'.repeat(5 - rating)}
    </span>
  );
}

function daysAgo(dateStr: string): string {
  const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (d === 0) return '오늘';
  if (d === 1) return '1일 전';
  if (d < 30) return `${d}일 전`;
  if (d < 365) return `${Math.floor(d / 30)}개월 전`;
  return `${Math.floor(d / 365)}년 전`;
}

// ── 메인 ─────────────────────────────────────────────────────────────────
const PAGE_SIZE = 50;
type ReviewPage = { scope: string; rows: ReviewRow[]; total: number; nextOffset: number; loading: boolean; error: boolean };

export default function MobileReviewsView() {
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [brandId, setBrandId] = useState<string>('');
  const [ratingFilter, setRatingFilter] = useState('all');
  const [auth, setAuth] = useState<{ ready: boolean; userId: string | null; epoch: number }>({ ready: false, userId: null, epoch: 0 });
  const [brandError, setBrandError] = useState(false);
  const [brandsReady, setBrandsReady] = useState(false);
  const [brandRetry, setBrandRetry] = useState(0);
  const [page, setPage] = useState<ReviewPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<ReviewRow | null>(null);
  const identityRef = useRef<{ ready: boolean; userId: string | null }>({ ready: false, userId: null });
  const scope = JSON.stringify([auth.epoch, brandId, ratingFilter]);
  const current = page?.scope === scope ? page : null;
  const rows = current?.rows ?? [];
  const total = current?.total ?? 0;

  useEffect(() => {
    let cancelled = false, eventSeen = false;
    const client = supabaseBrowser();
    const identity = (userId: string | null) => {
      if (cancelled) return;
      if (identityRef.current.ready && identityRef.current.userId === userId) return;
      identityRef.current = { ready: true, userId };
      setAuth(previous => ({ ready: true, userId, epoch: previous.epoch + 1 }));
      setBrands([]); setBrandId(''); setSelected(null); setPage(null); setOffset(0);
      setBrandError(false); setBrandsReady(false);
    };
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      eventSeen = true; identity(session?.user?.id ?? null);
    });
    void client.auth.getUser().then(({ data }) => { if (!eventSeen) identity(data.user?.id ?? null); })
      .catch(() => { if (!eventSeen) identity(null); });
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!auth.userId) return;
    let cancelled = false;
    const controller = new AbortController();
    setBrandError(false);
    setBrandsReady(false);
    fetchOwnBrands(controller.signal).then(bs => {
      if (cancelled) return;
      setBrands(bs);
      setBrandId(bs[0]?.id ?? '');
      setBrandsReady(true);
    }).catch(() => { if (!cancelled) { setBrandError(true); setBrandsReady(true); } });
    return () => { cancelled = true; controller.abort(); };
  }, [auth.userId, auth.epoch, brandRetry]);

  useEffect(() => {
    if (!auth.userId || !brandId) return;
    let cancelled = false;
    const controller = new AbortController();
    setPage(previous => previous?.scope === scope && offset > 0
      ? { ...previous, loading: true, error: false }
      : { scope, rows: [], total: 0, nextOffset: 0, loading: true, error: false });
    fetchReviews({
      brandIds: [brandId],
      ratingMin: ratingFilter === 'low' ? 1 : ratingFilter === 'high' ? 4 : 1,
      ratingMax: ratingFilter === 'low' ? 2 : ratingFilter === 'high' ? 5 : 5,
      sort: 'recent', limit: PAGE_SIZE, offset, signal: controller.signal, requireExactCount: true, stableOrder: true,
    }).then(({ rows: data, total: count }) => {
      if (cancelled) return;
      if (!Number.isSafeInteger(count) || count < 0 || (data.length === 0 && offset < count)) throw Error('Incomplete review page');
      setPage(previous => {
        const kept = offset > 0 && previous?.scope === scope ? previous.rows : [];
        const seen = new Set(kept.map(row => row.id));
        return { scope, rows: [...kept, ...data.filter(row => !seen.has(row.id) && !!seen.add(row.id))],
          total: count, nextOffset: offset + data.length, loading: false, error: false };
      });
    }).catch(() => {
      if (!cancelled) setPage(previous => previous?.scope === scope
        ? { ...previous, loading: false, error: true }
        : { scope, rows: [], total: 0, nextOffset: 0, loading: false, error: true });
    });
    return () => { cancelled = true; controller.abort(); };
  }, [auth.userId, brandId, ratingFilter, scope, offset, retry]);

  const changeBrand = (value: string) => { if (value === brandId) return; setBrandId(value); setSelected(null); setPage(null); setOffset(0); };
  const changeRating = (value: string) => { if (value === ratingFilter) return; setRatingFilter(value); setSelected(null); setPage(null); setOffset(0); };
  const refresh = () => { setSelected(null); setPage(null); setOffset(0); setRetry(value => value + 1); };

  const brandChips = brands.map(b => ({ value: b.id, label: b.name }));

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 12px 20px', width: '100%', minWidth: 0 }}>
        {brandChips.length > 0 && (
          <MobileFilterChips items={brandChips} activeValue={brandId} onChange={changeBrand} />
        )}
        <MobileFilterChips items={RATING_CHIPS} activeValue={ratingFilter} onChange={changeRating} />

        {!auth.ready ? (
          <div role="status">로그인 상태를 확인하는 중…</div>
        ) : !auth.userId ? (
          <div role="status">로그인 후 리뷰를 조회할 수 있습니다.</div>
        ) : brandError ? (
          <div role="alert">브랜드를 불러오지 못했습니다. <button type="button" className="btn sm" onClick={() => setBrandRetry(value => value + 1)}>다시 시도</button></div>
        ) : brandsReady && !brandId ? (
          <MobileEmptyState icon="📋" title="조회할 자사 브랜드가 없습니다" />
        ) : !brandId || (current?.loading && rows.length === 0) || !current ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>
        ) : current.error && rows.length === 0 ? (
          <div role="alert">리뷰를 불러오지 못했습니다. <button type="button" className="btn sm" onClick={() => setRetry(value => value + 1)}>다시 시도</button></div>
        ) : rows.length === 0 ? (
          <MobileEmptyState icon="💬" title="리뷰가 없습니다" />
        ) : (
          <>
            {rows.map(r => {
              const thumb = r.has_image && r.image_urls.length > 0 ? normImgUrl(r.image_urls[0]) : null;
              return (
                <div
                  key={r.id}
                  onClick={() => setSelected(r)}
                  style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10, cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', gap: 10 }}>
                    {/* 썸네일 */}
                    {thumb && (
                      <div style={{ width: 60, height: 60, flexShrink: 0, borderRadius: 7, overflow: 'hidden', background: 'var(--snk)', border: '1px solid var(--bd)' }}>
                        <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.currentTarget as HTMLImageElement).parentElement!.style.display = 'none'; }} />
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <Stars rating={r.rating} />
                        <span style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginLeft: 'auto' }}>
                          {daysAgo(r.review_date)}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--f3)', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.product_name}
                      </div>
                      {r.review_text && (
                        <p style={{
                          margin: 0, fontSize: 13, color: 'var(--f1)', lineHeight: 1.5,
                          display: '-webkit-box', WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical', overflow: 'hidden',
                        }}>
                          {r.review_text}
                        </p>
                      )}
                    </div>
                  </div>
                  {/* 하단 메타 */}
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {r.purchase_option && (
                      <span style={{ fontSize: 10, padding: '1px 7px', background: 'var(--snk)', border: '1px solid var(--bd)', borderRadius: 10, color: 'var(--f3)' }}>
                        {r.purchase_option}
                      </span>
                    )}
                    {(r.member_height || r.member_weight) && (
                      <span style={{ fontSize: 10, padding: '1px 7px', background: 'var(--snk)', border: '1px solid var(--bd)', borderRadius: 10, color: 'var(--f3)', fontFamily: 'var(--mono)' }}>
                        {[r.member_height ? `${r.member_height}cm` : null, r.member_weight ? `${r.member_weight}kg` : null].filter(Boolean).join('·')}
                      </span>
                    )}
                    {r.has_image && r.image_urls.length > 0 && (
                      <span style={{ fontSize: 10, padding: '1px 7px', background: 'var(--snk)', border: '1px solid var(--bd)', borderRadius: 10, color: 'var(--hs)' }}>
                        📷 {r.image_urls.length}
                      </span>
                    )}
                    {r.helpful_count > 0 && (
                      <span style={{ fontSize: 10, padding: '1px 7px', background: 'var(--snk)', border: '1px solid var(--bd)', borderRadius: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginLeft: 'auto' }}>
                        👍 {r.helpful_count}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--f4)' }}>{rows.length}개 표시 · 최근 조회 기준 {total}개 일치</div>
            <p className="dim" style={{ margin: 0, fontSize: 11 }}>조회 중 자료가 바뀔 수 있습니다. 표시된 일부 리뷰를 전체 리뷰 분석으로 해석하지 마세요.</p>
            {current.error ? <div role="alert">추가 리뷰를 불러오지 못했습니다. <button type="button" className="btn sm" onClick={() => setRetry(value => value + 1)}>다시 시도</button></div>
              : current.loading ? <div role="status">추가 리뷰를 불러오는 중…</div>
              : current.nextOffset < total ? <button type="button" className="btn sm" onClick={() => setOffset(current.nextOffset)}>리뷰 더 보기</button>
              : <div role="status">{rows.length !== total ? '중복 또는 자료 변경으로 표시 리뷰 수와 최근 일치 건수가 다릅니다.' : '현재 조회 결과의 마지막 페이지입니다.'}</div>}
            <button type="button" className="btn sm" disabled={current.loading} onClick={refresh}>처음부터 새로 조회</button>
          </>
        )}
      </div>

      {/* 리뷰 상세 바텀시트 */}
      {selected && (
        <ReviewDetailSheet review={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
