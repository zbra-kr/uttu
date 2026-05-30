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
}

export interface CompetitorRankKpi {
  slug: string;
  name: string;
  rank: number;
  is_own: boolean;
}

export interface BriefingKpiData {
  own_brands: OwnBrandKpi[];
  anomalies: AnomalyKpi;
  competitor_top5: CompetitorRankKpi[];
}

const OWN_MAIN_SLUGS = ['covernat', 'lee', 'wackywilly'];
const OWN_SLUGS_SET  = new Set(OWN_MAIN_SLUGS);

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export async function fetchBriefingKpiData(date: string): Promise<BriefingKpiData> {
  const sb        = supabaseBrowser();
  const yesterday = addDays(date, -1);
  const since     = addDays(date, -7);
  const dayBefore = addDays(date, -2);

  const [rankRes, brandRes, anomalyRes, compRes] = await Promise.all([
    sb.from('ranking_snapshots')
      .select('brand_slug, snapshot_date, rank_position')
      .in('brand_slug', OWN_MAIN_SLUGS)
      .gte('snapshot_date', since)
      .lte('snapshot_date', yesterday)
      .eq('gender_filter', 'A')
      .eq('age_filter', 'AGE_BAND_ALL')
      .order('snapshot_date')
      .limit(2000),

    sb.from('brands').select('slug, name').in('slug', OWN_MAIN_SLUGS),

    sb.from('anomalies')
      .select('severity')
      .gte('detection_date', yesterday)
      .lte('detection_date', yesterday)
      .limit(300),

    sb.from('brand_ranking_snapshots')
      .select('musinsa_brand_slug, brand_name, rank_position')
      .eq('snapshot_date', yesterday)
      .eq('category_code', '000')
      .eq('gender_filter', 'A')
      .eq('age_filter', 'AGE_BAND_ALL')
      .order('rank_position')
      .limit(5),
  ]);

  if (anomalyRes.error) console.error('[kpi] anomaly query error:', anomalyRes.error);
  if (compRes.error)    console.error('[kpi] competitor query error:', compRes.error);

  // ── 자사 브랜드명 ──────────────────────────────────────────
  const brandNames: Record<string, string> = {};
  for (const b of (brandRes.data ?? [])) brandNames[b.slug] = b.name;

  // ── 자사 순위 집계 ─────────────────────────────────────────
  const byBrandDate: Record<string, Record<string, number[]>> = {};
  for (const row of (rankRes.data ?? [])) {
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
  const anomalies: AnomalyKpi = { high: 0, medium: 0, low: 0, total: 0 };
  for (const row of (anomalyRes.data ?? [])) {
    const s = (row.severity ?? '').toLowerCase();
    anomalies.total++;
    if (s === 'high')        anomalies.high++;
    else if (s === 'medium') anomalies.medium++;
    else                     anomalies.low++;
  }

  // ── 경쟁사 TOP5 ────────────────────────────────────────────
  const competitor_top5: CompetitorRankKpi[] = (compRes.data ?? []).map(row => ({
    slug:   row.musinsa_brand_slug,
    name:   row.brand_name,
    rank:   row.rank_position,
    is_own: OWN_SLUGS_SET.has(row.musinsa_brand_slug),
  }));

  return { own_brands, anomalies, competitor_top5 };
}
