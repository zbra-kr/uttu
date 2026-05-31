'use client';
import React from 'react';
import { IcCalendar } from '@/components/ui/icons';
import { Line } from '@/components/ui/charts';
import { supabaseBrowser } from '@/lib/supabase/client';
import {
  fetchTodayJobs, fetchJobsHistory, fetchJobsKpi,
  type CollectionJob, type JobsKpi, type JobHistoryPoint,
} from '@/lib/queries-admin';
import JobDetailModal from '@/components/admin/JobDetailModal';
import { useIsMobile } from '@/hooks/useViewport';
import MobileAdminJobsView from './MobileAdminJobsView';

// ── 포맷 헬퍼 ──────────────────────────────────────────────────────────────────
function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const kst = new Date(new Date(iso).getTime() + 9 * 3_600_000);
  return kst.toISOString().slice(11, 19);
}

function fmtDuration(startIso: string, endIso: string | null): string {
  const end = endIso ? new Date(endIso) : new Date();
  const sec = Math.round((end.getTime() - new Date(startIso).getTime()) / 1000);
  if (sec < 60)   return `${sec}초`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function fmtAvgDuration(sec: number | null): string {
  if (sec === null) return '—';
  if (sec < 60)    return `${sec}초`;
  if (sec < 3600)  return `${Math.floor(sec / 60)}분 ${sec % 60}초`;
  return `${Math.floor(sec / 3600)}시간 ${Math.floor((sec % 3600) / 60)}분`;
}

function fmtDate(dateStr: string): string {
  return dateStr.slice(5); // 'MM-DD'
}

const STATUS_COLOR: Record<string, string> = {
  done:    'var(--slf)',
  error:   'var(--shf)',
  running: 'var(--smf)',
};
const STATUS_LABEL: Record<string, string> = {
  done:    '완료',
  error:   '오류',
  running: '실행 중',
};

// ── 진행률 바 ─────────────────────────────────────────────────────────────────
function ProgressCell({ rows_done, target, status }: Pick<CollectionJob, 'rows_done' | 'target' | 'status'>) {
  if (!target) {
    return <span style={{ fontSize: 12, color: 'var(--f2)', fontFamily: 'var(--mono)' }}>{rows_done.toLocaleString()}</span>;
  }
  const pct = Math.min(100, Math.round((rows_done / target) * 100));
  const color = status === 'error' ? 'var(--shf)' : status === 'done' ? 'var(--slf)' : 'var(--smf)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 80 }}>
      <span style={{ fontSize: 10, color: 'var(--f3)', fontFamily: 'var(--mono)' }}>
        {rows_done.toLocaleString()} / {target.toLocaleString()}
      </span>
      <div style={{ height: 3, background: 'var(--snk)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────
export default function AdminJobsPage() {
  const isMobile = useIsMobile();
  if (isMobile) return <MobileAdminJobsView />;
  const [jobs,    setJobs]    = React.useState<CollectionJob[]>([]);
  const [kpi,     setKpi]     = React.useState<JobsKpi | null>(null);
  const [history, setHistory] = React.useState<JobHistoryPoint[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [detail,  setDetail]  = React.useState<CollectionJob | null>(null);
  const [live,    setLive]    = React.useState(false);
  const kpiTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshKpi = React.useCallback(() => {
    fetchJobsKpi().then(k => { if (k) setKpi(k); });
  }, []);

  const scheduleKpiRefresh = React.useCallback(() => {
    if (kpiTimerRef.current) clearTimeout(kpiTimerRef.current);
    kpiTimerRef.current = setTimeout(refreshKpi, 3000);
  }, [refreshKpi]);

  React.useEffect(() => {
    // 초기 로드
    Promise.all([
      fetchTodayJobs(),
      fetchJobsKpi(),
      fetchJobsHistory(14),
    ]).then(([j, k, h]) => {
      setJobs(j);
      if (k) setKpi(k);
      setHistory(h);
      setLoading(false);
    });

    // Realtime 구독
    const client = supabaseBrowser();
    const channel = client
      .channel('admin_jobs_realtime')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any,
        { event: '*', schema: 'public', table: 'collection_jobs' },
        (payload: any) => {
          if (payload.eventType === 'INSERT' && payload.new) {
            setJobs(prev => [payload.new as CollectionJob, ...prev]);
          } else if (payload.eventType === 'UPDATE' && payload.new) {
            setJobs(prev => prev.map(j =>
              String(j.id) === String(payload.new.id) ? (payload.new as CollectionJob) : j,
            ));
            setDetail(prev =>
              prev && String(prev.id) === String(payload.new.id)
                ? (payload.new as CollectionJob) : prev,
            );
          } else if (payload.eventType === 'DELETE' && payload.old) {
            setJobs(prev => prev.filter(j => String(j.id) !== String(payload.old.id)));
          }
          scheduleKpiRefresh();
        },
      )
      .subscribe((status) => {
        setLive(status === 'SUBSCRIBED');
      });

    return () => {
      client.removeChannel(channel);
      if (kpiTimerRef.current) clearTimeout(kpiTimerRef.current);
    };
  }, [scheduleKpiRefresh]);

  // 14일 차트 데이터
  const chartLabels  = history.map(h => fmtDate(h.date));
  const successPts   = history.map(h => h.success);
  const errorPts     = history.map(h => h.error);
  const chartSeries  = [
    { points: successPts, label: '성공', color: 'var(--slf)' },
    { points: errorPts,   label: '오류', color: 'var(--shf)', dashed: true },
  ];

  return (
    <>
      <div className="page-title">
        <IcCalendar size={18} style={{ color: 'var(--hs)' }} />
        <h1>수집 모니터링</h1>
        <span className="chip" style={{ background: 'var(--shb)', color: 'var(--shf)', borderColor: 'var(--shf)' }}>admin</span>
        <span
          className="chip mono"
          style={{
            fontSize: 9, letterSpacing: '0.06em',
            background: live ? 'color-mix(in srgb, var(--slf) 12%, transparent)' : 'var(--snk)',
            color: live ? 'var(--slf)' : 'var(--f4)',
            borderColor: live ? 'var(--slf)' : 'var(--bs)',
          }}
        >
          {live ? '● LIVE' : '○ 연결 중'}
        </span>
      </div>

      {/* KPI 카드 */}
      <div className="grid grid-4 gap-14" style={{ marginBottom: 24 }}>
        {[
          { label: '오늘 실행',  value: kpi?.total_today   ?? '—', color: 'var(--f1)'  },
          { label: '성공',      value: kpi?.success_today  ?? '—', color: 'var(--slf)' },
          { label: '오류',      value: kpi?.error_today    ?? '—', color: kpi && kpi.error_today > 0 ? 'var(--shf)' : 'var(--f1)' },
          { label: '7일 평균',  value: fmtAvgDuration(kpi?.avg_duration_7d_sec ?? null), color: 'var(--f1)' },
        ].map(({ label, value, color }) => (
          <section key={label} className="panel">
            <div className="mono dim" style={{ fontSize: 10, letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 26, fontWeight: 600, color }}>{loading ? '—' : value}</div>
          </section>
        ))}
      </div>

      {/* 오늘의 실행 현황 테이블 */}
      <section className="panel" style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--f1)', marginBottom: 14 }}>
          오늘의 실행 현황
          {kpi?.running_today ? (
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--smf)', fontFamily: 'var(--mono)' }}>
              ● {kpi.running_today}개 실행 중
            </span>
          ) : null}
        </div>

        {loading ? (
          <div className="mono dim" style={{ fontSize: 12, padding: '8px 0' }}>불러오는 중…</div>
        ) : jobs.length === 0 ? (
          <div className="mono dim" style={{ fontSize: 12, padding: '8px 0' }}>오늘 실행된 수집 작업이 없습니다</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1.5px solid var(--bd)' }}>
                  {['상태', 'script', '레이블', '시작', '완료', '진행', '소요'].map(h => (
                    <th key={h} style={{
                      padding: '6px 10px', textAlign: 'left', fontWeight: 600,
                      color: 'var(--f3)', fontFamily: 'var(--mono)', fontSize: 10,
                      letterSpacing: '0.04em', whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.map(job => (
                  <tr
                    key={job.id}
                    onClick={() => setDetail(job)}
                    style={{
                      borderBottom: '0.5px solid var(--bs)',
                      cursor: 'pointer',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--hov)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                  >
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 3,
                        background: `color-mix(in srgb, ${STATUS_COLOR[job.status]} 15%, transparent)`,
                        color: STATUS_COLOR[job.status],
                        border: `0.5px solid ${STATUS_COLOR[job.status]}`,
                        fontFamily: 'var(--mono)', whiteSpace: 'nowrap',
                      }}>
                        {STATUS_LABEL[job.status] ?? job.status}
                      </span>
                    </td>
                    <td style={{ padding: '8px 10px', fontFamily: 'var(--mono)', color: 'var(--f3)', fontSize: 11, whiteSpace: 'nowrap' }}>
                      {job.script}
                    </td>
                    <td style={{ padding: '8px 10px', color: 'var(--f1)' }}>{job.label ?? '—'}</td>
                    <td style={{ padding: '8px 10px', fontFamily: 'var(--mono)', color: 'var(--f3)', fontSize: 11, whiteSpace: 'nowrap' }}>
                      {fmtTime(job.started_at)}
                    </td>
                    <td style={{ padding: '8px 10px', fontFamily: 'var(--mono)', color: 'var(--f3)', fontSize: 11, whiteSpace: 'nowrap' }}>
                      {fmtTime(job.finished_at)}
                    </td>
                    <td style={{ padding: '8px 10px', minWidth: 100 }}>
                      <ProgressCell rows_done={job.rows_done} target={job.target} status={job.status} />
                    </td>
                    <td style={{ padding: '8px 10px', fontFamily: 'var(--mono)', color: 'var(--f3)', fontSize: 11, whiteSpace: 'nowrap' }}>
                      {fmtDuration(job.started_at, job.finished_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 14일 추이 차트 */}
      {history.length > 0 && (
        <section className="panel" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--f1)' }}>14일 수집 추이</div>
            <div style={{ display: 'flex', gap: 12 }}>
              {[['성공', 'var(--slf)'], ['오류', 'var(--shf)']].map(([label, color]) => (
                <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--f3)' }}>
                  <span style={{ display: 'inline-block', width: 20, height: 2, background: color, borderRadius: 1 }} />
                  {label}
                </span>
              ))}
            </div>
          </div>
          <Line
            h={160}
            series={chartSeries}
            labels={chartLabels}
            yMin={0}
            dots={true}
          />
        </section>
      )}

      {/* 상세 모달 */}
      {detail && (
        <JobDetailModal job={detail} onClose={() => setDetail(null)} />
      )}
    </>
  );
}
