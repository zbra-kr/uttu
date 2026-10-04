import { DAILY_STORE, validDailyDate, validateDailyRequest } from './ranking-daily-insights';
import { rankingContextFromSearchParams } from './notes/ranking-context';

export interface ProductObservationContext {
  product: string;
  store: typeof DAILY_STORE;
  date: string;
  category: string;
  gender: string;
  age: string;
  back?: string;
}

export type ParsedProductObservation =
  | { kind: 'none' | 'invalid' }
  | { kind: 'valid'; value: ProductObservationContext };

const KEYS = new Set(['no', 'obs', 'store', 'date', 'category', 'gender', 'age', 'back']);
const OBS_KEYS = ['obs', 'store', 'date', 'category', 'gender', 'age', 'back'];

function validProduct(value: string | null): value is string {
  return !!value && /^[1-9]\d{0,15}$/.test(value) && Number.isSafeInteger(Number(value));
}

function validBack(value: string): boolean {
  if (!value.startsWith('/ranking?') || value.length > 6009 || value.includes('#')) return false;
  const query = new URLSearchParams(value.slice('/ranking?'.length));
  return rankingContextFromSearchParams(query) !== null;
}

export function parseProductObservation(params: URLSearchParams): ParsedProductObservation {
  if (!OBS_KEYS.some(key => params.has(key))) return { kind: 'none' };
  if (params.toString().length > 7000 || [...params.keys()].some(key => !KEYS.has(key) || params.getAll(key).length !== 1)) return { kind: 'invalid' };
  const product = params.get('no'), store = params.get('store'), date = params.get('date');
  const category = params.get('category'), gender = params.get('gender'), age = params.get('age');
  const back = params.get('back');
  if (params.get('obs') !== 'ranking-v1' || store !== DAILY_STORE || !validProduct(product)
    || !validDailyDate(date) || !category || !gender || !age
    || !validateDailyRequest({ categoryCode: category, genderFilter: gender, ageFilter: age, date })
    || (back !== null && !validBack(back))) return { kind: 'invalid' };
  return { kind: 'valid', value: { product, store, date, category, gender, age, ...(back ? { back } : {}) } };
}

export function productObservationHref(value: ProductObservationContext): string {
  const params = new URLSearchParams({ no: value.product, obs: 'ranking-v1', store: value.store,
    date: value.date, category: value.category, gender: value.gender, age: value.age });
  if (value.back) params.set('back', value.back);
  if (parseProductObservation(params).kind !== 'valid') throw new Error('Invalid product observation');
  return `/product?${params.toString()}`;
}
