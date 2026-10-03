/**
 * product_matches.score is an internal 0–100 point priority, not a probability.
 * The current runAutoMatch producer assigns category/pool tiers; manual matches
 * have no score. Never detect a different scale from a value or rescale it.
 * A future producer with different semantics needs explicit method metadata.
 */
export const MATCHING_SCORE_HELP = '자동 매칭 점수는 카테고리와 경쟁 브랜드 풀을 기준으로 정한 우선순위입니다. 상품 유사도나 확률이 아닙니다.';

function isValidMatchingScore(score: unknown): score is number {
  return typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100;
}

export function formatMatchingScore(score: unknown): string {
  if (score == null) return '점수 없음';
  if (!isValidMatchingScore(score)) return '점수 확인 필요';
  return `매칭 점수 ${score}점`;
}

/** Keep card badges, filter counts and filter membership on the same contract. */
export function getMatchingGrade(status: string, score: unknown): 'A' | 'B' | null {
  if (status !== 'auto' || !isValidMatchingScore(score)) return null;
  return score >= 70 ? 'A' : 'B';
}
