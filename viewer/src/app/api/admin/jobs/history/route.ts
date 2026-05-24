import { requireAdmin } from '@/lib/auth/require-admin';
import { NextRequest, NextResponse } from 'next/server';

function daysAgoKst(n: number): string {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  kst.setDate(kst.getDate() - n + 1);
  kst.setHours(0, 0, 0, 0);
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, '0');
  const d = String(kst.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}T00:00:00+09:00`;
}

function toKstDate(iso: string): string {
  const kst = new Date(new Date(iso).getTime() + 9 * 3_600_000);
  return kst.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const { error, ss } = await requireAdmin();
  if (error) return error;

  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get('days') ?? 14)));

  const { data, error: dbErr } = await ss
    .from('collection_jobs')
    .select('started_at, status')
    .gte('started_at', daysAgoKst(days))
    .in('status', ['done', 'error'])
    .order('started_at');

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  const buckets: Record<string, { success: number; error: number }> = {};
  for (const row of (data ?? [])) {
    const date = toKstDate(row.started_at);
    if (!buckets[date]) buckets[date] = { success: 0, error: 0 };
    if (row.status === 'done')  buckets[date].success++;
    if (row.status === 'error') buckets[date].error++;
  }

  const history = Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }));

  return NextResponse.json({ history });
}
