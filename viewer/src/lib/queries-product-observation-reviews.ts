import { supabaseBrowser } from '@/lib/supabase/client';
import { fetchReviews } from '@/lib/queries';
import { checkCSReviews, type CSReviewResult } from './cs-daily-review-check';
import { validDailyDate } from './ranking-daily-insights';
import { productObservationHref, type ProductObservationContext } from './product-observation-context';

export type ObservationReviewResult = { status: 'ready'; result: CSReviewResult }
  | { status: 'unavailable' | 'competitor' };
const linkedId = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 128;
/** Date is the explicit authored-review date; no briefing D-minus-one rule. */
export async function fetchObservationReviews(value: ProductObservationContext, today: string, signal: AbortSignal): Promise<ObservationReviewResult> {
  productObservationHref(value); // Validate store/cohort/back as well as product/date.
  if (!/^[1-9]\d{0,15}$/.test(value.product) || !Number.isSafeInteger(Number(value.product))
    || !validDailyDate(value.date) || !validDailyDate(today) || value.date > today) throw Error('Invalid review scope');
  const guard = () => { if (signal.aborted) throw new DOMException('Aborted', 'AbortError'); };
  guard();
  const { data, error } = await supabaseBrowser().from('products').select('id,musinsa_no,is_own')
    .eq('musinsa_no', Number(value.product)).limit(2).abortSignal(signal);
  guard();
  if (error) throw error;
  if (!Array.isArray(data)) throw Error('Product linkage unavailable');
  if (data.length !== 1 || !linkedId(data[0].id) || String(data[0].musinsa_no) !== value.product) return { status: 'unavailable' };
  const product = data[0];
  if (product.is_own !== true) return { status: 'competitor' };
  const reviews = await fetchReviews({ productId: product.id, ownOnly: true, requireOwnProduct: true,
    dateFrom: value.date, dateTo: value.date, ratingMin: 1, ratingMax: 2, limit: 20, offset: 0,
    sort: 'recent', stableOrder: true, requireExactCount: true, signal });
  guard();
  const checked = checkCSReviews(reviews, value.date);
  const rows = checked.rows.filter(row => row.product_id === product.id && row.musinsa_no === value.product);
  return { status: 'ready', result: { ...checked, rows, excluded: checked.excluded + checked.rows.length - rows.length } };
}
