import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { teamsConfig } from '@/lib/teams/config';
import { completeTeamsConnect, connectCookie, teamsConnectReturnPath } from '@/lib/teams/oauth';
import { teamsSetupRequired } from '@/lib/teams/setup-access';
import { safeTeamsSetupNext, teamsSetupPath } from '@/lib/teams/setup-navigation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const config = teamsConfig();
  // Fixed relative destination: never reflect a provider-supplied return URL/error.
  const origin = config?.origin ?? request.nextUrl.origin;
  let destination = new URL(teamsSetupRequired() ? teamsSetupPath('/me', true) : '/me?teams=failed', origin);
  if (teamsSetupRequired()) destination.searchParams.set('error', 'oauth');
  try {
    if (!config) throw new Error();
    const state = request.nextUrl.searchParams.get('state');
    const code = request.nextUrl.searchParams.get('code');
    const attempt = request.cookies.get(connectCookie(config.secure))?.value;
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error();
    if (teamsSetupRequired() && state && attempt) {
      destination = new URL(teamsSetupPath(teamsConnectReturnPath(user, config, attempt, state), true), origin);
      destination.searchParams.set('error', 'oauth');
    }
    if (request.nextUrl.searchParams.has('error') || !state || !code || !attempt) throw new Error();
    const next = safeTeamsSetupNext(await completeTeamsConnect(sb, user, config, attempt, state, code) ?? '/me');
    destination = new URL(next, origin);
    if (destination.pathname === '/me') destination.searchParams.set('teams', 'connected');
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
