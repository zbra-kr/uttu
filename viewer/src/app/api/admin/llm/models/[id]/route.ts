import { requireAdmin } from '@/lib/auth/require-admin';
import { NextRequest, NextResponse } from 'next/server';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { error, ss } = await requireAdmin();
  if (error) return error;

  const { id } = params;
  const patch = await req.json() as {
    is_active?:    boolean;
    is_default?:   boolean;
    display_name?: string;
    max_tokens?:   number | null;
  };

  // is_active=true 시 API key 확인
  if (patch.is_active === true) {
    const { data: model } = await ss
      .from('ai_allowed_models')
      .select('provider')
      .eq('id', id)
      .single();

    const keyMissing =
      (model?.provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) ||
      (model?.provider === 'openai'    && !process.env.OPENAI_API_KEY)    ||
      (model?.provider === 'google'    && !process.env.GEMINI_API_KEY);

    if (keyMissing) {
      return NextResponse.json(
        { error: `${model?.provider} API key 미설정 — 활성화 불가` },
        { status: 400 },
      );
    }
  }

  // is_default=true 이면 기존 default 해제
  if (patch.is_default === true) {
    await ss.from('ai_allowed_models').update({ is_default: false }).eq('is_default', true);
  }

  const { error: updateErr } = await ss
    .from('ai_allowed_models')
    .update(patch)
    .eq('id', id);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { error, ss } = await requireAdmin();
  if (error) return error;

  const { id } = params;

  const { data: model } = await ss
    .from('ai_allowed_models')
    .select('is_default, model_id')
    .eq('id', id)
    .single();

  if (model?.is_default) {
    return NextResponse.json(
      { error: '기본 모델은 삭제 불가 — 다른 모델을 기본으로 지정 후 삭제해 주세요' },
      { status: 400 },
    );
  }

  const { error: delErr } = await ss.from('ai_allowed_models').delete().eq('id', id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
