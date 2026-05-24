'use client';
import React from 'react';
import { IcEdit, IcBell, IcShield, IcPlus } from '@/components/ui/icons';
import Link from 'next/link';
import { fetchMyProfile, uploadAvatar, MyProfile } from '@/lib/queries-me';
import ProfileEditModal from '@/components/me/ProfileEditModal';
import SubscriptionMatrix from '@/components/me/SubscriptionMatrix';
import InboxList from '@/components/me/InboxList';

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
  const [profile, setProfile] = React.useState<MyProfile | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [editOpen, setEditOpen] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [avatarTs, setAvatarTs] = React.useState(Date.now());
  const [avatarError, setAvatarError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    fetchMyProfile().then(p => {
      setProfile(p);
      setLoading(false);
    });
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
          <div className="col-flex gap-2" style={{ alignItems: 'flex-end' }}>
            <span className="sec-tag">activity score (30d)</span>
            <span className="mono tnum" style={{ fontSize: 28, fontWeight: 500 }}>—</span>
            <span className="mono dim" style={{ fontSize: 11 }}>Phase 6에서 구현</span>
          </div>
        </div>
      </section>

      <div className="grid grid-6 gap-8">
        {[['북마크', '—', ''], ['저장 메모', '—', ''], ['검색 횟수', '—', ''], ['저장 필터', '—', ''], ['활성 알림', '—', ''], ['해소한 이상', '—', '']].map(([l, v, d], i) => (
          <div key={i} className="kpi">
            <span className="label">{l}</span>
            <div className="val">{v}</div>
            <div className="dlt"><span className="muted">{d}</span></div>
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
            {[
              ['상품', '커버낫 시그니처 로고 스웻셔츠', '오늘 09:42', '/product'],
              ['브랜드', '커버낫', '오늘 09:38', '/brand'],
              ['회사', '코웰패션', '오늘 09:32', '/company'],
              ['랭킹', '여 20대 상의 · DAILY', '어제 18:14', '/ranking'],
              ['리뷰', '자사 베이직 라운드 티', '어제 14:42', '/reviews'],
              ['이상탐지', '가격 −30% 스파이크', '어제 11:18', '/anomaly'],
              ['프로모션', 'SS24 BIG SALE 진행 상품', '5/18 16:20', '/promo'],
              ['상품', '아디다스 트레포일 후디', '5/18 14:48', '/product'],
            ].map((r, i) => (
              <Link key={i} href={r[3]} className="row-flex center between" style={{ padding: '9px 6px', borderBottom: i < 7 ? '0.5px dashed var(--bs)' : 'none', cursor: 'pointer', textDecoration: 'none', color: 'inherit', display: 'flex' }}>
                <div className="row-flex center gap-10 flex-1">
                  <span className="mono dim" style={{ fontSize: 10, width: 60 }}>{r[0]}</span>
                  <span style={{ fontSize: 13 }}>{r[1]}</span>
                </div>
                <span className="mono dim" style={{ fontSize: 11 }}>{r[2]}</span>
              </Link>
            ))}
          </section>

          <section className="panel">
            <div className="sec-head">
              <h3>내 메모 <span className="sub">최근순</span></h3>
              <button className="btn sm"><IcPlus /> 메모</button>
            </div>
            <div className="col-flex gap-8">
              {[
                ['커버낫 SS24 — 자사 BCV-SWT-001 직접 경쟁. 다음 주 가격 회의 안건.', '오늘 09:42', ['브랜드', '커버낫']],
                ['널디 −30% 스파이크 — 재고 소진 가능성. 데이터 출처 검토 필요.', '어제 11:24', ['상품', '특이점']],
                ['코웰패션 1Q 매출 −18%, 무신사 의존도 상승 — 채널 다각화 시그널.', '5/18 16:42', ['회사', '재무']],
                ['리뷰 분석 — 4월 생산분 사이즈 이슈. 공장 측 확인 요청 발송.', '5/17 14:18', ['리뷰', '품질']],
              ].map((m, i) => (
                <div key={i} className="panel compact" style={{ background: 'var(--snk)' }}>
                  <div style={{ fontSize: 12, color: 'var(--f1)', lineHeight: 1.5 }}>{m[0]}</div>
                  <div className="row-flex between center" style={{ marginTop: 8 }}>
                    <div className="row-flex gap-4">
                      {(m[2] as string[]).map((t, j) => <span key={j} className="chip">{t}</span>)}
                    </div>
                    <span className="mono dim" style={{ fontSize: 10 }}>{m[1]}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="col-flex gap-12">
          <section className="panel">
            <div className="sec-head">
              <h3>북마크 <span className="sub">영역별</span></h3>
              <button className="btn sm">관리 ↗</button>
            </div>
            {[
              ['회사', ['코웰패션', 'LF', 'F&F']],
              ['브랜드', ['커버낫', '디스이즈네버댓', '오라리', '널디']],
              ['상품', ['시그니처 스웻 (커버낫)', '체크 머플러 (커버낫)', '트레포일 후디 (아디다스)']],
              ['랭킹', ['여 20대 상의 DAILY', '남 30대 신발 WEEKLY']],
              ['저장 필터', ['이상탐지 · HIGH · 자사', '리뷰 · ★1~2 · 자사']],
            ].map((g, i) => (
              <div key={i} style={{ padding: '8px 0', borderBottom: i < 4 ? '0.5px dashed var(--bs)' : 'none' }}>
                <div className="sec-tag" style={{ marginBottom: 4 }}>{g[0]}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {(g[1] as string[]).map((b, j) => <span key={j} className="chip lg" style={{ cursor: 'pointer' }}>{b}</span>)}
                </div>
              </div>
            ))}
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
