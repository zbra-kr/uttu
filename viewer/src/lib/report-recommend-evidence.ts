import { supabaseBrowser } from './supabase/client';
import type { DailyReportData } from './queries-report';

export type RecommendState<T> = { state: 'loading' | 'signedout' | 'error' | 'ready'; data: T | null };
type Module = { id: string; snapshot_date: string; gender_filter: 'A'; title: string | null;
  module_type: string; position: number; items_count: number | null };
type Item = { id: string; module_id: string; snapshot_date: string; gender_filter: 'A';
  musinsa_no: string; brand_name: string | null; position: number };
export type RecommendSource<T> = { rows: T[]; latestRows: T[]; date: string | null; sampledRows: number; atLimit: boolean };
export type RecommendModules = RecommendSource<Module>;
export type RecommendItems = RecommendSource<Item>;
const MODULE_LIMIT = 50, ITEM_LIMIT = 1000;
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
function source<T extends { snapshot_date: string }>(rows: T[], limit: number): RecommendSource<T> {
  const latest = rows.length ? rows.reduce((d, r) => r.snapshot_date > d ? r.snapshot_date : d, rows[0].snapshot_date) : null;
  return { rows, latestRows: rows.filter(r => r.snapshot_date === latest), date: latest,
    sampledRows: rows.length, atLimit: rows.length >= limit };
}
export async function fetchReportRecommendModules(signal: AbortSignal): Promise<RecommendModules> {
  const { data, error } = await supabaseBrowser().from('recommend_modules')
    .select('id, title, module_type, position, items_count, snapshot_date, gender_filter').eq('gender_filter', 'A')
    .order('snapshot_date', { ascending: false }).order('position', { ascending: true })
    .order('id', { ascending: true }).limit(MODULE_LIMIT).abortSignal(signal);
  if (error || !Array.isArray(data)) throw new Error('추천 모듈 조회 실패');
  const rows: Module[] = data.map(r => {
    if (!r || !text(r.id) || !date(r.snapshot_date) || r.gender_filter !== 'A' || !text(r.module_type) || !integer(r.position))
      throw new Error('추천 모듈 식별자/기준일/조회 범위 확인 실패');
    return { id: r.id, snapshot_date: r.snapshot_date, gender_filter: 'A', title: text(r.title) ? r.title : null,
      module_type: r.module_type, position: r.position, items_count: integer(r.items_count) ? r.items_count : null };
  });
  return source(rows, MODULE_LIMIT);
}
export async function fetchReportRecommendItems(signal: AbortSignal): Promise<RecommendItems> {
  const { data, error } = await supabaseBrowser().from('recommend_items')
    .select('id, module_id, musinsa_no, brand_name, position, snapshot_date, gender_filter').eq('gender_filter', 'A')
    .order('snapshot_date', { ascending: false }).order('module_id', { ascending: true })
    .order('position', { ascending: true }).order('id', { ascending: true }).limit(ITEM_LIMIT).abortSignal(signal);
  if (error || !Array.isArray(data)) throw new Error('추천 아이템 조회 실패');
  const rows: Item[] = data.map(r => {
    if (!r || !text(r.id) || !text(r.module_id) || !text(r.musinsa_no) || !date(r.snapshot_date) || r.gender_filter !== 'A' || !integer(r.position))
      throw new Error('추천 아이템 식별자/기준일/조회 범위 확인 실패');
    return { id: r.id, module_id: r.module_id, musinsa_no: r.musinsa_no, snapshot_date: r.snapshot_date,
      gender_filter: 'A', position: r.position, brand_name: text(r.brand_name) ? r.brand_name : null };
  });
  return source(rows, ITEM_LIMIT);
}

export function deriveRecommendEvidence(modules: RecommendState<RecommendModules>, items: RecommendState<RecommendItems>) {
  const m = modules.state === 'ready' ? modules.data : null, i = items.state === 'ready' ? items.data : null;
  const byKey = new Map<string, Module[]>(), observedCounts = new Map<string, number>();
  const key = (id: string, d: string, g: string) => `${id}|${d}|${g}`;
  for (const row of m?.rows ?? []) {
    const k = key(row.id, row.snapshot_date, row.gender_filter);
    byKey.set(k, [...(byKey.get(k) ?? []), row]);
  }
  const brands = new Set<string>(), joinedBrands = new Set<string>(), brandCounts = new Map<string, number>();
  let unknownJoin = 0, unknownBrand = 0;
  for (const row of i?.latestRows ?? []) {
    if (row.brand_name) { brands.add(row.brand_name); brandCounts.set(row.brand_name, (brandCounts.get(row.brand_name) ?? 0) + 1); }
    else unknownBrand++;
    const k = key(row.module_id, row.snapshot_date, row.gender_filter), parents = byKey.get(k);
    if (parents?.length !== 1) { unknownJoin++; continue; }
    observedCounts.set(k, (observedCounts.get(k) ?? 0) + 1);
    if (row.brand_name) joinedBrands.add(row.brand_name);
  }
  // Header counts expose partial/inconsistent writes; never infer absence from missing item rows.
  const unaccountedModules = (m?.latestRows ?? []).filter(row => row.items_count === null
    || (observedCounts.get(key(row.id, row.snapshot_date, row.gender_filter)) ?? 0) !== row.items_count).length;
  const coherent = !!m && !!i && i.date !== null && m.date === i.date && !m.atLimit && !i.atLimit
    && unknownJoin === 0 && unknownBrand === 0 && unaccountedModules === 0;
  return { moduleDate: m?.date ?? null, itemDate: i?.date ?? null, itemCount: i ? i.latestRows.length : null,
    brandCount: i && unknownBrand === 0 ? brands.size : null, knownBrandCount: brands.size,
    unknownJoin, unknownBrand, unaccountedModules, coherent, joinedBrands,
    modules: m ? m.latestRows.map(row => ({ id: row.id, title: row.title ?? '—', moduleType: row.module_type,
      position: row.position, itemsCount: row.items_count })) : [],
    topBrands: i ? [...brandCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([brandName, count]) => ({ brandName, count })) : [] };
}
export type RecommendEvidence = ReturnType<typeof deriveRecommendEvidence>;
export function applyRecommendEvidence(data: DailyReportData, evidence: RecommendEvidence): DailyReportData {
  const observed = (name: string, fuzzy: boolean): boolean | null => [...evidence.joinedBrands].some(n => n === name
    || fuzzy && (n.includes(name) || name.includes(n))) ? true : evidence.coherent ? false : null;
  const channels = data.channelConversions.filter(c => c.channel !== '추천판');
  if (evidence.coherent && evidence.itemDate === data.kpi.latestDate) {
    const ranked = new Set(data.rankingRows.map(r => r.brandName)), exposureBrands = evidence.joinedBrands.size;
    const matchedBrands = [...evidence.joinedBrands].filter(b => ranked.has(b)).length;
    channels.unshift({ channel: '추천판', exposureBrands, matchedBrands, rate: exposureBrands ? Math.round(matchedBrands / exposureBrands * 100) : 0 });
  }
  return { ...data, kpi: { ...data.kpi, recommendItemCount: evidence.itemCount, recommendBrandCount: evidence.brandCount },
    ownBrands: data.ownBrands.map(b => ({ ...b, hasRecommend: observed(b.brandName, true) })),
    competitors: data.competitors.map(b => ({ ...b, hasRecommend: observed(b.brandName, false) })),
    recommendModules: evidence.modules, recommendTopBrands: evidence.topBrands, channelConversions: channels };
}
