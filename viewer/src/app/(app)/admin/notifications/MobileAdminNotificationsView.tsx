'use client';
import { useState, useEffect } from 'react';
import { fetchRecentNotifications, fetchNotificationsKpi, type NotificationRow, type NotificationsKpi } from '@/lib/queries-admin';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';

function fmtDate(dt: string): string {
  const kst = new Date(new Date(dt).getTime() + 9 * 3_600_000);
  return kst.toISOString().slice(0, 16).replace('T', ' ');
}

export default function MobileAdminNotificationsView() {
  const [kpi, setKpi] = useState<NotificationsKpi | null>(null);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchNotificationsKpi(), fetchRecentNotifications(50)])
      .then(([k, r]) => { setKpi(k); setRows(r); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 12px 20px' }}>
      {/* KPI */}
      {kpi && (
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { label: '24h 발송', value: kpi.total_24h },
            { label: '7일', value: kpi.total_7d },
            { label: '대기', value: kpi.pending },
          ].map(k => (
            <div key={k.label} style={{ flex: 1, textAlign: 'center', padding: '10px 0', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--f1)', fontFamily: 'var(--mono)' }}>{k.value.toLocaleString()}</div>
              <div style={{ fontSize: 10, color: 'var(--f4)', marginTop: 1 }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <MobileEmptyState icon="🔔" title="최근 알림이 없습니다" />
      ) : (
        rows.map(r => (
          <div key={r.id} style={{ padding: '10px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--f4)', background: 'var(--snk)', padding: '1px 5px', borderRadius: 3 }}>
                {r.event_type}
              </span>
              <span style={{ fontSize: 10, color: 'var(--f4)', marginLeft: 'auto' }}>{r.user_label}</span>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--f1)', marginTop: 4 }}>{r.title}</div>
            <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 3, display: 'flex', gap: 6 }}>
              <span>{fmtDate(r.created_at)}</span>
              {r.sent_to_teams_at && <span style={{ color: 'var(--slf)' }}>Teams ✓</span>}
              {r.sent_to_telegram_at && <span style={{ color: 'var(--slf)' }}>TG ✓</span>}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
