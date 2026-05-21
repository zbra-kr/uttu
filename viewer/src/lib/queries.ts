import { supabaseBrowser } from './supabase/client';
const supabase = supabaseBrowser();

// ── 카테고리 코드 매핑 ──────────────────────────────────────────
export const CATEGORY_MAP: Record<string, string> = {
  '000': '전체', '001': '상의', '002': '아우터', '003': '하의',
  '004': '신발', '017': '가방', '026': '모자', '100': '뷰티',
  '101': '액세서리', '102': '속옷', '103': '양말', '104': '스포츠', '106': '라이프',
};

export const AGE_MAP: Record<string, string> = {
  'AGE_BAND_ALL': '전체', 'AGE_BAND_MINOR': '20세 미만',
  'AGE_BAND_20': '20~25세', 'AGE_BAND_25': '25~30세',
  'AGE_BAND_30': '30~35세', 'AGE_BAND_35': '35~40세', 'AGE_BAND_40': '40세 이상',
};

// ── 랭킹 ────────────────────────────────────────────────────────
export interface RankingRow {
  rank_position: number;
  musinsa_no: number;
  product_name: string;
  brand_name: string;
  company_name: string | null;
  category_code: string;
  gender_filter: string;
  age_filter: string;
  list_price: number | null;
  final_price: number | null;
  discount_rate: number | null;
  is_sold_out: boolean;
  review_count: number;
  review_score: number;
  snapshot_date: string;
  is_own: boolean;
  product_id: string | null;
}

export async function fetchLatestRanking(opts: {
  categoryCode?: string;
  genderFilter?: string;
  ageFilter?: string;
  limit?: number;
}): Promise<RankingRow[]> {
  const { categoryCode = '000', genderFilter = 'A', ageFilter = 'AGE_BAND_ALL', limit = 300 } = opts;

  const { data, error } = await supabase
    .from('ranking_snapshots')
    .select(`rank_position, musinsa_no, product_name, brand_name,
      category_code, gender_filter, age_filter,
      list_price, final_price, discount_rate,
      is_sold_out, review_count, review_score, snapshot_date,
      product_id, products!inner(is_own, brands(companies(corp_name)))`)
    .eq('category_code', categoryCode)
    .eq('gender_filter', genderFilter)
    .eq('age_filter', ageFilter)
    .order('snapshot_date', { ascending: false })
    .order('rank_position', { ascending: true })
    .limit(limit);

  if (error) throw error;
  if (!data || data.length === 0) return [];
  const latestDate = (data[0] as any).snapshot_date;
  return (data as any[])
    .filter(r => r.snapshot_date === latestDate)
    .map(r => ({
      ...r,
      is_own: r.products?.is_own ?? false,
      company_name: r.products?.brands?.companies?.corp_name ?? null,
    }));
}

// ── 홈 요약 ──────────────────────────────────────────────────────
export interface HomeSummary {
  latestDate: string;
  totalProducts: number;
  ownProducts: number;
  ownTop100: number;
  totalReviews: number;
  avgRating: number;
  totalBrands: number;
}

export async function fetchHomeSummary(): Promise<HomeSummary> {
  const [rankSnap, reviewSnap, ownSnap, brandSnap] = await Promise.all([
    supabase.from('ranking_snapshots')
      .select('snapshot_date, rank_position, products!inner(is_own)')
      .eq('category_code', '000').eq('gender_filter', 'A').eq('age_filter', 'AGE_BAND_ALL')
      .order('snapshot_date', { ascending: false }).limit(100),
    supabase.from('reviews').select('rating').limit(500),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('is_own', true),
    supabase.from('brands').select('id', { count: 'exact', head: true }),
  ]);

  const rankRows = (rankSnap.data ?? []) as any[];
  const latestDate = rankRows[0]?.snapshot_date ?? '';
  const todayRank = rankRows.filter((r: any) => r.snapshot_date === latestDate);
  const ownTop100 = todayRank.filter((r: any) => r.products?.is_own && r.rank_position <= 100).length;

  const reviews = (reviewSnap.data ?? []) as any[];
  const avgRating = reviews.length > 0 ? reviews.reduce((s: number, r: any) => s + r.rating, 0) / reviews.length : 0;

  return {
    latestDate,
    totalProducts: todayRank.length,
    ownProducts: ownSnap.count ?? 0,
    ownTop100,
    totalReviews: reviews.length,
    avgRating: Math.round(avgRating * 100) / 100,
    totalBrands: brandSnap.count ?? 0,
  };
}

