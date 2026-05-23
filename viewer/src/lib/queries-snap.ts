import { supabaseBrowser } from './supabase/client';
const supabase = supabaseBrowser();

// ── 스냅 라벨 마스터 ──────────────────────────────────────────────────────
export interface LabelMaster {
  id: number;
  category_id: number;
  category_name: string;
  name: string;
  display_order: number;
}

export async function getSnapLabels(): Promise<LabelMaster[]> {
  const { data, error } = await supabase
    .from('snap_label_masters')
    .select('id, category_id, category_name, name, display_order')
    .order('category_id', { ascending: true })
    .order('display_order', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ── 공통 스냅 필드 ────────────────────────────────────────────────────────
interface SnapBase {
  snap_id: string;
  content_type: string;
  thumbnail_url: string | null;
  content_text: string | null;
  like_count: number;
  view_count: number;
  scrap_count: number;
  goods_click_count: number;
  comment_count: number;
  click_count: number;
  model_gender: string | null;
  model_height: number | null;
  model_weight: number | null;
  model_skin_tone: string | null;
  hashtags: string[] | null;
  style_label_ids: number[] | null;
  published_at: string;
}

export interface SnapRankRow extends SnapBase {
  rank_position: number;
  prev_rank_position: number | null;
  highlight: string | null;
  gender_filter: string;
  style_filter: string;
  snapshot_date: string;
}

export type SnapRow = SnapBase;

export interface SnapProductRow {
  musinsa_no: string | null;
  option_name: string | null;
  product_name: string;
  brand_name: string;
  thumbnail_url: string | null;
  final_price: number | null;
  list_price: number | null;
  discount_rate: number | null;
}

const SNAP_FIELDS = [
  'snap_id', 'content_type', 'thumbnail_url', 'content_text',
  'like_count', 'view_count', 'scrap_count', 'goods_click_count',
  'comment_count', 'click_count',
  'model_gender', 'model_height', 'model_weight', 'model_skin_tone',
  'hashtags', 'style_label_ids', 'published_at',
].join(', ');

// ── 최신 스냅 랭킹 날짜 ──────────────────────────────────────────────────
export async function getLatestSnapDate(): Promise<string> {
  const kst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const { data } = await supabase
    .from('snap_rankings')
    .select('snapshot_date')
    .order('snapshot_date', { ascending: false })
    .limit(1);
  return data?.[0]?.snapshot_date ?? kst;
}

// ── USER_SNAP 랭킹 ────────────────────────────────────────────────────────
// styles: snap_rankings.style_filter 값 배열 (기본 ['ALL'])
// gender_filter는 스크래퍼가 항상 'ALL'로만 수집하므로 쿼리에서 고정
// 복수 스타일 선택 시 snap_id 기준 중복 제거 (최신 날짜 + 최고 순위 유지)
export async function getUserSnapRankings(
  fromDate: string, toDate: string, styles: string[] = ['ALL'],
): Promise<SnapRankRow[]> {
  const { data: rankings, error: rankErr } = await supabase
    .from('snap_rankings')
    .select('snap_id, rank_position, prev_rank_position, highlight, gender_filter, snapshot_date, style_filter')
    .gte('snapshot_date', fromDate)
    .lte('snapshot_date', toDate)
    .eq('gender_filter', 'ALL')
    .in('style_filter', styles)
    .order('snapshot_date', { ascending: false })
    .order('rank_position', { ascending: true })
    .limit(2000);
  if (rankErr) throw rankErr;
  if (!rankings || rankings.length === 0) return [];

  // 복수 스타일 선택 시 동일 snap이 스타일별로 중복 표시 — 의도된 동작
  const snapIds = [...new Set(rankings.map(r => r.snap_id))];
  const { data: snaps, error: snapErr } = await supabase
    .from('snaps')
    .select(SNAP_FIELDS)
    .in('snap_id', snapIds)
    .limit(2000);
  if (snapErr) throw snapErr;

  const snapMap = new Map((snaps ?? []).map((s: any) => [s.snap_id, s]));
  const empty: SnapBase = {
    snap_id: '', content_type: 'USER_SNAP', thumbnail_url: null, content_text: null,
    like_count: 0, view_count: 0, scrap_count: 0, goods_click_count: 0,
    comment_count: 0, click_count: 0, model_gender: null, model_height: null,
    model_weight: null, model_skin_tone: null, hashtags: null, style_label_ids: null, published_at: '',
  };
  return rankings
    .filter(r => snapMap.has(r.snap_id))
    .map(r => ({ ...empty, ...(snapMap.get(r.snap_id) ?? {}), ...r }));
}

// ── BRAND / CODISHOP 스냅 ─────────────────────────────────────────────────
interface FetchByTypeOpts {
  labelIds?: number[];
  ascending?: boolean;
  fromDate?: string;
  toDate?: string;
  gender?: string;
  minHeight?: number;
  maxHeight?: number;
  minWeight?: number;
  maxWeight?: number;
  hashtags?: string[];
}

async function fetchByType(
  contentType: string, page: number, sort: 'latest' | 'likes' | 'views',
  opts: FetchByTypeOpts = {},
): Promise<{ rows: SnapRow[]; total: number }> {
  const { labelIds = [], ascending = false, fromDate, toDate, gender, minHeight, maxHeight, minWeight, maxWeight, hashtags } = opts;
  let q = supabase
    .from('snaps')
    .select(SNAP_FIELDS, { count: 'exact' })
    .eq('content_type', contentType);
  if (labelIds.length > 0)          q = (q as any).overlaps('style_label_ids', labelIds);
  if (fromDate)                      q = q.gte('published_at', fromDate);
  if (toDate)                        q = q.lte('published_at', toDate + 'T23:59:59');
  if (gender && gender !== 'ALL')    q = q.eq('model_gender', gender);
  if (minHeight != null)             q = q.gte('model_height', minHeight);
  if (maxHeight != null)             q = q.lte('model_height', maxHeight);
  if (minWeight != null)             q = q.gte('model_weight', minWeight);
  if (maxWeight != null)             q = q.lte('model_weight', maxWeight);
  if (hashtags && hashtags.length > 0) q = (q as any).contains('hashtags', hashtags);
  if (sort === 'likes')              q = q.order('like_count',   { ascending });
  else if (sort === 'views')         q = q.order('view_count',   { ascending });
  else                               q = q.order('published_at', { ascending });
  const { data, error, count } = await q.range(page * 50, page * 50 + 49);
  if (error) throw error;
  return { rows: (data ?? []) as unknown as SnapRow[], total: count ?? 0 };
}

export const getBrandSnaps    = (page: number, sort: 'latest' | 'likes' | 'views', opts?: FetchByTypeOpts) => fetchByType('BRAND_SNAP',    page, sort, opts);
export const getCodishopSnaps = (page: number, sort: 'latest' | 'likes' | 'views', opts?: FetchByTypeOpts) => fetchByType('CODISHOP_SNAP', page, sort, opts);

// ── 연결 상품 ─────────────────────────────────────────────────────────────
export async function getSnapProducts(snapId: string): Promise<SnapProductRow[]> {
  const { data, error } = await supabase
    .from('snap_products')
    .select('musinsa_no, option_name, products(name, thumbnail_url, brands(name))')
    .eq('snap_id', snapId)
    .limit(20);
  if (error) { console.error('[getSnapProducts]', snapId, error); return []; }

  const base = (data ?? []).map((r: any) => ({
    musinsa_no:    r.musinsa_no ?? null,
    option_name:   r.option_name ?? null,
    product_name:  r.products?.name ?? '—',
    brand_name:    r.products?.brands?.name ?? '—',
    thumbnail_url: r.products?.thumbnail_url ?? null,
    final_price:   null as number | null,
    list_price:    null as number | null,
    discount_rate: null as number | null,
  }));

  const nos = base.map(r => r.musinsa_no).filter((n): n is string => n !== null);
  if (nos.length === 0) return base;

  // ranking_snapshots에서 최신 가격 조회 (중복 방지: musinsa_no당 첫 번째만)
  const { data: prices } = await supabase
    .from('ranking_snapshots')
    .select('musinsa_no, final_price, list_price, discount_rate, snapshot_date')
    .in('musinsa_no', nos)
    .order('snapshot_date', { ascending: false })
    .limit(500);

  const priceMap = new Map<string, { final_price: number | null; list_price: number | null; discount_rate: number | null }>();
  for (const p of (prices ?? []) as any[]) {
    const key = String(p.musinsa_no);
    if (!priceMap.has(key))
      priceMap.set(key, { final_price: p.final_price ?? null, list_price: p.list_price ?? null, discount_rate: p.discount_rate ?? null });
  }

  return base.map(r => ({
    ...r,
    ...(r.musinsa_no != null ? (priceMap.get(r.musinsa_no) ?? {}) : {}),
  }));
}

// ── 프로필 랭킹 ───────────────────────────────────────────────────────────
export interface SnapProfileRow {
  id: string;
  profile_type: string;
  nickname: string;
  bio: string | null;
  profile_image_url: string | null;
  follower_count: number;
  following_count: number;
  snap_count: number;
  height: number | null;
  weight: number | null;
  skin_tone: string | null;
  gender: string | null;
  badge_title: string | null;
  brand_code: string | null;
  rank_position: number;
  prev_rank_position: number | null;
  highlight: string | null;
  snapshot_date: string;
}

export async function getProfileRankings(
  fromDate: string, toDate: string, profileType: 'USER' | 'BRAND',
): Promise<SnapProfileRow[]> {
  const { data: rankings, error: rankErr } = await supabase
    .from('snap_profile_rankings')
    .select('profile_id, rank_position, prev_rank_position, highlight, snapshot_date')
    .gte('snapshot_date', fromDate)
    .lte('snapshot_date', toDate)
    .eq('profile_type', profileType)
    .order('snapshot_date', { ascending: false })
    .order('rank_position', { ascending: true })
    .limit(500);
  if (rankErr) throw rankErr;
  if (!rankings || rankings.length === 0) return [];

  const profileIds = [...new Set(rankings.map(r => r.profile_id))];
  const { data: profiles, error: profErr } = await supabase
    .from('snap_profiles')
    .select('id, profile_type, nickname, bio, profile_image_url, follower_count, following_count, snap_count, height, weight, skin_tone, gender, badge_title, brand_code')
    .in('id', profileIds)
    .limit(300);
  if (profErr) throw profErr;

  const profMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
  return rankings
    .filter(r => profMap.has(r.profile_id))
    .map(r => ({
      ...profMap.get(r.profile_id),
      rank_position:      r.rank_position,
      prev_rank_position: r.prev_rank_position ?? null,
      highlight:          r.highlight ?? null,
      snapshot_date:      r.snapshot_date,
    }));
}

export async function getProfileSnaps(
  profileId: string, date: string,
): Promise<SnapRow[]> {
  const { data, error } = await supabase
    .from('snap_profile_snaps')
    .select('snap_id, display_order')
    .eq('profile_id', profileId)
    .eq('snapshot_date', date)
    .order('display_order', { ascending: true })
    .limit(10);
  if (error || !data || data.length === 0) return [];

  const snapIds = data.map(r => r.snap_id);
  const { data: snaps, error: snapErr } = await supabase
    .from('snaps')
    .select(SNAP_FIELDS)
    .in('snap_id', snapIds)
    .limit(10);
  if (snapErr) return [];

  const snapMap = new Map((snaps ?? []).map((s: any) => [s.snap_id, s]));
  return data
    .filter(r => snapMap.has(r.snap_id))
    .map(r => snapMap.get(r.snap_id) as SnapRow);
}

// ── 프로필 스냅 집계 ───────────────────────────────────────────────────────
export interface ProfileSnapStats {
  profile_id: string;
  total_likes: number;
  total_views: number;
  total_scraps: number;
  total_goods_click: number;
  total_comments: number;
}

export async function getProfileSnapStats(
  profileIds: string[], fromDate: string, toDate: string,
): Promise<Map<string, ProfileSnapStats>> {
  if (profileIds.length === 0) return new Map();

  const { data: links } = await supabase
    .from('snap_profile_snaps')
    .select('profile_id, snap_id')
    .in('profile_id', profileIds)
    .gte('snapshot_date', fromDate)
    .lte('snapshot_date', toDate)
    .limit(5000);
  if (!links || links.length === 0) return new Map();

  const snapIds = [...new Set((links as any[]).map(l => l.snap_id as string))];
  const { data: snaps } = await supabase
    .from('snaps')
    .select('snap_id, like_count, view_count, scrap_count, goods_click_count, comment_count')
    .in('snap_id', snapIds)
    .limit(5000);
  if (!snaps) return new Map();

  const snapMap = new Map((snaps as any[]).map(s => [s.snap_id, s]));
  const result = new Map<string, ProfileSnapStats>();
  for (const link of links as any[]) {
    const s = snapMap.get(link.snap_id);
    if (!s) continue;
    const ex = result.get(link.profile_id) ?? {
      profile_id: link.profile_id, total_likes: 0, total_views: 0,
      total_scraps: 0, total_goods_click: 0, total_comments: 0,
    };
    ex.total_likes       += s.like_count        ?? 0;
    ex.total_views       += s.view_count        ?? 0;
    ex.total_scraps      += s.scrap_count       ?? 0;
    ex.total_goods_click += s.goods_click_count ?? 0;
    ex.total_comments    += s.comment_count     ?? 0;
    result.set(link.profile_id, ex);
  }
  return result;
}

// ── 스냅 → 프로필 조인 ────────────────────────────────────────────────────
export interface SnapProfileInfo {
  id: string;
  nickname: string;
  profile_image_url: string | null;
  follower_count: number;
  badge_title: string | null;
  skin_tone: string | null;
}

export async function getSnapProfilesBySnapIds(
  snapIds: string[],
): Promise<Map<string, SnapProfileInfo>> {
  if (snapIds.length === 0) return new Map();
  const { data: links, error: linkErr } = await supabase
    .from('snap_profile_snaps')
    .select('snap_id, profile_id')
    .in('snap_id', snapIds)
    .limit(2000);
  if (linkErr || !links || links.length === 0) return new Map();

  const profileIds = [...new Set((links as any[]).map(l => l.profile_id))];
  const { data: profiles, error: profErr } = await supabase
    .from('snap_profiles')
    .select('id, nickname, profile_image_url, follower_count, badge_title, skin_tone')
    .in('id', profileIds)
    .eq('profile_type', 'USER')
    .limit(1000);
  if (profErr || !profiles) return new Map();

  const profMap = new Map((profiles as any[]).map(p => [p.id, p as SnapProfileInfo]));
  const result = new Map<string, SnapProfileInfo>();
  for (const link of links as any[]) {
    if (!result.has(link.snap_id) && profMap.has(link.profile_id))
      result.set(link.snap_id, profMap.get(link.profile_id)!);
  }
  return result;
}

// ── 브랜드 스냅 → 브랜드 정보 매핑 ──────────────────────────────────────────
export interface BrandSnapInfo {
  nickname: string;
  profile_image_url: string | null;
  brand_code: string | null;
}

export async function getBrandInfoBySnapIds(snapIds: string[]): Promise<Map<string, BrandSnapInfo>> {
  if (snapIds.length === 0) return new Map();
  const { data: links } = await supabase
    .from('snap_profile_snaps')
    .select('snap_id, profile_id')
    .in('snap_id', snapIds)
    .limit(2000);
  if (!links || links.length === 0) return new Map();

  const profileIds = [...new Set((links as any[]).map(l => l.profile_id))];
  const { data: profiles } = await supabase
    .from('snap_profiles')
    .select('id, nickname, profile_image_url, brand_code')
    .in('id', profileIds)
    .eq('profile_type', 'BRAND')
    .limit(1000);
  if (!profiles) return new Map();

  const profMap = new Map((profiles as any[]).map(p => [p.id, {
    nickname: p.nickname as string,
    profile_image_url: p.profile_image_url as string | null,
    brand_code: p.brand_code as string | null,
  }]));
  const result = new Map<string, BrandSnapInfo>();
  for (const link of links as any[]) {
    if (!result.has(link.snap_id) && profMap.has(link.profile_id))
      result.set(link.snap_id, profMap.get(link.profile_id)!);
  }
  return result;
}

// ── 프로필 모델 정보 fallback (프로필 값 없을 때 가장 최근 스냅에서) ─────────────
export interface ProfileModelFallback {
  gender: string | null;
  height: number | null;
  weight: number | null;
  skin_tone: string | null;
}

export async function getProfileModelFallbacks(
  profileIds: string[],
): Promise<Map<string, ProfileModelFallback>> {
  if (profileIds.length === 0) return new Map();

  const { data: links } = await supabase
    .from('snap_profile_snaps')
    .select('profile_id, snap_id, snapshot_date')
    .in('profile_id', profileIds)
    .order('snapshot_date', { ascending: false })
    .limit(5000);
  if (!links || links.length === 0) return new Map();

  const snapIds = [...new Set((links as any[]).map((l: any) => l.snap_id as string))];
  const { data: snaps } = await supabase
    .from('snaps')
    .select('snap_id, model_gender, model_height, model_weight, model_skin_tone, published_at')
    .in('snap_id', snapIds)
    .limit(5000);
  if (!snaps) return new Map();

  const snapMap = new Map((snaps as any[]).map((s: any) => [s.snap_id, s]));
  const profileSnaps = new Map<string, any[]>();
  for (const link of links as any[]) {
    const snap = snapMap.get(link.snap_id);
    if (!snap) continue;
    if (!profileSnaps.has(link.profile_id)) profileSnaps.set(link.profile_id, []);
    profileSnaps.get(link.profile_id)!.push(snap);
  }

  const result = new Map<string, ProfileModelFallback>();
  for (const [pid, snapList] of profileSnaps.entries()) {
    const sorted = snapList.sort((a: any, b: any) => b.published_at.localeCompare(a.published_at));
    let gender: string | null = null, height: number | null = null;
    let weight: number | null = null, skin_tone: string | null = null;
    for (const s of sorted) {
      if (!gender    && s.model_gender)    gender    = s.model_gender;
      if (!height    && s.model_height)    height    = s.model_height;
      if (!weight    && s.model_weight)    weight    = s.model_weight;
      if (!skin_tone && s.model_skin_tone) skin_tone = s.model_skin_tone;
      if (gender && height && weight && skin_tone) break;
    }
    if (gender || height || weight || skin_tone)
      result.set(pid, { gender, height, weight, skin_tone });
  }
  return result;
}

// ── 스냅 랭킹 스타일 필터 목록 ────────────────────────────────────────────
export const SNAP_STYLE_FILTERS = [
  { value: 'ALL',      label: '전체' },
  { value: 'CASUAL',   label: '캐주얼' },
  { value: 'STREET',   label: '스트릿' },
  { value: 'MINIMAL',  label: '미니멀' },
  { value: 'GIRLISH',  label: '걸리시' },
  { value: 'ROMANTIC', label: '로맨틱' },
  { value: 'CHIC',     label: '시크' },
];
