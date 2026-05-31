'use client';
import { useState, useEffect } from 'react';
import { fetchAdminUsers, type AdminUser } from '@/lib/queries-admin';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';

export default function MobileAdminUsersView() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchAdminUsers({ limit: 100 })
      .then(({ users: data }) => { setUsers(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = search
    ? users.filter(u =>
        (u.email ?? '').includes(search) ||
        (u.display_name ?? '').includes(search) ||
        (u.full_name ?? '').includes(search)
      )
    : users;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 12px 20px' }}>
      <input
        type="text"
        placeholder="이름·이메일 검색"
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{
          width: '100%', padding: '9px 12px', borderRadius: 8,
          border: '1px solid var(--bd)', background: 'var(--sur)',
          color: 'var(--f1)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
        }}
      />
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <MobileEmptyState icon="👥" title="사용자가 없습니다" />
      ) : (
        filtered.map(u => (
          <div key={u.id} style={{ padding: '10px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)' }}>
                  {u.display_name ?? u.full_name ?? '이름 없음'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--f3)', marginTop: 1 }}>{u.email}</div>
                {u.team && <div style={{ fontSize: 10, color: 'var(--f4)', marginTop: 1 }}>{u.team}</div>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                <span style={{
                  fontSize: 9, fontWeight: 600, fontFamily: 'var(--mono)',
                  color: u.role === 'admin' ? 'var(--shf)' : 'var(--f3)',
                  background: u.role === 'admin' ? 'var(--shb)' : 'var(--snk)',
                  padding: '2px 6px', borderRadius: 4,
                }}>
                  {u.role}
                </span>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
