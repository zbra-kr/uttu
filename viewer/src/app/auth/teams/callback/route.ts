import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { teamsConfig } from '@/lib/teams/config';
import { completeTeamsConnect, connectCookie } from '@/lib/teams/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const config = teamsConfig();
  // Fixed relative destination: never reflect a provider-supplied return URL/error.
  const destination = new URL('/me?teams=failed', config?.origin ?? request.nextUrl.origin);
  try {
    if (!config) throw new Error();
    const state = request.nextUrl.searchParams.get('state');
    const code = request.nextUrl.searchParams.get('code');
    const attempt = request.cookies.get(connectCookie(config.secure))?.value;
    if (request.nextUrl.searchParams.has('error') || !state || !code || !attempt) throw new Error();
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error();
    await completeTeamsConnect(sb, user, config, attempt, state, code);
    destination.searchParams.set('teams', 'connected');
  } catch { /* Credentials, codes, tokens and provider errors are never logged. */ }
  const response = NextResponse.redirect(destination, 303);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  for (const secure of [true, false]) {
    response.cookies.set(connectCookie(secure), '', {
      httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 0,
    });
  }
  return response;
}
