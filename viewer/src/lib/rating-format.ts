/** products.satisfaction_score and its averages come from goodsReview.satisfactionScore (0–5).
 * Never use this formatter for ranking_snapshots.review_score (0–100).
 * Out-of-range historical values are flagged, not guessed or rescaled.
 */
export function isFiveStarRating(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 5;
}

export function formatFiveStarRating(value: number | null | undefined): string {
  if (value == null) return '—';
  if (!isFiveStarRating(value)) return '확인 필요';
  return `${Number(value.toFixed(2))}/5`;
}

/** Below 3/5 is the five-star equivalent of the existing below-60% warning. */
export function isLowFiveStarRating(value: number | null | undefined): boolean {
  return isFiveStarRating(value) && value < 3;
}
