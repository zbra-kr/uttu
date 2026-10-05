'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { isAuthSessionMissingError } from '@supabase/supabase-js';
import { supabaseBrowser } from '@/lib/supabase/client';
import { parseProductObservation } from '@/lib/product-observation-context';
import { fetchObservationReviews, type ObservationReviewResult } from '@/lib/queries-product-observation-reviews';

export function useObservationReviews(query: string, today: string) {
  const parsed = useMemo(() => parseProductObservation(new URLSearchParams(query)), [query]);
  const available = parsed.kind === 'valid' && parsed.value.date <= today;
  const [selection, setSelection] = useState({ query, active: false, epoch: 0, today });
  if (selection.query !== query) setSelection({ query, active: false, epoch: selection.epoch + 1, today });
  const active = available && selection.query === query && selection.active;
  const activation = JSON.stringify([query, selection.epoch]);
  const activationToday = selection.today;
  const [authRetry, setAuthRetry] = useState(0), [attempt, setAttempt] = useState(0);
  const [auth, setAuth] = useState({ key: '', ready: false, error: false, user: null as string | null, epoch: 0 });
  const owner = useRef<{ user: string | null } | null>(null);
  const [loaded, setLoaded] = useState<{ scope: string; result: ObservationReviewResult | null; error: boolean } | null>(null);
  const scope = JSON.stringify([activation, auth.epoch, attempt]);
  useEffect(() => {
    if (!active) return;
    let cancelled = false, eventSeen = false;
    owner.current = null;
    const identity = (user: string | null) => {
      if (cancelled || owner.current?.user === user) return;
      owner.current = { user }; setLoaded(null);
      setAuth(previous => ({ key: activation, ready: true, error: false, user, epoch: previous.epoch + 1 }));
    };
    const client = supabaseBrowser();
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') return;
      eventSeen = true;
      // Auth is an external event: clear prior-owner source before the next paint.
      flushSync(() => identity(session?.user?.id ?? null));
    });
    void client.auth.getUser().then(({ data, error }) => {
      if (cancelled || eventSeen) return;
      if (error && !isAuthSessionMissingError(error)) throw error;
      identity(data.user?.id ?? null);
    }).catch(() => {
      if (!cancelled && !eventSeen) { owner.current = null; setLoaded(null);
        setAuth(previous => ({ key: activation, ready: true, error: true, user: null, epoch: previous.epoch + 1 })); }
    });
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, [active, activation, authRetry]);
  const verified = auth.key === activation && auth.ready;
  useEffect(() => {
    if (!active || !verified || auth.error || !auth.user || parsed.kind !== 'valid') { setLoaded(null); return; }
    let cancelled = false;
    const controller = new AbortController(), requestOwner = owner.current;
    setLoaded(null);
    void fetchObservationReviews(parsed.value, activationToday, controller.signal).then(result => {
      if (!cancelled && requestOwner === owner.current) setLoaded({ scope, result, error: false });
    }).catch(() => { if (!cancelled && requestOwner === owner.current) setLoaded({ scope, result: null, error: true }); });
    return () => { cancelled = true; controller.abort(); };
  }, [active, verified, auth.error, auth.user, parsed, activationToday, scope]);
  const current = loaded?.scope === scope ? loaded : null;
  const status = !active ? 'recent' : !verified ? 'loading' : auth.error ? 'error' : !auth.user ? 'signed-out'
    : !current ? 'loading' : current.error ? 'error' : current.result?.status ?? 'error';
  const activate = useCallback(() => { if (available) setSelection(previous => ({ query, active: true, epoch: previous.epoch + 1, today })); }, [query, available, today]);
  const recent = useCallback(() => setSelection(previous => ({ ...previous, active: false, epoch: previous.epoch + 1 })), []);
  const retry = useCallback(() => { if (auth.error) { setAuth(previous => ({ ...previous, ready: false })); setAuthRetry(n => n + 1); } else setAttempt(n => n + 1); }, [auth.error]);
  const result = status === 'ready' && current?.result?.status === 'ready' ? current.result.result : null;
  return useMemo(() => ({ query, available, active, status, result, activate, recent, retry, date: parsed.kind === 'valid' ? parsed.value.date : null }), [query, available, active, status, result, activate, recent, retry, parsed]);
}
