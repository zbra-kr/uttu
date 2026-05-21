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
    const { skip } = await req.json() as { skip: boolean };
    const { data, error } = await adminClient()
      .from('brands')
      .update({ company_skip: skip })
      .eq('id', params.id)
      .select('id, name, company_skip')
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
