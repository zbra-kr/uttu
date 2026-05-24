import { supabaseServer } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function PATCH(req: NextRequest) {
  const ss = await supabaseServer();
  const { data: { user } } = await ss.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { model_id } = await req.json() as { model_id: string | null };

  if (model_id !== null) {
    const { data: m } = await ss
      .from('ai_allowed_models')
      .select('is_active')
      .eq('model_id', model_id)
      .maybeSingle();

    if (!m?.is_active) {
      return NextResponse.json({ error: '비활성 또는 존재하지 않는 모델' }, { status: 400 });
    }
  }

  const { error } = await ss
    .from('profiles')
    .update({ preferred_model: model_id })
    .eq('id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
