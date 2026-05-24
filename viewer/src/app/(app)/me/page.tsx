'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { IcEdit, IcBell, IcShield } from '@/components/ui/icons';
import Link from 'next/link';
import { fetchMyProfile, uploadAvatar, MyProfile, fetchMyRecentNotes, fetchMentionsForMe, MyNote, fetchBookmarks, removeBookmark, Bookmark, EntityType, fetchViewHistory, ViewHistoryRow, fetchAllSavedFilters, deleteSavedFilter, SavedFilter, fetchMyStats, MyStats } from '@/lib/queries-me';
import ProfileEditModal from '@/components/me/ProfileEditModal';
import SubscriptionMatrix from '@/components/me/SubscriptionMatrix';
import InboxList from '@/components/me/InboxList';

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return '방금';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`;
  if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)}일 전`;
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

const ENTITY_LABEL: Record<string, string> = {
  company: '회사', brand: '브랜드', product: '상품', ranking_filter: '랭킹',
};

function noteLink(note: MyNote): string | null {
  if (!note.entity_type || !note.entity_id) return null;
  if (note.entity_type === 'ranking_filter') {
    return `/ranking?${note.entity_id}&note=${note.id}`;
  }
  return `/${note.entity_type}?id=${encodeURIComponent(note.entity_id)}&note=${note.id}`;
}

function bookmarkLink(bm: Bookmark): string {
  if (bm.entity_type === 'ranking_filter') return `/ranking?${bm.entity_id}`;
  return `/${bm.entity_type}?id=${encodeURIComponent(bm.entity_id)}`;
}

