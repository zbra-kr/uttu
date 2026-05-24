import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

function todayKST(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

function monthStartKST(): string {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  return `${kst.getFullYear()}-${String(kst.getMonth() + 1).padStart(2, '0')}-01`;
}

export async function GET() {
  const cookieStore = cookies();
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name) => cookieStore.get(name)?.value } },
  );
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) return NextResponse.json({ error: 'DB 미설정' }, { status: 500 });
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey);

  const [{ data: quota }, { data: dailyRow }, { data: monthlyRows }] = await Promise.all([
    supabase
      .from('ai_user_quotas')
      .select('monthly_token_limit, daily_token_limit, is_blocked, note')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('ai_usage_daily')
      .select('input_tokens, output_tokens')
      .eq('user_id', user.id)
      .eq('usage_date', todayKST())
      .maybeSingle(),
    supabase
      .from('ai_usage_daily')
      .select('input_tokens, output_tokens')
      .eq('user_id', user.id)
      .gte('usage_date', monthStartKST()),
  ]);

  const usedToday   = (dailyRow?.input_tokens ?? 0) + (dailyRow?.output_tokens ?? 0);
  const usedMonthly = (monthlyRows ?? []).reduce(
    (s: number, r: { input_tokens: number; output_tokens: number }) =>
      s + (r.input_tokens ?? 0) + (r.output_tokens ?? 0),
    0,
  );

  return NextResponse.json({
    quota: {
      monthly_token_limit: quota?.monthly_token_limit ?? null,
      daily_token_limit:   quota?.daily_token_limit   ?? null,
      is_blocked:          quota?.is_blocked           ?? false,
      note:                quota?.note                 ?? null,
    },
    usage: {
      used_today:   usedToday,
      used_monthly: usedMonthly,
    },
  });
}
