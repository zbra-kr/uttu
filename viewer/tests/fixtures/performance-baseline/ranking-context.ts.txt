/** Persisted, portable ranking filters. Entity grouping still uses the four legacy keys. */
export interface RankingSourceContext {
  version: 1;
  kind: 'ranking';
  period: 'today' | '7d' | '30d' | '90d' | 'custom';
  fromDate: string;
  toDate: string;
  selectedCategory: string;
  gender: string;
  age: string;
  price: [number, number];
  companies: string[];
  brands: string[];
  ownOnly: boolean;
  moverOnly: boolean;
  sort: string;
  sortDir: 'asc' | 'desc';
  page: number;
  /** Pin the query dates without changing the original period/entity grouping. */
  resolvedFromDate?: string;
  resolvedToDate?: string;
  /** Existing notes did not save the other filters or absolute dates. */
  legacy?: true;
}

const PERIODS = new Set(['today', '7d', '30d', '90d', 'custom']);
const CATEGORIES = new Set(['000', '001', '002', '003', '004', '017', '026', '100', '101', '102', '103', '104', '106']);
const GENDERS = new Set(['A', 'M', 'F']);
const AGES = new Set(['AGE_BAND_ALL', 'AGE_BAND_MINOR', 'AGE_BAND_20', 'AGE_BAND_25', 'AGE_BAND_30', 'AGE_BAND_35', 'AGE_BAND_40']);
const SORTS = new Set(['rank', 'change', 'rating', 'reviews', 'name']);
const CORE_KEYS = ['age', 'category', 'gender', 'period'];
const OBJECT_KEYS = new Set(['version', 'kind', 'period', 'fromDate', 'toDate', 'selectedCategory', 'gender', 'age', 'price', 'companies', 'brands', 'ownOnly', 'moverOnly', 'sort', 'sortDir', 'page', 'resolvedFromDate', 'resolvedToDate', 'legacy']);
const QUERY_KEYS = new Set(['context', 'period', 'fromDate', 'toDate', 'category', 'gender', 'age', 'priceMin', 'priceMax', 'company', 'brand', 'ownOnly', 'moverOnly', 'sort', 'sortDir', 'page', 'resolvedFromDate', 'resolvedToDate', 'note', 'notes']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const inSet = (value: unknown, allowed: Set<string>): value is string => typeof value === 'string' && allowed.has(value);

function date(value: unknown, empty = false): value is string {
  if (empty && value === '') return true;
  if (typeof value !== 'string' || !/^(20\d{2}|2100)-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function dateRange(from: string, to: string): boolean {
  // fetchLatestRanking issues one query per day; never accept an unbounded fan-out.
  return from <= to && (Date.parse(to) - Date.parse(from)) / 86_400_000 < 366;
}

function names(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 20 && value.every(item =>
    typeof item === 'string' && item.length > 0 && item.length <= 100
    && item.trim() === item && !/[\u0000-\u001f\u007f]/.test(item));
}

function coreFromEntity(entityId: string): { period: string; category: string; gender: string; age: string } | null {
  if (typeof entityId !== 'string' || entityId.length > 256) return null;
  const query = new URLSearchParams(entityId);
  if ([...query.keys()].length !== 4 || CORE_KEYS.some(key => query.getAll(key).length !== 1)
    || [...query.keys()].some(key => !CORE_KEYS.includes(key))) return null;
  const period = query.get('period'), category = query.get('category'), gender = query.get('gender'), age = query.get('age');
  if (!inSet(period, PERIODS) || !inSet(category, CATEGORIES) || !inSet(gender, GENDERS) || !inSet(age, AGES)) return null;
  return { period, category, gender, age };
}

export function validateRankingSourceContext(value: unknown, entityId?: string): RankingSourceContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !OBJECT_KEYS.has(key)) || input.version !== 1 || input.kind !== 'ranking'
    || !inSet(input.period, PERIODS) || !inSet(input.selectedCategory, CATEGORIES)
    || !inSet(input.gender, GENDERS) || !inSet(input.age, AGES) || !inSet(input.sort, SORTS)
    || (input.sortDir !== 'asc' && input.sortDir !== 'desc')
    || typeof input.ownOnly !== 'boolean' || typeof input.moverOnly !== 'boolean'
    || (input.legacy !== undefined && input.legacy !== true)
    || !Number.isInteger(input.page) || (input.page as number) < 1 || (input.page as number) > 2196
    || !date(input.fromDate, true) || !date(input.toDate, true)
    || !names(input.companies) || !names(input.brands)
    || !Array.isArray(input.price) || input.price.length !== 2
    || !input.price.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 50 && /^\d+(?:\.\d{1,2})?$/.test(String(n)))
    || input.price[0] >= input.price[1]) return null;
  const hasResolved = input.resolvedFromDate !== undefined || input.resolvedToDate !== undefined;
  if (hasResolved && (!date(input.resolvedFromDate) || !date(input.resolvedToDate)
    || !dateRange(input.resolvedFromDate, input.resolvedToDate))) return null;
  if (hasResolved && input.period === 'today' && input.resolvedFromDate !== input.resolvedToDate) return null;
  if (hasResolved && ['7d', '30d', '90d'].includes(input.period)
    && (Date.parse(input.resolvedToDate as string) - Date.parse(input.resolvedFromDate as string)) / 86_400_000
      !== Number(input.period.slice(0, -1)) - 1) return null;
  if (input.legacy === true && (hasResolved || input.period === 'custom' || input.fromDate || input.toDate
    || input.companies.length || input.brands.length || input.price[0] !== 0 || input.price[1] !== 50
    || input.ownOnly || input.moverOnly || input.sort !== 'rank' || input.sortDir !== 'asc' || input.page !== 1)) return null;
  if (input.period === 'custom') {
    const from = input.fromDate || input.resolvedFromDate;
    const to = input.toDate || input.resolvedToDate;
    if (!date(from) || !date(to) || !dateRange(from, to)) return null;
    if (hasResolved && ((input.fromDate && input.fromDate !== input.resolvedFromDate)
      || (input.toDate && input.toDate !== input.resolvedToDate))) return null;
  }
  if (entityId !== undefined) {
    const core = coreFromEntity(entityId);
    if (!core || core.period !== input.period || core.category !== input.selectedCategory
      || core.gender !== input.gender || core.age !== input.age) return null;
  }
  const result: RankingSourceContext = {
    version: 1, kind: 'ranking', period: input.period as RankingSourceContext['period'],
    fromDate: input.fromDate, toDate: input.toDate, selectedCategory: input.selectedCategory,
    gender: input.gender, age: input.age, price: [input.price[0], input.price[1]],
    companies: [...new Set(input.companies)].sort(), brands: [...new Set(input.brands)].sort(),
    ownOnly: input.ownOnly, moverOnly: input.moverOnly, sort: input.sort, sortDir: input.sortDir, page: input.page as number,
    ...(hasResolved ? { resolvedFromDate: input.resolvedFromDate as string, resolvedToDate: input.resolvedToDate as string } : {}),
    ...(input.legacy === true ? { legacy: true } : {}),
  };
  return queryForContext(result).toString().length <= 5000 ? result : null;
}

