'use client';
import React from 'react';
import { isAuthSessionMissingError } from '@supabase/supabase-js';
import { supabaseBrowser } from '@/lib/supabase/client';
import { startFundingRead as startRead, FundingReadTimeoutError } from '@/lib/funding-read';

/** The shared deadline bounds UI waiting; cancellation cannot prove backend cancellation. */
export function useBriefingScope(context: string) {
  const [identity, setIdentity] = React.useState<string | null | undefined>();
  const [authError, setAuthError] = React.useState(false);
  const [, render] = React.useState(0);
  const [attempt, setAttempt] = React.useState(0);
  const current = React.useRef({ context, identity, revision: 0, alive: true });
  if (current.current.context !== context) { current.current.context = context; current.current.revision++; }
  React.useEffect(() => {
    const value = current.current; value.alive = true;
    let active = true, eventSeen = false;
    const client = supabaseBrowser();
    const publish = (id: string | null) => {
      if (value.identity !== id) value.revision++;
      value.identity = id; setIdentity(id); setAuthError(false); render(value.revision);
    };
    const read = startRead(() => client.auth.getUser());
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (!active || event === 'INITIAL_SESSION') return;
      eventSeen = true; publish(session?.user.id ?? null); read.cancel();
    });
    void read.promise.then(({ data, error }) => {
      if (!active || eventSeen) return;
      if (error && !isAuthSessionMissingError(error)) throw error;
      publish(data.user?.id ?? null);
    }).catch(() => { if (active && !eventSeen) setAuthError(true); });
    return () => { active = false; value.alive = false; read.cancel(); subscription.unsubscribe(); };
  }, [attempt]);
  const retryAuth = React.useCallback(() => {
    current.current.identity = undefined; current.current.revision++;
    setIdentity(undefined); setAuthError(false); setAttempt(v => v + 1);
  }, []);
  const key = identity ? JSON.stringify([context, identity, current.current.revision]) : null;
  const isCurrent = React.useCallback((expected: string) => {
    const value = current.current;
    return value.alive && JSON.stringify([value.context, value.identity, value.revision]) === expected;
  }, []);
  return { key, isCurrent, authError, signedOut: identity === null, retryAuth };
}
export type BriefingScope = ReturnType<typeof useBriefingScope>;

export function useBriefingRead<T>(scope: BriefingScope, reader: (signal: AbortSignal) => Promise<T>, enabled = true) {
  const { key, isCurrent } = scope;
  const [state, setState] = React.useState<{ key: string | null; value: T | null; loaded: boolean; loading: boolean; error: boolean; timedOut: boolean }>({ key: null, value: null, loaded: false, loading: false, error: false, timedOut: false });
  const version = React.useRef(0), flight = React.useRef<ReturnType<typeof startRead> | null>(null);
  const refresh = React.useCallback(async () => {
    if (!enabled || !key || !isCurrent(key) || flight.current) return;
    const revision = ++version.current, valid = () => isCurrent(key) && version.current === revision;
    setState(old => old.key === key ? { ...old, loading: true, error: false, timedOut: false } : { key, value: null, loaded: false, loading: true, error: false, timedOut: false });
    const read = startRead(reader); flight.current = read;
    try { const value = await read.promise; if (valid()) setState({ key, value, loaded: true, loading: false, error: false, timedOut: false }); }
    catch (error) { if (valid()) setState(old => ({ ...old, loading: false, error: true, timedOut: error instanceof FundingReadTimeoutError })); }
    finally { if (flight.current === read) flight.current = null; }
  }, [enabled, key, isCurrent, reader]);
  React.useEffect(() => {
    void refresh(); const counter = version, active = flight;
    return () => { counter.current++; active.current?.cancel(); active.current = null; };
  }, [refresh]);
  const visible = enabled && key && state.key === key;
  return { value: visible ? state.value : null, loaded: !!visible && state.loaded,
    loading: enabled && !scope.signedOut && !scope.authError && (!visible || state.loading),
    error: enabled && (scope.authError || (!!visible && state.error)), timedOut: !!visible && state.timedOut,
    signedOut: scope.signedOut, retry: scope.authError ? scope.retryAuth : refresh };
}
export type BriefingReadState = Pick<ReturnType<typeof useBriefingRead>, 'loaded' | 'loading' | 'error' | 'timedOut' | 'signedOut' | 'retry'>;
