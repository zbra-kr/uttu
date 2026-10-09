import { previousCalendarDate, validDailyDate } from './ranking-daily-insights';
import { rankingSourceFromEntity, type RankingSourceContext } from './notes/ranking-context';

export interface StaffPlanningFilter { selectedCategory: string; gender: string; age: string }
export const DEFAULT_STAFF_FILTER: StaffPlanningFilter = { selectedCategory: '000', gender: 'A', age: 'AGE_BAND_ALL' };
const FILTER_KEYS = { selectedCategory: 'planningCategory', gender: 'planningGender', age: 'planningAge' } as const;
function validFilter(filter: StaffPlanningFilter) {
  return !!rankingSourceFromEntity(new URLSearchParams({ period: 'today', category: filter.selectedCategory, gender: filter.gender, age: filter.age }).toString());
}
/** Reuse the saved ranking context validator without broadening reads. */
export function staffPlanningFilterFromParams(params: URLSearchParams): StaffPlanningFilter | null {
  const filter = { ...DEFAULT_STAFF_FILTER };
  for (const field of Object.keys(FILTER_KEYS) as (keyof StaffPlanningFilter)[]) {
    const values = params.getAll(FILTER_KEYS[field]);
    if (values.length > 1) return null;
    if (values.length) filter[field] = values[0];
  }
  return validFilter(filter) ? filter : null;
}
export function staffPlanningFilterToParams(params: URLSearchParams, filter: StaffPlanningFilter): URLSearchParams {
  if (!validFilter(filter)) throw new Error('Invalid staff planning filter');
  const next = new URLSearchParams(params);
  for (const field of Object.keys(FILTER_KEYS) as (keyof StaffPlanningFilter)[]) next.set(FILTER_KEYS[field], filter[field]);
  return next;
}

/** Worker briefing cutoff: briefing D uses observations D−1 versus D−2. */
export function staffDailyPlanningScope(briefingDate: string, today: string, filter: StaffPlanningFilter = DEFAULT_STAFF_FILTER): RankingSourceContext | null {
  if (!validFilter(filter) || !validDailyDate(briefingDate) || !validDailyDate(today) || briefingDate > today) return null;
  const date = previousCalendarDate(briefingDate);
  if (!validDailyDate(date)) return null;
  return { version: 1, kind: 'ranking', period: 'today', fromDate: '', toDate: '',
    resolvedFromDate: date, resolvedToDate: date,
    selectedCategory: filter.selectedCategory, gender: filter.gender, age: filter.age, price: [0, 50],
    companies: [], brands: [], ownOnly: false, moverOnly: false,
    sort: 'rank', sortDir: 'asc', page: 1 };
}
