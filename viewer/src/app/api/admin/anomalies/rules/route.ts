import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth/require-admin';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!,
);

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const { data, error: dbErr } = await admin
    .from('detector_rules')
    .select('id, detector_key, label, module, severity, enabled, params, description, updated_at, updated_by')
    .order('module')
    .order('detector_key');

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  return NextResponse.json({ rules: data ?? [] });
}

export async function POST(req: NextRequest) {
  const { error, user } = await requireAdmin();
  if (error) return error;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: '잘못된 요청' }, { status: 400 });

  const { detector_key, label, module: mod, severity, params, description } = body;

  if (!detector_key || !label || !mod) {
    return NextResponse.json({ error: 'detector_key, label, module 필수' }, { status: 400 });
  }
  if (mod !== 'custom') {
    return NextResponse.json({ error: '사용자 추가 룰은 module=custom 만 허용' }, { status: 400 });
  }

  const { data, error: dbErr } = await admin
    .from('detector_rules')
    .insert({
      detector_key: detector_key.trim(),
      label:        label.trim(),
      module:       'custom',
      severity:     severity ?? 'medium',
      enabled:      true,
      params:       params ?? {},
      description:  description ?? null,
      updated_at:   new Date().toISOString(),
      updated_by:   user.id,
    })
    .select()
    .single();

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  return NextResponse.json({ rule: data }, { status: 201 });
}
