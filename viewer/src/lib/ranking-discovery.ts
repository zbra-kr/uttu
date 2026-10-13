import 'server-only';
import { createHash } from 'node:crypto';

// Phase 1: explicit dates and Cartesian cohorts; no inferred global rank.
export const DISCOVERY_CATEGORIES = ['000', '001', '002', '003', '004', '017', '026', '100', '101', '102', '103', '104', '106'];
export const DISCOVERY_GENDERS = ['A', 'M', 'F'];
export const DISCOVERY_AGES = ['AGE_BAND_ALL', 'AGE_BAND_MINOR', 'AGE_BAND_20', 'AGE_BAND_25', 'AGE_BAND_30', 'AGE_BAND_35', 'AGE_BAND_40'];
export const DISCOVERY_READ_CAP = 10_000;
export const DISCOVERY_READ_PAGE = 500;

export class DiscoveryError extends Error {
  constructor(public code: 'invalid-request' | 'read-cap' | 'incomplete-read' | 'invalid-receipt' | 'stale-cursor' | 'read-failed', public status: number) {
    super(code);
  }
}
export interface DiscoveryScope {
  version: 2; storeCode: 'musinsa'; fromDate: string; toDate: string;
  categories: string[]; genders: string[]; ages: string[]; ownOnly: boolean; pageSize: number;
}
export interface DiscoveryRequest { scope: DiscoveryScope; cursor: string | null }
export interface DiscoveryObservation {
  id: string; productId: string; musinsaNo: string; name: string | null; brand: string | null;
  own: boolean; date: string; category: string; gender: string; age: string; rank: number;
}
export interface DiscoveryReadReceipt { rows: unknown[]; totalRows: number }
export type DiscoveryReadPage = (scope: DiscoveryScope, offset: number, limit: number, signal?: AbortSignal) => Promise<DiscoveryReadReceipt>;
const invalid = (): never => { throw new DiscoveryError('invalid-request', 400); };
const receipt = (): never => { throw new DiscoveryError('invalid-receipt', 502); };
const dayNumber = (date: string) => Date.parse(date + 'T00:00:00Z') / 86_400_000;
const validDate = (value: unknown): value is string => typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(dayNumber(value)) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const keys = ['version', 'storeCode', 'fromDate', 'toDate', 'categories', 'genders', 'ages', 'ownOnly', 'pageSize', 'cursor'];

export function parseDiscoveryRequest(input: unknown): DiscoveryRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  const r = input as Record<string, unknown>;
  if (Object.keys(r).some(key => !keys.includes(key)) || r.version !== 2 || r.storeCode !== 'musinsa'
    || !validDate(r.fromDate) || !validDate(r.toDate) || dayNumber(r.toDate) - dayNumber(r.fromDate) < 0
    || dayNumber(r.toDate) - dayNumber(r.fromDate) > 30 || typeof r.ownOnly !== 'boolean') return invalid();
  const axis = (value: unknown, allowed: string[]): string[] => {
    if (!Array.isArray(value) || !value.length || value.length > allowed.length || value.some(v => typeof v !== 'string' || !allowed.includes(v))) return invalid();
    return [...new Set(value as string[])].sort();
  };
  const pageSize = r.pageSize ?? 50;
  if (typeof pageSize !== 'number' || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return invalid();
  if (r.cursor !== undefined && r.cursor !== null && (typeof r.cursor !== 'string' || !r.cursor.length || r.cursor.length > 1024)) return invalid();
  return { scope: { version: 2, storeCode: 'musinsa', fromDate: r.fromDate, toDate: r.toDate,
    categories: axis(r.categories, DISCOVERY_CATEGORIES), genders: axis(r.genders, DISCOVERY_GENDERS),
    ages: axis(r.ages, DISCOVERY_AGES), ownOnly: r.ownOnly, pageSize }, cursor: (r.cursor as string | null) ?? null };
}

function normalize(value: unknown, scope: DiscoveryScope): DiscoveryObservation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return receipt();
  const r = value as Record<string, unknown>;
  const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  const product = r.products as Record<string, unknown> | null;
  if (!uuid(r.id) || !uuid(r.product_id) || typeof r.musinsa_no !== 'string' || !/^[1-9]\d{0,19}$/.test(r.musinsa_no)
    || r.store_code !== scope.storeCode || !validDate(r.snapshot_date) || r.snapshot_date < scope.fromDate || r.snapshot_date > scope.toDate
    || typeof r.category_code !== 'string' || !scope.categories.includes(r.category_code)
    || typeof r.gender_filter !== 'string' || !scope.genders.includes(r.gender_filter)
    || typeof r.age_filter !== 'string' || !scope.ages.includes(r.age_filter)
    || typeof r.rank_position !== 'number' || !Number.isSafeInteger(r.rank_position) || r.rank_position <= 0
    || !product || Array.isArray(product) || typeof product.is_own !== 'boolean' || (scope.ownOnly && !product.is_own)) return receipt();
  const label = (v: unknown): string | null => v === null ? null : typeof v === 'string' && v.length <= 2000 ? v : receipt();
  return { id: r.id.toLowerCase(), productId: r.product_id.toLowerCase(), musinsaNo: r.musinsa_no,
    name: label(r.product_name), brand: label(r.brand_name), own: product.is_own, date: r.snapshot_date,
    category: r.category_code, gender: r.gender_filter, age: r.age_filter, rank: r.rank_position };
}
const cohortKey = (r: DiscoveryObservation) => [r.category, r.gender, r.age].join('/');

