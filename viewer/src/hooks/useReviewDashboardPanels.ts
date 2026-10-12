'use client';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { fetchOwnProducts, fetchCsAnomalies } from '@/lib/queries';

export type DashboardPanelState = 'loading' | 'signedout' | 'autherror' | 'ready' | 'error';
type Identity = { ready: boolean; userId: string | null; epoch: number; error: boolean };
type Reader<T> = (signal: AbortSignal) => Promise<T[]>;
const readProducts: Reader<Awaited<ReturnType<typeof fetchOwnProducts>>[number]> = signal => fetchOwnProducts(10, signal);
const readAnomalies: Reader<Awaited<ReturnType<typeof fetchCsAnomalies>>[number]> = signal => fetchCsAnomalies({ limit: 10 }, signal);

function usePanelRows<T>(auth: Identity, controllers: RefObject<Set<AbortController>>, reader: Reader<T>, retryIdentity: () => void) {
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
  const state: DashboardPanelState = auth.error ? 'autherror' : !auth.ready ? 'loading' : !auth.userId ? 'signedout' : current?.state ?? 'loading';
  return { state, rows: current?.state === 'ready' ? current.rows : [], retry: auth.error ? retryIdentity : retry };
}

/** Both fixed-query panels share one identity subscription, but settle/retry independently. */
export function useReviewDashboardPanels() {
  const [auth, setAuth] = useState<Identity>({ ready: false, userId: null, epoch: 0, error: false });
  const identityRef = useRef<{ ready: boolean; userId: string | null }>({ ready: false, userId: null });
  const controllers = useRef(new Set<AbortController>());
  const authRead = useRef<(() => void) | null>(null);
  const retryIdentity = useCallback(() => authRead.current?.(), []);
  useEffect(() => {
    let cancelled = false, eventSeen = false, version = 0, pending = false;
    const active = controllers.current;
    const identity = (userId: string | null) => {
      if (cancelled || (identityRef.current.ready && identityRef.current.userId === userId)) return;
      identityRef.current = { ready: true, userId };
      active.forEach(controller => controller.abort());
      setAuth(previous => ({ ready: true, userId, epoch: previous.epoch + 1, error: false }));
    };
    const client = supabaseBrowser();
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      eventSeen = true; version++; pending = false; identity(session?.user?.id ?? null);
    });
    const readIdentity = () => {
      if (cancelled || pending) return;
      pending = true;
      const request = ++version;
      identityRef.current = { ready: false, userId: null };
      active.forEach(controller => controller.abort());
      setAuth(previous => ({ ready: false, userId: null, epoch: previous.epoch + 1, error: false }));
      const fail = () => {
        if (!cancelled && request === version) setAuth(previous => ({ ...previous, ready: false, userId: null, error: true }));
      };
      // Promise boundary also handles a synchronous SDK exception.
      void Promise.resolve().then(() => client.auth.getUser()).then(({ data, error }) => {
        if (cancelled || request !== version) return;
        if (error) fail(); else identity(data.user?.id ?? null);
      }).catch(fail).finally(() => { if (request === version) pending = false; });
    };
    authRead.current = readIdentity;
    if (!eventSeen) readIdentity();
    return () => { cancelled = true; authRead.current = null; active.forEach(controller => controller.abort()); subscription.unsubscribe(); };
  }, []);
  return { ownProducts: usePanelRows(auth, controllers, readProducts, retryIdentity), csAnomalies: usePanelRows(auth, controllers, readAnomalies, retryIdentity) };
}
