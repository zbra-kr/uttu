'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { normImgUrl, type ReviewRow } from '@/lib/queries';
import { IcX } from '@/components/ui/icons';

const GENDER_LABEL: Record<string, string> = {
  male: '남성', female: '여성', M: '남성', F: '여성',
};

function Stars({ rating }: { rating: number }) {
  return (
    <span style={{ fontSize: 13, color: rating >= 4 ? 'var(--smf)' : rating <= 2 ? 'var(--shf)' : 'var(--f4)', fontFamily: 'var(--mono)', letterSpacing: 1 }}>
      {'★'.repeat(rating)}{'☆'.repeat(5 - rating)}
    </span>
  );
}

interface Props {
  review: ReviewRow;
  showProductButton?: boolean;
  onClose: () => void;
}

export default function ReviewDetailSheet({ review, showProductButton = true, onClose }: Props) {
  const router = useRouter();
  const [imgIdx, setImgIdx] = useState(0);
  const images = review.image_urls.map(u => normImgUrl(u)).filter(Boolean) as string[];

  return (
    <>
      {/* scrim */}
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,.45)', zIndex: 80 }}
        onClick={onClose}
      />
      {/* sheet */}
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 90,
        background: 'var(--sur)', borderTop: '1px solid var(--bs)',
        borderRadius: '16px 16px 0 0',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.2)',
        maxHeight: '88dvh', display: 'flex', flexDirection: 'column',
      }}>
        {/* handle */}
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10, paddingBottom: 2, flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--bs)' }} />
        </div>

        {/* 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '8px 16px 10px', borderBottom: '1px solid var(--bs)', gap: 10, flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {review.product_name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--f4)', marginTop: 1 }}>{review.brand_name}</div>
          </div>
          <button onClick={onClose} style={{
            width: 28, height: 28, border: '1px solid var(--bs)', borderRadius: 8,
            background: 'var(--snk)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'var(--f3)', padding: 0, flexShrink: 0,
          }}>
            <IcX size={14} />
          </button>
        </div>

        {/* 스크롤 영역 */}
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as 'touch', padding: '14px 16px 0' }}>

          {/* 별점 + 날짜 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Stars rating={review.rating} />
            <span style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginLeft: 'auto' }}>
              {review.review_date.slice(0, 10).replace(/-/g, '.')}
            </span>
          </div>

          {/* 구매 정보 chips */}
          {(review.purchase_option || review.member_height || review.member_weight || review.member_gender) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {review.purchase_option && (
                <span style={{ fontSize: 11, padding: '3px 9px', background: 'var(--snk)', border: '1px solid var(--bd)', borderRadius: 12, color: 'var(--f2)' }}>
                  {review.purchase_option}
                </span>
              )}
              {(review.member_height || review.member_weight) && (
                <span style={{ fontSize: 11, padding: '3px 9px', background: 'var(--snk)', border: '1px solid var(--bd)', borderRadius: 12, color: 'var(--f2)', fontFamily: 'var(--mono)' }}>
                  {[review.member_height ? `${review.member_height}cm` : null, review.member_weight ? `${review.member_weight}kg` : null].filter(Boolean).join(' · ')}
                </span>
              )}
              {review.member_gender && (
                <span style={{ fontSize: 11, padding: '3px 9px', background: 'var(--snk)', border: '1px solid var(--bd)', borderRadius: 12, color: 'var(--f2)' }}>
                  {GENDER_LABEL[review.member_gender] ?? review.member_gender}
                </span>
              )}
            </div>
          )}

          {/* 만족도 항목 */}
          {review.satisfactions && review.satisfactions.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
              {review.satisfactions.map((s, i) => (
                <span key={i} style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 10,
                  background: 'var(--hs-soft)', color: 'var(--hs)',
                  border: '1px solid var(--hs)', fontFamily: 'var(--mono)',
                }}>
                  {s.attribute} · {s.answer}
                </span>
              ))}
            </div>
          )}

          {/* 사진 갤러리 */}
          {images.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', background: 'var(--snk)', aspectRatio: '1 / 1', marginBottom: 8 }}>
                <img
                  src={images[imgIdx]}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
                {images.length > 1 && (
                  <span style={{
                    position: 'absolute', bottom: 8, right: 8,
                    background: 'var(--img-overlay)', color: 'var(--white)',
                    fontSize: 10, fontFamily: 'var(--mono)', padding: '2px 7px', borderRadius: 10,
                  }}>
                    {imgIdx + 1} / {images.length}
                  </span>
                )}
              </div>
              {images.length > 1 && (
                <div style={{ display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch' as 'touch' }}>
                  {images.map((url, i) => (
                    <button type="button" key={i} onClick={() => setImgIdx(i)}
                      style={{
                        width: 56, height: 56, flexShrink: 0, borderRadius: 7, overflow: 'hidden',
                        border: `2px solid ${i === imgIdx ? 'var(--hs)' : 'var(--bd)'}`,
                        cursor: 'pointer', background: 'var(--snk)', padding: 0,
                      }}>
                      <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 리뷰 본문 */}
          {review.review_text && (
            <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--f1)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {review.review_text}
            </p>
          )}

          {/* 도움돼요 */}
          {review.helpful_count > 0 && (
            <div style={{ fontSize: 11, color: 'var(--f4)', marginBottom: 14, fontFamily: 'var(--mono)' }}>
              👍 도움돼요 {review.helpful_count}
            </div>
          )}
        </div>

        {/* 하단 버튼 */}
        {showProductButton && (
          <div style={{ padding: '12px 16px', paddingBottom: 'max(12px, env(safe-area-inset-bottom))', borderTop: '1px solid var(--bs)', flexShrink: 0 }}>
            <button
              onClick={() => { onClose(); router.push(`/product?no=${review.musinsa_no}`); }}
              style={{
                width: '100%', padding: '13px 0', borderRadius: 12,
                background: 'var(--hs)', color: 'var(--white)',
                fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer',
              }}
            >
              상품 상세 보기 →
            </button>
          </div>
        )}
      </div>
    </>
  );
}
