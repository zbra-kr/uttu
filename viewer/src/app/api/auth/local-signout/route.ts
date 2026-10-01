import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { isSameOriginPost } from '@/lib/teams/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let origin: string;
  try { origin = new URL(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || '').origin; }
  catch { return NextResponse.json({ error: 'configuration_unavailable' }, { status: 503 }); }
  if (!isSameOriginPost(request, origin)) return NextResponse.json({ error: 'invalid_request' }, { status: 403 });
  try {
    const sb = await supabaseServer();
    const { error } = await sb.auth.signOut({ scope: 'local' });
    if (error) return NextResponse.json({ error: 'signout_failed' }, { status: 503 });
    return NextResponse.json({ url: '/login' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'signout_failed' }, { status: 503 }); }
}
