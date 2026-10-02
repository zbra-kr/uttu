import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { readTeamsSetupAccess, teamsSetupRequired } from '@/lib/teams/setup-access';
import { teamsSetupPath } from '@/lib/teams/setup-navigation';
import { compactNoteAuthReturn } from '@/lib/notes/auth-return';
import { tourReturnPath } from '@/lib/onboarding/navigation';

const PUBLIC_PATHS = new Set(['/login', '/admin-login', '/signup', '/forgot-password']);
const PUBLIC_PREFIXES = ['/auth/callback', '/auth/teams/callback', '/reset-password', '/api/stats', '/api/mcp'];
const SETUP_PATHS = new Set(['/setup/teams', '/api/me/teams/connection', '/api/auth/local-signout']);

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet: { name: string; value: string; options: CookieOptions }[]) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;

  // Clearing only this browser session must still work after it expires.
  if (pathname === '/api/auth/local-signout') return response;

  // 공개 prefix 경로 (auth callback 등): 세션 갱신만
  if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) {
    return response;
  }

  // 공개 완전일치 경로
  if (PUBLIC_PATHS.has(pathname)) {
    // 관리자 계정 전환은 현재 세션을 유지한 채 시도할 수 있습니다.
    if (user && pathname !== '/admin-login') return NextResponse.redirect(new URL('/', request.url));
    return response;
  }

  // 나머지 모든 경로: 로그인 필수
  if (!user) {
    const url = new URL('/login', request.url);
    url.searchParams.set('redirect', compactNoteAuthReturn(`${pathname}${request.nextUrl.search}`));
    return NextResponse.redirect(url);
  }

  if (teamsSetupRequired() && !SETUP_PATHS.has(pathname)) {
    let allowed = false;
    try { allowed = (await readTeamsSetupAccess(supabase, user)).decision.allowed; }
    catch { /* A failed status check never silently releases a non-admin. */ }
    if (!allowed) {
      const destination = teamsSetupPath(tourReturnPath(`${pathname}${request.nextUrl.search}`));
      const blocked = pathname.startsWith('/api/')
        ? NextResponse.json({ error: 'teams_setup_required', setup_url: destination },
          { status: 428, headers: { 'Cache-Control': 'no-store' } })
        : NextResponse.redirect(new URL(destination, request.url));
      // Keep any refreshed Supabase session cookies on the setup response.
      response.cookies.getAll().forEach(cookie => blocked.cookies.set(cookie));
      blocked.headers.set('Cache-Control', 'no-store');
      return blocked;
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|html)$).*)',
  ],
};
