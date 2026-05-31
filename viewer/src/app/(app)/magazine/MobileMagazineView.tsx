'use client';
import { useState, useEffect } from 'react';
import { fetchMagazineArticles, type MagazineRow } from '@/lib/queries';
import MobileFilterChips from '@/components/mobile/MobileFilterChips';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';

const CAT_CHIPS = [
  { value: '',       label: '전체' },
  { value: 'style',  label: '스타일' },
  { value: 'trend',  label: '트렌드' },
  { value: 'new',    label: '신상' },
];

function fmtDate(dt: string): string {
  return dt.slice(0, 10).replace(/-/g, '.');
}

export default function MobileMagazineView() {
  const [rows, setRows] = useState<MagazineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState('');

  useEffect(() => {
    setLoading(true);
    fetchMagazineArticles({ category: cat || undefined, sort: 'published_at', limit: 100 })
      .then(({ rows: data }) => { setRows(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [cat]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 12px 20px' }}>
      <MobileFilterChips items={CAT_CHIPS} activeValue={cat} onChange={setCat} />

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>
      ) : rows.length === 0 ? (
        <MobileEmptyState icon="📰" title="매거진 데이터가 없습니다" />
      ) : (
        rows.map(r => (
          <a
            key={r.id}
            href={r.landing_url ?? `https://www.musinsa.com/app/contents/detail/${r.article_id}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', gap: 12, padding: '12px 13px',
              background: 'var(--sur)', border: '1px solid var(--bd)',
              borderRadius: 10, textDecoration: 'none', color: 'inherit',
            }}
          >
            {r.thumbnail_url && (
              <img
                src={r.thumbnail_url}
                alt=""
                width={64}
                height={64}
                style={{ borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <p style={{
                margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--f1)', lineHeight: 1.4,
                display: '-webkit-box', WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>
                {r.title}
              </p>
              <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', display: 'flex', gap: 8 }}>
                <span>노출 {r.view_count.toLocaleString()}</span>
                {r.comment_count > 0 && <span>댓글 {r.comment_count}</span>}
              </div>
              <div style={{ fontSize: 10, color: 'var(--f4)' }}>{fmtDate(r.published_at)}</div>
            </div>
          </a>
        ))
      )}
    </div>
  );
}
