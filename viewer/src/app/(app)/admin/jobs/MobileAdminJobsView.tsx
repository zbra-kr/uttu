'use client';
import { useState, useEffect } from 'react';
import { fetchTodayJobs, type CollectionJob } from '@/lib/queries-admin';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';

const STATUS_COLOR: Record<string, string> = {
  running: 'var(--smf)',
  done:    'var(--slf)',
  error:   'var(--shf)',
};

const STATUS_BG: Record<string, string> = {
  running: 'var(--smb)',
  done:    'var(--slb)',
  error:   'var(--shb)',
};

function elapsed(start: string, end: string | null): string {
  const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}초`;
  return `${Math.floor(s / 60)}분 ${s % 60}초`;
}

function formatTs(ts: string): string {
  const kst = new Date(new Date(ts).getTime() + 9 * 3_600_000);
  return kst.toISOString().slice(11, 16);
}

export default function MobileAdminJobsView() {
  const [jobs, setJobs] = useState<CollectionJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTodayJobs()
      .then(data => { setJobs(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>;
  if (jobs.length === 0) return <MobileEmptyState icon="⚙️" title="오늘 실행된 작업이 없습니다" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 12px 20px' }}>
      {jobs.map(j => {
        const pct = j.target && j.target > 0 ? Math.min(100, Math.round((j.rows_done / j.target) * 100)) : null;
        return (
          <div key={j.id} style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {j.label ?? j.script}
                </div>
                <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 2 }}>
                  {formatTs(j.started_at)}
                  {j.finished_at && ` · ${elapsed(j.started_at, j.finished_at)}`}
                </div>
              </div>
              <span style={{
                fontSize: 9, fontWeight: 600, fontFamily: 'var(--mono)', flexShrink: 0,
                color: STATUS_COLOR[j.status] ?? 'var(--f4)',
                background: STATUS_BG[j.status] ?? 'var(--snk)',
                padding: '2px 6px', borderRadius: 4,
              }}>
                {j.status}
              </span>
            </div>
            {/* 진행률 */}
            {pct != null && j.status === 'running' && (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 3 }}>
                  <span>{j.rows_done.toLocaleString()} / {j.target!.toLocaleString()}</span>
                  <span>{pct}%</span>
                </div>
                <div style={{ height: 4, background: 'var(--snk)', borderRadius: 2 }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: 'var(--hs)', borderRadius: 2 }} />
                </div>
              </div>
            )}
            {j.error_msg && (
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--shf)', fontFamily: 'var(--mono)' }}>
                {j.error_msg.slice(0, 80)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
