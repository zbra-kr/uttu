import { requireAdmin } from '@/lib/auth/require-admin';
import { NextResponse } from 'next/server';

function todayKstStart(): string {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  return `${today}T00:00:00+09:00`;
}

function sevenDaysAgoKst(): string {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  kst.setDate(kst.getDate() - 6);
  kst.setHours(0, 0, 0, 0);
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, '0');
  const d = String(kst.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}T00:00:00+09:00`;
}

export async function GET() {
  const { error, ss } = await requireAdmin();
  if (error) return error;

  const start = todayKstStart();
  const weekStart = sevenDaysAgoKst();

  const [totalRes, successRes, errorRes, runningRes, doneWeekRes] = await Promise.all([
    ss.from('collection_jobs').select('*', { count: 'exact', head: true }).gte('started_at', start),
    ss.from('collection_jobs').select('*', { count: 'exact', head: true }).gte('started_at', start).eq('status', 'done'),
    ss.from('collection_jobs').select('*', { count: 'exact', head: true }).gte('started_at', start).eq('status', 'error'),
    ss.from('collection_jobs').select('*', { count: 'exact', head: true }).gte('started_at', start).eq('status', 'running'),
    ss.from('collection_jobs').select('started_at, finished_at').gte('started_at', weekStart).eq('status', 'done').not('finished_at', 'is', null),
  ]);

  const doneJobs = (doneWeekRes.data ?? []) as Array<{ started_at: string; finished_at: string }>;
  let avgDurationSec: number | null = null;
  if (doneJobs.length > 0) {
    const total = doneJobs.reduce((s, j) => {
      return s + (new Date(j.finished_at).getTime() - new Date(j.started_at).getTime()) / 1000;
    }, 0);
    avgDurationSec = Math.round(total / doneJobs.length);
  }

  return NextResponse.json({
    total_today:         totalRes.count   ?? 0,
    success_today:       successRes.count ?? 0,
    error_today:         errorRes.count   ?? 0,
    running_today:       runningRes.count ?? 0,
    avg_duration_7d_sec: avgDurationSec,
  });
}
