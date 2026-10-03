/** Bounded URL, date, evidence, and plaintext memo contracts. */
export const WEEKLY_PAGE_SIZE = 30;
export const WEEKLY_EVIDENCE_LIMIT = 10;
export const WEEKLY_MEMO_TAG = '상품개선검토';
export const WEEKLY_MEMO_HEADER = '[UTTU 상품 개선 검토 v1]';
const DAY = 86_400_000;
export interface WeeklyScope {
  brand: string; from: string; to: string; rating: 'all' | 'low'; product: string | null; at: string;
}
export interface WeeklyCursor { date: string; id: string }
export interface WeeklyEvidence {
  id: string; product_id: string; musinsa_review_id: string;
  product_name: string; musinsa_no: string; brand_name: string;
  rating: number; review_text: string; review_date: string;
  created_at: string; purchase_option: string | null;
}
export function isWeeklyId(value: string): boolean {
  return typeof value === 'string' && value.length === 36
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
export function isWeeklyDate(value: string): boolean {
  return typeof value === 'string' && value.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function kstClosedWeek(now = new Date()): { from: string; to: string } {
  const today = new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
  return { from: new Date(Date.parse(today) - 7 * DAY).toISOString().slice(0, 10),
    to: new Date(Date.parse(today) - DAY).toISOString().slice(0, 10) };
}
export function weeklyPeriodError(from: string, to: string, now = new Date()): string | null {
  if (!isWeeklyDate(from) || !isWeeklyDate(to)) return '올바른 작성일 범위를 선택해 주세요.';
  if (to < from || Date.parse(to) - Date.parse(from) > 6 * DAY) return '한 번에 최대 7개의 작성일을 확인할 수 있습니다.';
  if (to > kstClosedWeek(now).to) return '오늘(KST)을 제외한 작성일을 선택해 주세요. 오늘의 수집은 아직 진행 중일 수 있습니다.';
  return null;
}
export function parseWeeklyLocation(params: URLSearchParams, now = new Date()): {
  scope: WeeklyScope | null; evidence: string[]; error: string | null;
} {
  const keys = ['brand', 'from', 'to', 'rating', 'product', 'at', 'evidence'];
  for (const key of keys) {
    if (params.getAll(key).length > 1) return { scope: null, evidence: [], error: '중복된 링크 조건입니다. 범위를 다시 선택해 주세요.' };
  }
  if (!params.get('brand')) return { scope: null, evidence: [], error: keys.some(key => params.has(key))
    ? '브랜드가 없는 링크입니다. 범위를 다시 선택해 주세요.' : null };
  const brand = params.get('brand')!.toLowerCase();
  const product = params.get('product')?.toLowerCase() || null;
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const at = params.get('at') ?? '';
  const rating = params.get('rating') ?? 'all';
  const evidence = params.get('evidence')?.split(',').map(id => id.toLowerCase()) ?? [];
  const error = !isWeeklyId(brand) || (product && !isWeeklyId(product)) ? '브랜드 또는 상품 링크를 확인해 주세요.'
    : weeklyPeriodError(from, to, now)
      ?? (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at) || !Number.isFinite(Date.parse(at))
        || new Date(at).toISOString() !== at || Date.parse(at) > now.getTime() + 60_000 ? '조회 기준시각이 올바르지 않습니다. 범위를 다시 선택해 주세요.' : null)
      ?? (rating !== 'all' && rating !== 'low' ? '별점 조건을 확인해 주세요.' : null)
      ?? (evidence.length > WEEKLY_EVIDENCE_LIMIT || evidence.some(id => !isWeeklyId(id))
        || new Set(evidence).size !== evidence.length ? '연결된 근거 식별자를 확인해 주세요.' : null);
  return { scope: error ? null : { brand, from, to, rating: rating as WeeklyScope['rating'], product, at }, evidence, error: error || null };
}
export function weeklyHref(scope: WeeklyScope, evidence: string[] = []): string {
  const params = new URLSearchParams({ brand: scope.brand, from: scope.from, to: scope.to, rating: scope.rating, at: scope.at });
  if (scope.product) params.set('product', scope.product);
  if (evidence.length) params.set('evidence', evidence.join(','));
  return `/reviews/weekly?${params.toString()}`;
}
/** Identity deduplication only; similar text never proves two reviews are the same. */
export function uniqueWeeklyEvidence(rows: WeeklyEvidence[]): WeeklyEvidence[] {
  const seen = new Set<string>();
  return rows.filter(row => {
    const key = row.musinsa_review_id ? `musinsa:${row.musinsa_review_id}` : `row:${row.id.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
export function formatWeeklyTime(value: string): string {
  if (!Number.isFinite(Date.parse(value))) return '시각 확인 불가';
  return `${new Date(Date.parse(value) + 9 * 3_600_000).toISOString().replace('T', ' ').slice(0, 16)} KST`;
}
export function buildWeeklyMemo(input: {
  scope: WeeklyScope; brandName: string; evidence: WeeklyEvidence[];
  observation: string; nextCheck: string; nextDate: string;
}): string {
  const rows = uniqueWeeklyEvidence(input.evidence);
  const parsed = parseWeeklyLocation(new URLSearchParams(weeklyHref(input.scope, rows.map(row => row.id)).split('?')[1]));
  const invalidEvidence = rows.some(row => !isWeeklyId(row.id) || !isWeeklyId(row.product_id)
    || !isWeeklyDate(row.review_date) || row.review_date < input.scope.from || row.review_date > input.scope.to
    || !Number.isFinite(Date.parse(row.created_at)) || Date.parse(row.created_at) > Date.parse(input.scope.at)
    || (input.scope.product !== null && row.product_id.toLowerCase() !== input.scope.product.toLowerCase())
    || !Number.isInteger(row.rating) || row.rating < 1 || row.rating > 5
    || (input.scope.rating === 'low' && row.rating > 2));
  if (parsed.error || !parsed.scope || invalidEvidence || !rows.length || rows.length > WEEKLY_EVIDENCE_LIMIT
    || !input.observation.trim() || !input.nextCheck.trim() || !isWeeklyDate(input.nextDate)
    || input.observation.length > 2000 || input.nextCheck.length > 2000) throw new Error('검토 근거와 다음 확인 내용을 입력해 주세요.');
  return [WEEKLY_MEMO_HEADER, `브랜드: ${input.brandName}`, `작성일 범위: ${input.scope.from} ~ ${input.scope.to} (KST)`,
    `조회 기준: ${formatWeeklyTime(input.scope.at)}`, `별점 조건: ${input.scope.rating === 'low' ? '1~2점' : '전체'}`,
    `선택한 원문: ${rows.length}건 (브랜드 전체의 이슈 건수·비율이 아님)`,
    ...rows.map(row => `- ${row.product_name} · 작성 ${row.review_date} · ${row.rating}/5 · 원천 ID ${row.musinsa_review_id || '확인 불가'} · 저장 ${formatWeeklyTime(row.created_at)} · 저장 ID ${row.id}`),
    '', `관찰: ${input.observation.trim()}`, `다음 확인: ${input.nextCheck.trim()}`, `다음 확인일: ${input.nextDate}`,
    '', '수집 완전성 미확인. 조회 기준 이후 저장된 리뷰는 제외하며, 원문 수정·삭제는 재열람에 반영될 수 있습니다.',
    `근거 보기: ${weeklyHref(parsed.scope, parsed.evidence)}`].join('\n');
}
/** Emit only a validated same-app URL, never arbitrary plaintext links. */
export function weeklyMemoHref(body: string): string | null {
  if (!body.startsWith(`${WEEKLY_MEMO_HEADER}\n`)) return null;
  const line = body.split('\n').at(-1);
  if (!line?.startsWith('근거 보기: /reviews/weekly?')) return null;
  const href = line.slice('근거 보기: '.length);
  const parsed = parseWeeklyLocation(new URLSearchParams(href.slice(href.indexOf('?') + 1)));
  if (!parsed.scope || parsed.error || !parsed.evidence.length) return null;
  return weeklyHref(parsed.scope, parsed.evidence);
}
