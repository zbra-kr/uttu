import { buildWeeklyMemo, isWeeklyId, isWeeklyDate, parseWeeklyLocation, weeklyHref,
  type WeeklyScope, type WeeklyEvidence } from './weekly-review';

export interface WeeklyDraft {
  scope: WeeklyScope; brandName: string; evidence: WeeklyEvidence[];
  observation: string; nextCheck: string; nextDate: string;
}
export function weeklyDraftKey(userId: string): string {
  if (!isWeeklyId(userId)) throw new Error('로그인 정보를 확인해 주세요.');
  return `uttu:weekly-review:draft:v1:${userId}`;
}
/** Account-scoped, tab-only storage must not retain original review prose/options. */
export function serializeWeeklyDraft(draft: WeeklyDraft): string {
  return JSON.stringify({ version: 1, ...draft, evidence: draft.evidence.map(row => ({
    id: row.id, product_id: row.product_id, musinsa_review_id: row.musinsa_review_id,
    product_name: row.product_name, musinsa_no: row.musinsa_no, brand_name: row.brand_name,
    rating: row.rating, review_date: row.review_date, created_at: row.created_at,
    review_text: '', purchase_option: null,
  })) });
}
export function restoreWeeklyDraft(raw: string): WeeklyDraft | null {
  try {
    if (raw.length > 40_000) return null;
    const value = JSON.parse(raw);
    if (value.version !== 1 || typeof value.brandName !== 'string' || value.brandName.length > 500
      || !Array.isArray(value.evidence) || value.evidence.length > 10 || !value.scope
      || typeof value.observation !== 'string' || value.observation.length > 2000
      || typeof value.nextCheck !== 'string' || value.nextCheck.length > 2000
      || typeof value.nextDate !== 'string' || (value.nextDate !== '' && !isWeeklyDate(value.nextDate))) return null;
    const parsed = parseWeeklyLocation(new URLSearchParams(weeklyHref(value.scope).split('?')[1]));
    if (!parsed.scope || parsed.error) return null;
    const draft: WeeklyDraft = { scope: parsed.scope, brandName: value.brandName,
      observation: value.observation, nextCheck: value.nextCheck, nextDate: value.nextDate,
      evidence: value.evidence.map((row: WeeklyEvidence) => ({
        id: row.id, product_id: row.product_id, musinsa_review_id: row.musinsa_review_id,
        product_name: row.product_name, musinsa_no: row.musinsa_no, brand_name: row.brand_name,
        rating: row.rating, review_date: row.review_date, created_at: row.created_at,
        review_text: '', purchase_option: null,
      })) };
    if (draft.evidence.some(row => [row.musinsa_review_id, row.product_name, row.musinsa_no, row.brand_name]
      .some(text => typeof text !== 'string' || text.length > 1000))) return null;
    if (draft.evidence.length) buildWeeklyMemo({ ...draft, observation: '임시 검증', nextCheck: '임시 검증', nextDate: draft.scope.to });
    return draft;
  } catch { return null; }
}
/** Content-addressed UUIDv8; same owner and immutable body reuse the replay key. */
export async function weeklySubmissionId(userId: string, body: string): Promise<string> {
  if (!isWeeklyId(userId) || !body) throw new Error('메모 저장 정보를 확인해 주세요.');
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(`uttu:weekly-review:submission:v1\0${userId}\0${body}`))).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
