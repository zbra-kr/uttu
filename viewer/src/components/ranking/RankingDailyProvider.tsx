'use client';
import React from 'react';
import { usePathname } from 'next/navigation';
import { useIsMobile } from '@/hooks/useViewport';
import { supabaseBrowser } from '@/lib/supabase/client';
import { fetchRankingDaily } from '@/lib/queries-ranking-daily';
import { createDailyRankingSession, type DailyRankingSession } from '@/lib/ranking-daily-session';

const Context = React.createContext<DailyRankingSession | null>(null);
export const useRankingDailySession = () => React.useContext(Context);

/** Stable above the responsive shell; identity comes only from the normal SDK lifecycle. */
export default function RankingDailyProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const mobile = useIsMobile();
  const active = pathname === '/ranking' || pathname === '/today' || (pathname === '/' && mobile);
  const [session] = React.useState(() => createDailyRankingSession(fetchRankingDaily));
  React.useEffect(() => {
    if (!active) { session.leave(); return; }
    session.enter();
    let cancelled = false, authEventSeen = false;
    const client = supabaseBrowser();
    const { data: { subscription } } = client.auth.onAuthStateChange((event, authSession) => {
      if (cancelled) return;
      authEventSeen = true;
      // No SDK calls or credential access in the callback; an auth epoch invalidates old reads.
      session.identity(authSession?.user.id ?? null, event !== 'INITIAL_SESSION');
    });
    void client.auth.getUser().then(({ data }) => {
      if (!cancelled && !authEventSeen) session.identity(data.user?.id ?? null);
    }).catch(() => { if (!cancelled && !authEventSeen) session.identity(null); });
    return () => { cancelled = true; subscription.unsubscribe(); session.leave(); };
  }, [active, session]);
  return <Context.Provider value={session}>{children}</Context.Provider>;
}
