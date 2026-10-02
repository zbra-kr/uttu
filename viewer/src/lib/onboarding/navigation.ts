import { safeTeamsSetupNext } from '@/lib/teams/setup-navigation';

export const TOUR_RETURN_PARAM = 'uttu_tour_return';
const TOUR_PAGES = new Set(['/ranking', '/me']);
const BASE = 'https://uttu.invalid';

/** This controls only a safe return destination; it never authorizes access. */
export function tourReturnPath(current: string): string {
  const url = new URL(current, BASE);
  if (!TOUR_PAGES.has(url.pathname)) return current;
  const returns = url.searchParams.getAll(TOUR_RETURN_PARAM);
  url.searchParams.delete(TOUR_RETURN_PARAM);
  const fallback = `${url.pathname}${url.search}${url.hash}`;
  if (returns.length !== 1 || returns[0].length > 8192) return fallback;
  const origin = new URL(safeTeamsSetupNext(returns[0]), BASE);
  // Never propagate nested return markers through another tour/setup cycle.
  origin.searchParams.delete(TOUR_RETURN_PARAM);
  return `${origin.pathname}${origin.search}${origin.hash}`;
}

export function tourNavigationPath(destination: string, origin: string): string {
  const url = new URL(destination, BASE);
  if (!TOUR_PAGES.has(url.pathname)) return destination;
  url.searchParams.set(TOUR_RETURN_PARAM, safeTeamsSetupNext(origin));
  return `${url.pathname}${url.search}${url.hash}`;
}
