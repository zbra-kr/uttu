'use client';
import React from 'react';
import { IcX, IcShield } from '@/components/ui/icons';
import {
  AdminUser, AdminUserSession,
  updateAdminUser, fetchAdminUserSessions,
} from '@/lib/queries-admin';

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const kst = new Date(new Date(iso).getTime() + 9 * 3_600_000);
  return kst.toISOString().slice(0, 16).replace('T', ' ').replace(/-/g, '.');
}

function routeLabel(route: string | null): string {
  const MAP: Record<string, string> = {
    '/': '홈', '/ranking': '상품 랭킹', '/anomaly': '이상탐지',
    '/brand': '브랜드', '/product': '상품', '/promo': '프로모션',
    '/company': '회사', '/companies': '회사 목록',
  };
  return route ? (MAP[route] ?? route) : '—';
}

interface Props {
  user: AdminUser;
  onClose: () => void;
  onUpdated: (updated: AdminUser) => void;
}

export default function UserDetailModal({ user, onClose, onUpdated }: Props) {
  // form state
  const [role,        setRole]        = React.useState<'admin' | 'viewer'>(user.role);
  const [displayName, setDisplayName] = React.useState(user.display_name ?? '');
  const [team,        setTeam]        = React.useState(user.team ?? '');
  const [monthly,     setMonthly]     = React.useState<string>(
    user.quota.monthly_token_limit != null ? String(user.quota.monthly_token_limit) : ''
  );
  const [daily,       setDaily]       = React.useState<string>(
    user.quota.daily_token_limit != null ? String(user.quota.daily_token_limit) : ''
  );
  const [blocked,     setBlocked]     = React.useState(user.quota.is_blocked);
  const [note,        setNote]        = React.useState(user.quota.note ?? '');
  const [saving,      setSaving]      = React.useState(false);
  const [errMsg,      setErrMsg]      = React.useState<string | null>(null);

  // sessions
  const [sessions,     setSessions]    = React.useState<AdminUserSession[]>([]);
  const [sessLoading,  setSessLoading] = React.useState(true);

  React.useEffect(() => {
    fetchAdminUserSessions(user.id, 10).then(s => { setSessions(s); setSessLoading(false); });
  }, [user.id]);

  // ESC to close
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const handleSave = async () => {
    if (blocked && !note.trim()) { setErrMsg('차단 시 메모를 입력해주세요.'); return; }
    setSaving(true); setErrMsg(null);

    const patch: Parameters<typeof updateAdminUser>[1] = {};

    const profileChanged = role !== user.role || displayName !== (user.display_name ?? '') || team !== (user.team ?? '');
    if (profileChanged) {
      patch.profile = {
        role,
        display_name: displayName.trim() || null,
        team: team.trim() || null,
      };
    }

    const newMonthly = monthly.trim() === '' ? null : parseInt(monthly, 10);
    const newDaily   = daily.trim() === '' ? null   : parseInt(daily, 10);
    const quotaChanged =
      newMonthly !== user.quota.monthly_token_limit ||
      newDaily   !== user.quota.daily_token_limit   ||
      blocked    !== user.quota.is_blocked          ||
      note       !== (user.quota.note ?? '');

    if (quotaChanged) {
      patch.quota = {
        monthly_token_limit: newMonthly,
        daily_token_limit: newDaily,
        is_blocked: blocked,
        note: note.trim() || null,
      };
    }

    const { error } = await updateAdminUser(user.id, patch);
    setSaving(false);
    if (error) { setErrMsg(error); return; }

    onUpdated({
      ...user,
      role,
      display_name: displayName.trim() || null,
      team: team.trim() || null,
      quota: {
        monthly_token_limit: newMonthly,
        daily_token_limit: newDaily,
        is_blocked: blocked,
        note: note.trim() || null,
      },
    });
    onClose();
  };

  const displayLabel = user.full_name || user.display_name || user.email;
  const initials = displayLabel.slice(0, 2).toUpperCase();
  const usedMonthly = user.usage_this_month.total_tokens;
  const limitMonthly = user.quota.monthly_token_limit;
  const usagePct = limitMonthly ? Math.min(100, (usedMonthly / limitMonthly) * 100) : 0;
  const barColor = usagePct >= 95 ? 'var(--shf)' : usagePct >= 80 ? 'var(--smf)' : 'var(--hs)';

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="drawer" style={{ width: 500 }}>
        {/* 헤더 */}
        <div className="drawer-head">
          <div className="row-flex center gap-10">
            <div style={{
              width: 32, height: 32, borderRadius: 6, flexShrink: 0,
              background: 'var(--snk)', border: '0.5px solid var(--bd)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, overflow: 'hidden',
            }}>
              {user.avatar_url
                ? <img src={user.avatar_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                : initials}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--f1)' }}>{displayLabel}</div>
              <div className="mono dim" style={{ fontSize: 10 }}>{user.email}</div>
            </div>
            {user.quota.is_blocked && (
              <span className="sev hi" style={{ fontSize: 10, marginLeft: 4 }}><span className="pip" />차단됨</span>
            )}
          </div>
          <button className="btn sm icon" onClick={onClose}><IcX /></button>
        </div>

        <div className="drawer-body">
          {/* 이번달 사용량 요약 */}
          <section className="panel compact">
            <div className="row-flex between center" style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--f3)' }}>이번달 사용량</span>
              <span className="mono" style={{ fontSize: 11 }}>
                {fmtTokens(usedMonthly)} {limitMonthly ? `/ ${fmtTokens(limitMonthly)}` : '/ 무제한'}
              </span>
            </div>
            {limitMonthly && (
              <div style={{ height: 4, background: 'var(--snk)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${usagePct}%`, height: '100%', background: barColor, borderRadius: 2, transition: 'width 0.3s' }} />
              </div>
            )}
            <div className="row-flex gap-14" style={{ marginTop: 8, fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>
              <span>입력 {fmtTokens(user.usage_this_month.input_tokens)}</span>
              <span>출력 {fmtTokens(user.usage_this_month.output_tokens)}</span>
              <span>세션 {user.usage_this_month.session_count}</span>
            </div>
          </section>

          {/* 기본 정보 편집 */}
          <section className="panel">
            <div className="sec-head"><h3>기본 정보</h3></div>
            <div className="grid grid-2 gap-12">
              <div>
                <span className="field-lbl">역할</span>
                <select
                  value={role}
                  onChange={e => setRole(e.target.value as 'admin' | 'viewer')}
                  className="input"
                  style={{ width: '100%', fontSize: 12 }}
                >
                  <option value="viewer">viewer</option>
                  <option value="admin">admin</option>
                </select>
              </div>
              <div>
                <span className="field-lbl">팀</span>
                <input
                  className="input"
                  style={{ width: '100%', fontSize: 12 }}
                  value={team}
                  onChange={e => setTeam(e.target.value)}
                  placeholder="예) IT팀"
                />
              </div>
              <div className="grid-2" style={{ gridColumn: '1 / -1' }}>
                <span className="field-lbl">표시 이름 (멘션용)</span>
                <input
                  className="input"
                  style={{ width: '100%', fontSize: 12 }}
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="예) 정호철"
                />
              </div>
            </div>
          </section>

          {/* AI 쿼터 편집 */}
          <section className="panel">
            <div className="sec-head"><h3>AI 쿼터</h3></div>
            <div className="grid grid-2 gap-12">
              <div>
                <span className="field-lbl">월 한도 (토큰)</span>
                <input
                  className="input mono"
                  style={{ width: '100%', fontSize: 12 }}
                  type="number"
                  min={0}
                  value={monthly}
                  onChange={e => setMonthly(e.target.value)}
                  placeholder="비우면 무제한"
                />
              </div>
              <div>
                <span className="field-lbl">일 한도 (토큰)</span>
                <input
                  className="input mono"
                  style={{ width: '100%', fontSize: 12 }}
                  type="number"
                  min={0}
                  value={daily}
                  onChange={e => setDaily(e.target.value)}
                  placeholder="비우면 무제한"
                />
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <div className="row-flex center gap-10" style={{ marginBottom: 6 }}>
                <span className="field-lbl" style={{ margin: 0 }}>AI 접근 차단</span>
                <div
                  className={`toggle${blocked ? ' on' : ''}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setBlocked(b => !b)}
                >
                  <div className="thumb" />
                </div>
                {blocked && <span className="sev hi" style={{ fontSize: 10 }}><span className="pip" />차단 중</span>}
              </div>
              <textarea
                className="input"
                style={{ width: '100%', fontSize: 11, minHeight: 60, resize: 'vertical', fontFamily: 'var(--mono)' }}
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder={blocked ? '차단 사유를 입력하세요 (필수)' : '관리자 메모 (선택)'}
              />
            </div>
          </section>

          {/* 최근 세션 */}
          <section className="panel">
            <div className="sec-head"><h3>최근 대화 세션 <span className="sub">{sessLoading ? '로딩중…' : `${sessions.length}건`}</span></h3></div>
            {sessLoading ? (
              <div className="dim mono" style={{ fontSize: 11, textAlign: 'center', padding: '12px 0' }}>불러오는 중…</div>
            ) : sessions.length === 0 ? (
              <div className="dim mono" style={{ fontSize: 11, textAlign: 'center', padding: '12px 0' }}>세션 없음</div>
            ) : (
              <div className="col-flex gap-4">
                {sessions.map(s => (
                  <div key={s.id} style={{ padding: '7px 10px', background: 'var(--snk)', borderRadius: 4, fontSize: 11 }}>
                    <div className="row-flex between center">
                      <span style={{ color: 'var(--f2)', fontWeight: 500 }}>
                        {s.title ?? routeLabel(s.route)}
                      </span>
                      <span className="mono dim" style={{ fontSize: 10 }}>
                        {fmtTokens(s.input_tokens + s.output_tokens)} tok
                      </span>
                    </div>
                    <div className="row-flex gap-10 mono dim" style={{ fontSize: 10, marginTop: 2 }}>
                      <span>{routeLabel(s.route)}</span>
                      <span>{fmtDateTime(s.started_at)}</span>
                      <span>{s.message_count}턴</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 에러 + 저장 */}
          {errMsg && (
            <div style={{ padding: '8px 12px', background: 'var(--shb)', color: 'var(--shf)', borderRadius: 4, fontSize: 12, fontFamily: 'var(--mono)' }}>
              {errMsg}
            </div>
          )}
          <div className="row-flex gap-8">
            <button className="btn primary" onClick={handleSave} disabled={saving} style={{ flex: 1 }}>
              {saving ? '저장 중…' : '저장'}
            </button>
            <button className="btn" onClick={onClose}>취소</button>
          </div>
        </div>
      </div>
    </>
  );
}
