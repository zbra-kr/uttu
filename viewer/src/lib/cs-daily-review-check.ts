import type { ReviewRow } from './queries';

export const CS_REVIEW_LIMIT = 20;
export function validCSDate(value: string): boolean {
  return /^20\d{2}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
    && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}
export function csReviewDate(date: string, today: string): string | null {
  if (!validCSDate(date) || !validCSDate(today) || date > today) return null;
  return new Date(Date.parse(date + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
}
const identity = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 128;
export function currentCSProductHref(row: Pick<ReviewRow, 'product_id' | 'musinsa_no'>): string | null {
  return identity(row.product_id) && typeof row.musinsa_no === 'string' && /^[1-9]\d{0,19}$/.test(row.musinsa_no)
    ? `/product?no=${row.musinsa_no}` : null;
}
export interface CSReviewResult { rows: ReviewRow[]; total: number; excluded: number }
/** Count is the authorized saved-data join scope, not the customer population. */
export function checkCSReviews(result: { rows: ReviewRow[]; total: number }, date: string): CSReviewResult {
  if (!Array.isArray(result.rows) || !Number.isSafeInteger(result.total) || result.total < result.rows.length
    || result.rows.length > CS_REVIEW_LIMIT || (result.total > 0 && result.rows.length === 0)) throw new Error('Review count inconsistent');
  const frequencies = new Map<string, number>();
  for (const row of result.rows) if (row && identity(row.id)) frequencies.set(row.id, (frequencies.get(row.id) ?? 0) + 1);
  const rows = result.rows.filter(row => row && identity(row.id) && frequencies.get(row.id) === 1
    && row.review_date === date && (row.rating === 1 || row.rating === 2)
    && (row.review_text === null || typeof row.review_text === 'string'));
  return { rows, total: result.total, excluded: result.rows.length - rows.length };
}
