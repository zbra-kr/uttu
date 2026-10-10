import { fetchProductDetail, fetchProductMatches, fetchReviews, type ProductDetail, type ProductMatchRow, type ReviewRow } from './queries';

export const COMPARISON_LIMIT = 3;
export function validComparisonDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
    && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}
export function comparisonReviewWindow(end: string, days: 7 | 30) {
  if (!validComparisonDate(end) || ![7, 30].includes(days)) throw Error('Invalid review period');
  return { from: new Date(Date.parse(end + 'T00:00:00Z') - (days - 1) * 86400000).toISOString().slice(0, 10), to: end };
}
export function comparisonPriceGap(own: ProductDetail, competitor: ProductDetail) {
  if (!validComparisonDate(own.rank_snapshot_date) || !validComparisonDate(competitor.rank_snapshot_date)) return { gap: null, percent: null, reason: '가격 관측일을 확인할 수 없습니다.' };
  if (own.rank_snapshot_date !== competitor.rank_snapshot_date) return { gap: null, percent: null, reason: '관측일이 달라 가격 차이 계산을 보류합니다.' };
  if (!own.category_code || own.category_code === '000' || own.category_code !== competitor.category_code) return { gap: null, percent: null, reason: '같은 대분류인지 확인할 수 없어 비교를 보류합니다.' };
  const a = own.final_price, b = competitor.final_price;
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return { gap: null, percent: null, reason: '유효한 저장 판매가가 없습니다.' };
  return { gap: a - b, percent: (a - b) / b * 100, reason: '같은 관측일·대분류의 저장 판매가 기준입니다. 소재·사양이 같다는 뜻은 아닙니다.' };
}
export interface ComparisonCompetitor { match: ProductMatchRow; detail: ProductDetail | null; unavailable: boolean }
export interface ComparisonReviews { total: number; lowTotal: number; rows: ReviewRow[] }
export interface ProductComparison {
  own: ProductDetail;
  competitors: ComparisonCompetitor[];
  confirmedLoaded: number;
  autoLoaded: number;
  matchError: boolean;
  reviews: ComparisonReviews | null;
  reviewError: boolean;
  from: string;
  to: string;
}
function reviewReceipt(result: { rows: ReviewRow[]; total: number }, id: string, from: string, to: string, maxRating: number) {
  if (!result || !Array.isArray(result.rows) || !Number.isSafeInteger(result.total) || result.total < result.rows.length || (result.total > 0 && result.rows.length === 0)
    || result.rows.some(r => !r || r.product_id !== id || typeof r.id !== 'string' || !r.id
      || !validComparisonDate(r.review_date) || r.review_date < from || r.review_date > to
      || !Number.isInteger(r.rating) || r.rating < 1 || r.rating > maxRating
      || !(r.review_text === null || typeof r.review_text === 'string'))) throw Error('Invalid review evidence');
  return result;
}
/** On-demand only; no writes, automatic matching, extra history RPC or unbounded per-product loop. */
export async function loadProductComparison(no: string, end: string, days: 7 | 30, signal?: AbortSignal): Promise<ProductComparison> {
  if (signal?.aborted) throw Error('Read cancelled');
  if (!/^\d{1,15}$/.test(no)) throw Error('Invalid product number');
  const { from, to } = comparisonReviewWindow(end, days);
  const own = await fetchProductDetail(no);
  if (!own || String(own.musinsa_no) !== no || !own.id || own.is_own !== true) throw Error('Own product unavailable');
  if (signal?.aborted) throw Error('Read cancelled');
  const common = { productId: own.id, dateFrom: from, dateTo: to, ratingMin: 1, sort: 'recent' as const, offset: 0, requireExactCount: true, stableOrder: true, signal };
  const reviewsRequest = Promise.all([
    fetchReviews({ ...common, ratingMax: 5, limit: 1 }),
    fetchReviews({ ...common, ratingMax: 2, limit: 3 }),
  ]).then(([all, low]) => {
    reviewReceipt(all, own.id, from, to, 5); reviewReceipt(low, own.id, from, to, 2);
    if (low.total > all.total) throw Error('Inconsistent review evidence');
    return { total: all.total, lowTotal: low.total, rows: low.rows };
  }).catch(() => null);
  const matchesRequest = fetchProductMatches(own.id).then(async rows => {
    if (!Array.isArray(rows) || rows.some(r => !r || typeof r.id !== 'string' || !r.id || typeof r.created_at !== 'string' || !Number.isFinite(Date.parse(r.created_at)) || r.own_product_id !== own.id || !['auto', 'confirmed', 'excluded'].includes(r.status)
      || typeof r.competitor_product_id !== 'string' || !r.competitor_product_id || !/^\d{1,15}$/.test(String(r.competitor_musinsa_no)))) throw Error('Invalid matches');
    if (signal?.aborted) throw Error('Read cancelled');
    const unique = new Map<string, ProductMatchRow>();
    rows.filter(r => r.status === 'confirmed').sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || a.id.localeCompare(b.id))
      .forEach(r => { if (!unique.has(r.competitor_product_id)) unique.set(r.competitor_product_id, r); });
    const selected = [...unique.values()].slice(0, COMPARISON_LIMIT);
    const competitors = await Promise.all(selected.map(async match => {
      try {
        const detail = await fetchProductDetail(String(match.competitor_musinsa_no));
        if (!detail || detail.id !== match.competitor_product_id || String(detail.musinsa_no) !== String(match.competitor_musinsa_no) || detail.is_own !== false) throw Error('Competitor unavailable');
        return { match, detail, unavailable: false };
      } catch { return { match, detail: null, unavailable: true }; }
    }));
    return { competitors, confirmedLoaded: unique.size, autoLoaded: rows.filter(r => r.status === 'auto').length };
  }).catch(() => null);
  const [reviews, matches] = await Promise.all([reviewsRequest, matchesRequest]);
  if (signal?.aborted) throw Error('Read cancelled');
  return { own, from, to, reviews, reviewError: reviews === null, competitors: matches?.competitors ?? [], confirmedLoaded: matches?.confirmedLoaded ?? 0, autoLoaded: matches?.autoLoaded ?? 0, matchError: matches === null };
}
