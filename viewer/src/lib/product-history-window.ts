export interface ProductHistoryCoverage {
  mode?: 'daily' | 'weekly';
  horizonStart?: string;
  horizonEnd?: string;
  threshold?: number;
  eligibleRows?: number;
  latestPartialWeek?: boolean;
  latestObservedDays?: number;
  rowCount: number;
  capped: boolean;
  excludedBoundaryDate: string | null;
  firstDate: string | null;
  lastDate: string | null;
  missingPrices: number;
}
export type ProductPriceHistory = { date: string; price: number | null; discount_rate: number | null }[] & { coverage?: ProductHistoryCoverage };
export type ProductRankHistory = { date: string; rank: number; category: string }[] & { coverage?: ProductHistoryCoverage };

/** Validates a bounded server-aggregated receipt; never falls back to raw rows. */
export function parseProductHistoryReceipt(input: unknown): { price: ProductPriceHistory; rank: ProductRankHistory } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid product history receipt');
  const r = input as Record<string, any>;
  const validDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
    && Number.isFinite(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
  const day = (s: string) => Date.parse(s + 'T00:00:00Z') / 86400000;
  const monday = (s: string) => day(s) - (new Date(s + 'T00:00:00Z').getUTCDay() + 6) % 7;
  const fail = (): never => { throw Error('Invalid product history receipt'); };
  if (!r || r.version !== 1 || !['daily', 'weekly'].includes(r.mode) || r.threshold !== 500
    || !Number.isSafeInteger(r.eligibleRows) || r.eligibleRows < 0 || r.scope !== 'product-wide-best' || r.store !== 'musinsa'
    || !validDate(r.horizonStart) || !validDate(r.horizonEnd) || day(r.horizonEnd) < day(r.horizonStart)
    || day(r.horizonEnd) - day(r.horizonStart) > 363 || day(r.horizonStart) !== monday(r.horizonStart)
    || (r.mode === 'weekly') !== (r.eligibleRows > 500) || !Array.isArray(r.points)
    || r.points.length > (r.mode === 'weekly' ? 52 : 364) || r.points.length > r.eligibleRows) fail();
  let previous = '', previousWeek = '';
  for (const p of r.points) {
    if (!p || !validDate(p.date) || p.date <= previous || p.date < r.horizonStart || p.date > r.horizonEnd
      || !Number.isSafeInteger(p.rank) || p.rank <= 0 || typeof p.category !== 'string'
      || !(p.price === null || (typeof p.price === 'number' && Number.isFinite(p.price) && p.price > 0))
      || !(p.discount_rate === null || (typeof p.discount_rate === 'number' && Number.isFinite(p.discount_rate)))
      || !validDate(p.weekStart) || !validDate(p.weekEnd) || day(p.weekStart) !== monday(p.date) || day(p.weekEnd) !== day(p.weekStart) + 6
      || !Number.isSafeInteger(p.observedDays) || p.observedDays < 1 || p.observedDays > 7
      || (r.mode === 'daily' && p.observedDays !== 1) || (r.mode === 'weekly' && p.weekStart <= previousWeek)
      || typeof p.currentWeek !== 'boolean' || p.currentWeek !== (day(p.weekStart) === monday(r.horizonEnd))) fail();
    previous = p.date; previousWeek = p.weekStart;
  }
  if (r.points.length ? r.latestDate !== previous : r.latestDate !== null || r.eligibleRows !== 0) fail();
  const rank: ProductRankHistory = r.points.map((p: any) => ({ date: p.date, rank: p.rank, category: p.category }));
  const price: ProductPriceHistory = r.points.map((p: any) => ({ date: p.date, price: p.price, discount_rate: p.discount_rate }));
  const coverage: ProductHistoryCoverage = { mode: r.mode, horizonStart: r.horizonStart, horizonEnd: r.horizonEnd,
    threshold: r.threshold, eligibleRows: r.eligibleRows, rowCount: r.points.length, capped: false, excludedBoundaryDate: null,
    firstDate: r.points[0]?.date ?? null, lastDate: r.latestDate, missingPrices: price.filter(p => p.price === null).length,
    latestPartialWeek: r.mode === 'weekly' && r.points.at(-1)?.currentWeek === true,
    latestObservedDays: r.mode === 'weekly' ? r.points.at(-1)?.observedDays : undefined };
  price.coverage = rank.coverage = coverage;
  return { price, rank };
}
