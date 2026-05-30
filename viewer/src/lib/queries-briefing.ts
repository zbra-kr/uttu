'use client';
import { supabaseBrowser } from './supabase/client';

export interface BriefingInsight {
  title: string;
  body: string;
  link?: string;
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

export function kstToday(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

export async function fetchAvailableBriefingDates(): Promise<string[]> {
  const sb = supabaseBrowser();
  const d = new Date();
  d.setDate(d.getDate() - 60);
  const since = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

  const { data, error } = await sb
    .from('daily_briefings')
    .select('briefing_date')
    .gte('briefing_date', since)
    .order('briefing_date', { ascending: false })
    .limit(180); // max 3 per day × 60 days

  if (error) {
    console.error('[briefing] dates query failed', error);
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const row of (data ?? [])) {
    const dt = row.briefing_date as string;
    if (!seen.has(dt)) { seen.add(dt); result.push(dt); }
  }
  return result;
}

export async function fetchAllBriefings(date?: string): Promise<AllBriefings> {
  const sb = supabaseBrowser();
  const target = date ?? kstToday();

  const { data, error } = await sb
    .from('daily_briefings')
    .select('briefing_date,audience,headline,daily_brief,weekly_brief,card_comments,insights,news_picks,generated_at,model')
    .eq('briefing_date', target)
    .limit(3);

  if (error) {
    console.error('[briefing] query failed', error);
    return { executive: null, staff: null, cs: null, briefing_date: target };
  }

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
