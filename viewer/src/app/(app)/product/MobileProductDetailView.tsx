'use client';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import {
  fetchProductDetail, fetchProductPriceHistory, fetchProductRankHistory, fetchReviews,
  type ProductDetail, type ReviewRow,
} from '@/lib/queries';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

function fmtPrice(v: number | null): string {
  if (v == null) return '—';
  return `${Math.round(v / 1000).toLocaleString()}천원`;
}

function fmtDate(d: string): string {
  return d.slice(5); // MM-DD
}

function Stars({ score }: { score: number | null }) {
  if (score == null) return null;
  const stars = Math.round((score / 20)); // 0~100 → 0~5
  return (
    <span style={{ color: 'var(--smf)', fontSize: 12 }}>
      {'★'.repeat(stars)}{'☆'.repeat(5 - stars)}
    </span>
  );
}

export default function MobileProductDetailView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const no = searchParams.get('no') ?? '';

  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [priceHistory, setPriceHistory] = useState<{ date: string; price: number }[]>([]);
  const [rankHistory, setRankHistory] = useState<{ date: string; rank: number }[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!no) return;
    setLoading(true);

    Promise.all([
      fetchProductDetail(no),
      fetchProductPriceHistory(no),
      fetchProductRankHistory(no),
    ]).then(([det, price, rank]) => {
      setDetail(det);
      setPriceHistory(price.slice(-30).map(p => ({ date: fmtDate(p.date), price: p.price })));
      setRankHistory(rank.filter(r => r.category === '000').slice(-30).map(r => ({ date: fmtDate(r.date), rank: r.rank })));
      setLoading(false);
      if (det) {
        fetchReviews({ productId: det.id, limit: 5 })
          .then(({ rows }) => setReviews(rows));
      }
    });
  }, [no]);

  if (!no) return <MobileEmptyState icon="🔍" title="상품 번호가 없습니다" />;
  if (loading) return <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>;
  if (!detail) return <MobileEmptyState icon="📦" title="상품 정보를 찾을 수 없습니다" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 12px 20px' }}>
      {/* 헤더 */}
      <div style={{ padding: '14px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
        {detail.thumbnail_url && (
          <img src={detail.thumbnail_url} alt="" style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', borderRadius: 8, marginBottom: 12 }} />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span
            style={{ fontSize: 12, color: 'var(--f3)', cursor: 'pointer' }}
            onClick={() => detail.brand_id && router.push(`/brand?id=${detail.brand_id}`)}
          >
            {detail.brand_name}
          </span>
          {detail.is_own && (
            <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--hs)', background: 'var(--hs-soft)', padding: '1px 5px', borderRadius: 4 }}>자사</span>
          )}
        </div>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--f1)', lineHeight: 1.4 }}>
          {detail.name}
        </h1>
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--f1)', fontFamily: 'var(--mono)' }}>
            {fmtPrice(detail.final_price)}
          </span>
          {detail.discount_rate != null && detail.discount_rate > 0 && (
            <span style={{ fontSize: 13, color: 'var(--td)', fontFamily: 'var(--mono)' }}>-{Math.round(detail.discount_rate)}%</span>
          )}
          {detail.list_price != null && detail.list_price !== detail.final_price && (
            <span style={{ fontSize: 12, color: 'var(--f4)', textDecoration: 'line-through' }}>{fmtPrice(detail.list_price)}</span>
          )}
        </div>
        {detail.rank_position && (
          <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 4 }}>
            랭킹 #{detail.rank_position}위
            {detail.review_count > 0 && ` · 리뷰 ${detail.review_count.toLocaleString()}개`}
          </div>
        )}
      </div>

      {/* 랭킹 추이 */}
      {rankHistory.length >= 2 && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 8 }}>랭킹 추이 (30일)</div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={rankHistory}>
              <XAxis dataKey="date" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis reversed tick={{ fontSize: 9 }} width={36} />
              <Tooltip formatter={(v: unknown) => [`#${v as number}`, '순위']} labelStyle={{ fontSize: 10 }} contentStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="rank" stroke="var(--hs)" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 가격 추이 */}
      {priceHistory.length >= 2 && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 8 }}>가격 추이 (30일)</div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={priceHistory}>
              <XAxis dataKey="date" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9 }} width={50} tickFormatter={v => `${Math.round(v / 1000)}천`} />
              <Tooltip formatter={(v: unknown) => [fmtPrice(v as number), '가격']} labelStyle={{ fontSize: 10 }} contentStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="price" stroke="var(--slf)" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 리뷰 */}
      {reviews.length > 0 && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 8 }}>최근 리뷰</div>
          {reviews.slice(0, 3).map(r => (
            <div key={r.id} style={{ borderTop: '1px solid var(--bd)', paddingTop: 8, marginTop: 8 }}>
              <Stars score={r.rating * 20} />
              {r.review_text && (
                <p style={{
                  margin: '4px 0 0', fontSize: 12, color: 'var(--f2)', lineHeight: 1.5,
                  display: '-webkit-box', WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>
                  {r.review_text}
                </p>
              )}
            </div>
          ))}
          <div
            onClick={() => router.push('/reviews')}
            style={{ marginTop: 10, fontSize: 12, color: 'var(--hs)', cursor: 'pointer', fontFamily: 'var(--mono)' }}
          >
            전체 리뷰 →
          </div>
        </div>
      )}

      {/* 카테고리 정보 */}
      <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {[
            ['카테고리', detail.category_d2_name ?? detail.category_code],
            ['회사', detail.company_name],
          ].filter(([, v]) => v).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--f4)', width: 60, flexShrink: 0 }}>{k}</span>
              <span style={{ fontSize: 12, color: 'var(--f2)' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
