import { supabaseServer } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { AUTH_ROUTES, safeAuthRedirect } from '@/lib/auth/oauth';
import { syncMicrosoftProfileName } from '@/lib/auth/microsoft-profile';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeAuthRedirect(searchParams.get('next'));
  const providerError = searchParams.get('error');

  if (code && !providerError) {
    try {
      const supabase = await supabaseServer();
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        if (await syncMicrosoftProfileName(supabase, data?.user) === 'failed') {
          console.warn('[auth] Microsoft profile name sync failed');
        }
        return NextResponse.redirect(new URL(next, origin));
      }
    } catch {
      // Do not expose provider errors, authorization codes or tokens in the UI/log.
    }
  }

  const login = new URL(AUTH_ROUTES.login, origin);
  login.searchParams.set('error', providerError === 'access_denied' ? 'cancelled' : 'auth');
  if (next !== AUTH_ROUTES.home) login.searchParams.set('redirect', next);
  return NextResponse.redirect(login);
}
