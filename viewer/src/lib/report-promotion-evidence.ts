import { supabaseBrowser } from './supabase/client';
import type { DailyReportData } from './queries-report';

export type EvidenceState<T> = { state: 'loading' | 'signedout' | 'error' | 'ready'; data: T | null };
type Header = { id: string; snapshot_date: string; promotion_type: string | null };
type Item = { id: string; promotion_id: string; snapshot_date: string; musinsa_no: string;
  musinsa_brand_name: string | null; discount_rate: number | null };
export type PromotionSource<T> = { rows: T[]; date: string | null; sampledRows: number; atLimit: boolean };
export type PromotionHeaders = PromotionSource<Header>;
export type PromotionItems = PromotionSource<Item>;
const HEADER_LIMIT = 50, ITEM_LIMIT = 2000;
const types = new Set(['limited_offer', 'daily_sale', 'brand_week', 'general']);
const ranges = [
  { label: '~20%', min: 0, max: 20 }, { label: '20~40%', min: 20, max: 40 },
  { label: '40~60%', min: 40, max: 60 }, { label: '60~80%', min: 60, max: 80 },
  { label: '80%~', min: 80, max: 101 },
];
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const discount = (v: unknown) => {
  if (typeof v !== 'number' && !(typeof v === 'string' && v.trim() !== '')) return null;
  const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
};
function source<T extends { snapshot_date: string }>(rows: T[], limit: number): PromotionSource<T> {
  return { rows, date: rows.length ? rows.reduce((d, r) => r.snapshot_date > d ? r.snapshot_date : d, rows[0].snapshot_date) : null,
    sampledRows: rows.length, atLimit: rows.length >= limit };
}

// Headers are mutable: retain all returned dates, but never apply a header to another day's items.
export async function fetchReportPromotionHeaders(signal: AbortSignal): Promise<PromotionHeaders> {
  const { data, error } = await supabaseBrowser().from('promotions')
    .select('id, promotion_type, snapshot_date').order('snapshot_date', { ascending: false })
    .order('id', { ascending: true }).limit(HEADER_LIMIT).abortSignal(signal);
  if (error || !Array.isArray(data)) throw new Error('프로모션 헤더 조회 실패');
  const rows = data.map(r => {
    if (!r || !text(r.id) || !date(r.snapshot_date)) throw new Error('프로모션 헤더 식별자/기준일 확인 실패');
    return { id: r.id, snapshot_date: r.snapshot_date, promotion_type: text(r.promotion_type) ? r.promotion_type : null };
  });
  return source(rows, HEADER_LIMIT);
}
export async function fetchReportPromotionItems(signal: AbortSignal): Promise<PromotionItems> {
  const { data, error } = await supabaseBrowser().from('promotion_items')
    .select('id, promotion_id, musinsa_no, musinsa_brand_name, discount_rate, snapshot_date')
    .order('snapshot_date', { ascending: false }).order('id', { ascending: true }).limit(ITEM_LIMIT).abortSignal(signal);
  if (error || !Array.isArray(data)) throw new Error('프로모션 아이템 조회 실패');
  const rows = data.map(r => {
    if (!r || !text(r.id) || !text(r.promotion_id) || !text(r.musinsa_no) || !date(r.snapshot_date))
      throw new Error('프로모션 아이템 식별자/기준일 확인 실패');
    return { id: r.id, promotion_id: r.promotion_id, musinsa_no: r.musinsa_no, snapshot_date: r.snapshot_date,
      musinsa_brand_name: text(r.musinsa_brand_name) ? r.musinsa_brand_name : null, discount_rate: discount(r.discount_rate) };
  });
  const value = source(rows, ITEM_LIMIT);
  return { ...value, rows: rows.filter(r => r.snapshot_date === value.date) };
}

export function derivePromotionEvidence(headers: EvidenceState<PromotionHeaders>, items: EvidenceState<PromotionItems>) {
  const h = headers.state === 'ready' ? headers.data : null, i = items.state === 'ready' ? items.data : null;
  const byKey = new Map<string, Header[]>();
  for (const row of h?.rows ?? []) {
    const key = row.id + '|' + row.snapshot_date;
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  const saleBrands = new Set<string>(), promoBrands = new Set<string>(), allBrands = new Set<string>();
  let unknownClassification = 0, unknownDiscount = 0, unknownBrand = 0;
  const counts = ranges.map(() => 0);
  for (const row of i?.rows ?? []) {
    if (row.discount_rate === null) unknownDiscount++;
    else { const bucket = ranges.findIndex(b => row.discount_rate! >= b.min && row.discount_rate! < b.max); counts[bucket]++; }
    if (!row.musinsa_brand_name) unknownBrand++;
    const candidates = byKey.get(row.promotion_id + '|' + row.snapshot_date);
    const type = candidates?.length === 1 ? candidates[0].promotion_type : null;
    if (!type || !types.has(type)) { unknownClassification++; continue; }
    if (!row.musinsa_brand_name) continue;
    allBrands.add(row.musinsa_brand_name);
    if (type === 'daily_sale' || type === 'general') saleBrands.add(row.musinsa_brand_name);
    else promoBrands.add(row.musinsa_brand_name);
  }
  // Negative observations describe only a coherent, uncapped returned sample, never campaign activity.
  const coherent = !!h && !!i && !h.atLimit && !i.atLimit && unknownClassification === 0 && unknownBrand === 0;
  return { date: i?.date ?? null, itemCount: i ? i.rows.length : null, brandCount: coherent ? allBrands.size : null,
    saleBrands, promoBrands, coherent, unknownClassification, unknownDiscount, unknownBrand,
    saleDist: i ? ranges.map((b, n) => ({ label: b.label, count: counts[n] })) : [] };
}
export type PromotionEvidence = ReturnType<typeof derivePromotionEvidence>;
export function applyPromotionEvidence(data: DailyReportData, evidence: PromotionEvidence): DailyReportData {
  const matches = (set: Set<string>, name: string, fuzzy: boolean) => [...set].some(n => n === name || fuzzy && (n.includes(name) || name.includes(n)));
  const observed = (set: Set<string>, name: string, fuzzy: boolean): boolean | null => matches(set, name, fuzzy) ? true : evidence.coherent ? false : null;
  const channels = data.channelConversions.filter(c => c.channel !== '세일판');
  if (evidence.coherent && evidence.date === data.kpi.latestDate) {
    const ranked = new Set(data.rankingRows.map(r => r.brandName));
    const matchedBrands = [...evidence.saleBrands].filter(b => ranked.has(b)).length;
    channels.splice(1, 0, { channel: '세일판', exposureBrands: evidence.saleBrands.size, matchedBrands,
      rate: evidence.saleBrands.size ? Math.round(matchedBrands / evidence.saleBrands.size * 100) : 0 });
  }
  return { ...data, kpi: { ...data.kpi, saleItemCount: evidence.itemCount, saleBrandCount: evidence.brandCount },
    ownBrands: data.ownBrands.map(b => ({ ...b, hasSale: observed(evidence.saleBrands, b.brandName, true), hasPromo: observed(evidence.promoBrands, b.brandName, true) })),
    competitors: data.competitors.map(b => ({ ...b, hasSale: observed(evidence.saleBrands, b.brandName, false) })),
    saleDist: evidence.saleDist, channelConversions: channels };
}
