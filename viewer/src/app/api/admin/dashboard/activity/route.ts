import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth/require-admin';
import { NextResponse } from 'next/server';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!,
);

type ActivityItem = {
  type: 'anomaly' | 'signup' | 'job_error';
  occurred_at: string;
  label: string;
  link?: string;
};

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const now24hAgo = new Date(Date.now() - 24 * 3_600_000).toISOString();

  const [anomaliesRes, signupsRes, jobErrorsRes] = await Promise.all([
    admin.from('anomalies')
      .select('id, detected_at, entity_name, anomaly_type')
      .eq('severity', 'high')
      .gte('detected_at', now24hAgo)
      .order('detected_at', { ascending: false })
      .limit(5),
    admin.from('profiles')
      .select('id, display_name, full_name, created_at')
      .gte('created_at', now24hAgo)
      .order('created_at', { ascending: false })
      .limit(5),
    admin.from('collection_jobs')
      .select('id, script, error_msg, started_at')
      .eq('status', 'error')
      .gte('started_at', now24hAgo)
      .order('started_at', { ascending: false })
      .limit(5),
  ]);

  const items: ActivityItem[] = [
    ...((anomaliesRes.data ?? []) as Array<{
      id: string; detected_at: string; entity_name: string | null; anomaly_type: string;
    }>).map(a => ({
      type: 'anomaly' as const,
      occurred_at: a.detected_at,
      label: `${a.entity_name ?? '?'} — ${a.anomaly_type}`,
      link: '/anomaly',
    })),
    ...((signupsRes.data ?? []) as Array<{
      id: string; display_name: string | null; full_name: string | null; created_at: string;
    }>).map(p => ({
      type: 'signup' as const,
      occurred_at: p.created_at,
      label: `${p.display_name ?? p.full_name ?? '신규 사용자'} 가입`,
      link: '/admin/users',
    })),
    ...((jobErrorsRes.data ?? []) as Array<{
      id: string; script: string; error_msg: string | null; started_at: string;
    }>).map(j => ({
      type: 'job_error' as const,
      occurred_at: j.started_at,
      label: `${j.script} 실패: ${(j.error_msg ?? '').slice(0, 60)}`,
      link: '/admin/jobs',
    })),
  ];

  items.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));

  return NextResponse.json({ activity: items.slice(0, 15) });
}
