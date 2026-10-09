'use client';
import { supabaseBrowser } from './supabase/client';

export interface OwnBrandKpi {
  slug: string;
  name: string;
  best_rank_yesterday: number | null;
  rank_delta: number | null; // positive = improved (smaller rank number = better)
  weekly_trend: { date: string; best_rank: number }[];
}

export interface AnomalyKpi {
  high: number;
  medium: number;
  low: number;
  total: number;
  unknown: number;
}

export interface CompetitorRankKpi {
  slug: string;
  name: string;
  rank: number;
  is_own: boolean;
}

export type KpiStatus = 'complete' | 'truncated' | 'invalid' | 'unavailable';

export interface BriefingKpiData {
  source_date: string;
  since: string;
  rank_status: KpiStatus;
  anomaly_status: KpiStatus;
  competitor_status: KpiStatus;
  own_brands: OwnBrandKpi[];
  anomalies: AnomalyKpi;
  competitor_top5: CompetitorRankKpi[];
}

const OWN_MAIN_SLUGS = ['covernat', 'lee', 'wackywilly'];
const OWN_SLUGS_SET  = new Set(OWN_MAIN_SLUGS);

export function addDays(dateStr: string, n: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new Error('Invalid briefing date');
  const dt = new Date(`${dateStr}T00:00:00Z`);
  if (!Number.isFinite(dt.getTime()) || dt.toISOString().slice(0, 10) !== dateStr) throw new Error('Invalid briefing date');
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// count is the exact number visible under the existing reader's RLS. It proves
// query completeness, not upstream collection completeness. Missing/invalid
// count is unverified even if a server silently returns fewer than the limit.
function status(result: { error: unknown; data: unknown; count?: number | null }, ceiling?: number): KpiStatus {
  if (result.error || !Array.isArray(result.data)) return 'unavailable';
  if (!Number.isSafeInteger(result.count) || result.count! < 0) return 'truncated';
  const expected = ceiling === undefined ? result.count! : Math.min(ceiling, result.count!);
  return result.data.length === expected ? 'complete' : 'truncated';
}
const validRank = (rank: unknown): rank is number => typeof rank === 'number' && Number.isSafeInteger(rank) && rank > 0;

export async function fetchBriefingKpiData(date: string, signal?: AbortSignal): Promise<BriefingKpiData> {
  const yesterday = addDays(date, -1);
  const since     = addDays(date, -7);
  const dayBefore = addDays(date, -2);

  const sb = supabaseBrowser();
  const queries = [
    sb.from('ranking_snapshots')
      .select('brand_slug, snapshot_date, rank_position', { count: 'exact' })
      .in('brand_slug', OWN_MAIN_SLUGS)
      .gte('snapshot_date', since)
      .lte('snapshot_date', yesterday)
      .eq('gender_filter', 'A')
      .eq('age_filter', 'AGE_BAND_ALL')
      .order('snapshot_date')
      .limit(2000),

    sb.from('brands').select('slug, name').in('slug', OWN_MAIN_SLUGS),

    sb.from('anomalies')
      .select('severity, detection_date', { count: 'exact' })
      .gte('detection_date', yesterday)
      .lte('detection_date', yesterday)
      .limit(300),

    sb.from('brand_ranking_snapshots')
      .select('musinsa_brand_slug, brand_name, rank_position, snapshot_date', { count: 'exact' })
      .eq('snapshot_date', yesterday)
      .eq('category_code', '000')
      .eq('gender_filter', 'A')
      .eq('age_filter', 'AGE_BAND_ALL')
      .order('rank_position')
      .limit(5),
  ] as const;
  if (signal) queries.forEach(query => query.abortSignal(signal));
  const settled = await Promise.allSettled(queries);
  const unwrap = <T,>(result: PromiseSettledResult<T>): T | { data: null; error: true; count: null } =>
    result.status === 'fulfilled' ? result.value : { data: null, error: true, count: null };
  const rankRes = unwrap(settled[0]), brandRes = unwrap(settled[1]);
  const anomalyRes = unwrap(settled[2]), compRes = unwrap(settled[3]);
  let rank_status = status(rankRes);
  let anomaly_status = status(anomalyRes);
  let competitor_status = status(compRes, 5);
  if (rank_status === 'complete' && rankRes.data!.some(row =>
    !row || !OWN_SLUGS_SET.has(row.brand_slug) || typeof row.snapshot_date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.snapshot_date) ||
    row.snapshot_date < since || row.snapshot_date > yesterday || !validRank(row.rank_position) ||
    (() => { try { return addDays(row.snapshot_date, 0) !== row.snapshot_date; } catch { return true; } })())) rank_status = 'invalid';
  if (competitor_status === 'complete' && compRes.data!.some(row =>
    !row || row.snapshot_date !== yesterday || !validRank(row.rank_position) || typeof row.musinsa_brand_slug !== 'string' || !row.musinsa_brand_slug ||
    typeof row.brand_name !== 'string')) competitor_status = 'invalid';

  // ── 자사 브랜드명 ──────────────────────────────────────────
  const brandNames: Record<string, string> = {};
  for (const b of (brandRes.error || !Array.isArray(brandRes.data) ? [] : brandRes.data)) {
    if (b && typeof b.slug === 'string' && typeof b.name === 'string') brandNames[b.slug] = b.name;
  }

  // ── 자사 순위 집계 ─────────────────────────────────────────
  const byBrandDate: Record<string, Record<string, number[]>> = {};
  for (const row of (rank_status === 'complete' ? rankRes.data ?? [] : [])) {
    (byBrandDate[row.brand_slug] ??= {})[row.snapshot_date] ??= [];
    byBrandDate[row.brand_slug][row.snapshot_date].push(row.rank_position);
  }
  const dates = Array.from({ length: 7 }, (_, i) => addDays(date, i - 7));

  const own_brands: OwnBrandKpi[] = OWN_MAIN_SLUGS.map(slug => {
    const byDate = byBrandDate[slug] ?? {};
    const weekly_trend = dates
      .map(d => ({ date: d, best_rank: byDate[d] ? Math.min(...byDate[d]) : null }))
      .filter((t): t is { date: string; best_rank: number } => t.best_rank !== null);

    const best_rank_yesterday  = byDate[yesterday] ? Math.min(...byDate[yesterday]) : null;
    const best_rank_day_before = byDate[dayBefore] ? Math.min(...byDate[dayBefore]) : null;
    const rank_delta = best_rank_yesterday !== null && best_rank_day_before !== null
      ? best_rank_day_before - best_rank_yesterday : null;

    return { slug, name: brandNames[slug] ?? slug, best_rank_yesterday, rank_delta, weekly_trend };
  });

  // ── 이상탐지 집계 ──────────────────────────────────────────
  const anomalies: AnomalyKpi = { high: 0, medium: 0, low: 0, total: 0, unknown: 0 };
  for (const row of (anomalyRes.error || !Array.isArray(anomalyRes.data) ? [] : anomalyRes.data)) {
    if (!row || row.detection_date !== yesterday) {
      anomaly_status = 'invalid';
      anomalies.unknown++;
      continue;
    }
    const s = typeof row.severity === 'string' ? row.severity.toLowerCase() : '';
    anomalies.total++;
    if (s === 'high')        anomalies.high++;
    else if (s === 'medium') anomalies.medium++;
    else if (s === 'low')    anomalies.low++;
    else { anomalies.unknown++; if (anomaly_status === 'complete') anomaly_status = 'invalid'; }
  }

  // ── 경쟁사 TOP5 ────────────────────────────────────────────
  const competitor_top5: CompetitorRankKpi[] = (competitor_status === 'complete' ? compRes.data ?? [] : []).map(row => ({
    slug:   row.musinsa_brand_slug,
    name:   row.brand_name,
    rank:   row.rank_position,
    is_own: OWN_SLUGS_SET.has(row.musinsa_brand_slug),
  }));

  return { source_date: yesterday, since, rank_status, anomaly_status, competitor_status, own_brands, anomalies, competitor_top5 };
}
