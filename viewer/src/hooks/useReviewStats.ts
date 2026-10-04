'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { fetchReviewStats, type ReviewStats } from '@/lib/queries';

type Result = { days: number; epoch: number } & (
  | { state: 'ready'; stats: ReviewStats }
  | { state: 'error'; stats: null }
);

export function useReviewStats(days: number) {
  const [auth, setAuth] = useState<{ ready: boolean; userId: string | null; epoch: number }>({ ready: false, userId: null, epoch: 0 });
  const identityRef = useRef<{ ready: boolean; userId: string | null }>({ ready: false, userId: null });
  const currentRead = useRef<AbortController | null>(null);
  const [loaded, setLoaded] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    let cancelled = false, eventSeen = false;
    const readRef = currentRead;
    const identity = (userId: string | null) => {
      if (cancelled || (identityRef.current.ready && identityRef.current.userId === userId)) return;
      identityRef.current = { ready: true, userId };
      readRef.current?.abort();
      setLoaded(null);
      setAuth(previous => ({ ready: true, userId, epoch: previous.epoch + 1 }));
    };
    const client = supabaseBrowser();
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      eventSeen = true; identity(session?.user?.id ?? null);
    });
    void client.auth.getUser().then(({ data, error }) => {
      if (!eventSeen) identity(error ? null : data.user?.id ?? null);
    }).catch(() => { if (!eventSeen) identity(null); });
    return () => { cancelled = true; readRef.current?.abort(); subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!auth.userId) return;
    const controller = new AbortController();
    currentRead.current = controller;
    setLoaded(null);
    void fetchReviewStats(days, controller.signal).then(stats => {
      if (!controller.signal.aborted) setLoaded({ days, epoch: auth.epoch, state: 'ready', stats });
    }).catch(() => {
      if (!controller.signal.aborted) setLoaded({ days, epoch: auth.epoch, state: 'error', stats: null });
    });
    return () => { controller.abort(); if (currentRead.current === controller) currentRead.current = null; };
  }, [days, auth.userId, auth.epoch, attempt]);

  const current = auth.userId && loaded?.days === days && loaded.epoch === auth.epoch ? loaded : null;
  const state = !auth.ready ? 'loading' : !auth.userId ? 'signedout' : current?.state ?? 'loading';
  return { state, stats: current?.state === 'ready' ? current.stats : null, retry };
}
