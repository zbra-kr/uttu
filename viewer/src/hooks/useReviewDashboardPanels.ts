'use client';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { fetchOwnProducts, fetchCsAnomalies } from '@/lib/queries';

export type DashboardPanelState = 'loading' | 'signedout' | 'ready' | 'error';
type Identity = { ready: boolean; userId: string | null; epoch: number };
type Reader<T> = (signal: AbortSignal) => Promise<T[]>;
const readProducts: Reader<Awaited<ReturnType<typeof fetchOwnProducts>>[number]> = signal => fetchOwnProducts(10, signal);
const readAnomalies: Reader<Awaited<ReturnType<typeof fetchCsAnomalies>>[number]> = signal => fetchCsAnomalies({ limit: 10 }, signal);

function usePanelRows<T>(auth: Identity, controllers: RefObject<Set<AbortController>>, reader: Reader<T>) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ epoch: number; attempt: number; state: 'ready' | 'error'; rows: T[] } | null>(null);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    if (!auth.userId) return;
    const controller = new AbortController(), active = controllers.current;
    active.add(controller);
    setLoaded(null);
    void reader(controller.signal).then(rows => {
      if (!controller.signal.aborted) setLoaded({ epoch: auth.epoch, attempt, state: 'ready', rows });
    }).catch(() => {
      if (!controller.signal.aborted) setLoaded({ epoch: auth.epoch, attempt, state: 'error', rows: [] });
    });
    return () => { controller.abort(); active.delete(controller); };
  }, [auth.userId, auth.epoch, attempt, controllers, reader]);
  const current = auth.userId && loaded?.epoch === auth.epoch && loaded.attempt === attempt ? loaded : null;
  const state: DashboardPanelState = !auth.ready ? 'loading' : !auth.userId ? 'signedout' : current?.state ?? 'loading';
  return { state, rows: current?.state === 'ready' ? current.rows : [], retry };
}

/** Both fixed-query panels share one identity subscription, but settle/retry independently. */
export function useReviewDashboardPanels() {
  const [auth, setAuth] = useState<Identity>({ ready: false, userId: null, epoch: 0 });
  const identityRef = useRef<{ ready: boolean; userId: string | null }>({ ready: false, userId: null });
  const controllers = useRef(new Set<AbortController>());
  useEffect(() => {
    let cancelled = false, eventSeen = false;
    const active = controllers.current;
    const identity = (userId: string | null) => {
      if (cancelled || (identityRef.current.ready && identityRef.current.userId === userId)) return;
      identityRef.current = { ready: true, userId };
      active.forEach(controller => controller.abort());
      setAuth(previous => ({ ready: true, userId, epoch: previous.epoch + 1 }));
    };
    const client = supabaseBrowser();
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      eventSeen = true; identity(session?.user?.id ?? null);
    });
    void client.auth.getUser().then(({ data, error }) => {
      if (!eventSeen) identity(error ? null : data.user?.id ?? null);
    }).catch(() => { if (!eventSeen) identity(null); });
    return () => { cancelled = true; active.forEach(controller => controller.abort()); subscription.unsubscribe(); };
  }, []);
  return { ownProducts: usePanelRows(auth, controllers, readProducts), csAnomalies: usePanelRows(auth, controllers, readAnomalies) };
}
