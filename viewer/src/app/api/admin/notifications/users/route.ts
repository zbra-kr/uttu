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

  const { data: profiles, error: profErr } = await admin
    .from('profiles')
    .select('id, display_name, team, teams_webhook_url, telegram_chat_id')
    .order('display_name');

  if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });
  if (!profiles || profiles.length === 0) return NextResponse.json({ users: [] });

  const userIds = profiles.map((p: { id: string }) => p.id);

  const [subsRes, authRes] = await Promise.all([
    admin.from('user_notification_subscriptions')
      .select('user_id')
      .in('user_id', userIds)
      .eq('enabled', true),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);

  const subCount = new Map<string, number>();
  for (const sub of (subsRes.data ?? []) as Array<{ user_id: string }>) {
    subCount.set(sub.user_id, (subCount.get(sub.user_id) ?? 0) + 1);
  }

  const emailMap = new Map(
    (authRes.data?.users ?? []).map(u => [u.id, u.email ?? '']),
  );

  const users = (profiles as Array<{
    id: string; display_name: string | null; team: string | null;
    teams_webhook_url: string | null; telegram_chat_id: string | null;
  }>).map(p => ({
    user_id:              p.id,
    display_name:         p.display_name,
    email:                emailMap.get(p.id) ?? '',
    team:                 p.team,
    has_teams_webhook:    !!p.teams_webhook_url,
    has_telegram_chat_id: !!p.telegram_chat_id,
    active_subscriptions: subCount.get(p.id) ?? 0,
  }));

  return NextResponse.json({ users });
}
