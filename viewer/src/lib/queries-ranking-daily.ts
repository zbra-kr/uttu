import { supabaseBrowser } from './supabase/client';
import { DAILY_STORE, DAILY_RANK_LIMIT, DAILY_READ_LIMIT, previousCalendarDate, validateDailyRequest, validDailyDate,
  type DailyRequest, type DailyData, type DailyObservation } from './ranking-daily-insights';

/** One optional latest-date read and two bounded date reads; no per-product requests. */
export async function fetchRankingDaily(request: DailyRequest, signal?: AbortSignal): Promise<DailyData> {
  if (!validateDailyRequest(request)) throw new Error('Invalid daily ranking scope');
  const client = supabaseBrowser();
  const guard = () => { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); };
  const segment = <Columns extends string>(columns: Columns) => client.from('ranking_snapshots').select(columns)
    .eq('store_code', DAILY_STORE).eq('category_code', request.categoryCode)
    .eq('gender_filter', request.genderFilter).eq('age_filter', request.ageFilter);
  let date = request.date;
  guard();
  if (!date) {
    let query = segment('snapshot_date,store_code')
      .order('snapshot_date', { ascending: false }).limit(1);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    guard();
    if (error) throw error;
    const latest = data?.[0];
    if (!latest) return { request, date: null, previousDate: null, current: [], previous: [] };
    date = latest.snapshot_date;
    if (latest.store_code !== DAILY_STORE || !validDailyDate(date)) throw new Error('Invalid observed ranking date or store');
  }
  const previousDate = previousCalendarDate(date!);
  const readDate = async (day: string): Promise<DailyObservation[]> => {
    guard();
    let query = segment(`store_code,snapshot_date,category_code,gender_filter,age_filter,
      musinsa_no,rank_position,product_name,brand_name,final_price,discount_rate,
      products(is_own,brands(companies(corp_name)))`)
      .eq('snapshot_date', day).lte('rank_position', DAILY_RANK_LIMIT)
      .order('rank_position', { ascending: true }).order('musinsa_no', { ascending: true }).limit(DAILY_READ_LIMIT);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    guard();
    if (error) throw error;
    if (data !== null && !Array.isArray(data)) throw new Error('Invalid ranking response');
    return (data || []) as DailyObservation[];
  };
  const [current, previous] = await Promise.all([readDate(date!), readDate(previousDate)]);
  return { request, date: date!, previousDate, current, previous };
}
