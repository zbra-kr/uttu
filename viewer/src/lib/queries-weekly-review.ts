'use client';
import { supabaseBrowser } from './supabase/client';
import { WEEKLY_PAGE_SIZE, WEEKLY_EVIDENCE_LIMIT, WEEKLY_MEMO_TAG, isWeeklyId, isWeeklyDate,
  parseWeeklyLocation, weeklyHref, uniqueWeeklyEvidence,
  type WeeklyScope, type WeeklyCursor, type WeeklyEvidence } from './weekly-review';

export interface WeeklyPage { rows: WeeklyEvidence[]; next: WeeklyCursor | null; fetchedRows: number }
export interface WeeklySavedMemo { id: string; body: string; created_at: string }

/**
 * One bounded read, no exact count or product fanout. Earlier read-only EXPLAIN
 * observed products_brand_idx/is_own_idx -> reviews_product_date_idx for one own
 * brand. Planner cardinality was underestimated; authenticated RLS runtime is
 * still a release gate. A date LIMIT alone would not prove the query safe.
 */
export async function fetchWeeklyReviews(scope: WeeklyScope, options: {
  cursor?: WeeklyCursor | null; evidence?: string[]; signal?: AbortSignal;
} = {}): Promise<WeeklyPage> {
  const evidence = options.evidence ?? [];
  const parsed = parseWeeklyLocation(new URLSearchParams(weeklyHref(scope, evidence).split('?')[1]));
  if (parsed.error || !parsed.scope || evidence.length > WEEKLY_EVIDENCE_LIMIT) throw new Error('조회 범위를 확인해 주세요.');
  if (options.cursor && (!isWeeklyId(options.cursor.id) || !isWeeklyDate(options.cursor.date)
    || options.cursor.date < scope.from || options.cursor.date > scope.to)) throw new Error('페이지 조건을 확인해 주세요.');
  let query = supabaseBrowser().from('reviews')
    .select(`id, product_id, musinsa_review_id, rating, review_text, review_date, created_at, purchase_option,
      products!inner(name, musinsa_no, is_own, brand_id, brands(name))`)
    .eq('products.is_own', true).eq('products.brand_id', parsed.scope.brand)
    .gte('review_date', scope.from).lte('review_date', scope.to).lte('created_at', scope.at)
    .order('review_date', { ascending: false }).order('id', { ascending: false })
    .limit(evidence.length ? WEEKLY_EVIDENCE_LIMIT : WEEKLY_PAGE_SIZE + 1);
  if (parsed.scope.product) query = query.eq('product_id', parsed.scope.product);
  if (scope.rating === 'low') query = query.gte('rating', 1).lte('rating', 2);
  if (evidence.length) query = query.in('id', parsed.evidence);
  else if (options.cursor) query = query.or(`review_date.lt.${options.cursor.date},and(review_date.eq.${options.cursor.date},id.lt.${options.cursor.id})`);
  if (options.signal) query = query.abortSignal(options.signal);
  const { data, error } = await query;
  if (error || !Array.isArray(data)) throw new Error('리뷰를 불러오지 못했습니다. 범위를 유지한 채 다시 시도해 주세요.');
  const page = evidence.length ? data : data.slice(0, WEEKLY_PAGE_SIZE);
  const rows = page.map(row => {
    const product = row.products as unknown as { name: string; musinsa_no: string; brands: { name: string } | null };
    return { id: row.id, product_id: row.product_id, musinsa_review_id: row.musinsa_review_id ?? '',
      product_name: product?.name ?? '상품명 확인 불가', musinsa_no: String(product?.musinsa_no ?? ''),
      brand_name: product?.brands?.name ?? '브랜드명 확인 불가', rating: row.rating,
      review_text: row.review_text ?? '', review_date: row.review_date, created_at: row.created_at,
      purchase_option: row.purchase_option ?? null } as WeeklyEvidence;
  });
  const last = page.at(-1);
  return { rows: uniqueWeeklyEvidence(rows), fetchedRows: page.length,
    next: !evidence.length && data.length > WEEKLY_PAGE_SIZE && last ? { date: last.review_date, id: last.id } : null };
}

/** Only current user's brand-tagged memos, no author/mention/Teams lookups or writes. */
export async function fetchWeeklyMemos(brand: string, signal?: AbortSignal, expectedUserId?: string): Promise<WeeklySavedMemo[]> {
  if (!isWeeklyId(brand)) throw new Error('브랜드를 확인해 주세요.');
  const sb = supabaseBrowser();
  const { data: auth, error: authError } = await sb.auth.getUser();
  if (authError || !auth.user) throw new Error('내 검토 메모를 보려면 로그인이 필요합니다.');
  if (expectedUserId && auth.user.id !== expectedUserId) throw new Error('로그인 계정이 변경되었습니다. 다시 조회해 주세요.');
  let query = sb.from('user_notes').select('id,body,created_at')
    .eq('user_id', auth.user.id).eq('entity_type', 'brand').eq('entity_id', brand)
    .contains('tags', [WEEKLY_MEMO_TAG]).order('created_at', { ascending: false }).limit(10);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error || !Array.isArray(data)) throw new Error('이전 검토 메모를 불러오지 못했습니다.');
  return data as WeeklySavedMemo[];
}
