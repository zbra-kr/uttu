import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
  const { id } = params;
  let body: { parent_company_id: string | null };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'JSON 파싱 오류' }, { status: 400 });
  }

  const parentId = body.parent_company_id ?? null;

  if (parentId === id) {
    return NextResponse.json({ error: '자기 자신을 모회사로 설정할 수 없습니다' }, { status: 400 });
  }

  try {
    const supabase = adminClient();
    const { data, error } = await supabase
      .from('companies')
      .update({ parent_company_id: parentId })
      .eq('id', id)
      .select('id, corp_name, parent_company_id')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
