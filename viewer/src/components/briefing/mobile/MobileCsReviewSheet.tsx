'use client';
import { useState, useEffect } from 'react';
import { fetchReviews, fetchOwnBrands, normImgUrl, type ReviewRow } from '@/lib/queries';
import ReviewDetailSheet from '@/components/mobile/ReviewDetailSheet';
import { IcX } from '@/components/ui/icons';

export type CsReviewFilter = 'today' | 'low' | 'high';

const FILTER_LABEL: Record<CsReviewFilter, string> = {
  today: '오늘의 리뷰',
  low:   '저점 리뷰 (1~2점)',
  high:  '고점 리뷰 (4~5점)',
};

function Stars({ rating }: { rating: number }) {
  return (
    <span style={{ fontSize: 12, letterSpacing: 1, fontFamily: 'var(--mono)', color: rating >= 4 ? 'var(--smf)' : rating <= 2 ? 'var(--shf)' : 'var(--f4)' }}>
      {'★'.repeat(rating)}{'☆'.repeat(5 - rating)}
    </span>
  );
}

function daysAgo(dateStr: string): string {
  const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (d === 0) return '오늘';
  if (d === 1) return '1일 전';
  if (d < 30) return `${d}일 전`;
  return `${Math.floor(d / 30)}개월 전`;
}

interface Props {
  filter: CsReviewFilter;
  briefingDate: string;
  onClose: () => void;
}

export default function MobileCsReviewSheet({ filter, briefingDate, onClose }: Props) {
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ReviewRow | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const brands = await fetchOwnBrands();
      const brandIds = brands.map(b => b.id);
      if (brandIds.length === 0) { setLoading(false); return; }

      const opts: Parameters<typeof fetchReviews>[0] = {
        brandIds,
        sort: filter === 'low' ? 'rating_asc' : 'recent',
        limit: 50,
      };

      if (filter === 'today') {
        opts.dateFrom = briefingDate;
        opts.dateTo = briefingDate;
      } else if (filter === 'low') {
        opts.ratingMin = 1;
        opts.ratingMax = 2;
      } else {
        opts.ratingMin = 4;
        opts.ratingMax = 5;
        opts.sort = 'rating_desc';
      }

      const { rows: data } = await fetchReviews(opts);
      setRows(data);
      setLoading(false);
    }
    load().catch(() => setLoading(false));
  }, [filter, briefingDate]);

  return (
    <>
      {selected && (
        <ReviewDetailSheet review={selected} onClose={() => setSelected(null)} />
      )}

      {/* scrim */}
      <div
        style={{ position: 'fixed', inset: 0, background: 'var(--img-overlay)', zIndex: 80 }}
        onClick={onClose}
      />

      {/* sheet */}
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 90,
        background: 'var(--sur)', borderTop: '1px solid var(--bs)',
        borderRadius: '16px 16px 0 0',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.2)',
        maxHeight: '85dvh', display: 'flex', flexDirection: 'column',
      }}>
        {/* handle */}
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10, paddingBottom: 4, flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--bs)' }} />
        </div>

        {/* 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '4px 16px 12px', flexShrink: 0, borderBottom: '1px solid var(--bd)' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--f1)', flex: 1 }}>
            {FILTER_LABEL[filter]}
          </span>
          {!loading && (
            <span style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginRight: 10 }}>
              {rows.length}건
            </span>
          )}
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28, border: '1px solid var(--bs)', borderRadius: 7,
              background: 'var(--snk)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: 'var(--f3)', padding: 0,
            }}
          >
            <IcX size={14} />
          </button>
        </div>

        {/* 목록 */}
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as 'touch' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--f4)', fontSize: 13 }}>
              불러오는 중...
            </div>
          ) : rows.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--f4)', fontSize: 13 }}>
              해당 리뷰가 없습니다
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {rows.map((r, i) => {
                const thumb = r.has_image && r.image_urls.length > 0 ? normImgUrl(r.image_urls[0]) : null;
                return (
                  <div
                    key={r.id}
                    onClick={() => setSelected(r)}
                    style={{
                      padding: '12px 16px',
                      borderTop: i > 0 ? '1px solid var(--bd)' : undefined,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 10 }}>
                      {thumb && (
                        <div style={{ width: 52, height: 52, flexShrink: 0, borderRadius: 7, overflow: 'hidden', background: 'var(--snk)' }}>
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
                        <p style={{
                          margin: '0 0 4px', fontSize: 12, color: 'var(--f2)', lineHeight: 1.55,
                          display: '-webkit-box', WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical', overflow: 'hidden',
                        }}>
                          {r.review_text || '(내용 없음)'}
                        </p>
                        {r.product_name && (
                          <span style={{ fontSize: 10, color: 'var(--f4)' }}>{r.product_name}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