// ── 스냅 ─────────────────────────────────────────────────────────
export interface SnapRow {
  id: string;
  snap_id: string;
  content_type: string;
  format_type: string | null;
  published_at: string;
  like_count: number;
  view_count: number;
  comment_count: number;
  goods_click_count: number;
  model_gender: string | null;
  model_height: number | null;
  model_weight: number | null;
  collected_at: string;
}

export async function fetchSnaps(opts: {
  gender?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: SnapRow[]; total: number }> {
  const { gender, limit = 50, offset = 0 } = opts;

  let q = supabase
    .from('snaps')
    .select('id, snap_id, content_type, format_type, published_at, like_count, view_count, comment_count, goods_click_count, model_gender, model_height, model_weight, collected_at', { count: 'exact' })
    .order('published_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (gender && gender !== 'ALL') q = q.eq('model_gender', gender);

  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as SnapRow[], total: count ?? 0 };
}

export interface SnapProduct {
  musinsa_no: number;
  product_name: string;
  brand_name: string;
  final_price: number | null;
  rank_position: number | null;
}

export async function fetchSnapProducts(snapId: string): Promise<SnapProduct[]> {
  const { data, error } = await supabase
    .from('snap_products')
    .select('products(musinsa_no, name, brands(name), ranking_snapshots(rank_position, final_price))')
    .eq('snap_id', snapId)
    .limit(20);
  if (error) return [];
  return (data ?? []).map((r: any) => {
    const p = r.products;
    const rs = p?.ranking_snapshots?.[0];
    return {
      musinsa_no: p?.musinsa_no,
      product_name: p?.name ?? '—',
      brand_name: p?.brands?.name ?? '—',
      final_price: rs?.final_price ?? null,
      rank_position: rs?.rank_position ?? null,
    };
  });
}

// ── 매거진 ───────────────────────────────────────────────────────
export interface MagazineRow {
  id: string;
  article_id: string;
  cms_index: string | null;
  title: string;
  category: string | null;
  brand_names: string[];
  view_count: number;
  comment_count: number;
  published_at: string;
  collected_at: string;
}

export async function fetchMagazineArticles(opts: {
  category?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: MagazineRow[]; total: number }> {
  const { category, limit = 50, offset = 0 } = opts;

  let q = supabase
    .from('magazine_articles')
    .select('id, article_id, cms_index, title, category, brand_names, view_count, comment_count, published_at, collected_at', { count: 'exact' })
    .order('published_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (category && category !== 'all') q = q.eq('category', category);

  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as MagazineRow[], total: count ?? 0 };
}

export async function fetchMagazineCategories(): Promise<string[]> {
  const { data } = await supabase
    .from('magazine_articles')
    .select('category')
    .not('category', 'is', null)
    .order('category');
  const cats = [...new Set((data ?? []).map((r: any) => r.category).filter(Boolean))];
  return cats;
}

// ── 리뷰 ─────────────────────────────────────────────────────────
export interface ReviewRow {
  id: string;
  product_id: string;
  rating: number;
  review_text: string | null;
  review_date: string;
  helpful_count: number;
  has_image: boolean;
  product_name: string;
  brand_name: string;
}

export async function fetchReviews(opts: {
  ratingMin?: number;
  ratingMax?: number;
  dateFrom?: string;
  dateTo?: string;
  keyword?: string;
  ownOnly?: boolean;
  productId?: string;
  sort?: 'recent' | 'rating_asc' | 'rating_desc' | 'helpful';
  limit?: number;
  offset?: number;
}): Promise<{ rows: ReviewRow[]; total: number }> {
  const { ratingMin = 1, ratingMax = 5, dateFrom, dateTo, keyword, ownOnly = true, productId, sort = 'recent', limit = 30, offset = 0 } = opts;

  let q = supabase
    .from('reviews')
    .select(`id, product_id, rating, review_text, review_date, helpful_count, has_image,
      products!inner(name, is_own, brands(name))`, { count: 'exact' })
    .gte('rating', ratingMin)
    .lte('rating', ratingMax)
    .range(offset, offset + limit - 1);

  if (productId) q = q.eq('product_id', productId);
  else if (ownOnly) q = (q as any).eq('products.is_own', true);
  if (dateFrom) q = q.gte('review_date', dateFrom);
  if (dateTo) q = q.lte('review_date', dateTo);
  if (keyword) q = q.ilike('review_text', `%${keyword}%`);

  if (sort === 'recent') q = q.order('review_date', { ascending: false });
  else if (sort === 'rating_asc') q = q.order('rating', { ascending: true });
  else if (sort === 'rating_desc') q = q.order('rating', { ascending: false });
  else if (sort === 'helpful') q = q.order('helpful_count', { ascending: false });

  const { data, error, count } = await q;
  if (error) throw error;

  return {
    rows: (data ?? []).map((r: any) => ({
      id: r.id,
      product_id: r.product_id,
      rating: r.rating,
      review_text: r.review_text,
      review_date: r.review_date,
      helpful_count: r.helpful_count ?? 0,
      has_image: r.has_image ?? false,
      product_name: r.products?.name ?? '—',
      brand_name: r.products?.brands?.name ?? '—',
    })),
    total: count ?? 0,
  };
}

export async function fetchReviewStats(days = 30): Promise<{
  total: number; avgRating: number; lowCount: number; ratingDist: number[];
}> {
  const from = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  const { data } = await (supabase as any)
    .from('reviews')
    .select('rating, products!inner(is_own)')
    .gte('review_date', from)
    .eq('products.is_own', true);
  const rows = (data ?? []) as any[];
  const total = rows.length;
  const avgRating = total > 0 ? rows.reduce((s, r) => s + r.rating, 0) / total : 0;
  const lowCount = rows.filter(r => r.rating <= 2).length;
  const ratingDist = [5, 4, 3, 2, 1].map(star => rows.filter(r => r.rating === star).length);
  return { total, avgRating: Math.round(avgRating * 100) / 100, lowCount, ratingDist };
}

// ── 자사 상품 ────────────────────────────────────────────────────
export interface OwnProduct {
  id: string;
  musinsa_no: number;
  name: string;
  brand_name: string;
  review_count: number;
  satisfaction_score: number | null;
}

export async function fetchOwnProducts(limit = 100): Promise<OwnProduct[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, musinsa_no, name, review_count, satisfaction_score, brands(name)')
    .eq('is_own', true)
    .order('review_count', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    musinsa_no: r.musinsa_no,
    name: r.name,
    brand_name: r.brands?.name ?? '—',
    review_count: r.review_count ?? 0,
    satisfaction_score: r.satisfaction_score,
  }));
}

