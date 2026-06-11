import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth/require-admin';

function adminClient() {
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY 미설정');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { error: authErr } = await requireAdmin();
  if (authErr) return authErr;
  const { id } = params;
  let body: { skip: boolean };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'JSON 파싱 오류' }, { status: 400 });
  }

  try {
    const supabase = adminClient();
    const { data, error } = await supabase
      .from('companies')
      .update({ dart_skip: body.skip })
      .eq('id', id)
      .select('id, corp_name, dart_skip')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
