import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth/require-admin';

function adminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY 미설정');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key);
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const { error } = await requireAdmin();
  if (error) return error;
  try {
    const { company_id, confirmed = true } = await req.json() as { company_id: string | null; confirmed?: boolean };
    const { data, error } = await adminClient()
      .from('brands')
      .update({ company_id, company_confirmed: confirmed })
      .eq('id', params.id)
      .select('id, name, company_id, company_confirmed')
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
