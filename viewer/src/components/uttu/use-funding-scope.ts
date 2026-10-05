'use client';
import React from 'react';
import { isAuthSessionMissingError } from '@supabase/supabase-js';
import { supabaseBrowser } from '@/lib/supabase/client';
import { startFundingRead } from '@/lib/funding-read';

/** Invalidate outstanding reads immediately on company, identity or unmount changes. */
export function useFundingScope(companyId: string) {
  const [identity, setIdentity] = React.useState<string | null | undefined>(undefined);
  const [authError, setAuthError] = React.useState(false);
  const [, setRevision] = React.useState(0);
  const [attempt, setAttempt] = React.useState(0);
  const current = React.useRef({ companyId, identity, alive: true, revision: 0, verifying: true });
  if (current.current.companyId !== companyId) {
    current.current.companyId = companyId; current.current.revision++;
  }
  React.useEffect(() => {
    const value = current.current;
    value.alive = true; value.verifying = true;
    let active = true, eventVersion = 0;
    const client = supabaseBrowser();
    const publish = (id: string | null) => {
      value.verifying = false;
      if (current.current.identity !== id) current.current.revision++;
      current.current.identity = id;
      setRevision(current.current.revision);
      setIdentity(id); setAuthError(false);
    };
    const read = startFundingRead(() => client.auth.getUser());
    const version = eventVersion;
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (!active || event === 'INITIAL_SESSION') return;
      eventVersion++; publish(session?.user.id ?? null); read.cancel();
    });
    void read.promise.then(({ data, error }) => {
      if (!active || version !== eventVersion) return;
      if (error && !isAuthSessionMissingError(error)) throw error;
      publish(data.user?.id ?? null);
    }).catch(() => { if (active && version === eventVersion) { value.verifying = false; setAuthError(true); } });
    return () => { active = false; value.alive = false; value.verifying = false; read.cancel(); subscription.unsubscribe(); };
  }, [attempt]);
  const retryAuth = React.useCallback(() => {
    if (!current.current.alive || current.current.verifying) return;
    current.current.verifying = true;
    current.current.identity = undefined; current.current.revision++;
    setIdentity(undefined); setAuthError(false); setAttempt(value => value + 1);
  }, []);
  const key = identity && companyId ? JSON.stringify([companyId, identity, current.current.revision]) : null;
  const isCurrent = React.useCallback((expected: string) => {
    const value = current.current;
    return value.alive && JSON.stringify([value.companyId, value.identity, value.revision]) === expected;
  }, []);
  return { key, isCurrent, authError, retryAuth, signedOut: identity === null };
}
