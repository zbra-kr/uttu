import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth/require-admin';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!,
);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { error, user } = await requireAdmin();
  if (error) return error;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: '잘못된 요청' }, { status: 400 });

  const allowed: Record<string, unknown> = {};
  if (typeof body.enabled    === 'boolean') allowed.enabled    = body.enabled;
  if (typeof body.severity   === 'string')  allowed.severity   = body.severity;
  if (typeof body.label      === 'string')  allowed.label      = body.label.trim();
  if (typeof body.description=== 'string')  allowed.description= body.description;
  if (body.params !== undefined)            allowed.params     = body.params;

  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: '변경 항목 없음' }, { status: 400 });
  }

  allowed.updated_at = new Date().toISOString();
  allowed.updated_by = user.id;

  const { data, error: dbErr } = await admin
    .from('detector_rules')
    .update(allowed)
    .eq('id', params.id)
    .select()
    .single();

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  return NextResponse.json({ rule: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requireAdmin();
  if (error) return error;

  // 커스텀 룰만 삭제 허용
  const { data: existing } = await admin
    .from('detector_rules')
    .select('module')
    .eq('id', params.id)
    .single();

  if (!existing) return NextResponse.json({ error: '룰을 찾을 수 없음' }, { status: 404 });
  if (existing.module !== 'custom') {
    return NextResponse.json({ error: '기본 제공 룰은 삭제할 수 없습니다' }, { status: 403 });
  }

  const { error: dbErr } = await admin
    .from('detector_rules')
    .delete()
    .eq('id', params.id);

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
