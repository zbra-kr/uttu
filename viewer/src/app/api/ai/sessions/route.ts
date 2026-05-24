import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

export async function GET() {
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

  if (!userId) return Response.json({ sessions: [] });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) return Response.json({ sessions: [] });

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey);
  const { data } = await supabase
    .from('ai_sessions')
    .select('id, title, route, started_at, message_count')
    .eq('user_id', userId)
    .gt('message_count', 0)
    .order('started_at', { ascending: false })
    .limit(60);

  return Response.json({ sessions: data ?? [] });
}
