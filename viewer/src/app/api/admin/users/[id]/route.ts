import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth/require-admin';

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!,
);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { error, user } = await requireAdmin();
  if (error) return error;

  const targetId = params.id;
  const body: {
    profile?: { role?: string; display_name?: string | null; team?: string | null };
    quota?: { monthly_token_limit?: number | null; daily_token_limit?: number | null; is_blocked?: boolean; note?: string | null };
  } = await req.json().catch(() => ({}));

  // 본인 마지막 admin 강등 보호
  if (user!.id === targetId && body.profile?.role === 'viewer') {
    const { count } = await adminClient
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin');
    if ((count ?? 0) <= 1) {
      return NextResponse.json({ error: '시스템에 마지막 관리자는 강등할 수 없습니다.' }, { status: 400 });
    }
  }

  // profile 업데이트
  if (body.profile && Object.keys(body.profile).length > 0) {
    const { error: profErr } = await adminClient
      .from('profiles')
      .update(body.profile)
      .eq('id', targetId);
    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });
  }

  // quota upsert (사용자 quota row 없을 수도 있으므로 upsert)
  if (body.quota && Object.keys(body.quota).length > 0) {
    const { error: quotaErr } = await adminClient
      .from('ai_user_quotas')
      .upsert({ user_id: targetId, ...body.quota, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (quotaErr) return NextResponse.json({ error: quotaErr.message }, { status: 500 });
  }

  // 최신값 반환
  const { data: updated } = await adminClient
    .from('profiles')
    .select('id, full_name, display_name, role, team, ai_user_quotas(monthly_token_limit, daily_token_limit, is_blocked, note)')
    .eq('id', targetId)
    .single();

  return NextResponse.json({ ok: true, user: updated });
}
