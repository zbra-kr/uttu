import { validateRankingSourceContext, type RankingSourceContext } from './notes/ranking-context';

// The snapshot schema and collector use this exact store identifier.
export const DAILY_STORE = 'musinsa';
export const DAILY_RANK_LIMIT = 300;
// Supabase defaults to 1,000 returned rows. Treat that boundary as incomplete,
// including an exactly full response, rather than relying on an unreachable extra row.
export const DAILY_READ_LIMIT = 1000;

export interface DailyRequest { categoryCode: string; genderFilter: string; ageFilter: string; date?: string }
export interface DailyObservation {
  store_code: unknown; snapshot_date: unknown; category_code: unknown; gender_filter: unknown; age_filter: unknown;
  musinsa_no: unknown; rank_position: unknown; product_name?: unknown; brand_name?: unknown;
  final_price?: unknown; discount_rate?: unknown;
  products?: { is_own?: unknown; brands?: { companies?: { corp_name?: unknown } | null } | null } | null;
}
export interface DailyData {
  request: DailyRequest; date: string | null; previousDate: string | null;
  current: DailyObservation[]; previous: DailyObservation[];
}
export interface DailyRow {
  product: string; rank: number; name: string; brand: string | null; company: string | null;
  price: number | null; discount: number | null; own: boolean | null;
}
export interface DailyRiser { current: DailyRow; previous: DailyRow; rise: number; discountPoints: number | null }
export interface DailyComparison {
  status: 'ready' | 'partial' | 'missing-current' | 'missing-previous' | 'capped';
  risers: DailyRiser[]; matched: number; missingPrevious: number; invalidRows: number;
  ambiguousRows: number; ambiguousPairs: number; unknownFilterRows: number; unknownMetrics: number;
}

export function validDailyDate(value: unknown): value is string {
  return typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
    && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}
