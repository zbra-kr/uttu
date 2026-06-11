import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth/require-admin';

function adminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY 미설정');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key);
}

export async function POST(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;
  try {
    const { corp_name, business_number, include_dart } = await req.json() as {
      corp_name: string; business_number?: string; include_dart?: boolean;
    };
    if (!corp_name?.trim()) return NextResponse.json({ error: '법인명은 필수입니다' }, { status: 400 });

    const row: Record<string, unknown> = { corp_name: corp_name.trim() };
    if (business_number?.trim()) row.business_number = business_number.replace(/\D/g, '').slice(0, 10);
    if (include_dart) row.dart_fetched_at = new Date().toISOString();

    const { data, error } = await adminClient()
      .from('companies')
      .insert(row)
      .select('id, corp_name, business_number')
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e: any) {
    const msg: string = e.message ?? String(e);
    const status = msg.includes('unique') || msg.includes('duplicate') ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
