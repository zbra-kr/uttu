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
  const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();

  const [sent24h, sent7d, pending, webhookUsers, allUsers, lastSent] = await Promise.all([
    admin.from('user_notifications')
      .select('id', { count: 'exact', head: true })
      .not('sent_to_teams_at', 'is', null)
      .gte('sent_to_teams_at', now24hAgo),
    admin.from('user_notifications')
      .select('id', { count: 'exact', head: true })
      .not('sent_to_teams_at', 'is', null)
      .gte('sent_to_teams_at', now7dAgo),
    admin.from('user_notifications')
      .select('id', { count: 'exact', head: true })
      .is('sent_to_teams_at', null),
    admin.from('profiles')
      .select('id', { count: 'exact', head: true })
      .not('teams_webhook_url', 'is', null),
    admin.from('profiles')
      .select('id', { count: 'exact', head: true }),
    admin.from('user_notifications')
      .select('sent_to_teams_at')
      .not('sent_to_teams_at', 'is', null)
      .order('sent_to_teams_at', { ascending: false })
      .limit(1),
  ]);

  // stuck: pending 10분+ + webhook 설정된 사용자
  let stuck = 0;
  const { data: pendingRows } = await admin
    .from('user_notifications')
    .select('user_id')
    .is('sent_to_teams_at', null)
    .lt('created_at', tenMinAgo)
    .limit(1000);

  if (pendingRows && pendingRows.length > 0) {
    const userIds = [...new Set(pendingRows.map((p: { user_id: string }) => p.user_id))];
    const { count } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .in('id', userIds)
      .not('teams_webhook_url', 'is', null);
    stuck = count ?? 0;
  }

  return NextResponse.json({
    total_24h:        sent24h.count   ?? 0,
    total_7d:         sent7d.count    ?? 0,
    pending:          pending.count   ?? 0,
    stuck,
    webhook_set_users: webhookUsers.count ?? 0,
    total_users:       allUsers.count     ?? 0,
    last_dispatch_at: (lastSent.data?.[0] as { sent_to_teams_at: string } | undefined)?.sent_to_teams_at ?? null,
  });
}
