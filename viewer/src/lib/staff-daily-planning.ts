import { previousCalendarDate, validDailyDate } from './ranking-daily-insights';
import type { RankingSourceContext } from './notes/ranking-context';

/** Worker briefing cutoff: briefing D uses observations D−1 versus D−2. */
export function staffDailyPlanningScope(briefingDate: string, today: string): RankingSourceContext | null {
  if (!validDailyDate(briefingDate) || !validDailyDate(today) || briefingDate > today) return null;
  const date = previousCalendarDate(briefingDate);
  if (!validDailyDate(date)) return null;
  return { version: 1, kind: 'ranking', period: 'today', fromDate: '', toDate: '',
    resolvedFromDate: date, resolvedToDate: date,
    selectedCategory: '000', gender: 'A', age: 'AGE_BAND_ALL', price: [0, 50],
    companies: [], brands: [], ownOnly: false, moverOnly: false,
    sort: 'rank', sortDir: 'asc', page: 1 };
}
