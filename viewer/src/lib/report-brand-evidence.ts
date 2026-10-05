import { supabaseBrowser } from './supabase/client';
import type { BrandRankRow } from './queries-report';

export interface BrandEvidence {
  date: string | null;
  comparisonDate: string | null;
  sampledRows: number;
  atLimit: boolean;
  rows: BrandRankRow[];
}

/** One bounded read, independent of product ranking dates. No completeness claim. */
export async function fetchReportBrandEvidence(signal: AbortSignal): Promise<BrandEvidence> {
  const { data, error } = await supabaseBrowser().from('brand_ranking_snapshots')
    .select('rank_position, brand_name, snapshot_date, brands(is_own)')
    .eq('category_code', '000').eq('gender_filter', 'A').eq('age_filter', 'AGE_BAND_ALL')
    .order('snapshot_date', { ascending: false }).order('rank_position', { ascending: true })
    .limit(400).abortSignal(signal);
  if (error || !Array.isArray(data)) throw new Error('브랜드 순위 조회 실패');
  const valid = data.every(row => typeof row.snapshot_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.snapshot_date)
    && Number.isFinite(Date.parse(row.snapshot_date + 'T00:00:00Z'))
    && new Date(row.snapshot_date + 'T00:00:00Z').toISOString().slice(0, 10) === row.snapshot_date
    && Number.isInteger(row.rank_position) && row.rank_position > 0 && typeof row.brand_name === 'string');
  if (!valid) throw new Error('브랜드 순위 기준일 또는 행 확인 실패');
  const dates = [...new Set(data.map(row => row.snapshot_date as string))].sort().reverse();
  const date = dates[0] ?? null, comparisonDate = dates[1] ?? null;
  const previous = new Map(data.filter(row => row.snapshot_date === comparisonDate).map(row => [row.brand_name, row.rank_position]));
  return { date, comparisonDate, sampledRows: data.length, atLimit: data.length === 400,
    rows: data.filter(row => row.snapshot_date === date).sort((a, b) => a.rank_position - b.rank_position).slice(0, 30).map(row => ({
      rank: row.rank_position, brandName: row.brand_name,
      rankChange: previous.has(row.brand_name) ? previous.get(row.brand_name)! - row.rank_position : null,
      isOwn: (row.brands as unknown as { is_own?: boolean } | null)?.is_own ?? false,
    })) };
}
