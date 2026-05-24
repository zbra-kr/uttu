import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth/require-admin';
import { NextRequest, NextResponse } from 'next/server';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!,
);

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? 50)));

  const { data: notifs, error: dbErr } = await admin
    .from('user_notifications')
    .select('id, user_id, event_type, title, sent_to_teams_at, sent_to_telegram_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  if (!notifs || notifs.length === 0) return NextResponse.json({ notifications: [] });

  const userIds = [...new Set(notifs.map((n: { user_id: string }) => n.user_id))];
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, display_name')
    .in('id', userIds);

  const profileMap = new Map(
    (profiles ?? []).map((p: { id: string; display_name: string | null }) => [p.id, p.display_name]),
  );

  const notifications = notifs.map((n: {
    id: string; user_id: string; event_type: string; title: string;
    sent_to_teams_at: string | null; sent_to_telegram_at: string | null; created_at: string;
  }) => ({
    ...n,
    user_label: profileMap.get(n.user_id) ?? n.user_id.slice(0, 8),
  }));

  return NextResponse.json({ notifications });
}
