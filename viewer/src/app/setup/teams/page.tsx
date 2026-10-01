import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTeamsSetupContext } from '@/lib/teams/setup-context';
import { safeTeamsSetupNext } from '@/lib/teams/setup-navigation';
import TeamsSetupClient from './TeamsSetupClient';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Teams 연결 · UTTU' };

export default async function TeamsSetupPage({ searchParams = {} }: {
  searchParams?: { next?: string | string[]; error?: string | string[]; attempted?: string | string[] };
}) {
  const nextPath = safeTeamsSetupNext(searchParams.next);
  const initialError = searchParams.error === 'oauth';
  const context = await getTeamsSetupContext();

  if (!context.user) redirect(`/login?redirect=${encodeURIComponent(nextPath)}`);
  if (context.decision.allowed) {
    // A callback query string is not proof of a saved connection. Only the
    // server's verified decision permits entering the app.
    redirect(initialError ? '/me?teams=failed' : nextPath);
  }

  return <TeamsSetupClient
    nextPath={nextPath}
    reason={context.decision.reason}
    canConnect={context.canConnect}
    initialError={initialError}
    attempted={searchParams.attempted !== undefined}
  />;
}
