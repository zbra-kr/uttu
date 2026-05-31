'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import {
  fetchMyProfile, fetchBookmarks, fetchMyRecentNotes, fetchMentionsForMe,
  type MyProfile, type Bookmark, type MyNote,
} from '@/lib/queries-me';
import MobileFilterChips from '@/components/mobile/MobileFilterChips';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';

const TABS = [
  { value: 'bookmarks', label: '북마크' },
  { value: 'notes',     label: '메모' },
  { value: 'mentions',  label: '멘션' },
];

const ENTITY_LABEL: Record<string, string> = {
  product: '상품', brand: '브랜드', company: '회사',
  anomaly: '이상탐지', magazine: '매거진',
};

function fmtDate(dt: string): string {
  return new Date(dt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

export default function MobileMeView() {
  const router = useRouter();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [tab, setTab] = useState('bookmarks');
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [notes, setNotes] = useState<MyNote[]>([]);
  const [mentions, setMentions] = useState<MyNote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchMyProfile(), fetchBookmarks(), fetchMyRecentNotes(), fetchMentionsForMe()])
      .then(([prof, bks, nts, ments]) => {
        setProfile(prof);
        setBookmarks(bks);
        setNotes(nts);
        setMentions(ments);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleLogout() {
    await supabaseBrowser().auth.signOut();
    router.push('/login');
  }

  if (loading) return <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 12px 20px' }}>
      {/* 프로필 */}
      {profile && (
        <div style={{ padding: '14px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="" width={44} height={44} style={{ borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--hs-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: 'var(--hs)' }}>
                {(profile.display_name ?? profile.full_name ?? '?')[0]}
              </div>
            )}
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--f1)' }}>
                {profile.display_name ?? profile.full_name ?? '이름 없음'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--f3)', marginTop: 2 }}>{profile.email}</div>
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--hs)', background: 'var(--hs-soft)', padding: '1px 5px', borderRadius: 3 }}>
                  {profile.role}
                </span>
                {profile.team && (
                  <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--f3)', background: 'var(--snk)', padding: '1px 5px', borderRadius: 3 }}>
                    {profile.team}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 탭 */}
      <MobileFilterChips items={TABS} activeValue={tab} onChange={setTab} />

      {/* 북마크 */}
      {tab === 'bookmarks' && (
        bookmarks.length === 0 ? (
          <MobileEmptyState icon="⭐" title="북마크가 없습니다" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {bookmarks.map(b => (
              <div
                key={b.id}
                style={{ padding: '10px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--f4)', background: 'var(--snk)', padding: '1px 5px', borderRadius: 3 }}>
                    {ENTITY_LABEL[b.entity_type] ?? b.entity_type}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.label ?? b.entity_id}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--f4)' }}>{fmtDate(b.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* 메모 */}
      {tab === 'notes' && (
        notes.length === 0 ? (
          <MobileEmptyState icon="📝" title="작성한 메모가 없습니다" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {notes.map(n => (
              <div key={n.id} style={{ padding: '10px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
                <p style={{
                  margin: 0, fontSize: 13, color: 'var(--f1)', lineHeight: 1.55,
                  display: '-webkit-box', WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>
                  {n.body}
                </p>
                <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 4 }}>{fmtDate(n.created_at)}</div>
              </div>
            ))}
          </div>
        )
      )}

      {/* 멘션 */}
      {tab === 'mentions' && (
        mentions.length === 0 ? (
          <MobileEmptyState icon="💬" title="받은 멘션이 없습니다" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {mentions.map(n => (
              <div key={n.id} style={{ padding: '10px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
                <p style={{
                  margin: 0, fontSize: 13, color: 'var(--f1)', lineHeight: 1.55,
                  display: '-webkit-box', WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>
                  {n.body}
                </p>
                <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 4 }}>{fmtDate(n.created_at)}</div>
              </div>
            ))}
          </div>
        )
      )}

      {/* 로그아웃 */}
      <button
        onClick={handleLogout}
        style={{
          marginTop: 8, padding: '12px 0', borderRadius: 10, fontSize: 14, fontWeight: 600,
          background: 'var(--shb)', color: 'var(--shf)',
          border: '1px solid var(--shf)', cursor: 'pointer',
        }}
      >
        로그아웃
      </button>
    </div>
  );
}
