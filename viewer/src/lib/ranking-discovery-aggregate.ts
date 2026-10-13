import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseDiscoveryRequest, type DiscoveryScope } from './ranking-discovery';

// Authenticated v3 API uses this reader; absent RPC fails closed, never a raw-scan fallback.
export type AggregateRequest = { scope: DiscoveryScope; after?: string | null; productId?: string | null; evidenceAfter?: string | null; limit?: number };
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
export interface AggregateProduct { productId: string; musinsaNo: string; name: string | null; brand: string | null; own: boolean;
  observedDays: number; observedCohorts: number; observationCount: number; latestObservedDate: string }
export interface AggregateEvidence { id: string; date: string; category: string; gender: string; age: string; rank: number; rankStatus: 'unknown'; changeStatus: 'not-read' }
export type AggregateReceipt = { version: 3; mode: 'products' | 'evidence'; scope: DiscoveryScope; sourceCompleteness: 'unknown';
  paginationConsistency: 'keyset-best-effort'; ownClassification: 'current-product-master'; hasMore: boolean; nextId: string | null;
  remainingCount: number;
  products?: AggregateProduct[]; totalProducts?: number; matchingObservations?: number;
  productId?: string; evidence?: AggregateEvidence[]; totalObservations?: number };
export class AggregateError extends Error { constructor(public code: 'invalid-request' | 'invalid-receipt' | 'rpc-unavailable' | 'rpc-missing' | 'rpc-denied' | 'rpc-timeout') { super(code); } }
const reject = (): never => { throw new AggregateError('invalid-receipt'); };
function validateRequest(r: AggregateRequest) {
  const scope = parseDiscoveryRequest(r.scope).scope;
  const productId = r.productId ?? null, after = r.after ?? null, evidenceAfter = r.evidenceAfter ?? null;
  const limit = r.limit ?? (productId ? 100 : scope.pageSize);
  if ([productId, after, evidenceAfter].some(v => v !== null && !uuid(v)) || (!productId && evidenceAfter) || (productId && after)
    || !Number.isInteger(limit) || limit < 1 || limit > (productId ? 500 : 100)) throw new AggregateError('invalid-request');
  Object.freeze(scope.categories); Object.freeze(scope.genders); Object.freeze(scope.ages); Object.freeze(scope);
  return Object.freeze({ scope, productId, after, evidenceAfter, limit });
}
export function parseAggregateReceipt(value: unknown, request: AggregateRequest): AggregateReceipt {
  const q = validateRequest(request), r = value as AggregateReceipt;
  let responseScope: DiscoveryScope;
  try { responseScope = parseDiscoveryRequest(r?.scope).scope; } catch { return reject(); }
  const count = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  const date = (d: unknown): d is string => typeof d === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(d)
    && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d && d >= q.scope.fromDate && d <= q.scope.toDate;
  if (!r || r.version !== 3 || r.mode !== (q.productId ? 'evidence' : 'products') || JSON.stringify(responseScope) !== JSON.stringify(q.scope)
    || r.sourceCompleteness !== 'unknown' || r.paginationConsistency !== 'keyset-best-effort' || r.ownClassification !== 'current-product-master'
    || typeof r.hasMore !== 'boolean' || (r.hasMore ? !uuid(r.nextId) : r.nextId !== null)) return reject();
  const list = q.productId ? r.evidence : r.products;
  const total = q.productId ? r.totalObservations : r.totalProducts;
  const continuation = q.productId ? q.evidenceAfter : q.after;
  if (!count(total) || !count(r.remainingCount) || r.remainingCount > total || (!continuation && r.remainingCount !== total)
    || !Array.isArray(list) || list.length !== Math.min(q.limit, r.remainingCount)
    || r.hasMore !== (r.remainingCount > q.limit)) return reject();
  let previous = q.productId ? q.evidenceAfter : q.after;
  for (const item of list) {
    if (!item || typeof item !== 'object') return reject();
    const id = q.productId ? (item as AggregateEvidence).id : (item as AggregateProduct).productId;
    if (!uuid(id) || (previous !== null && id <= previous)) return reject(); previous = id;
  }
  if (r.hasMore && r.nextId !== previous) return reject();
  if (q.productId) {
    if (r.productId !== q.productId || !count(r.totalObservations) || r.totalObservations < list.length) return reject();
    for (const e of r.evidence!) if (!date(e.date) || !q.scope.categories.includes(e.category) || !q.scope.genders.includes(e.gender)
      || !q.scope.ages.includes(e.age) || !Number.isSafeInteger(e.rank) || e.rank < 1 || e.rankStatus !== 'unknown' || e.changeStatus !== 'not-read') return reject();
  } else {
    if (!count(r.totalProducts) || r.totalProducts < list.length || !count(r.matchingObservations) || r.matchingObservations < r.totalProducts) return reject();
    const days = (Date.parse(q.scope.toDate) - Date.parse(q.scope.fromDate)) / 86400000 + 1;
    for (const p of r.products!) if (typeof p.musinsaNo !== 'string' || !/^[1-9]\d{0,19}$/.test(p.musinsaNo) || typeof p.own !== 'boolean' || (q.scope.ownOnly && !p.own)
      || !(p.name === null || typeof p.name === 'string') || !(p.brand === null || typeof p.brand === 'string') || !date(p.latestObservedDate)
      || !count(p.observationCount) || p.observationCount < 1 || !count(p.observedDays) || p.observedDays < 1 || p.observedDays > days
      || !count(p.observedCohorts) || p.observedCohorts < 1 || p.observedCohorts > q.scope.categories.length * q.scope.genders.length * q.scope.ages.length
      || p.observationCount < Math.max(p.observedDays, p.observedCohorts) || p.observationCount > p.observedDays * p.observedCohorts
      || p.observationCount > r.matchingObservations) return reject();
  }
  return { ...r, scope: responseScope };
}
export async function readAggregateDiscovery(client: SupabaseClient, request: AggregateRequest, signal: AbortSignal): Promise<AggregateReceipt> {
  const q = validateRequest(request); signal.throwIfAborted();
  let abort: () => void = () => {};
  try {
    const pending = client.rpc('get_ranking_discovery_page_v3', { p_scope: q.scope, p_after: q.after, p_product: q.productId,
      p_evidence_after: q.evidenceAfter, p_limit: q.limit }).abortSignal(signal);
    const response = await Promise.race([Promise.resolve(pending), new Promise<never>((_, fail) => {
      abort = () => fail(signal.reason); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    })]);
    signal.throwIfAborted();
    if (response.error) {
      const code=response.error.code;
      throw new AggregateError(code==='PGRST202'||code==='42883'?'rpc-missing':code==='42501'||code==='PGRST301'||code==='PGRST302'?'rpc-denied':code==='57014'?'rpc-timeout':'rpc-unavailable');
    }
    return parseAggregateReceipt(response.data, q);
  } finally { signal.removeEventListener('abort', abort); }
}
