import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth/require-admin';

// service_role은 이 서버 API Route 에서만 사용 — 클라이언트 코드 절대 금지
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
  if (!id) return NextResponse.json({ error: 'id 필수' }, { status: 400 });

  let body: { corp_code: string; is_listed: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON 파싱 오류' }, { status: 400 });
  }

  const { corp_code, is_listed } = body;
  if (!corp_code) return NextResponse.json({ error: 'corp_code 필수' }, { status: 400 });

  try {
    const supabase = adminClient();

    // corp_code 중복 사전 확인 — 다른 회사에 이미 등록된 경우 409 반환
    const { data: existing } = await supabase
      .from('companies')
      .select('id, corp_name')
      .eq('corp_code', corp_code)
      .neq('id', id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        {
          error: `이 corp_code(${corp_code})는 이미 '${existing.corp_name}'에 등록되어 있습니다.`,
          existing_id: existing.id,
          existing_corp_name: existing.corp_name,
        },
        { status: 409 },
      );
    }

    const { data, error } = await supabase
      .from('companies')
      .update({
        corp_code,
        is_listed: is_listed ?? false,
        dart_fetched_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id, corp_name, corp_code, is_listed')
      .single();

    if (error) {
      console.error('[corp-code PATCH]', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
