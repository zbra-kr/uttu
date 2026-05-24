import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  if (!sessionId) return Response.json({ messages: [] });

  let userId: string | null = null;
  try {
    const cookieStore = cookies();
    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (name) => cookieStore.get(name)?.value } },
    );
    const { data: { user } } = await supabaseAuth.auth.getUser();
    userId = user?.id ?? null;
  } catch {}

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) return Response.json({ messages: [] });

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey);

  // 세션 소유권 확인
  const { data: session } = await supabase
    .from('ai_sessions')
    .select('user_id')
    .eq('id', sessionId)
    .maybeSingle();

  if (!session) return Response.json({ messages: [] });
  if (userId && session.user_id !== userId) return Response.json({ messages: [] });

  const { data } = await supabase
    .from('ai_messages')
    .select('sequence_no, role, content, tool_calls')
    .eq('session_id', sessionId)
    .order('sequence_no', { ascending: true });

  return Response.json({ messages: data ?? [] });
}
