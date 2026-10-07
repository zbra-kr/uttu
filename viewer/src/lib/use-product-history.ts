'use client';
import { useEffect, useState } from 'react';
import { fetchProductHistories } from '@/lib/queries';
import type { ProductPriceHistory, ProductRankHistory } from './product-history-window';

export function useProductHistory(productNo: string | null) {
  const [request, setRequest] = useState(0);
  const [receipt, setReceipt] = useState<{ productNo: string | null; price: ProductPriceHistory; rank: ProductRankHistory; status: 'loading' | 'ready' | 'error' }>({ productNo: null, price: [], rank: [], status: 'loading' });
  useEffect(() => {
    let active = true;
    setReceipt({ productNo, price: [], rank: [], status: 'loading' });
    if (productNo) fetchProductHistories(productNo).then(history => {
      if (active) setReceipt({ productNo, ...history, status: 'ready' });
    }).catch(() => {
      if (active) setReceipt({ productNo, price: [], rank: [], status: 'error' });
    });
    return () => { active = false; };
  }, [productNo, request]);
  // Product navigation hides the old receipt before the next effect runs.
  const current = receipt.productNo === productNo ? receipt : { price: [] as ProductPriceHistory, rank: [] as ProductRankHistory, status: 'loading' as const };
  return { priceHistory: current.price, rankHistory: current.rank, status: current.status, retry: () => {
    setReceipt({ productNo, price: [], rank: [], status: 'loading' });
    setRequest(value => value + 1);
  } };
}
