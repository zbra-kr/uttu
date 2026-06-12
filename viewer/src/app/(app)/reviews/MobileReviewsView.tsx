'use client';
import { useState, useEffect, useRef } from 'react';
import { fetchReviews, fetchOwnBrands, normImgUrl, type ReviewRow } from '@/lib/queries';
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
const PAGE_SIZE = 30;

export default function MobileReviewsView() {
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [brandId, setBrandId] = useState<string>('');
  const [ratingFilter, setRatingFilter] = useState('all');
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ReviewRow | null>(null);
  const loaderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchOwnBrands().then(bs => {
      setBrands(bs);
      if (bs.length > 0) setBrandId(bs[0].id);
    });
  }, []);

  useEffect(() => {
    if (!brandId) return;
    setLoading(true);
    setPage(1);
    fetchReviews({
      brandIds: [brandId],
      ratingMin: ratingFilter === 'low' ? 1 : ratingFilter === 'high' ? 4 : 1,
      ratingMax: ratingFilter === 'low' ? 2 : ratingFilter === 'high' ? 5 : 5,
      sort: 'recent',
      limit: 200,
    }).then(({ rows: data }) => { setRows(data); setLoading(false); }).catch(() => setLoading(false));
  }, [brandId, ratingFilter]);

  const displayed = rows.slice(0, page * PAGE_SIZE);

  useEffect(() => {
    const el = loaderRef.current;
    if (!el) return;
    const ob = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && displayed.length < rows.length) setPage(p => p + 1);
    }, { threshold: 0.1 });
    ob.observe(el);
    return () => ob.disconnect();
  }, [displayed.length, rows.length]);

  const brandChips = brands.map(b => ({ value: b.id, label: b.name }));

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 12px 20px', width: '100%', minWidth: 0 }}>
        {brandChips.length > 0 && (
          <MobileFilterChips items={brandChips} activeValue={brandId} onChange={setBrandId} />
        )}
        <MobileFilterChips items={RATING_CHIPS} activeValue={ratingFilter} onChange={setRatingFilter} />

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>
        ) : displayed.length === 0 ? (
          <MobileEmptyState icon="💬" title="리뷰가 없습니다" />
        ) : (
          <>
            {displayed.map(r => {
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
            {displayed.length < rows.length && (
              <div ref={loaderRef} style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--f4)', fontSize: 12 }}>
                불러오는 중...
              </div>
            )}
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
