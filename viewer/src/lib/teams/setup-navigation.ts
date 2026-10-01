import { safeAuthRedirect } from '@/lib/auth/oauth';

/** Preserve app deep links, never send an OAuth callback into another auth loop. */
export function safeTeamsSetupNext(value: unknown): string {
  const candidate = safeAuthRedirect(value);
  try {
    const url = new URL(candidate, 'https://uttu.invalid');
    let path = url.pathname;
    for (let i = 0; i < 3 && path.includes('%'); i++) path = decodeURIComponent(path);
    if (path.includes('%') || /[\\\u0000-\u0020\u007f]/.test(path) || path.startsWith('//')) return '/';
    path = new URL(path, 'https://uttu.invalid').pathname;
    if (/^\/(?:auth|api|setup|login|admin-login|signup)(?:\/|$)/i.test(path)) return '/';
    return candidate;
  } catch { return '/'; }
}

export function teamsSetupPath(next: unknown, attempted = false): string {
  const query = new URLSearchParams({ next: safeTeamsSetupNext(next) });
  if (attempted) query.set('attempted', '1');
  return `/setup/teams?${query}`;
}
