import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function adminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY 미설정');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key);
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const { remark } = await req.json() as { remark: string | null };
    const { data, error } = await adminClient()
      .from('brands')
      .update({ remark: remark || null })
      .eq('id', params.id)
      .select('id, remark')
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
