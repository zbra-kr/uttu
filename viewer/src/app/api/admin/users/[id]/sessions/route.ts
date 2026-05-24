import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth/require-admin';

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!,
);

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requireAdmin();
  if (error) return error;

  const limit = Math.min(50, parseInt(req.nextUrl.searchParams.get('limit') ?? '10', 10));

  const { data, error: sessErr } = await adminClient
    .from('ai_sessions')
    .select('id, route, context, started_at, ended_at, message_count, input_tokens, output_tokens, title')
    .eq('user_id', params.id)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (sessErr) return NextResponse.json({ error: sessErr.message }, { status: 500 });

  const sessions = (data ?? []).map(s => ({
    ...s,
    ai_provider: null,
    ai_model: null,
  }));

  return NextResponse.json({ sessions });
}
