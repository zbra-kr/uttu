'use client';
import { useState, useEffect } from 'react';
import { fetchSnaps, type SnapRow } from '@/lib/queries';
import MobileFilterChips from '@/components/mobile/MobileFilterChips';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';

const GENDER_CHIPS = [
  { value: 'ALL', label: '전체' },
  { value: 'M',   label: '남성' },
  { value: 'F',   label: '여성' },
];

export default function MobileSnapView() {
  const [rows, setRows] = useState<SnapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [gender, setGender] = useState('ALL');
  const [fullscreen, setFullscreen] = useState<SnapRow | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchSnaps({ gender: gender === 'ALL' ? undefined : gender, limit: 60 })
      .then(({ rows: data }) => { setRows(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [gender]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 12px 20px' , width: '100%', minWidth: 0 }}>
      <MobileFilterChips items={GENDER_CHIPS} activeValue={gender} onChange={setGender} />

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>
      ) : rows.length === 0 ? (
        <MobileEmptyState icon="📸" title="스냅 데이터가 없습니다" />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {rows.map(r => (
            <div
              key={r.id}
              onClick={() => r.thumbnail_url && setFullscreen(r)}
              style={{ borderRadius: 8, overflow: 'hidden', cursor: r.thumbnail_url ? 'pointer' : 'default', position: 'relative', aspectRatio: '3/4', background: 'var(--snk)' }}
            >
              {r.thumbnail_url ? (
                <img
                  src={r.thumbnail_url}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>📸</div>
              )}
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
                padding: '8px 8px 6px',
                display: 'flex', gap: 8, color: 'var(--rai)', fontSize: 10, fontFamily: 'var(--mono)',
              }}>
                <span>♥ {r.like_count.toLocaleString()}</span>
                <span>👁 {r.view_count.toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 풀스크린 */}
      {fullscreen && fullscreen.thumbnail_url && (
        <div
          onClick={() => setFullscreen(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <img
            src={fullscreen.thumbnail_url}
            alt=""
            style={{ maxWidth: '100%', maxHeight: '90dvh', objectFit: 'contain' }}
          />
          <button
            onClick={() => setFullscreen(null)}
            style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(0,0,0,0.5)', border: 'none', color: 'var(--rai)', fontSize: 20, width: 36, height: 36, borderRadius: '50%', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
