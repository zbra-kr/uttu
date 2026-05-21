import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = new Set(['/login', '/signup']);
const PUBLIC_PREFIXES = ['/auth/callback', '/reset-password'];

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

  // 공개 prefix 경로 (auth callback 등): 세션 갱신만
  if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) {
    return response;
  }

  // 공개 완전일치 경로
  if (PUBLIC_PATHS.has(pathname)) {
    // 이미 로그인됐으면 앱으로
    if (user) return NextResponse.redirect(new URL('/', request.url));
    return response;
  }

  // 나머지 모든 경로: 로그인 필수
  if (!user) {
    const url = new URL('/login', request.url);
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
