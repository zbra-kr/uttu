'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { fetchProductBrief, fetchReviews, type CsAnomaly, type ReviewRow } from '@/lib/queries';

type AuthState = 'checking' | 'authenticated' | 'signedout' | 'unavailable';
type State = 'idle' | 'loading' | 'ready' | 'error';
type Product = NonNullable<Awaited<ReturnType<typeof fetchProductBrief>>>;
type Receipt<T> = { scope: string; state: 'ready' | 'error'; data: T | null };

/** Current saved product reviews, not a snapshot of the detector's evidence. */
export function useCsAnomalyReviews(selected: Pick<CsAnomaly, 'id' | 'entity_id'> | null,
  rating: 'all' | 'low' | 'mid' | 'hi', page: number, limit: number) {
  const [auth, setAuth] = useState({ ready: false, userId: null as string | null, epoch: 0, state: 'checking' as AuthState });
  const [authAttempt, setAuthAttempt] = useState(0);
  const identity = useRef(auth);
  const currentRead = useRef<AbortController | null>(null);
  useEffect(() => {
    let cancelled = false, eventSeen = false;
    const acceptIdentity = (userId: string | null, unavailable = false) => {
      const state: AuthState = unavailable ? 'unavailable' : userId ? 'authenticated' : 'signedout';
      if (cancelled || (identity.current.ready && identity.current.userId === userId && identity.current.state === state)) return;
      const next = { ready: true, userId, epoch: identity.current.epoch + 1, state };
      identity.current = next;
      currentRead.current?.abort();
      setProductReceipt(null); setReviewReceipt(null); setAuth(next);
    };
    const client = supabaseBrowser();
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      eventSeen = true; acceptIdentity(session?.user?.id ?? null);
    });
    void client.auth.getUser().then(({ data, error }) => {
      if (!eventSeen) acceptIdentity(error ? null : data.user?.id ?? null, Boolean(error));
    }).catch(() => { if (!eventSeen) acceptIdentity(null, true); });
    return () => { cancelled = true; currentRead.current?.abort(); subscription.unsubscribe(); };
  }, [authAttempt]);
  const alertKey = selected ? JSON.stringify([selected.id, selected.entity_id]) : '';
  const [selection, setSelection] = useState({ key: alertKey, epoch: 0 });
  const epoch = selection.key === alertKey ? selection.epoch : selection.epoch + 1;
  if (selection.key !== alertKey) setSelection({ key: alertKey, epoch });
  const [productAttempt, setProductAttempt] = useState(0);
  const [reviewAttempt, setReviewAttempt] = useState(0);
  const productScope = JSON.stringify([alertKey, epoch, auth.epoch, productAttempt]);
  const reviewKey = JSON.stringify([alertKey, epoch, auth.epoch, rating, page, limit, reviewAttempt]);
  const [reviewRequest, setReviewRequest] = useState({ key: reviewKey, epoch: 0 });
  const reviewEpoch = reviewRequest.key === reviewKey ? reviewRequest.epoch : reviewRequest.epoch + 1;
  if (reviewRequest.key !== reviewKey) setReviewRequest({ key: reviewKey, epoch: reviewEpoch });
  const reviewScope = JSON.stringify([reviewKey, reviewEpoch]);
  const [productReceipt, setProductReceipt] = useState<Receipt<Product> | null>(null);
  const [reviewReceipt, setReviewReceipt] = useState<Receipt<{ rows: ReviewRow[]; total: number }> | null>(null);
  const productId = selected?.entity_id;

  useEffect(() => {
    if (!productId || !auth.userId) return;
    let cancelled = false;
    const active = () => !cancelled && identity.current.epoch === auth.epoch;
    void fetchProductBrief(productId).then(product => {
      if (active()) setProductReceipt({ scope: productScope, state: product ? 'ready' : 'error', data: product });
    }).catch(() => {
      if (active()) setProductReceipt({ scope: productScope, state: 'error', data: null });
    });
    return () => { cancelled = true; };
  }, [productId, productScope, auth.userId, auth.epoch]);

  useEffect(() => {
    if (!productId || !auth.userId) return;
    const controller = new AbortController();
    currentRead.current = controller;
    let cancelled = false;
    const active = () => !cancelled && identity.current.epoch === auth.epoch && !controller.signal.aborted;
    void fetchReviews({ productId, ratingMin: rating === 'hi' ? 4 : rating === 'mid' ? 3 : 1,
      ratingMax: rating === 'low' ? 2 : rating === 'mid' ? 3 : 5,
      sort: 'recent', limit, offset: page * limit, signal: controller.signal,
      stableOrder: true, requireExactCount: true,
    }).then(data => {
      if (active()) setReviewReceipt({ scope: reviewScope, state: 'ready', data });
    }).catch(() => {
      if (active()) setReviewReceipt({ scope: reviewScope, state: 'error', data: null });
    });
    return () => { cancelled = true; controller.abort(); if (currentRead.current === controller) currentRead.current = null; };
  }, [productId, rating, page, limit, reviewScope, auth.userId, auth.epoch]);

  const product = productReceipt?.scope === productScope ? productReceipt : null;
  const reviews = reviewReceipt?.scope === reviewScope ? reviewReceipt : null;
  const productState: State = !selected || (auth.ready && !auth.userId) ? 'idle' : product?.state ?? 'loading';
  const reviewState: State = !selected || (auth.ready && !auth.userId) ? 'idle' : reviews?.state ?? 'loading';
  const retryProduct = useCallback(() => setProductAttempt(value => value + 1), []);
  const retryReviews = useCallback(() => setReviewAttempt(value => value + 1), []);
  const retryAuth = useCallback(() => {
    const next = { ready: false, userId: null, epoch: identity.current.epoch + 1, state: 'checking' as AuthState };
    identity.current = next; currentRead.current?.abort();
    setProductReceipt(null); setReviewReceipt(null); setAuth(next);
    setAuthAttempt(value => value + 1);
  }, []);
  return { authState: auth.state, retryAuth, product: productState === 'ready' ? product?.data ?? null : null,
    reviews: reviewState === 'ready' ? reviews?.data?.rows ?? [] : [],
    total: reviewState === 'ready' ? reviews?.data?.total ?? null : null,
    productState, reviewState, retryProduct, retryReviews };
}
