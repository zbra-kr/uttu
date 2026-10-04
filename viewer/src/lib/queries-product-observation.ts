'use client';
import { supabaseBrowser } from './supabase/client';
import { DAILY_RANK_LIMIT } from './ranking-daily-insights';
import type { ProductObservationContext } from './product-observation-context';

export interface ObservedProductRow {
  product: string;
  date: string;
  rank: number;
  name: string;
  brand: string | null;
  price: number | null;
  discount: number | null;
  own: boolean | null;
}

export type ObservedProductResult =
  | { status: 'ready'; row: ObservedProductRow }
  | { status: 'missing' | 'ambiguous' | 'capped' | 'error' };

/** One exact, bounded observation read. Latest product data is never a fallback. */
export async function fetchProductObservation(context: ProductObservationContext, signal?: AbortSignal): Promise<ObservedProductResult> {
  try {
    let query = supabaseBrowser().from('ranking_snapshots')
      .select('store_code,snapshot_date,category_code,gender_filter,age_filter,musinsa_no,rank_position,product_name,brand_name,final_price,discount_rate,products(is_own)')
      .eq('store_code', context.store).eq('musinsa_no', Number(context.product))
      .eq('snapshot_date', context.date).eq('category_code', context.category)
      .eq('gender_filter', context.gender).eq('age_filter', context.age)
      .order('rank_position', { ascending: true }).limit(3);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error || !Array.isArray(data)) return { status: 'error' };
    if (data.length === 0) return { status: 'missing' };
    if (data.length >= 3) return { status: 'capped' };
    if (data.length === 2) return { status: 'ambiguous' };
    const r = data[0];
    if (r.store_code !== context.store || r.snapshot_date !== context.date
      || r.category_code !== context.category || r.gender_filter !== context.gender
      || r.age_filter !== context.age || String(r.musinsa_no) !== context.product
      || !Number.isInteger(r.rank_position) || r.rank_position < 1 || r.rank_position > DAILY_RANK_LIMIT) return { status: 'error' };
    const metric = (value: unknown, max = Infinity): number | null =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
    const name = typeof r.product_name === 'string' && r.product_name.trim() ? r.product_name.trim() : `상품 #${context.product}`;
    if (Array.isArray(r.products) && r.products.length > 1) return { status: 'error' };
    const joinedProduct = Array.isArray(r.products) ? r.products[0] : r.products;
    return { status: 'ready', row: { product: context.product, date: context.date, rank: r.rank_position,
      name, brand: typeof r.brand_name === 'string' && r.brand_name.trim() ? r.brand_name.trim() : null,
      price: metric(r.final_price), discount: metric(r.discount_rate, 100),
      own: typeof joinedProduct?.is_own === 'boolean' ? joinedProduct.is_own : null } };
  } catch {
    return { status: 'error' };
  }
}