function viewHistoryLink(row: ViewHistoryRow): string {
  if (row.entity_type === 'ranking_filter') return `/ranking?${row.entity_id}`;
  return `/${row.entity_type}?id=${encodeURIComponent(row.entity_id)}`;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function formatJoined(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function formatLastSeen(iso: string | null): string {
  if (!iso) return '기록 없음';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 86400000 && d.getDate() === now.getDate()) {
    return `오늘 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 1) return '어제';
  if (diffDays < 7) return `${diffDays}일 전`;
  return formatJoined(iso);
}

const ADMIN_CHIPS  = ['홈', '랭킹', '이상탐지', '회사', '브랜드', '상품', '프로모션', '스냅샷', '매거진', '리뷰', '매핑 (admin)', '설정 (admin)'];
const VIEWER_CHIPS = ['홈', '랭킹', '이상탐지', '회사', '브랜드', '상품', '프로모션', '스냅샷'];

export default function MePage() {
  const router = useRouter();
  const [profile, setProfile] = React.useState<MyProfile | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [editOpen, setEditOpen] = React.useState(false);
  const [myNotes, setMyNotes] = React.useState<MyNote[]>([]);
  const [mentions, setMentions] = React.useState<MyNote[]>([]);
  const [bookmarks, setBookmarks] = React.useState<Bookmark[]>([]);
  const [viewHistory, setViewHistory] = React.useState<ViewHistoryRow[]>([]);
  const [savedFilters, setSavedFilters] = React.useState<SavedFilter[]>([]);
  const [stats, setStats] = React.useState<MyStats | null>(null);
  const [statsLoading, setStatsLoading] = React.useState(true);
  const [uploading, setUploading] = React.useState(false);
  const [avatarTs, setAvatarTs] = React.useState(Date.now());
  const [avatarError, setAvatarError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    fetchMyProfile().then(p => { setProfile(p); setLoading(false); });
    fetchMyRecentNotes(10).then(setMyNotes);
    fetchMentionsForMe(20).then(setMentions);
    fetchBookmarks().then(setBookmarks);
    fetchViewHistory(8).then(setViewHistory);
    fetchAllSavedFilters().then(setSavedFilters);
    fetchMyStats().then(s => { setStats(s); setStatsLoading(false); });
  }, []);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    setUploading(true);
    setAvatarError(null);
    const { url, error } = await uploadAvatar(file, profile.id);
    setUploading(false);
    e.target.value = '';
    if (error) { setAvatarError(error); return; }
    if (url) {
      setProfile(p => p ? { ...p, avatar_url: url } : p);
      setAvatarTs(Date.now());
    }
  };

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--f3)', fontSize: 13 }}>불러오는 중…</div>;
  }

  if (!profile) {
    return <div style={{ padding: 24, color: 'var(--shf)', fontSize: 13 }}>프로필을 불러올 수 없습니다.</div>;
  }

  const isAdmin = profile.role === 'admin';
  const name     = profile.full_name || profile.email.split('@')[0];
  const initials = getInitials(name);
  const chips    = isAdmin ? ADMIN_CHIPS : VIEWER_CHIPS;

  return (
    <>
      {editOpen && (
        <ProfileEditModal
          profile={profile}
          onClose={() => setEditOpen(false)}
          onSaved={(patch) => {
            setProfile(p => p ? { ...p, ...patch } : p);
            setEditOpen(false);
          }}
        />
      )}

      <section className="panel" style={{ padding: 24 }}>
        <div className="row-flex gap-16" style={{ alignItems: 'flex-start' }}>
          <div className="col-flex gap-4" style={{ flexShrink: 0, alignItems: 'center' }}>
            <div
              className="panel compact"
              style={{ width: 88, height: 88, background: 'var(--snk)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative', overflow: 'hidden', padding: 0 }}
              onClick={() => fileRef.current?.click()}
              title="클릭해서 이미지 변경"
            >
              {profile.avatar_url
                ? <img src={`${profile.avatar_url}?t=${avatarTs}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="프로필" />
                : <span className="mono" style={{ fontSize: 26, fontWeight: 500 }}>{initials}</span>
              }
              {uploading && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: '#fff', fontSize: 11 }}>업로드 중…</span>
                </div>
              )}
              {!uploading && (
                <div className="avatar-hover-overlay" style={{ position: 'absolute', inset: 0, background: 'transparent', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 6, opacity: 0, transition: 'opacity 120ms' }}
                  onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'rgba(0,0,0,0.35)'; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = '0'; e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ color: '#fff', fontSize: 10 }}>변경</span>
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={handleAvatarChange} />
            </div>
            {avatarError && <div style={{ fontSize: 10, color: 'var(--shf)', textAlign: 'center', maxWidth: 88 }}>{avatarError}</div>}
          </div>
          <div className="flex-1">
            <div className="row-flex baseline gap-10">
              <h1 style={{ fontSize: 24, fontWeight: 500, margin: 0 }}>{name}</h1>
              {isAdmin && (
                <span className="chip lg" style={{ background: 'var(--shb)', color: 'var(--shf)', borderColor: 'var(--shf)' }}>admin</span>
              )}
              {profile.team && <span className="chip lg">{profile.team}</span>}
            </div>
            <div className="mono dim" style={{ marginTop: 4, fontSize: 12 }}>
              {profile.email} · 가입 {formatJoined(profile.created_at)} · 마지막 접속 {formatLastSeen(profile.last_sign_in_at)}
            </div>
            <div className="row-flex gap-6" style={{ marginTop: 12 }}>
              <button className="btn sm" onClick={() => setEditOpen(true)}><IcEdit /> 프로필 편집</button>
              <Link href="/settings" className="btn sm"><IcBell /> 알림 설정</Link>
              <Link href="/settings" className="btn sm"><IcShield /> 2FA</Link>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-6 gap-8">
        {([
          ['북마크',   statsLoading ? '—' : String(stats?.bookmarks ?? 0),              statsLoading ? '' : `+ ${stats?.bookmarks_recent_7d ?? 0} (7d)`],
          ['저장 메모', statsLoading ? '—' : String(stats?.notes ?? 0),                  statsLoading ? '' : `+ ${stats?.notes_recent_7d ?? 0} (7d)`],
          ['최근 본',  statsLoading ? '—' : String(stats?.view_history ?? 0),            statsLoading ? '' : `+ ${stats?.view_history_recent_7d ?? 0} (7d)`],
          ['저장 필터', statsLoading ? '—' : String(stats?.saved_filters ?? 0),          ''],
          ['활성 알림', statsLoading ? '—' : String(stats?.active_subscriptions ?? 0),   statsLoading ? '' : `${stats?.active_subscription_events ?? 0} 영역`],
          ['받은 멘션', statsLoading ? '—' : String(stats?.mentions_received_30d ?? 0),  '최근 30일'],
        ] as [string, string, string][]).map(([l, v, d], i) => (
          <div key={i} className="kpi">
            <span className="label">{l}</span>
            <div className="val">{v}</div>
            {d && <div className="dlt"><span className="muted">{d}</span></div>}
          </div>
        ))}
      </div>

      <div className="grid grid-2 gap-14">
        <div className="col-flex gap-12">
          <section className="panel">
            <div className="sec-head">
              <h3>최근 본 <span className="sub">최근 14일</span></h3>
              <button className="btn sm">전체 ↗</button>
            </div>
            {viewHistory.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--f4)', padding: '16px 0', textAlign: 'center' }}>방문 기록이 없습니다.</div>
            ) : viewHistory.map((row, i) => (
              <Link key={row.id} href={viewHistoryLink(row)} className="row-flex center between" style={{ padding: '9px 6px', borderBottom: i < viewHistory.length - 1 ? '0.5px dashed var(--bs)' : 'none', cursor: 'pointer', textDecoration: 'none', color: 'inherit', display: 'flex' }}>
                <div className="row-flex center gap-10 flex-1">
                  <span className="mono dim" style={{ fontSize: 10, width: 60 }}>{ENTITY_LABEL[row.entity_type] ?? row.entity_type}</span>
                  <span style={{ fontSize: 13 }}>{row.label ?? row.entity_id}</span>
                </div>
                <span className="mono dim" style={{ fontSize: 11 }}>{relTime(row.viewed_at)}</span>
              </Link>
            ))}
          </section>

          <section className="panel">
            <div className="sec-head">
              <h3>내 메모 <span className="sub">최근순</span></h3>
            </div>
            {myNotes.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--f4)', padding: '16px 0', textAlign: 'center' }}>작성한 메모가 없습니다.</div>
            ) : (
              <div className="col-flex gap-8">
                {myNotes.map(note => {
                  const link = noteLink(note);
                  return (
                    <div
                      key={note.id}
                      className="panel compact"
                      style={{ background: 'var(--snk)', cursor: link ? 'pointer' : 'default' }}
                      onClick={() => link && router.push(link)}
                    >
                      <div style={{ fontSize: 12, color: 'var(--f1)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {note.body}
                      </div>
                      <div className="row-flex between center" style={{ marginTop: 8 }}>
                        <div className="row-flex gap-4" style={{ flexWrap: 'wrap' }}>
                          {note.entity_type && (
                            <span className="chip" style={{ color: 'var(--hs)', fontSize: 10 }}>
                              {ENTITY_LABEL[note.entity_type] ?? note.entity_type}
                            </span>
                          )}
                          {note.tags.map((t, j) => <span key={j} className="chip" style={{ fontSize: 10 }}>{t}</span>)}
                        </div>
                        <span className="mono dim" style={{ fontSize: 10, flexShrink: 0 }}>{relTime(note.updated_at)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="sec-head">
              <h3>받은 멘션 <span className="sub">최근순</span></h3>
            </div>
            {mentions.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--f4)', padding: '16px 0', textAlign: 'center' }}>받은 멘션이 없습니다.</div>
            ) : (
              <div className="col-flex">
                {mentions.map((note, i) => {
                  const link = noteLink(note);
                  const authorName = note.author?.display_name ?? note.author?.full_name ?? '알 수 없음';
                  return (
                    <div
                      key={note.id}
                      onClick={() => link && router.push(link)}
                      style={{
                        padding: '10px 6px',
                        borderBottom: i < mentions.length - 1 ? '0.5px dashed var(--bs)' : 'none',
                        cursor: link ? 'pointer' : 'default',
                        display: 'flex', gap: 8, alignItems: 'flex-start',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--hs)', marginRight: 6 }}>{authorName}</span>
                        <span style={{ fontSize: 12, color: 'var(--f2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline' }}>
                          {note.body.slice(0, 80)}{note.body.length > 80 ? '…' : ''}
                        </span>
                        <div className="row-flex gap-4" style={{ marginTop: 4 }}>
                          {note.entity_type && (
                            <span className="chip" style={{ fontSize: 10 }}>{ENTITY_LABEL[note.entity_type] ?? note.entity_type}</span>
                          )}
                        </div>
                      </div>
                      <span className="mono dim" style={{ fontSize: 10, flexShrink: 0, marginTop: 2 }}>{relTime(note.created_at)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="col-flex gap-12">
          <section className="panel">
            <div className="sec-head">
              <h3>북마크 <span className="sub">{bookmarks.length}개</span></h3>
            </div>
            {bookmarks.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--f4)', padding: '16px 0', textAlign: 'center' }}>저장된 북마크가 없습니다.</div>
            ) : (
              <div>
                {bookmarks.map((bm, i) => (
                  <div
                    key={bm.id}
                    className="row-flex center between"
                    style={{
                      padding: '9px 6px',
                      borderBottom: i < bookmarks.length - 1 ? '0.5px dashed var(--bs)' : 'none',
                      gap: 8,
                    }}
                  >
                    <div
                      className="row-flex center gap-10 flex-1"
                      style={{ cursor: 'pointer', minWidth: 0 }}
                      onClick={() => router.push(bookmarkLink(bm))}
                    >
                      <span className="mono dim" style={{ fontSize: 10, width: 40, flexShrink: 0 }}>
                        {ENTITY_LABEL[bm.entity_type] ?? bm.entity_type}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {bm.label ?? bm.entity_id.slice(0, 24)}
                      </span>
                    </div>
                    <span className="mono dim" style={{ fontSize: 10, flexShrink: 0 }}>{relTime(bm.created_at)}</span>
                    <button
                      title="북마크 해제"
                      onClick={async () => {
                        await removeBookmark(bm.entity_type, bm.entity_id);
                        setBookmarks(prev => prev.filter(b => b.id !== bm.id));
                      }}
                      style={{ width: 20, height: 20, borderRadius: 4, border: 'none', background: 'transparent', color: 'var(--f4)', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, padding: 0, lineHeight: 1 }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--shf)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--f4)'; }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="sec-head">
              <h3>저장 필터 <span className="sub">{savedFilters.length}개</span></h3>
            </div>
            {savedFilters.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--f4)', padding: '16px 0', textAlign: 'center' }}>저장된 필터가 없습니다.</div>
            ) : (
              <div className="col-flex gap-12">
                {Object.entries(
                  savedFilters.reduce<Record<string, SavedFilter[]>>((acc, f) => {
                    (acc[f.page] ??= []).push(f);
                    return acc;
                  }, {}),
                ).map(([page, items]) => {
                  const PAGE_LABEL: Record<string, string> = { '/ranking': '랭킹', '/anomaly': '이상탐지', '/promo': '프로모션', '/reviews': '리뷰' };
                  return (
                    <div key={page}>
                      <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 6 }}>{PAGE_LABEL[page] ?? page}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {items.map(f => (
                          <div
                            key={f.id}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              padding: '4px 8px', borderRadius: 4,
                              background: 'var(--snk)', border: '0.5px solid var(--bs)',
                              fontSize: 12, color: 'var(--f1)', cursor: 'pointer',
                            }}
                            onClick={() => router.push(page)}
                          >
                            <span>{f.name}</span>
                            <button
                              onClick={async e => {
                                e.stopPropagation();
                                const { error } = await deleteSavedFilter(f.id);
                                if (!error) setSavedFilters(prev => prev.filter(x => x.id !== f.id));
                              }}
                              style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                padding: 0, color: 'var(--f4)', fontSize: 13, lineHeight: 1,
                              }}
                              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--shf)'; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--f4)'; }}
                              title="삭제"
                            >×</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="sec-head">
              <h3>알림 구독</h3>
            </div>
            <SubscriptionMatrix isAdmin={isAdmin} />
          </section>

          <section className="panel">
            <div className="sec-head">
              <h3>받은 알림 <span className="sub">최근 50건</span></h3>
            </div>
            <InboxList limit={50} />
          </section>

          <section className="panel surface">
            <div className="sec-head">
              <h3>내 권한 <span className="sub">{isAdmin ? 'admin · 전체 영역' : 'viewer'}</span></h3>
            </div>
            <div className="row-flex gap-4 wrap">
              {chips.map((a, i) => (
                <span key={i} className="chip lg">{a}</span>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
