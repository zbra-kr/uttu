'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchProductBrief, fetchReviews, type CsAnomaly, type ReviewRow } from '@/lib/queries';

type State = 'idle' | 'loading' | 'ready' | 'error';
type Product = NonNullable<Awaited<ReturnType<typeof fetchProductBrief>>>;
type Receipt<T> = { scope: string; state: 'ready' | 'error'; data: T | null };

/** Current saved product reviews, not a snapshot of the detector's evidence. */
export function useCsAnomalyReviews(selected: Pick<CsAnomaly, 'id' | 'entity_id'> | null,
  rating: 'all' | 'low' | 'mid' | 'hi', page: number, limit: number) {
  const alertKey = selected ? JSON.stringify([selected.id, selected.entity_id]) : '';
  const [selection, setSelection] = useState({ key: alertKey, epoch: 0 });
  const epoch = selection.key === alertKey ? selection.epoch : selection.epoch + 1;
  if (selection.key !== alertKey) setSelection({ key: alertKey, epoch });
  const [productAttempt, setProductAttempt] = useState(0);
  const [reviewAttempt, setReviewAttempt] = useState(0);
  const productScope = JSON.stringify([alertKey, epoch, productAttempt]);
  const reviewScope = JSON.stringify([alertKey, epoch, rating, page, limit, reviewAttempt]);
  const current = useRef({ productScope, reviewScope });
  current.current = { productScope, reviewScope };
  const [productReceipt, setProductReceipt] = useState<Receipt<Product> | null>(null);
  const [reviewReceipt, setReviewReceipt] = useState<Receipt<{ rows: ReviewRow[]; total: number }> | null>(null);
  const productId = selected?.entity_id;

  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    const active = () => !cancelled && current.current.productScope === productScope;
    void fetchProductBrief(productId).then(product => {
      if (active()) setProductReceipt({ scope: productScope, state: product ? 'ready' : 'error', data: product });
    }).catch(() => {
      if (active()) setProductReceipt({ scope: productScope, state: 'error', data: null });
    });
    return () => { cancelled = true; };
  }, [productId, productScope]);

  useEffect(() => {
    if (!productId) return;
    const controller = new AbortController();
    let cancelled = false;
    const active = () => !cancelled && !controller.signal.aborted && current.current.reviewScope === reviewScope;
    void fetchReviews({ productId, ratingMin: rating === 'hi' ? 4 : rating === 'mid' ? 3 : 1,
      ratingMax: rating === 'low' ? 2 : rating === 'mid' ? 3 : 5,
      sort: 'recent', limit, offset: page * limit, signal: controller.signal,
      stableOrder: true, requireExactCount: true,
    }).then(data => {
      if (active()) setReviewReceipt({ scope: reviewScope, state: 'ready', data });
    }).catch(() => {
      if (active()) setReviewReceipt({ scope: reviewScope, state: 'error', data: null });
    });
    return () => { cancelled = true; controller.abort(); };
  }, [productId, rating, page, limit, reviewScope]);

  const product = productReceipt?.scope === productScope ? productReceipt : null;
  const reviews = reviewReceipt?.scope === reviewScope ? reviewReceipt : null;
  const productState: State = !selected ? 'idle' : product?.state ?? 'loading';
  const reviewState: State = !selected ? 'idle' : reviews?.state ?? 'loading';
  const retryProduct = useCallback(() => setProductAttempt(value => value + 1), []);
  const retryReviews = useCallback(() => setReviewAttempt(value => value + 1), []);
  return { product: productState === 'ready' ? product?.data ?? null : null,
    reviews: reviewState === 'ready' ? reviews?.data?.rows ?? [] : [],
    total: reviewState === 'ready' ? reviews?.data?.total ?? null : null,
    productState, reviewState, retryProduct, retryReviews };
}