/** Legacy notes can restore only these four fields, never missing custom dates. */
export function rankingSourceFromEntity(entityId: string): RankingSourceContext | null {
  const core = coreFromEntity(entityId);
  if (!core || core.period === 'custom') return null;
  return validateRankingSourceContext({ version: 1, kind: 'ranking', period: core.period,
    fromDate: '', toDate: '', selectedCategory: core.category, gender: core.gender, age: core.age,
    price: [0, 50], companies: [], brands: [], ownOnly: false, moverOnly: false, sort: 'rank', sortDir: 'asc', page: 1, legacy: true });
}

function queryForContext(valid: RankingSourceContext): URLSearchParams {
  const query = new URLSearchParams({ context: valid.legacy ? 'ranking-legacy-v1' : 'ranking-v1', period: valid.period, fromDate: valid.fromDate,
    toDate: valid.toDate, category: valid.selectedCategory, gender: valid.gender, age: valid.age,
    priceMin: String(valid.price[0]), priceMax: String(valid.price[1]), ownOnly: valid.ownOnly ? '1' : '0',
    moverOnly: valid.moverOnly ? '1' : '0', sort: valid.sort, sortDir: valid.sortDir, page: String(valid.page) });
  for (const name of valid.companies) query.append('company', name);
  for (const name of valid.brands) query.append('brand', name);
  if (valid.resolvedFromDate && valid.resolvedToDate) {
    query.set('resolvedFromDate', valid.resolvedFromDate);
    query.set('resolvedToDate', valid.resolvedToDate);
  }
  return query;
}

export function rankingContextToSearchParams(context: RankingSourceContext): URLSearchParams {
  const valid = validateRankingSourceContext(context);
  if (!valid) throw new Error('Invalid ranking source context');
  return queryForContext(valid);
}

export function rankingContextFromSearchParams(params: Pick<URLSearchParams, 'toString'>): RankingSourceContext | null {
  const raw = params.toString();
  if (raw.length > 6000) return null;
  const query = new URLSearchParams(raw);
  if ([...query.keys()].some(key => !QUERY_KEYS.has(key))
    || [...query.keys()].some(key => key !== 'company' && key !== 'brand' && query.getAll(key).length !== 1)
    || (query.has('note') && !UUID.test(query.get('note')!))
    || (query.has('notes') && query.get('notes') !== 'open')) return null;
  if (query.get('context') !== 'ranking-v1' && query.get('context') !== 'ranking-legacy-v1') return null;
  const number = (key: string): number => {
    const value = query.get(key);
    return value !== null && /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value) ? Number(value) : NaN;
  };
  if (!['0', '1'].includes(query.get('ownOnly') ?? '') || !['0', '1'].includes(query.get('moverOnly') ?? '')) return null;
  return validateRankingSourceContext({ version: 1, kind: 'ranking', period: query.get('period'),
    fromDate: query.get('fromDate'), toDate: query.get('toDate'), selectedCategory: query.get('category'),
    gender: query.get('gender'), age: query.get('age'), price: [number('priceMin'), number('priceMax')],
    companies: query.getAll('company'), brands: query.getAll('brand'), ownOnly: query.get('ownOnly') === '1',
    moverOnly: query.get('moverOnly') === '1', sort: query.get('sort'), sortDir: query.get('sortDir'), page: number('page'),
    ...(query.has('resolvedFromDate') || query.has('resolvedToDate')
      ? { resolvedFromDate: query.get('resolvedFromDate'), resolvedToDate: query.get('resolvedToDate') } : {}),
    ...(query.get('context') === 'ranking-legacy-v1' ? { legacy: true } : {}),
  });
}
