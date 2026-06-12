'use client';
import React from 'react';
import { IcUsers, IcShield, IcSearch } from '@/components/ui/icons';
import { fetchAdminUsers, type AdminUser } from '@/lib/queries-admin';
import UserDetailModal from '@/components/admin/UserDetailModal';
import { useIsMobile } from '@/hooks/useViewport';
import MobileAdminUsersView from './MobileAdminUsersView';
import { fmtTokens, fmtDate } from '@/lib/format';

function UsageBar({ used, limit, usedToday, dailyLimit }: {
  used: number; limit: number | null;
  usedToday?: number; dailyLimit?: number | null;
}) {
  const fmtK = fmtTokens;
  const monthColor = (p: number) => p >= 95 ? 'var(--shf)' : p >= 80 ? 'var(--smf)' : 'var(--hs)';
  const dayColor   = (p: number) => p >= 95 ? 'var(--shf)' : p >= 80 ? 'var(--smf)' : 'var(--slf)';

  const hasMonth = limit != null;
  const hasDay   = dailyLimit != null && usedToday !== undefined;

  if (!hasMonth && !hasDay) {
    return <span className="chip" style={{ fontSize: 9 }}>무제한</span>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      {hasDay && (() => {
        const pct = Math.min(100, ((usedToday ?? 0) / dailyLimit!) * 100);
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span className="mono" style={{ fontSize: 9, color: 'var(--slf)' }}>오늘</span>
              <span className="mono" style={{ fontSize: 9, color: 'var(--f3)' }}>
                {fmtK(usedToday ?? 0)} / {fmtK(dailyLimit!)}
              </span>
            </div>
            <div style={{ height: 2, background: 'var(--snk)', borderRadius: 1, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: dayColor(pct), borderRadius: 1 }} />
            </div>
          </div>
        );
      })()}
      {hasMonth && (() => {
        const pct = Math.min(100, (used / limit!) * 100);
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span className="mono" style={{ fontSize: 9, color: 'var(--f4)' }}>이번달</span>
              <span className="mono" style={{ fontSize: 9, color: 'var(--f2)' }}>
                {fmtK(used)} / {fmtK(limit!)}
              </span>
            </div>
            <div style={{ height: 2, background: 'var(--snk)', borderRadius: 1, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: monthColor(pct), borderRadius: 1 }} />
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default function AdminUsersPage() {
  const isMobile = useIsMobile();
  if (isMobile) return <MobileAdminUsersView />;
  return <AdminUsersDesktopView />;
}

function AdminUsersDesktopView() {
  const [users,   setUsers]   = React.useState<AdminUser[]>([]);
  const [total,   setTotal]   = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [q,       setQ]       = React.useState('');
  const [role,    setRole]    = React.useState<'all' | 'admin' | 'viewer'>('all');
  const [detail,  setDetail]  = React.useState<AdminUser | null>(null);

  const [deferQ, setDeferQ] = React.useState('');
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = React.useCallback((query: string, roleFilter: typeof role) => {
    setLoading(true);
    fetchAdminUsers({ q: query, role: roleFilter, limit: 100 })
      .then(({ users: u, total: t }) => { setUsers(u); setTotal(t); })
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => { load(deferQ, role); }, [deferQ, role, load]);

  const handleQ = (v: string) => {
    setQ(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDeferQ(v), 350);
  };

  const handleUpdated = (updated: AdminUser) => {
    setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
  };

  // KPI 계산
  const active7d = users.filter(u => {
    if (!u.last_sign_in_at) return false;
    return Date.now() - new Date(u.last_sign_in_at).getTime() < 7 * 86_400_000;
  }).length;
  const blockedCount = users.filter(u => u.quota.is_blocked).length;
  const totalTokens  = users.reduce((s, u) => s + u.usage_this_month.total_tokens, 0);

  return (
    <>
      <div className="page-title">
        <IcShield size={18} style={{ color: 'var(--hs)' }} />
        <h1>사용자 관리</h1>
        <span className="chip" style={{ background: 'var(--shb)', color: 'var(--shf)', borderColor: 'var(--shf)' }}>admin</span>
      </div>

      {/* KPI */}
      <div className="grid grid-4 gap-8">
        {([
          ['전체 사용자',   total,         '명'],
          ['7일 활성',      active7d,      '명'],
          ['차단됨',        blockedCount,  '명'],
          ['이번달 토큰',   totalTokens,   'tok'],
        ] as [string, number, string][]).map(([label, val, unit], i) => (
          <div key={i} className="kpi">
            <span className="label">{label}</span>
            <div className="val">
              {unit === 'tok' ? fmtTokens(val) : val.toLocaleString()}
              <span className="unit"> {unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* 검색 + 필터 */}
      <div className="row-flex gap-8 center">
        <div className="row-flex center gap-6" style={{ background: 'var(--snk)', border: '1px solid var(--bd)', borderRadius: 5, padding: '4px 10px', flex: 1, maxWidth: 300 }}>
          <IcSearch size={14} style={{ color: 'var(--f4)', flexShrink: 0 }} />
          <input
            value={q}
            onChange={e => handleQ(e.target.value)}
            placeholder="이름 · 이메일 · 표시명"
            style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12, width: '100%', color: 'var(--f1)' }}
          />
        </div>
        <div className="row-flex gap-4">
          {(['all', 'admin', 'viewer'] as const).map(r => (
            <button key={r} className={`btn sm${role === r ? ' active' : ''}`} onClick={() => setRole(r)}>
              {r === 'all' ? '전체' : r}
            </button>
          ))}
        </div>
        <span className="mono dim" style={{ fontSize: 11, marginLeft: 'auto' }}>
          {loading ? '로딩중…' : `${users.length}명`}
        </span>
      </div>

      {/* 테이블 */}
      <section className="panel" style={{ padding: 0 }}>
        <div className="tbl" style={{ border: 'none', borderRadius: 0 }}>
          <div className="row head" style={{ gridTemplateColumns: '1.6fr 90px 1.6fr 100px 56px 90px 44px' }}>
            <span>사용자</span>
            <span>역할</span>
            <span>이번달 사용</span>
            <span>한도</span>
            <span>차단</span>
            <span>최근 접속</span>
            <span></span>
          </div>

          {loading && (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--f4)', fontSize: 12, fontFamily: 'var(--mono)' }}>
              불러오는 중…
            </div>
          )}

          {!loading && users.length === 0 && (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--f4)', fontSize: 12, fontFamily: 'var(--mono)' }}>
              사용자 없음
            </div>
          )}

          {!loading && users.map((u, i) => (
            <div
              key={u.id}
              className={`row hover${i % 2 ? ' alt' : ''}`}
              style={{ gridTemplateColumns: '1.6fr 90px 1.6fr 100px 56px 90px 44px', cursor: 'pointer' }}
              onClick={() => setDetail(u)}
            >
              {/* 사용자 */}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.full_name || u.display_name || '—'}
                </div>
                <div className="mono dim" style={{ fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.email}
                </div>
              </div>

              {/* 역할 */}
              <span>
                {u.role === 'admin'
                  ? <span className="chip" style={{ fontSize: 10, background: 'var(--shb)', color: 'var(--shf)', borderColor: 'var(--shf)' }}>admin</span>
                  : <span className="chip" style={{ fontSize: 10 }}>viewer</span>}
              </span>

              {/* 이번달 사용 */}
              <div style={{ minWidth: 0 }}>
                <UsageBar
                  used={u.usage_this_month.total_tokens}
                  limit={u.quota.monthly_token_limit}
                  usedToday={u.usage_today}
                  dailyLimit={u.quota.daily_token_limit}
                />
              </div>

              {/* 한도 */}
              <span className="mono" style={{ fontSize: 10, color: 'var(--f3)' }}>
                {u.quota.monthly_token_limit != null ? fmtTokens(u.quota.monthly_token_limit) : '무제한'}
              </span>

              {/* 차단 */}
              <span>
                {u.quota.is_blocked && (
                  <span className="sev hi" style={{ fontSize: 9 }}><span className="pip" />차단</span>
                )}
              </span>

              {/* 최근 접속 */}
              <span className="mono dim" style={{ fontSize: 10 }}>
                {fmtDate(u.last_sign_in_at)}
              </span>

              {/* 액션 */}
              <span>
                <IcUsers size={13} style={{ color: 'var(--f4)' }} />
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* 상세 모달 */}
      {detail && (
        <UserDetailModal
          user={detail}
          onClose={() => setDetail(null)}
          onUpdated={handleUpdated}
        />
      )}
    </>
  );
}
