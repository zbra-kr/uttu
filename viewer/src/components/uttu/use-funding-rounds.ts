'use client';
import React from 'react';
import { getFundingRounds, type FundingRound } from '@/lib/queries-funding';
import { useFundingScope } from './use-funding-scope';

export function useFundingRounds(companyId: string) {
  const scope = useFundingScope(companyId);
  const { key, isCurrent } = scope;
  const [state, setState] = React.useState<{
    key: string | null; rounds: FundingRound[]; loaded: boolean; loading: boolean; error: boolean;
  }>({ key: null, rounds: [], loaded: false, loading: false, error: false });
  const request = React.useRef(0);
  const flight = React.useRef<string | null>(null);
  const refresh = React.useCallback(async () => {
    if (!key || !isCurrent(key) || flight.current === key) return;
    const version = ++request.current;
    flight.current = key;
    const valid = () => isCurrent(key) && request.current === version;
    setState(old => old.key === key ? { ...old, loading: true, error: false }
      : { key, rounds: [], loaded: false, loading: true, error: false });
    try {
      const rounds = await getFundingRounds(companyId, 50);
      if (valid()) setState({ key, rounds, loaded: true, loading: true, error: false });
    } catch {
      if (valid()) setState(old => ({ ...old, error: true }));
    } finally {
      if (valid()) { flight.current = null; setState(old => ({ ...old, loading: false })); }
    }
  }, [companyId, key, isCurrent]);
  React.useEffect(() => {
    void refresh();
    const counter = request, activeFlight = flight;
    return () => { counter.current++; activeFlight.current = null; };
  }, [refresh]);
  const visible = scope.key && state.key === scope.key;
  return {
    rounds: visible ? state.rounds : [],
    loaded: !!visible && state.loaded,
    loading: scope.key ? !visible || state.loading : !scope.signedOut && !scope.authError,
    error: scope.authError || (!!visible && state.error),
    signedOut: scope.signedOut,
    refresh: scope.authError ? async () => scope.retryAuth() : refresh,
  };
}
export type FundingRoundsState = ReturnType<typeof useFundingRounds>;