// ── 브랜드 목록 ──────────────────────────────────────────────────
export async function fetchBrandOptions() {
  const { data } = await supabase.from('brands').select('id, name').order('name').limit(200);
  return (data ?? []) as { id: string; name: string }[];
}

export async function fetchCompanyOptions() {
  const { data } = await supabase.from('companies').select('id, corp_name').order('corp_name');
  return (data ?? []) as { id: string; corp_name: string }[];
}

// ── 이상탐지 신호 ──────────────────────────────────────────────────
export type AnomalyRow = [string, string, string, string, string, string];
// [시각, sev('hi'|'md'|'lo'), 영역, 이벤트, 대상, status('open')]

export async function fetchAnomalySignals(): Promise<AnomalyRow[]> {
  const signals: AnomalyRow[] = [];
  const today = new Date().toISOString().split('T')[0];
  const sevenAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const fourteenAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];

  const [lowRecent, lowPrev, rankRows, newPromos] = await Promise.all([
    supabase.from('reviews')
      .select('product_id, review_date, products!inner(name, is_own)')
      .lte('rating', 2).gte('review_date', sevenAgo)
      .eq('products.is_own', true).limit(500),
    supabase.from('reviews')
      .select('product_id')
      .lte('rating', 2).gte('review_date', fourteenAgo).lt('review_date', sevenAgo).limit(500),
    supabase.from('ranking_snapshots')
      .select('product_id, product_name, rank_position, snapshot_date, products!inner(is_own)')
      .eq('category_code', '000').eq('gender_filter', 'A').eq('age_filter', 'AGE_BAND_ALL')
      .eq('products.is_own', true)
      .order('snapshot_date', { ascending: false }).limit(400),
    supabase.from('promotions').select('title, collected_at').gte('collected_at', sevenAgo).limit(20),
  ]);

  const recentMap = new Map<string, { name: string; count: number }>();
  for (const r of (lowRecent.data ?? []) as any[]) {
    const e = recentMap.get(r.product_id) ?? { name: r.products?.name ?? '—', count: 0 };
    recentMap.set(r.product_id, { ...e, count: e.count + 1 });
  }
  const prevMap = new Map<string, number>();
  for (const r of (lowPrev.data ?? []) as any[]) {
    prevMap.set(r.product_id, (prevMap.get(r.product_id) ?? 0) + 1);
  }
  for (const [pid, { name, count }] of recentMap) {
    const prev = prevMap.get(pid) ?? 0;
    if (count < 2) continue;
    signals.push([today, count >= 5 ? 'hi' : 'md', '리뷰',
      `저점 리뷰 ${count}건${prev > 0 ? ` (전주 ${prev}건)` : ''}`, name, 'open']);
  }

  const rankData = (rankRows.data ?? []) as any[];
  const dates = [...new Set(rankData.map(r => r.snapshot_date))].sort().reverse();
  if (dates.length >= 2) {
    const [d1, d2] = dates;
    const latest = new Map<string, any>(rankData.filter(r => r.snapshot_date === d1).map(r => [r.product_id, r]));
    const prev = new Map<string, any>(rankData.filter(r => r.snapshot_date === d2).map(r => [r.product_id, r]));
    for (const [pid, curr] of latest) {
      const p = prev.get(pid);
      if (!p) continue;
      const change = p.rank_position - curr.rank_position;
      if (Math.abs(change) < 20) continue;
      signals.push([d1, Math.abs(change) >= 50 ? 'hi' : 'md', '상품',
        change > 0 ? `랭킹 ↑${change}위 급등` : `랭킹 ↓${Math.abs(change)}위 급락`,
        curr.product_name, 'open']);
    }
  }

  for (const p of (newPromos.data ?? []) as any[]) {
    signals.push([(p.collected_at ?? today).split('T')[0], 'lo', '프로모션',
      '신규 프로모션 수집', p.title ?? '—', 'open']);
  }

  return signals.sort((a, b) => b[0].localeCompare(a[0]));
}