/** Completes a bounded stored window before grouping. Never pages raw rows as products. */
export async function discoverRankingProducts(request: DiscoveryRequest, readPage: DiscoveryReadPage, signal?: AbortSignal) {
  // Revalidate typed inputs too: callers cannot bypass bounds or cursor scope checks.
  const parsed = parseDiscoveryRequest({ ...request.scope, cursor: request.cursor });
  const scope = parsed.scope;
  const observations: DiscoveryObservation[] = [];
  const ids = new Set<string>(), grains = new Set<string>();
  let previousId: string | null = null;
  let declaredTotal: number | null = null;
  for (let offset = 0; ; offset += DISCOVERY_READ_PAGE) {
    signal?.throwIfAborted();
    const limit = DISCOVERY_READ_PAGE;
    const page = await readPage(scope, offset, limit, signal);
    signal?.throwIfAborted();
    if (!page || !Array.isArray(page.rows) || !Number.isSafeInteger(page.totalRows) || page.totalRows < 0) return receipt();
    const { rows, totalRows } = page;
    if (totalRows > DISCOVERY_READ_CAP) throw new DiscoveryError('read-cap', 422);
    if (declaredTotal !== null && declaredTotal !== totalRows) return receipt();
    declaredTotal = totalRows;
    if (offset > totalRows || rows.length > limit || offset + rows.length > totalRows) return receipt();
    // A short response may be a lower deployed row ceiling, not the end of the window.
    if (rows.length !== Math.min(limit, totalRows - offset)) throw new DiscoveryError('incomplete-read', 502);
    for (const raw of rows) {
      const row = normalize(raw, scope);
      const grain = [row.productId, row.date, cohortKey(row)].join('/');
      if (ids.has(row.id) || grains.has(grain) || (previousId !== null && row.id <= previousId)) return receipt();
      ids.add(row.id); grains.add(grain); previousId = row.id; observations.push(row);
    }
    // Exact count proves the terminal page; do not request a range beyond that count.
    if (offset + rows.length === totalRows) break;
  }
  const rankCounts = new Map<string, number>();
  const rankKey = (r: DiscoveryObservation) => [r.date, cohortKey(r), r.rank].join('/');
  for (const row of observations) rankCounts.set(rankKey(row), (rankCounts.get(rankKey(row)) ?? 0) + 1);
  const grouped = new Map<string, DiscoveryObservation[]>();
  const numbers = new Map<string, string>();
  for (const row of observations) {
    if (numbers.has(row.musinsaNo) && numbers.get(row.musinsaNo) !== row.productId) return receipt();
    numbers.set(row.musinsaNo, row.productId);
    const rows = grouped.get(row.productId) ?? [];
    if (rows.length && (rows[0].musinsaNo !== row.musinsaNo || rows[0].own !== row.own)) return receipt();
    rows.push(row); grouped.set(row.productId, rows);
  }
  const scopeHash = hash(scope), dataHash = hash(observations);
  const productIds = [...grouped.keys()].sort();
  let start = 0;
  if (parsed.cursor) {
    let cursor: { scope?: unknown; data?: unknown; after?: unknown };
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(parsed.cursor)) return invalid();
      cursor = JSON.parse(Buffer.from(parsed.cursor, 'base64url').toString('utf8'));
      if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor) || Object.keys(cursor).sort().join(',') !== 'after,data,scope') return invalid();
    } catch { return invalid(); }
    if (cursor.scope !== scopeHash) return invalid();
    if (cursor.data !== dataHash) throw new DiscoveryError('stale-cursor', 409);
    if (typeof cursor.after !== 'string' || !grouped.has(cursor.after)) return invalid();
    start = productIds.indexOf(cursor.after) + 1;
  }
  const chosen = productIds.slice(start, start + scope.pageSize);
  const products = chosen.map(productId => {
    const rows = grouped.get(productId)!.sort((a, b) => b.date.localeCompare(a.date) || cohortKey(a).localeCompare(cohortKey(b)));
    return { productId, musinsaNo: rows[0].musinsaNo, name: rows[0].name, brand: rows[0].brand, own: rows[0].own,
      latestObservedDate: rows[0].date, observedDays: new Set(rows.map(r => r.date)).size,
      observedCohorts: new Set(rows.map(cohortKey)).size, observationCount: rows.length,
      // Each rank remains attached to its date and cohort. No best/average/global rank.
      evidence: rows.map(r => ({ date: r.date, category: r.category, gender: r.gender, age: r.age, rank: r.rank,
        rankStatus: rankCounts.get(rankKey(r))! > 1 ? 'ambiguous' as const : 'observed' as const,
        completeness: 'unknown' as const, changeStatus: 'not-read' as const })) };
  });
  const hasMore = start + chosen.length < productIds.length;
  const nextCursor = hasMore ? Buffer.from(JSON.stringify({ scope: scopeHash, data: dataHash, after: chosen.at(-1) })).toString('base64url') : null;
  const matched = new Set(observations.map(r => [r.date, cohortKey(r)].join('/')));
  return { version: 2 as const, scope, products, totalProducts: productIds.length, observationCount: observations.length,
    hasMore, nextCursor, coverage: { basis: 'stored-observations' as const, sourceCompleteness: 'unknown' as const,
      expectedCohortDays: scope.categories.length * scope.genders.length * scope.ages.length * (dayNumber(scope.toDate) - dayNumber(scope.fromDate) + 1),
      matchedCohortDays: matched.size, matchedBasis: scope.ownOnly ? 'own-filtered-observations' as const : 'stored-observations' as const,
      emptyMeaning: 'no-matching-stored-observations' as const, readCap: DISCOVERY_READ_CAP,
      storedWindowRead: 'completed-within-cap' as const, readIsolation: 'best-effort' as const,
      ownClassification: 'current-product-master' as const } };
}
