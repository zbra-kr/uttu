import { requireAdmin } from '@/lib/auth/require-admin';
import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  const { error, ss } = await requireAdmin();
  if (error) return error;

  const { data: models, error: dbErr } = await ss
    .from('ai_allowed_models')
    .select('*')
    .order('created_at');

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  return NextResponse.json({ models: models ?? [] });
}

export async function POST(req: NextRequest) {
  const { error, ss } = await requireAdmin();
  if (error) return error;

  const body = await req.json() as {
    provider: string;
    model_id: string;
    display_name: string;
    is_default?: boolean;
    is_active?: boolean;
    max_tokens?: number | null;
  };

  const { provider, model_id, display_name } = body;
  if (!provider || !model_id || !display_name) {
    return NextResponse.json({ error: 'provider, model_id, display_name 필수' }, { status: 400 });
  }

  // API key 확인
  const keyMissing =
    (provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) ||
    (provider === 'openai'    && !process.env.OPENAI_API_KEY)    ||
    (provider === 'google'    && !process.env.GEMINI_API_KEY);

  if (keyMissing) {
    return NextResponse.json({ error: `${provider} API key 미설정 — Vercel 환경변수 추가 필요` }, { status: 400 });
  }

  // is_default=true 이면 기존 default 해제
  if (body.is_default) {
    await ss.from('ai_allowed_models').update({ is_default: false }).eq('is_default', true);
  }

  const { data, error: insErr } = await ss
    .from('ai_allowed_models')
    .insert({
      provider,
      model_id,
      display_name,
      is_default:  body.is_default  ?? false,
      is_active:   body.is_active   ?? true,
      max_tokens:  body.max_tokens  ?? null,
    })
    .select()
    .single();

  if (insErr) {
    if (insErr.code === '23505') {
      return NextResponse.json({ error: '이미 등록된 model_id입니다' }, { status: 400 });
    }
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ model: data }, { status: 201 });
}
