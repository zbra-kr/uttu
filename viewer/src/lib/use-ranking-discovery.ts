'use client';
import { useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from './supabase/client';
import type { DiscoveryScope } from './ranking-discovery';
import { DiscoveryClientError, discoveryScopeKey, fetchDiscovery, type DiscoveryResult } from './ranking-discovery-client';

type State = { status: 'idle' | 'loading' | 'ready' | 'error'; data: DiscoveryResult | null; error: string | null };
const idle: State = { status: 'idle', data: null, error: null };
export function useRankingDiscovery() {
  const [auth, setAuth] = useState<string | null | undefined>(undefined);
  const [state, setState] = useState<State>(idle);
  const [pageIndex, setPageIndex] = useState(0);
  const [appliedScope, setAppliedScope] = useState<DiscoveryScope | null>(null);
  const identity = useRef<string | null | undefined>(undefined);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const history = useRef<(string | null)[]>([null]);
  const last = useRef<{ scope: DiscoveryScope; cursor: string | null; index: number } | null>(null);
  const cancel = () => {
    generation.current++; controller.current?.abort(); controller.current = null;
    if (timer.current) clearTimeout(timer.current); timer.current = null;
  };
  useEffect(() => {
    const client = supabaseBrowser(); let active = true, eventSeen = false;
    const accept = (id: string | null) => {
      if (!active || identity.current === id) return;
      cancel(); identity.current = id; setAuth(id); setState(idle); setAppliedScope(null); setPageIndex(0);
      history.current = [null]; last.current = null;
    };
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => { eventSeen = true; accept(session?.user.id ?? null); });
    void client.auth.getUser().then(({ data, error }) => { if (!eventSeen) accept(error ? null : data.user?.id ?? null); })
      .catch(() => { if (!eventSeen) accept(null); });
    return () => { active = false; cancel(); subscription.unsubscribe(); };
  }, []);

  const begin = (scope: DiscoveryScope, cursor: string | null, index: number) => {
    if (!identity.current) return;
    cancel(); const epoch = generation.current, owner = identity.current, next = new AbortController();
    controller.current = next; last.current = { scope, cursor, index }; setAppliedScope(scope);
    setState({ status: 'loading', data: null, error: null });
    const current = () => generation.current === epoch && identity.current === owner && !next.signal.aborted;
    timer.current = setTimeout(() => {
      if (!current()) return;
      next.abort(); controller.current = null; timer.current = null;
      setState({ status: 'error', data: null, error: 'aggregate-query-timeout' });
    }, 15_000);
    void fetchDiscovery(scope, cursor, next.signal).then(data => {
      if (!current()) return;
      setState({ status: 'ready', data, error: null }); setPageIndex(index);
    }).catch(error => {
      if (!current()) return;
      setState({ status: 'error', data: null, error: error instanceof DiscoveryClientError ? error.code : 'aggregate-unconnected' });
    }).finally(() => {
      if (generation.current !== epoch) return;
      if (timer.current) clearTimeout(timer.current); timer.current = null; controller.current = null;
    });
  };
  return { ...state, auth, pageIndex, appliedScope,
    apply(scope: DiscoveryScope) {
      if (controller.current && last.current?.cursor === null && discoveryScopeKey(last.current.scope) === discoveryScopeKey(scope)) return;
      history.current = [null]; begin(scope, null, 0);
    },
    retry() { if (controller.current || state.status === 'loading' || !last.current) return; const r = last.current; begin(r.scope, r.cursor, r.index); },
    restart() { if (controller.current || !appliedScope) return; history.current = [null]; begin(appliedScope, null, 0); },
    next() {
      if (controller.current || state.status !== 'ready' || !state.data?.nextCursor) return;
      history.current = [...history.current.slice(0, pageIndex + 1), state.data.nextCursor];
      begin(state.data.scope, state.data.nextCursor, pageIndex + 1);
    },
    previous() {
      if (controller.current || state.status !== 'ready' || !appliedScope || !pageIndex) return;
      begin(appliedScope, history.current[pageIndex - 1], pageIndex - 1);
    },
  };
}
