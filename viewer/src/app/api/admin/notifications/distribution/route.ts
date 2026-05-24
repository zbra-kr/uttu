import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth/require-admin';
import { NextResponse } from 'next/server';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!,
);

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const now24hAgo = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const now7dAgo  = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();

  const { data: rows, error: dbErr } = await admin
    .from('user_notifications')
    .select('event_type, created_at')
    .gte('created_at', now7dAgo)
    .limit(5000);

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  const buckets: Record<string, { count_24h: number; count_7d: number }> = {};
  for (const row of (rows ?? []) as Array<{ event_type: string; created_at: string }>) {
    const et = row.event_type;
    if (!buckets[et]) buckets[et] = { count_24h: 0, count_7d: 0 };
    buckets[et].count_7d++;
    if (row.created_at >= now24hAgo) buckets[et].count_24h++;
  }

  const distribution = Object.entries(buckets)
    .map(([event_type, v]) => ({ event_type, ...v }))
    .sort((a, b) => b.count_7d - a.count_7d);

  return NextResponse.json({ distribution });
}
