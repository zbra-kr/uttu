import { supabaseServer } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  const ss = await supabaseServer();
  const { data: { user } } = await ss.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const [modelsRes, profRes] = await Promise.all([
    ss.from('ai_allowed_models')
      .select('id, provider, model_id, display_name, is_default')
      .eq('is_active', true)
      .order('created_at'),
    ss.from('profiles')
      .select('preferred_model')
      .eq('id', user.id)
      .single(),
  ]);

  const models = modelsRes.data ?? [];
  const preferred = profRes.data?.preferred_model ?? null;

  // resolve current: preferred (if still active) → default → null
  const activeModelIds = new Set(models.map((m) => m.model_id));
  const current =
    (preferred && activeModelIds.has(preferred))
      ? preferred
      : (models.find((m) => m.is_default)?.model_id ?? null);

  return NextResponse.json({ models, current });
}
