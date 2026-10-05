'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isAuthSessionMissingError } from '@supabase/supabase-js';
import { fetchReviews } from '@/lib/queries';
import { supabaseBrowser } from '@/lib/supabase/client';
import { checkCSReviews, csReviewDate, CS_REVIEW_LIMIT, type CSReviewResult } from '@/lib/cs-daily-review-check';

type Status = 'inactive' | 'invalid-date' | 'loading' | 'signed-out' | 'error' | 'ready';
export interface CSDailyReviewState {
  status: Status; scope: string; briefingDate: string; reviewDate: string | null;
  result: CSReviewResult | null; retry: () => void;
}
/** Owned by the stable Today boundary, above Shell's responsive presentation trees. */
export function useCSDailyReviewCheck(active: boolean, briefingDate: string, today: string): CSDailyReviewState {
  const [auth, setAuth] = useState({ ready: false, error: false, userId: null as string | null, epoch: 0 });
  const owner = useRef<{ userId: string | null } | null>(null);
  const [authRetry, setAuthRetry] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<{ scope: string; result: CSReviewResult | null; error: boolean } | null>(null);
  const reviewDate = csReviewDate(briefingDate, today);
  const scope = JSON.stringify([active, briefingDate, auth.epoch, attempt]);

  useEffect(() => {
    let cancelled = false, eventSeen = false;
    const client = supabaseBrowser();
    function identity(userId: string | null) {
      if (cancelled) return;
      if (owner.current && owner.current.userId === userId) return;
      owner.current = { userId };
      setAuth(previous => ({ ready: true, error: false, userId, epoch: previous.epoch + 1 }));
      setData(null);
    }
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      // Initial local session loading can emit null on failure; getUser verifies it.
      if (event === 'INITIAL_SESSION') return;
      eventSeen = true; identity(session?.user?.id ?? null);
    });
    void client.auth.getUser().then(({ data: identityData, error }) => {
      if (cancelled || eventSeen) return;
      if (error && !isAuthSessionMissingError(error)) throw error;
      identity(identityData.user?.id ?? null);
    }).catch(() => {
      if (!cancelled && !eventSeen) {
        owner.current = null;
        setAuth(previous => ({ ready: true, error: true, userId: null, epoch: previous.epoch + 1 }));
        setData(null);
      }
    });
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, [authRetry]);

  useEffect(() => {
    if (!active || !reviewDate || !auth.ready || auth.error || !auth.userId) { setData(null); return; }
    let cancelled = false;
    const requestOwner = owner.current;
    const controller = new AbortController();
    setData(null);
    void fetchReviews({ ownOnly: true, ratingMin: 1, ratingMax: 2,
      dateFrom: reviewDate, dateTo: reviewDate, sort: 'recent', limit: CS_REVIEW_LIMIT, offset: 0,
      stableOrder: true, requireExactCount: true, signal: controller.signal,
    }).then(result => {
      if (!cancelled && requestOwner === owner.current) setData({ scope, result: checkCSReviews(result, reviewDate), error: false });
    }).catch(() => {
      if (!cancelled && requestOwner === owner.current) setData({ scope, result: null, error: true });
    });
    return () => { cancelled = true; controller.abort(); };
  }, [active, reviewDate, auth.ready, auth.error, auth.userId, scope]);

  const current = data?.scope === scope ? data : null;
  const status: Status = !active ? 'inactive' : !reviewDate ? 'invalid-date' : !auth.ready ? 'loading'
    : auth.error ? 'error' : !auth.userId ? 'signed-out' : !current ? 'loading' : current.error ? 'error' : 'ready';
  const retry = useCallback(() => {
    if (auth.error) { setAuth(previous => ({ ...previous, ready: false })); setAuthRetry(value => value + 1); }
    else setAttempt(value => value + 1);
  }, [auth.error]);
  const result = status === 'ready' ? current!.result : null;
  return useMemo(() => ({ status, scope, briefingDate, reviewDate, result, retry }), [status, scope, briefingDate, reviewDate, result, retry]);
}