// ── 브랜드 상세 ───────────────────────────────────────────────────
export interface BrandInfo {
  id: string;
  name: string;
  slug: string;
  is_own: boolean;
  nation_name: string | null;
  since_year: number | null;
  introduction: string | null;
  logo_url: string | null;
}

export async function fetchBrandInfo(brandId: string): Promise<BrandInfo | null> {
  const { data, error } = await supabase
    .from('brands')
    .select('id, name, slug, is_own, nation_name, since_year, introduction, logo_url')
    .eq('id', brandId).single();
  if (error) return null;
  return data as BrandInfo;
}

export interface BrandStats {
  top100Count: number;
  avgRank: number;
  skuCount: number;
  promoCount: number;
}

export async function fetchBrandStats(brandName: string): Promise<BrandStats> {
  const { data: rankRows } = await supabase
    .from('ranking_snapshots')
    .select('rank_position, snapshot_date, product_id')
    .eq('brand_name', brandName)
    .eq('category_code', '000').eq('gender_filter', 'A').eq('age_filter', 'AGE_BAND_ALL')
    .order('snapshot_date', { ascending: false }).limit(500);

  const rows = (rankRows ?? []) as any[];
  const latestDate = rows[0]?.snapshot_date;
  const today = rows.filter(r => r.snapshot_date === latestDate);
  const top100Count = today.filter(r => r.rank_position <= 100).length;
  const avgRank = today.length > 0 ? Math.round(today.reduce((s: number, r: any) => s + r.rank_position, 0) / today.length) : 0;
  const skuCount = today.length;

  const productIds = [...new Set(today.map((r: any) => r.product_id).filter(Boolean))];
  let promoCount = 0;
  if (productIds.length > 0) {
    const { data: promos } = await supabase
      .from('promotion_items').select('promotion_id')
      .in('product_id', productIds.slice(0, 200));
    promoCount = new Set((promos ?? []).map((p: any) => p.promotion_id)).size;
  }

  return { top100Count, avgRank, skuCount, promoCount };
}

