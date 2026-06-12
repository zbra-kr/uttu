'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { fetchDashboardKpi, fetchDashboardActivity, type DashboardKpi, type DashboardActivity } from '@/lib/queries-admin';
import { fmtTokens } from '@/lib/format';

function timeSince(iso: string | null): string {
  if (!iso) return '—';
  const sec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${sec}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  return `${Math.floor(sec / 86400)}일 전`;
}

const ACTIVITY_COLOR: Record<string, string> = {
  anomaly: 'var(--shf)',
  signup: 'var(--slf)',
  job_error: 'var(--smf)',
};

export default function MobileAdminDashboardView() {
  const [kpi, setKpi] = useState<DashboardKpi | null>(null);
  const [activity, setActivity] = useState<DashboardActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchDashboardKpi(), fetchDashboardActivity()])
      .then(([k, a]) => { setKpi(k); setActivity(a); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 12px 20px' , width: '100%', minWidth: 0 }}>

      {kpi && (
        <>
          {/* 사용자 KPI */}
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--f4)', letterSpacing: '0.06em', marginBottom: -4 }}>사용자</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { label: '전체', value: kpi.users.total },
              { label: '7일 활성', value: kpi.users.active_7d },
              { label: 'AI 토큰', value: fmtTokens(kpi.users.ai_tokens_this_month) },
            ].map(k => (
              <div key={k.label} style={{ flex: 1, textAlign: 'center', padding: '10px 0', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--f1)', fontFamily: 'var(--mono)' }}>{k.value}</div>
                <div style={{ fontSize: 10, color: 'var(--f4)', marginTop: 1 }}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* 작업 KPI */}
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--f4)', letterSpacing: '0.06em', marginBottom: -4 }}>오늘 작업</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { label: '전체', value: kpi.jobs.total_today },
              { label: '성공', value: kpi.jobs.success_today, color: 'var(--slf)' },
              { label: '오류', value: kpi.jobs.error_today, color: kpi.jobs.error_today > 0 ? 'var(--shf)' : 'var(--f1)' },
            ].map(k => (
              <div key={k.label} style={{ flex: 1, textAlign: 'center', padding: '10px 0', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: ('color' in k ? k.color : 'var(--f1)'), fontFamily: 'var(--mono)' }}>{k.value}</div>
                <div style={{ fontSize: 10, color: 'var(--f4)', marginTop: 1 }}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* 데이터 KPI */}
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--f4)', letterSpacing: '0.06em', marginBottom: -4 }}>데이터</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { label: '브랜드', value: kpi.data.total_brands },
              { label: '상품', value: kpi.data.total_products.toLocaleString() },
              { label: '이상탐지', value: kpi.data.high_anomalies_unread, color: kpi.data.high_anomalies_unread > 0 ? 'var(--shf)' : 'var(--f1)' },
            ].map(k => (
              <div key={k.label} style={{ flex: 1, textAlign: 'center', padding: '10px 0', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: ('color' in k ? k.color : 'var(--f1)'), fontFamily: 'var(--mono)' }}>{k.value}</div>
                <div style={{ fontSize: 10, color: 'var(--f4)', marginTop: 1 }}>{k.label}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 빠른 링크 */}
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--f4)', letterSpacing: '0.06em', marginBottom: -4 }}>바로가기</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[
          { path: '/admin/users', label: '사용자 관리' },
          { path: '/admin/jobs', label: '작업 내역' },
          { path: '/admin/notifications', label: '알림 내역' },
          { path: '/admin/llm', label: 'LLM 모델' },
          { path: '/admin/anomalies', label: '이상탐지 규칙' },
          { path: '/admin/mapping', label: '매핑 관리' },
        ].map(link => (
          <Link key={link.path} href={link.path} style={{ textDecoration: 'none' }}>
            <div style={{
              padding: '12px 14px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--f1)' }}>{link.label}</span>
              <span style={{ fontSize: 14, color: 'var(--f4)' }}>→</span>
            </div>
          </Link>
        ))}
      </div>

      {/* 최근 활동 */}
      {activity.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--f4)', letterSpacing: '0.06em', marginBottom: -4 }}>최근 활동</div>
          {activity.slice(0, 5).map((a, i) => (
            <div key={i} style={{ padding: '10px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10, borderLeft: `3px solid ${ACTIVITY_COLOR[a.type] ?? 'var(--f4)'}` }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--f1)' }}>{a.label}</div>
              <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 2 }}>{timeSince(a.occurred_at)}</div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
