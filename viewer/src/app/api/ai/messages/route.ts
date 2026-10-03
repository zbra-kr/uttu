import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { isUuid } from '@/lib/ai/session-access';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  if (!isUuid(sessionId)) return Response.json({ error: 'invalid_request' }, { status: 400 });

  let userId: string | null = null;
  try {
    const cookieStore = await cookies();
    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (name) => cookieStore.get(name)?.value } },
    );
    const { data: { user }, error } = await supabaseAuth.auth.getUser();
    userId = error ? null : user?.id ?? null;
  } catch {}

  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) return Response.json({ messages: [] });

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey);

  // 세션 소유권 확인
  const { data: session, error: sessionError } = await supabase
    .from('ai_sessions')
    .select('user_id')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .maybeSingle();

  if (sessionError) return Response.json({ error: 'service_unavailable' }, { status: 503 });
  if (!session) return Response.json({ messages: [] });
  if (session.user_id !== userId) return Response.json({ messages: [] });

  const { data } = await supabase
    .from('ai_messages')
    .select('sequence_no, role, content, tool_calls')
    .eq('session_id', sessionId)
    .order('sequence_no', { ascending: true });

  return Response.json({ messages: data ?? [] });
}
