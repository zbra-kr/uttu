'use client';
import React from 'react';
import { getFundingRounds, type FundingRound } from '@/lib/queries-funding';
import { useFundingScope } from './use-funding-scope';
import { startFundingRead, FundingReadTimeoutError } from '@/lib/funding-read';

export function useFundingRounds(companyId: string) {
  const scope = useFundingScope(companyId);
  const { key, isCurrent } = scope;
  const [state, setState] = React.useState<{
    key: string | null; rounds: FundingRound[]; loaded: boolean; loading: boolean; error: boolean; timedOut: boolean;
  }>({ key: null, rounds: [], loaded: false, loading: false, error: false, timedOut: false });
  const request = React.useRef(0);
  const flight = React.useRef<string | null>(null);
  const read = React.useRef<ReturnType<typeof startFundingRead> | null>(null);
  const refresh = React.useCallback(async (supersede = false) => {
    if (!key || !isCurrent(key) || (!supersede && flight.current === key)) return;
    const version = ++request.current;
    read.current?.cancel();
    flight.current = key;
    const valid = () => isCurrent(key) && request.current === version;
    setState(old => old.key === key ? { ...old, loading: true, error: false, timedOut: false }
      : { key, rounds: [], loaded: false, loading: true, error: false, timedOut: false });
    const active = startFundingRead(signal => getFundingRounds(companyId, 50, signal));
    read.current = active;
    try {
      const rounds = await active.promise;
      if (valid()) setState({ key, rounds, loaded: true, loading: true, error: false, timedOut: false });
    } catch (error) {
      if (valid()) setState(old => ({ ...old, error: true, timedOut: error instanceof FundingReadTimeoutError }));
    } finally {
      if (read.current === active) read.current = null;
      if (valid()) { flight.current = null; setState(old => ({ ...old, loading: false })); }
    }
  }, [companyId, key, isCurrent]);
  const refreshAfterJob = React.useCallback(() => refresh(true), [refresh]);
  React.useEffect(() => {
    void refresh();
    const counter = request, activeFlight = flight, activeRead = read;
    return () => { counter.current++; activeFlight.current = null; activeRead.current?.cancel(); activeRead.current = null; };
  }, [refresh]);
  const visible = scope.key && state.key === scope.key;
  return {
    rounds: visible ? state.rounds : [],
    loaded: !!visible && state.loaded,
    loading: scope.key ? !visible || state.loading : !scope.signedOut && !scope.authError,
    error: scope.authError || (!!visible && state.error),
    timedOut: !!visible && state.timedOut,
    signedOut: scope.signedOut,
    refresh: scope.authError ? async () => scope.retryAuth() : refresh,
    refreshAfterJob,
  };
}
export type FundingRoundsState = ReturnType<typeof useFundingRounds>;
