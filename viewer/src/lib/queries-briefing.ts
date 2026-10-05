'use client';
import { supabaseBrowser } from './supabase/client';
import { kstToday } from './format';
export { kstToday };

export interface BriefingInsight {
  title: string;
  body: string;
  link?: string;
}

export interface InsightKeyMetric {
  label: string;
  value: string;
  change?: string;
}

export interface InsightChart {
  type: 'bar' | 'line';
  title: string;
  x_labels: string[];
  series: { name: string; values: number[] }[];
  reversed?: boolean;
}

export interface InsightPage {
  idx: number;
  title: string;
  body: string;
  link: string;
  article: string;
  key_metrics: InsightKeyMetric[];
  chart: InsightChart | null;
}

export interface BriefingNewsPick {
  headline: string;
  summary: string;
  source_name: string;
  source_url: string;
  relevance: number;
}

export interface Briefing {
  briefing_date: string;
  audience: 'executive' | 'staff' | 'cs';
  headline: string;
  daily_brief: string[];
  weekly_brief?: string[];
  card_comments: Record<string, string>;
  insights: BriefingInsight[];
  insight_pages?: InsightPage[];
  news_picks?: BriefingNewsPick[];
  generated_at: string;
  model: string;
}

export interface AllBriefings {
  executive: Briefing | null;
  staff: Briefing | null;
  cs: Briefing | null;
  briefing_date: string;
}

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
function validInsightPage(page: InsightPage): boolean {
  if (!page || !Number.isInteger(page.idx) || page.idx < 0 || [page.title, page.body, page.link, page.article].some(value => typeof value !== 'string') ||
    !Array.isArray(page.key_metrics) || page.key_metrics.some(metric => !metric || typeof metric.label !== 'string' || typeof metric.value !== 'string' || (metric.change != null && typeof metric.change !== 'string'))) return false;
  const chart = page.chart;
  return chart == null || (['bar', 'line'].includes(chart.type) && typeof chart.title === 'string' && strings(chart.x_labels) && Array.isArray(chart.series) &&
    chart.series.every(series => series && typeof series.name === 'string' && Array.isArray(series.values) && series.values.every(Number.isFinite)));
}

export async function fetchAvailableBriefingDates(signal?: AbortSignal): Promise<string[]> {
  const sb = supabaseBrowser();
  const d = new Date();
  d.setDate(d.getDate() - 60);
  const since = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

  const query = sb
    .from('daily_briefings')
    .select('briefing_date')
    .gte('briefing_date', since)
    .order('briefing_date', { ascending: false })
    .limit(180); // max 3 per day × 60 days

  if (signal) query.abortSignal(signal);
  const { data, error } = await query;
  if (error || !Array.isArray(data) || data.some(row => !row || typeof row.briefing_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.briefing_date))) throw new Error('Briefing dates unavailable');

  const seen = new Set<string>();
  const result: string[] = [];
  for (const row of (data ?? [])) {
    const dt = row.briefing_date as string;
    if (!seen.has(dt)) { seen.add(dt); result.push(dt); }
  }
  return result;
}

export async function fetchAllBriefings(date?: string, signal?: AbortSignal): Promise<AllBriefings> {
  const sb = supabaseBrowser();
  const target = date ?? kstToday();

  const query = sb
    .from('daily_briefings')
    .select('briefing_date,audience,headline,daily_brief,weekly_brief,card_comments,insights,insight_pages,news_picks,generated_at,model')
    .eq('briefing_date', target)
    .limit(3);

  if (signal) query.abortSignal(signal);
  const { data, error } = await query;
  if (error || !Array.isArray(data) || data.some(row => !row || row.briefing_date !== target ||
    !['executive', 'staff', 'cs'].includes(row.audience) || typeof row.headline !== 'string' ||
    !strings(row.daily_brief) || (row.weekly_brief != null && !strings(row.weekly_brief)) ||
    !row.card_comments || typeof row.card_comments !== 'object' || Array.isArray(row.card_comments) ||
    Object.values(row.card_comments).some(value => typeof value !== 'string') ||
    !Array.isArray(row.insights) || row.insights.some((insight: BriefingInsight) => !insight || typeof insight.title !== 'string' || typeof insight.body !== 'string' || (insight.link != null && typeof insight.link !== 'string')) ||
    (row.news_picks != null && (!Array.isArray(row.news_picks) || row.news_picks.some((pick: BriefingNewsPick) => !pick ||
      typeof pick.headline !== 'string' || typeof pick.summary !== 'string' || typeof pick.source_name !== 'string' || typeof pick.source_url !== 'string' ||
      !Number.isFinite(pick.relevance) || pick.relevance < 0 || pick.relevance > 5))) ||
    (row.insight_pages != null && (!Array.isArray(row.insight_pages) || !row.insight_pages.every(validInsightPage))))) throw new Error('Briefing unavailable');
  if (new Set(data.map(row => row.audience)).size !== data.length) throw new Error('Ambiguous briefing');

  const map: Record<string, Briefing> = {};
  for (const row of (data ?? [])) {
    map[row.audience] = row as Briefing;
  }

  return {
    executive: (map['executive'] as Briefing) ?? null,
    staff: (map['staff'] as Briefing) ?? null,
    cs: (map['cs'] as Briefing) ?? null,
    briefing_date: target,
  };
}
