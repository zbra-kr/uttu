import type { SignInWithOAuthCredentials } from '@supabase/supabase-js';

export const AUTH_ROUTES = {
  home: '/',
  login: '/login',
  callback: '/auth/callback',
} as const;

/** Accept only same-origin app paths, including a saved query string. */
export function safeAuthRedirect(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return AUTH_ROUTES.home;
  }
  // Backslashes/control characters can change URL parsing. Encoded separators at
  // the start are rejected too, rather than relying on a proxy's decoding rules.
  if (/[\\\u0000-\u0020\u007f]/.test(value) || /^\/(?:%2f|%5c)/i.test(value)) {
    return AUTH_ROUTES.home;
  }
  const base = 'https://uttu.invalid';
  const url = new URL(value, base);
  if (
    url.origin !== base || url.pathname.startsWith('//')
    || /^\/(?:%2f|%5c)/i.test(url.pathname)
    || url.pathname === AUTH_ROUTES.login || url.pathname === AUTH_ROUTES.callback
  ) {
    return AUTH_ROUTES.home;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Deployment-owned URL only: never derive the OAuth callback from form/Host input. */
export function microsoftOAuthCredentials(
  appUrl: string,
  next: unknown,
  production: boolean,
): SignInWithOAuthCredentials {
  const origin = new URL(appUrl);
  if (
    !['http:', 'https:'].includes(origin.protocol)
    || (production && origin.protocol !== 'https:')
    || origin.username || origin.password || origin.search || origin.hash
    || origin.pathname !== '/'
  ) {
    throw new Error('Invalid auth app origin');
  }
  const callback = new URL(AUTH_ROUTES.callback, origin);
  const destination = safeAuthRedirect(next);
  if (destination !== AUTH_ROUTES.home) callback.searchParams.set('next', destination);
  return {
    provider: 'azure',
    options: {
      scopes: 'email',
      redirectTo: callback.toString(),
      skipBrowserRedirect: true,
      // Do not force prompt=login: Entra controls SSO, MFA and Conditional Access.
    },
  };
}

export function authErrorMessage(error: unknown): string | undefined {
  if (error === 'cancelled') return 'Microsoft 로그인이 취소되었습니다. 다시 시도해 주세요.';
  if (error === 'auth') return '로그인을 완료하지 못했습니다. 다시 시도하거나 IT팀에 문의해 주세요.';
  return undefined;
}
