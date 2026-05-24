import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth/require-admin';

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!,
);

function kstMonthStart(): string {
  const now = new Date(Date.now() + 9 * 3_600_000);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const sp     = req.nextUrl.searchParams;
  const q      = sp.get('q')?.trim() ?? '';
  const role   = sp.get('role') ?? '';
  const page   = Math.max(1, parseInt(sp.get('page') ?? '1', 10));
  const limit  = Math.min(100, parseInt(sp.get('limit') ?? '50', 10));
  const offset = (page - 1) * limit;

  // 1. auth.users — email + last_sign_in_at (service_role only)
  const { data: authList } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
  const authMap = new Map(
    (authList?.users ?? []).map(u => [u.id, { email: u.email ?? '', last_sign_in_at: u.last_sign_in_at ?? null }])
  );

  // 2. profiles + quotas
  let profileQuery = adminClient
    .from('profiles')
    .select('id, full_name, display_name, role, team, avatar_url, created_at, ai_user_quotas(monthly_token_limit, daily_token_limit, is_blocked, note)', { count: 'exact' });

  if (role && role !== 'all') profileQuery = profileQuery.eq('role', role);
  if (q) profileQuery = profileQuery.or(`full_name.ilike.%${q}%,display_name.ilike.%${q}%`);

  profileQuery = profileQuery.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

  const { data: profiles, count, error: profErr } = await profileQuery;
  if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });

  // 3. 이번달 사용량 집계
  const monthStart = kstMonthStart();
  const { data: usageRows } = await adminClient
    .from('ai_usage_daily')
    .select('user_id, input_tokens, output_tokens, session_count')
    .gte('usage_date', monthStart);

  type UsageAccum = { input_tokens: number; output_tokens: number; session_count: number };
  const usageMap = new Map<string, UsageAccum>();
  for (const row of (usageRows ?? [])) {
    const prev = usageMap.get(row.user_id) ?? { input_tokens: 0, output_tokens: 0, session_count: 0 };
    usageMap.set(row.user_id, {
      input_tokens:  prev.input_tokens  + (row.input_tokens  ?? 0),
      output_tokens: prev.output_tokens + (row.output_tokens ?? 0),
      session_count: prev.session_count + (row.session_count ?? 0),
    });
  }

  // 4. email 검색 필터 (auth.users는 ilike 미지원 → 클라이언트 필터)
  let filteredProfiles = profiles ?? [];
  if (q) {
    const ql = q.toLowerCase();
    filteredProfiles = filteredProfiles.filter(p => {
      const auth = authMap.get(p.id);
      return (
        (p.full_name    ?? '').toLowerCase().includes(ql) ||
        (p.display_name ?? '').toLowerCase().includes(ql) ||
        (auth?.email    ?? '').toLowerCase().includes(ql)
      );
    });
  }

  const users = filteredProfiles.map((p: any) => {
    const auth  = authMap.get(p.id) ?? { email: '', last_sign_in_at: null };
    const quota = Array.isArray(p.ai_user_quotas) ? p.ai_user_quotas[0] : p.ai_user_quotas;
    const usage = usageMap.get(p.id) ?? { input_tokens: 0, output_tokens: 0, session_count: 0 };
    return {
      id:              p.id,
      email:           auth.email,
      full_name:       p.full_name,
      display_name:    p.display_name,
      role:            p.role,
      team:            p.team,
      avatar_url:      p.avatar_url,
      created_at:      p.created_at,
      last_sign_in_at: auth.last_sign_in_at,
      quota: quota ? {
        monthly_token_limit: quota.monthly_token_limit,
        daily_token_limit:   quota.daily_token_limit,
        is_blocked:          quota.is_blocked,
        note:                quota.note,
      } : { monthly_token_limit: null, daily_token_limit: null, is_blocked: false, note: null },
      usage_this_month: {
        input_tokens:  usage.input_tokens,
        output_tokens: usage.output_tokens,
        total_tokens:  usage.input_tokens + usage.output_tokens,
        session_count: usage.session_count,
      },
    };
  });

  return NextResponse.json({ users, total: count ?? users.length });
}