export function previousCalendarDate(date: string): string {
  if (!validDailyDate(date)) throw new Error('Invalid observation date');
  return new Date(Date.parse(date + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10);
}
export function dailyRequest(context: RankingSourceContext | null): DailyRequest | null {
  const scope = validateRankingSourceContext(context);
  if (!scope) return null;
  let date: string | undefined;
  if (scope.period === 'today') date = scope.resolvedToDate;
  else if (scope.period === 'custom') {
    const from = scope.resolvedFromDate || scope.fromDate;
    const to = scope.resolvedToDate || scope.toDate;
    if (!validDailyDate(from) || from !== to) return null;
    date = to;
  } else return null;
  return { categoryCode: scope.selectedCategory, genderFilter: scope.gender, ageFilter: scope.age, ...(date ? { date } : {}) };
}
export function validateDailyRequest(request: DailyRequest): boolean {
  return !!dailyRequest({ version: 1, kind: 'ranking', period: 'today', fromDate: '', toDate: '',
    selectedCategory: request.categoryCode, gender: request.genderFilter, age: request.ageFilter,
    price: [0, 50], companies: [], brands: [], ownOnly: false, moverOnly: false,
    sort: 'rank', sortDir: 'asc', page: 1,
  }) && (request.date === undefined || validDailyDate(request.date));
}
export function pinDailyContext(context: RankingSourceContext, date: string): RankingSourceContext | null {
  if (!validDailyDate(date) || !dailyRequest(context)) return null;
  return validateRankingSourceContext({ ...context, resolvedFromDate: date, resolvedToDate: date });
}

function productKey(value: unknown): string | null {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value);
  return /^[1-9]\d{0,19}$/.test(text) ? text : null;
}
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const metric = (value: unknown, max = Infinity): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
function scopeMatches(row: DailyObservation, request: DailyRequest, date: string) {
  return !!row && typeof row === 'object' && row.store_code === DAILY_STORE && row.snapshot_date === date && row.category_code === request.categoryCode
    && row.gender_filter === request.genderFilter && row.age_filter === request.ageFilter;
}
function normalizeDay(rows: DailyObservation[], request: DailyRequest, date: string) {
  const products = new Map<string, number>(), ranks = new Map<number, number>(), tainted = new Set<string>();
  let invalid = 0, ambiguous = 0;
  for (const row of rows) {
    if (!scopeMatches(row, request, date)) continue;
    const key = productKey(row.musinsa_no);
    if (key) products.set(key, (products.get(key) || 0) + 1);
    if (typeof row.rank_position === 'number' && Number.isInteger(row.rank_position) && row.rank_position > 0 && row.rank_position <= DAILY_RANK_LIMIT) {
      ranks.set(row.rank_position, (ranks.get(row.rank_position) || 0) + 1);
    }
  }
  const clean = new Map<string, DailyRow>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') { invalid++; continue; }
    const key = productKey(row.musinsa_no), rank = row.rank_position;
    if (!scopeMatches(row, request, date) || !key || typeof rank !== 'number' || !Number.isInteger(rank) || rank < 1 || rank > DAILY_RANK_LIMIT) {
      invalid++;
      if (key && scopeMatches(row, request, date)) tainted.add(key);
      continue;
    }
    if (products.get(key)! > 1 || ranks.get(rank)! > 1) { ambiguous++; tainted.add(key); continue; }
    clean.set(key, { product: key, rank, name: text(row.product_name) || `상품 #${key}`, brand: text(row.brand_name),
      company: text(row.products?.brands?.companies?.corp_name), price: metric(row.final_price), discount: metric(row.discount_rate, 100),
      own: typeof row.products?.is_own === 'boolean' ? row.products.is_own : null });
  }
  return { clean, tainted, invalid, ambiguous };
}
function currentFilter(row: DailyRow, scope?: RankingSourceContext | null): 'include' | 'exclude' | 'unknown' {
  if (!scope) return 'include';
  if (scope.brands.length && !row.brand) return 'unknown';
  if (scope.brands.length && !scope.brands.includes(row.brand!)) return 'exclude';
  if (scope.companies.length && !row.company) return 'unknown';
  if (scope.companies.length && !scope.companies.includes(row.company!)) return 'exclude';
  if (scope.ownOnly && row.own === null) return 'unknown';
  if (scope.ownOnly && !row.own) return 'exclude';
  if (scope.price[0] > 0 || scope.price[1] < 50) {
    if (row.price === null) return 'unknown';
    if (row.price < scope.price[0] * 10000 || (scope.price[1] < 50 && row.price > scope.price[1] * 10000)) return 'exclude';
  }
  return 'include';
}
export function compareDailyRanking(data: DailyData, scope?: RankingSourceContext | null): DailyComparison {
  const result: DailyComparison = { status: 'ready', risers: [], matched: 0, missingPrevious: 0, invalidRows: 0,
    ambiguousRows: 0, ambiguousPairs: 0, unknownFilterRows: 0, unknownMetrics: 0 };
  const requested = scope ? dailyRequest(scope) : data.request;
  if (!validateDailyRequest(data.request) || !requested
    || requested.categoryCode !== data.request.categoryCode || requested.genderFilter !== data.request.genderFilter || requested.ageFilter !== data.request.ageFilter
    || (data.request.date !== undefined && data.request.date !== data.date) || (requested.date !== undefined && requested.date !== data.date)) {
    return { ...result, status: 'partial', invalidRows: data.previous.length + data.current.length };
  }
  if (data.current.length >= DAILY_READ_LIMIT || data.previous.length >= DAILY_READ_LIMIT) return { ...result, status: 'capped' };
  if (!data.date || !data.current.length) return { ...result, status: 'missing-current' };
  if (!validDailyDate(data.date)) return { ...result, status: 'partial', invalidRows: data.previous.length + data.current.length };
  if (!data.previousDate || previousCalendarDate(data.date) !== data.previousDate) return { ...result, status: 'partial', invalidRows: data.previous.length + data.current.length };
  if (!data.previous.length) return { ...result, status: 'missing-previous' };
  const current = normalizeDay(data.current, data.request, data.date), previous = normalizeDay(data.previous, data.request, data.previousDate);
  result.invalidRows = current.invalid + previous.invalid;
  result.ambiguousRows = current.ambiguous + previous.ambiguous;
  for (const row of current.clean.values()) {
    const filter = currentFilter(row, scope);
    if (filter === 'unknown') { result.unknownFilterRows++; continue; }
    if (filter === 'exclude') continue;
    const before = previous.clean.get(row.product);
    if (!before) {
      if (previous.tainted.has(row.product)) result.ambiguousPairs++;
      else result.missingPrevious++;
      continue;
    }
    result.matched++;
    if (row.price === null || before.price === null || row.discount === null || before.discount === null) result.unknownMetrics++;
    const rise = before.rank - row.rank;
    if (rise > 0) result.risers.push({ current: row, previous: before, rise,
      discountPoints: row.discount === null || before.discount === null ? null : Math.round((row.discount - before.discount) * 100) / 100 });
  }
  result.risers.sort((a, b) => b.rise - a.rise || a.current.rank - b.current.rank
    || a.current.product.length - b.current.product.length || (a.current.product < b.current.product ? -1 : a.current.product > b.current.product ? 1 : 0));
  result.risers = result.risers.slice(0, 5);
  if (result.invalidRows || result.ambiguousRows || result.ambiguousPairs || result.unknownFilterRows || result.unknownMetrics) result.status = 'partial';
  return result;
}