export interface BrandProduct {
  musinsa_no: string;
  product_name: string;
  rank_position: number | null;
  final_price: number | null;
  discount_rate: number | null;
  review_count: number;
  review_score: number;
}

export async function fetchBrandProducts(brandName: string, limit = 50): Promise<BrandProduct[]> {
  const { data } = await supabase
    .from('ranking_snapshots')
    .select('musinsa_no, product_name, rank_position, final_price, discount_rate, review_count, review_score, snapshot_date')
    .eq('brand_name', brandName)
    .eq('category_code', '000').eq('gender_filter', 'A').eq('age_filter', 'AGE_BAND_ALL')
    .order('snapshot_date', { ascending: false })
    .order('rank_position', { ascending: true })
    .limit(limit * 3);

  const rows = (data ?? []) as any[];
  const latestDate = rows[0]?.snapshot_date;
  return rows
    .filter(r => r.snapshot_date === latestDate)
    .slice(0, limit)
    .map(r => ({
      musinsa_no: r.musinsa_no,
      product_name: r.product_name,
      rank_position: r.rank_position,
      final_price: r.final_price,
      discount_rate: r.discount_rate,
      review_count: r.review_count ?? 0,
      review_score: r.review_score ?? 0,
    }));
}

// ── 상품 상세 ─────────────────────────────────────────────────────
export interface ProductDetail {
  id: string;
  musinsa_no: string;
  name: string;
  brand_name: string;
  brand_id: string | null;
  final_price: number | null;
  list_price: number | null;
  discount_rate: number | null;
  rank_position: number | null;
  review_count: number;
  satisfaction_score: number | null;
  category_code: string;
  gender: string | null;
  is_own: boolean;
  thumbnail_url: string | null;
}

export async function fetchProductDetail(musinsaNo: string): Promise<ProductDetail | null> {
  const { data, error } = await supabase
    .from('products')
    .select('id, musinsa_no, name, review_count, satisfaction_score, category_code, gender, is_own, thumbnail_url, brand_id, brands(name)')
    .eq('musinsa_no', musinsaNo).single();
  if (error || !data) return null;
  const p = data as any;

  const { data: ranks } = await supabase
    .from('ranking_snapshots')
    .select('rank_position, final_price, list_price, discount_rate')
    .eq('musinsa_no', musinsaNo)
    .eq('category_code', '000').eq('gender_filter', 'A').eq('age_filter', 'AGE_BAND_ALL')
    .order('snapshot_date', { ascending: false }).limit(1);
  const r = (ranks ?? [])[0] as any;

  return {
    id: p.id,
    musinsa_no: p.musinsa_no,
    name: p.name ?? '—',
    brand_name: p.brands?.name ?? '—',
    brand_id: p.brand_id,
    final_price: r?.final_price ?? null,
    list_price: r?.list_price ?? null,
    discount_rate: r?.discount_rate ?? null,
    rank_position: r?.rank_position ?? null,
    review_count: p.review_count ?? 0,
    satisfaction_score: p.satisfaction_score,
    category_code: p.category_code ?? '000',
    gender: p.gender,
    is_own: p.is_own ?? false,
    thumbnail_url: p.thumbnail_url,
  };
}

export async function fetchProductPriceHistory(musinsaNo: string): Promise<{ date: string; price: number }[]> {
  const { data } = await supabase
    .from('ranking_snapshots')
    .select('snapshot_date, final_price')
    .eq('musinsa_no', musinsaNo)
    .eq('category_code', '000').eq('gender_filter', 'A').eq('age_filter', 'AGE_BAND_ALL')
    .not('final_price', 'is', null)
    .order('snapshot_date', { ascending: true }).limit(90);
  return (data ?? []).map((r: any) => ({ date: r.snapshot_date, price: r.final_price }));
}
