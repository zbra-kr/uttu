import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth/require-admin';
import { NextResponse } from 'next/server';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!,
);

function todayKstStart(): string {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  return `${today}T00:00:00+09:00`;
}

function monthStartKSTDate(): string {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const now7dAgo  = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const now24hAgo = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const todayKst  = todayKstStart();
  const monthStart = monthStartKSTDate();

  const [
    usersTotal,
    usersBlockedRes,
    aiTokensRows,
    jobsTodayRes,
    jobsHistory7dRes,
    notif24hRes,
    notifPendingRes,
    notifLastRes,
    companiesTotal,
    companiesUnmapped,
    brandsTotal,
    productsTotal,
    highAnomaliesUnread,
    authUsersRes,
  ] = await Promise.all([
    admin.from('profiles').select('id', { count: 'exact', head: true }),
    admin.from('ai_user_quotas').select('user_id', { count: 'exact', head: true }).eq('is_blocked', true),
    admin.from('ai_usage_daily').select('input_tokens, output_tokens').gte('usage_date', monthStart),
    admin.from('collection_jobs').select('status, started_at, finished_at').gte('started_at', todayKst).limit(500),
    admin.from('collection_jobs').select('status, started_at, finished_at').gte('started_at', now7dAgo).limit(2000),
    admin.from('user_notifications').select('id', { count: 'exact', head: true }).gte('sent_to_teams_at', now24hAgo),
    admin.from('user_notifications').select('id', { count: 'exact', head: true }).is('sent_to_teams_at', null),
    admin.from('user_notifications').select('sent_to_teams_at')
      .not('sent_to_teams_at', 'is', null).order('sent_to_teams_at', { ascending: false }).limit(1),
    admin.from('companies').select('id', { count: 'exact', head: true }),
    admin.from('companies').select('id', { count: 'exact', head: true }).is('corp_code', null),
    admin.from('brands').select('id', { count: 'exact', head: true }),
    admin.from('products').select('id', { count: 'exact', head: true }),
    admin.from('anomalies').select('id', { count: 'exact', head: true }).eq('severity', 'high'),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  // active_7d: last_sign_in_at >= 7일 전
  const active7d = (authUsersRes.data?.users ?? []).filter(
    u => u.last_sign_in_at && new Date(u.last_sign_in_at) > new Date(now7dAgo),
  ).length;

  // 이번달 AI 토큰 합산
  const aiTokensThisMonth = (aiTokensRows.data ?? []).reduce(
    (s, r: { input_tokens: number; output_tokens: number }) =>
      s + (r.input_tokens ?? 0) + (r.output_tokens ?? 0),
    0,
  );

  // 오늘 작업 집계
  const jobsArr = (jobsTodayRes.data ?? []) as Array<{ status: string; started_at: string; finished_at: string | null }>;
  const successToday = jobsArr.filter(j => j.status === 'done').length;
  const errorToday   = jobsArr.filter(j => j.status === 'error').length;

  // 7일 평균 duration (성공 job만)
  const completed7d = ((jobsHistory7dRes.data ?? []) as Array<{ status: string; started_at: string; finished_at: string | null }>)
    .filter(j => j.status === 'done' && j.finished_at);
  const avgDuration7dSec = completed7d.length > 0
    ? Math.round(
        completed7d.reduce((s, j) =>
          s + (new Date(j.finished_at!).getTime() - new Date(j.started_at).getTime()), 0)
        / completed7d.length / 1000,
      )
    : null;

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
    users: {
      total:                usersTotal.count   ?? 0,
      active_7d:            active7d,
      blocked:              usersBlockedRes.count ?? 0,
      ai_tokens_this_month: aiTokensThisMonth,
    },
    jobs: {
      total_today:        jobsArr.length,
      success_today:      successToday,
      error_today:        errorToday,
      avg_duration_7d_sec: avgDuration7dSec,
    },
    notifications: {
      total_24h:        notif24hRes.count ?? 0,
      pending:          notifPendingRes.count ?? 0,
      stuck,
      last_dispatch_at: (notifLastRes.data?.[0] as { sent_to_teams_at: string } | undefined)?.sent_to_teams_at ?? null,
    },
    data: {
      total_companies:      companiesTotal.count    ?? 0,
      unmapped_companies:   companiesUnmapped.count ?? 0,
      total_brands:         brandsTotal.count       ?? 0,
      total_products:       productsTotal.count     ?? 0,
      high_anomalies_unread: highAnomaliesUnread.count ?? 0,
    },
  });
}
