import { supabaseBrowser } from './supabase/client';
const supabase = supabaseBrowser();

// 무신사 이미지 CDN 상대경로를 절대 URL로 정규화
export const normImgUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;
  if (url.startsWith('/')) return `https://image.musinsa.com${url}`;
  return url;
};

// ── 카테고리 코드 매핑 ──────────────────────────────────────────
export const CATEGORY_MAP: Record<string, string> = {
  '000': '전체', '001': '상의', '002': '아우터', '003': '바지',
  '004': '가방', '017': '스포츠/레저', '026': '속옷/홈웨어', '100': '원피스/스커트',
  '101': '소품', '102': '디지털/라이프', '103': '신발', '104': '뷰티', '106': '키즈',
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
  review_score: number;   // 0~100 만족도 % (무신사 amplitude.reviewScore)
  snapshot_date: string;
  is_own: boolean;
  product_id: string | null;
  rank_change: number | null;  // 전일 대비 순위 변동 (+상승 / -하락 / null=신규)
  thumbnail_url: string | null;
}

export async function fetchLatestRanking(opts: {
  categoryCode?: string;
  genderFilter?: string;
  ageFilter?: string;
  limit?: number;    // 날짜당 최대 행 수
  fromDate?: string; // YYYY-MM-DD. 미지정 시 최신 1일만
  toDate?: string;   // YYYY-MM-DD
}): Promise<RankingRow[]> {
  const { categoryCode = '000', genderFilter = 'A', ageFilter = 'AGE_BAND_ALL', limit = 300 } = opts;

  // 날짜 하나에 대한 쿼리 함수
  const queryDate = async (date: string) => {
    const { data, error } = await supabase
      .from('ranking_snapshots')
      .select(`rank_position, musinsa_no, product_name, brand_name,
        category_code, gender_filter, age_filter,
        list_price, final_price, discount_rate,
        is_sold_out, review_count, review_score, snapshot_date,
        product_id, products!inner(is_own, thumbnail_url, brands(companies(corp_name)))`)
      .eq('category_code', categoryCode)
      .eq('gender_filter', genderFilter)
      .eq('age_filter', ageFilter)
      .eq('snapshot_date', date)
      .order('rank_position', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as any[];
  };

  // fromDate 미지정 = 오늘 모드: 최신 날짜 자동 감지
  let dates: string[] = [];
  if (!opts.fromDate) {
    const { data: latest } = await supabase
      .from('ranking_snapshots')
      .select('snapshot_date')
      .eq('category_code', categoryCode)
      .eq('gender_filter', genderFilter)
      .eq('age_filter', ageFilter)
      .order('snapshot_date', { ascending: false })
      .limit(1);
    const latestDate = (latest as any[])?.[0]?.snapshot_date;
    if (!latestDate) return [];
    // 전일 비교용으로 하루 더 포함
    const prev = new Date(latestDate);
    prev.setDate(prev.getDate() - 1);
    dates = [prev.toISOString().slice(0, 10), latestDate];
  } else {
    // 날짜 범위를 하루씩 생성 (문자열 산술 — timezone 무관)
    const addDay = (dateStr: string, n: number): string => {
      const [y, m, d] = dateStr.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d + n));
      return dt.toISOString().slice(0, 10);
    };
    let cur = opts.fromDate;
    const end = opts.toDate ?? opts.fromDate;
    while (cur <= end) {
      dates.push(cur);
      cur = addDay(cur, 1);
    }
    // 전일 비교용으로 fromDate 하루 전도 포함
    dates = [addDay(opts.fromDate, -1), ...dates];
  }

  // 날짜별 parallel 쿼리
  const results = await Promise.all(dates.map(d => queryDate(d).then(rows => ({ date: d, rows }))));

  // byDate 맵 구성 (rank_change 계산용)
  const byDate = new Map<string, Map<string, number>>();
  for (const { date, rows } of results) {
    byDate.set(date, new Map(rows.map((r: any) => [String(r.musinsa_no), r.rank_position])));
  }

  // fromDate 미지정이면 최신 날짜만, 아니면 fromDate 이후만 반환
  const targetDates = opts.fromDate
    ? dates.slice(1)   // 전일 제외 (비교용으로만 사용)
    : dates.slice(-1); // 최신 날짜 1일만

  const output: any[] = [];
  for (const date of targetDates) {
    const prevDate = dates[dates.indexOf(date) - 1] ?? null;
    const prevMap = prevDate ? byDate.get(prevDate) : null;
    const dayRows = results.find(x => x.date === date)?.rows ?? [];
    for (const r of dayRows) {
      const prevRank = prevMap?.get(String((r as any).musinsa_no));
      output.push({
        ...r,
        is_own: (r as any).products?.is_own ?? false,
        company_name: (r as any).products?.brands?.companies?.corp_name ?? null,
        thumbnail_url: normImgUrl((r as any).products?.thumbnail_url),
        rank_change: prevRank !== undefined ? prevRank - (r as any).rank_position : null,
      });
    }
  }

  // 날짜 내림차순, 순위 오름차순 정렬
  return output.sort((a, b) =>
    a.snapshot_date > b.snapshot_date ? -1 :
    a.snapshot_date < b.snapshot_date ?  1 :
    a.rank_position - b.rank_position
  );
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
  thumbnail_url: string | null;
}

export async function fetchSnaps(opts: {
  gender?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: SnapRow[]; total: number }> {
  const { gender, limit = 50, offset = 0 } = opts;

  let q = supabase
    .from('snaps')
    .select('id, snap_id, content_type, format_type, published_at, like_count, view_count, comment_count, goods_click_count, model_gender, model_height, model_weight, collected_at, thumbnail_url', { count: 'exact' })
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
  sub_category: string | null;
  brand_names: string[];
  view_count: number;
  comment_count: number;
  published_at: string;
  collected_at: string;
  thumbnail_url: string | null;
  summary: string | null;
  landing_url: string | null;
}

export interface MagazineArticleProduct {
  musinsa_no: string;
  product_id: string;
  name: string;
  is_own: boolean;
  brand_name: string | null;
}

export async function fetchMagazineArticles(opts: {
  category?: string;
  keyword?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: 'published_at' | 'view_count' | 'comment_count';
  limit?: number;
  offset?: number;
}): Promise<{ rows: MagazineRow[]; total: number }> {
  const { category, keyword, dateFrom, dateTo, sort = 'published_at', limit = 50, offset = 0 } = opts;

  let q = supabase
    .from('magazine_articles')
    .select('id, article_id, cms_index, title, category, sub_category, brand_names, view_count, comment_count, published_at, collected_at, thumbnail_url, summary, landing_url', { count: 'exact' })
    .order(sort, { ascending: false })
    .range(offset, offset + limit - 1);

  if (category && category !== 'all') q = q.eq('category', category);
  if (keyword) q = q.ilike('title', `%${keyword}%`);
  if (dateFrom) q = q.gte('published_at', dateFrom);
  if (dateTo) q = q.lte('published_at', dateTo + 'T23:59:59');

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

export async function fetchMagazineProducts(articleId: string): Promise<MagazineArticleProduct[]> {
  const { data } = await supabase
    .from('magazine_article_products')
    .select('musinsa_no, product_id, products(name, is_own, brands(name))')
    .eq('article_id', articleId)
    .limit(30);
  return ((data ?? []) as any[]).map(r => ({
    musinsa_no: r.musinsa_no,
    product_id: r.product_id,
    name: r.products?.name ?? '(stub)',
    is_own: r.products?.is_own ?? false,
    brand_name: r.products?.brands?.name ?? null,
  })).filter(r => r.name !== '(stub)');
}

export interface MagazineArticleProductExport {
  article_id: string;
  article_title: string;
  published_at: string;
  view_count: number;
  musinsa_no: string;
  product_name: string;
  brand_name: string | null;
  is_own: boolean;
  rank_position: number | null;
}

export async function fetchMagazineArticleProductsForExport(
  articleIds: string[]
): Promise<MagazineArticleProductExport[]> {
  if (!articleIds.length) return [];

  const rows: MagazineArticleProductExport[] = [];
  for (let i = 0; i < articleIds.length; i += 50) {
    const chunk = articleIds.slice(i, i + 50);
    const { data } = await supabase
      .from('magazine_article_products')
      .select(`
        article_id, musinsa_no,
        products(name, is_own, brands(name), ranking_snapshots(rank_position, snapshot_date)),
        magazine_articles(title, published_at, view_count)
      `)
      .in('article_id', chunk)
      .limit(2000);

    for (const r of (data ?? []) as any[]) {
      const p  = r.products ?? {};
      const ma = r.magazine_articles ?? {};
      if (!p.name || p.name === '(stub)') continue;

      // 가장 최근 ranking snapshot
      const snaps: Array<{ rank_position: number; snapshot_date: string }> =
        p.ranking_snapshots ?? [];
      const latestSnap = snaps.sort((a, b) =>
        b.snapshot_date.localeCompare(a.snapshot_date)
      )[0] ?? null;

      rows.push({
        article_id:    r.article_id,
        article_title: ma.title ?? '',
        published_at:  (ma.published_at ?? '').slice(0, 10),
        view_count:    ma.view_count ?? 0,
        musinsa_no:    r.musinsa_no,
        product_name:  p.name,
        brand_name:    p.brands?.name ?? null,
        is_own:        p.is_own ?? false,
        rank_position: latestSnap?.rank_position ?? null,
      });
    }
  }
  return rows;
}

export async function fetchBrandIdsByNames(names: string[]): Promise<Record<string, string>> {
  if (!names.length) return {};
  const { data } = await supabase
    .from('brands')
    .select('id, name')
    .in('name', names);
  return Object.fromEntries((data ?? []).map((r: any) => [r.name, r.id]));
}

export interface MagazineBoostAnomaly {
  id: string;
  detection_date: string;
  severity: string;
  anomaly_type: string;
  entity_name: string | null;
  entity_id: string | null;
  description: string | null;
  meta: {
    article_id?: string;
    magazine_article_uuid?: string;
    article_title?: string;
    pub_date?: string;
    musinsa_no?: string;
    rank_before?: number | null;
    rank_after?: number;
    rank_delta?: number | null;
    article_views?: number;
    is_own?: boolean;
  };
}

export async function fetchMagazineBoostAnomalies(opts: {
  limit?: number;
  offset?: number;
  severity?: string;
  ownOnly?: boolean;
  articleIds?: string[];
}): Promise<{ rows: MagazineBoostAnomaly[]; total: number }> {
  const { limit = 50, offset = 0, severity, ownOnly, articleIds } = opts;
  let q = supabase
    .from('anomalies')
    .select('id, detection_date, severity, anomaly_type, entity_name, entity_id, description, meta', { count: 'exact' })
    .eq('module', 'magazine')
    .in('anomaly_type', ['magazine_rank_boost', 'magazine_rank_new_entry'])
    .order('detection_date', { ascending: false })
    .order('severity', { ascending: true })
    .range(offset, offset + limit - 1);
  if (severity) q = q.eq('severity', severity);
  const { data, error, count } = await q;
  if (error) throw error;
  let rows = (data ?? []) as MagazineBoostAnomaly[];
  if (ownOnly) rows = rows.filter(r => r.meta?.is_own === true);
  if (articleIds && articleIds.length > 0) {
    const idSet = new Set(articleIds);
    rows = rows.filter(r => r.meta?.article_id != null && idSet.has(r.meta.article_id));
  }
  return { rows, total: count ?? 0 };
}

// ── 리뷰 ─────────────────────────────────────────────────────────
export interface ReviewRow {
  id: string;
  product_id: string;
  musinsa_review_id: string;
  musinsa_no: string;
  rating: number;
  review_text: string | null;
  review_date: string;
  helpful_count: number;
  has_image: boolean;
  image_urls: string[];
  product_name: string;
  brand_name: string;
  member_height: number | null;
  member_weight: number | null;
  member_gender: string | null;
  satisfactions: { attribute: string; answer: string }[] | null;
  purchase_option: string | null;
}

export interface BodyStatBucket {
  label: string;
  count: number;
  avgRating: number;
}

export interface BodyStats {
  byHeight: BodyStatBucket[];
  byWeight: BodyStatBucket[];
  totalSampled: number;
}

export async function fetchReviews(opts: {
  ratingMin?: number;
  ratingMax?: number;
  dateFrom?: string;
  dateTo?: string;
  keyword?: string;
  ownOnly?: boolean;
  productId?: string;
  productIds?: string[];
  brandIds?: string[];
  categoryCodes?: string[];
  genders?: string[];
  heightMin?: number;
  heightMax?: number;
  weightMin?: number;
  weightMax?: number;
  satisfactionFilter?: Record<string, string>;
  sort?: 'recent' | 'rating_asc' | 'rating_desc' | 'helpful';
  limit?: number;
  offset?: number;
}): Promise<{ rows: ReviewRow[]; total: number }> {
  const {
    ratingMin = 1, ratingMax = 5, dateFrom, dateTo, keyword, ownOnly = true,
    productId, productIds, brandIds, categoryCodes,
    genders, heightMin, heightMax, weightMin, weightMax, satisfactionFilter,
    sort = 'recent', limit = 30, offset = 0,
  } = opts;

  let q = supabase
    .from('reviews')
    .select(`id, product_id, musinsa_review_id, rating, review_text, review_date, helpful_count, has_image, image_urls,
      member_height, member_weight, member_gender, satisfactions, purchase_option,
      products!inner(name, musinsa_no, is_own, brand_id, category_code, brands(name))`, { count: 'exact' })
    .gte('rating', ratingMin)
    .lte('rating', ratingMax)
    .range(offset, offset + limit - 1);

  if (productId) q = q.eq('product_id', productId);
  else if (productIds && productIds.length > 0) q = q.in('product_id', productIds);
  else if (ownOnly) q = (q as any).eq('products.is_own', true);
  if (brandIds && brandIds.length > 0) q = (q as any).in('products.brand_id', brandIds);
  if (categoryCodes && categoryCodes.length > 0) q = (q as any).in('products.category_code', categoryCodes);
  if (dateFrom) q = q.gte('review_date', dateFrom);
  if (dateTo) q = q.lte('review_date', dateTo);
  if (keyword) q = q.ilike('review_text', `%${keyword}%`);
  if (genders && genders.length > 0) q = q.in('member_gender', genders);
  if (heightMin != null) q = q.gte('member_height', heightMin).not('member_height', 'is', null);
  if (heightMax != null) q = q.lte('member_height', heightMax);
  if (weightMin != null) q = q.gte('member_weight', weightMin).not('member_weight', 'is', null);
  if (weightMax != null) q = q.lte('member_weight', weightMax);
  const satEntries = Object.entries(satisfactionFilter ?? {});
  for (const [attr, answer] of satEntries) {
    q = q.filter('satisfactions', 'cs', JSON.stringify([{ attribute: attr, answer }]));
  }

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
      musinsa_review_id: r.musinsa_review_id ?? '',
      musinsa_no: String(r.products?.musinsa_no ?? ''),
      rating: r.rating,
      review_text: r.review_text,
      review_date: r.review_date,
      helpful_count: r.helpful_count ?? 0,
      has_image: r.has_image ?? false,
      image_urls: r.image_urls ?? [],
      product_name: r.products?.name ?? '—',
      brand_name: r.products?.brands?.name ?? '—',
      member_height: r.member_height ?? null,
      member_weight: r.member_weight ?? null,
      member_gender: r.member_gender ?? null,
      satisfactions: r.satisfactions ?? null,
      purchase_option: r.purchase_option ?? null,
    })),
    total: count ?? 0,
  };
}

export async function fetchReviewStats(days = 30): Promise<{
  total: number; avgRating: number; lowCount: number; ratingDist: number[]; imageCount: number;
}> {
  const dateFilter = days !== 999
    ? new Date(Date.now() - days * 86400000).toISOString().split('T')[0]
    : null;

  const makeQ = () => {
    const q = supabase.from('reviews').select('*', { count: 'exact', head: true });
    return dateFilter ? q.gte('review_date', dateFilter) : q;
  };

  const [res5, res4, res3, res2, res1, imgRes] = await Promise.all([
    makeQ().eq('rating', 5),
    makeQ().eq('rating', 4),
    makeQ().eq('rating', 3),
    makeQ().eq('rating', 2),
    makeQ().eq('rating', 1),
    makeQ().eq('has_image', true),
  ]);

  const ratingDist = [res5.count ?? 0, res4.count ?? 0, res3.count ?? 0, res2.count ?? 0, res1.count ?? 0];
  const total = ratingDist.reduce((s, c) => s + c, 0);
  const avgRating = total > 0
    ? [5, 4, 3, 2, 1].reduce((s, star, i) => s + star * ratingDist[i], 0) / total
    : 0;
  const lowCount = ratingDist[3] + ratingDist[4]; // ★2 + ★1

  return { total, avgRating: Math.round(avgRating * 100) / 100, lowCount, ratingDist, imageCount: imgRes.count ?? 0 };
}


export async function fetchBodyStats(productId: string): Promise<BodyStats> {
  const { data, error } = await supabase.rpc('get_body_stats', { p_product_id: productId });
  if (error || !data) return { byHeight: [], byWeight: [], totalSampled: 0 };

  const rows = data as { type: string; bucket: string; avg_rating: number; cnt: number }[];
  const toRow = (r: typeof rows[0]): BodyStatBucket => ({
    label: r.bucket,
    count: Number(r.cnt),
    avgRating: Number(r.avg_rating),
  });
  const byHeight = rows.filter(r => r.type === 'height').map(toRow);
  const byWeight = rows.filter(r => r.type === 'weight').map(toRow);
  const totalSampled = byHeight.reduce((s, r) => s + r.count, 0);

  return { byHeight, byWeight, totalSampled };
}

export async function fetchOwnBrands(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from('brands')
    .select('id, name')
    .eq('is_own', true)
    .order('name');
  if (error) throw error;
  return (data ?? []) as { id: string; name: string }[];
}

export interface CsAnomaly {
  id: string;
  detection_date: string;
  severity: string;
  anomaly_type: string;
  entity_id: string;
  entity_name: string;
  description: string;
  meta: Record<string, unknown>;
}

export async function fetchCsAnomalies(opts?: { severity?: string; limit?: number }): Promise<CsAnomaly[]> {
  const { severity, limit = 200 } = opts ?? {};
  let q = supabase
    .from('anomalies')
    .select('id, detection_date, severity, anomaly_type, entity_id, entity_name, description, meta')
    .eq('module', 'cs')
    .order('detection_date', { ascending: false })
    .order('severity', { ascending: true })
    .limit(limit);
  if (severity) q = q.eq('severity', severity);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as CsAnomaly[];
}

export async function fetchProductBrief(id: string): Promise<{ name: string; musinsa_no: string; brand_name: string } | null> {
  const { data, error } = await supabase
    .from('products')
    .select('name, musinsa_no, brands(name)')
    .eq('id', id)
    .single();
  if (error) return null;
  return {
    name: (data as any).name ?? '—',
    musinsa_no: String((data as any).musinsa_no ?? ''),
    brand_name: (data as any).brands?.name ?? '—',
  };
}

// ── 자사 상품 ────────────────────────────────────────────────────
export interface OwnProduct {
  id: string;
  musinsa_no: number;
  name: string;
  brand_name: string;
  review_count: number;
  satisfaction_score: number | null;
  style_no: string | null;
  erp_style_code: string | null;
}

export async function fetchOwnProducts(limit = 100): Promise<OwnProduct[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, musinsa_no, name, review_count, satisfaction_score, style_no, erp_style_code, brands(name)')
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
    style_no: r.style_no ?? null,
    erp_style_code: r.erp_style_code ?? null,
  }));
}

// ── 상품 검색 ────────────────────────────────────────────────────
export interface ProductSearchResult {
  musinsa_no: number;
  name: string;
  brand_name: string;
  company_name: string | null;
  style_no: string | null;
  is_own: boolean;
}

export async function searchProducts(keyword: string, limit = 20): Promise<ProductSearchResult[]> {
  const kw = keyword.trim();
  if (!kw) return [];

  const isNum = /^\d+$/.test(kw);

  const select = 'musinsa_no, name, style_no, is_own, brands(name, companies(corp_name))';

  let q = supabase
    .from('products')
    .select(select)
    .neq('name', '(stub)')
    .not('name', 'is', null)
    .order('review_count', { ascending: false })
    .limit(limit);

  if (isNum) {
    q = q.eq('musinsa_no', parseInt(kw, 10));
  } else {
    q = q.or(`name.ilike.%${kw}%,style_no.ilike.%${kw}%,erp_style_code.ilike.%${kw}%`);
  }

  const { data: direct } = await q;

  // 브랜드명·회사명 검색 — ranking_snapshots.brand_name 기준
  let brandRows: any[] = [];
  if (!isNum) {
    const { data: br } = await supabase
      .from('ranking_snapshots')
      .select('musinsa_no, product_name, brand_name, product_id')
      .ilike('brand_name', `%${kw}%`)
      .order('rank_position', { ascending: true })
      .limit(limit * 3);

    // musinsa_no 기준으로 중복 제거 후 product 정보 조회
    const seenNos = new Set((direct ?? []).map((r: any) => r.musinsa_no));
    const uniqueNos = [...new Map((br ?? []).map((r: any) => [r.musinsa_no, r])).values()]
      .filter((r: any) => !seenNos.has(r.musinsa_no))
      .slice(0, limit);

    if (uniqueNos.length > 0) {
      const { data: extra } = await supabase
        .from('products')
        .select(select)
        .in('musinsa_no', uniqueNos.map((r: any) => r.musinsa_no))
        .neq('name', '(stub)')
        .not('name', 'is', null);
      brandRows = extra ?? [];
    }
  }

  return [...(direct ?? []), ...brandRows].map((r: any) => ({
    musinsa_no: r.musinsa_no,
    name: r.name ?? '—',
    brand_name: r.brands?.name ?? '—',
    company_name: r.brands?.companies?.corp_name ?? null,
    style_no: r.style_no ?? null,
    is_own: r.is_own ?? false,
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

export async function searchCompanies(keyword: string, limit = 20): Promise<{ id: string; corp_name: string }[]> {
  const kw = keyword.trim();
  if (!kw) return [];
  const { data, error } = await supabase
    .from('companies').select('id, corp_name')
    .ilike('corp_name', `%${kw}%`).order('corp_name').limit(limit);
  if (error) return [];
  return (data ?? []) as { id: string; corp_name: string }[];
}

export interface CompanyInfo {
  id: string;
  corp_name: string;
  business_number: string | null;
  ceo_name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  mail_order_no: string | null;
  corp_code: string | null;
  stock_code: string | null;
  is_listed: boolean;
  website: string | null;
  dart_fetched_at: string | null;
  funding_last_collected_at: string | null;
  funding_brief_md: string | null;
  funding_brief_at: string | null;
  parent_company_id: string | null;
}

export async function fetchCompanyInfo(id: string): Promise<CompanyInfo | null> {
  const { data, error } = await supabase
    .from('companies')
    .select('id, corp_name, business_number, ceo_name, address, phone, email, mail_order_no, corp_code, stock_code, is_listed, website, dart_fetched_at, funding_last_collected_at, funding_brief_md, funding_brief_at, parent_company_id')
    .eq('id', id).single();
  if (error || !data) return null;
  return data as CompanyInfo;
}

export interface CompanyChild {
  id: string;
  corp_name: string;
  brands: { id: string; name: string; slug: string; is_own: boolean; nation_name: string | null }[];
}

export async function fetchChildCompanies(companyId: string): Promise<CompanyChild[]> {
  const { data, error } = await supabase
    .from('companies')
    .select('id, corp_name, brands(id, name, slug, is_own, nation_name)')
    .eq('parent_company_id', companyId)
    .order('corp_name');
  if (error) return [];
  return (data ?? []).map((c: any) => ({
    id: c.id,
    corp_name: c.corp_name,
    brands: (c.brands ?? []).sort((a: any, b: any) =>
      Number(b.is_own) - Number(a.is_own) || a.name.localeCompare(b.name)
    ),
  }));
}

export async function fetchParentCompany(parentId: string | null): Promise<{ id: string; corp_name: string } | null> {
  if (!parentId) return null;
  const { data, error } = await supabase
    .from('companies')
    .select('id, corp_name')
    .eq('id', parentId)
    .single();
  if (error || !data) return null;
  return data as { id: string; corp_name: string };
}

export interface GroupBrandRow {
  brand_id: string;
  brand_name: string;
  company_id: string;
  company_name: string;
  depth: number;
}

export async function fetchGroupBrands(rootCompanyId: string): Promise<GroupBrandRow[]> {
  const { data, error } = await supabase.rpc('group_brands', { root_company_id: rootCompanyId });
  if (error) return [];
  return (data ?? []) as GroupBrandRow[];
}

export interface CompanyBrand {
  id: string;
  name: string;
  slug: string;
  is_own: boolean;
  nation_name: string | null;
}

export async function fetchCompanyBrands(companyId: string): Promise<CompanyBrand[]> {
  const { data, error } = await supabase
    .from('brands').select('id, name, slug, is_own, nation_name')
    .eq('company_id', companyId).order('is_own', { ascending: false }).order('name');
  if (error) return [];
  return (data ?? []) as CompanyBrand[];
}

export interface DartFinancial {
  fiscal_year: number;
  revenue: number | null;
  operating_income: number | null;
  net_income: number | null;
  total_assets: number | null;
  total_liabilities: number | null;
  data_source: string;
}

export async function fetchCompanyFinancials(companyId: string): Promise<DartFinancial[]> {
  const { data, error } = await supabase
    .from('dart_financials')
    .select('fiscal_year, revenue, operating_income, net_income, total_assets, total_liabilities, data_source')
    .eq('company_id', companyId).order('fiscal_year', { ascending: false }).limit(5);
  if (error) return [];
  return (data ?? []) as DartFinancial[];
}

export interface DartDisclosure {
  id: string;
  rcept_no: string;
  report_nm: string;
  rcept_dt: string;
  flr_nm: string | null;
  rm: string | null;
}

export async function fetchCompanyDisclosures(companyId: string, limit = 30): Promise<DartDisclosure[]> {
  const { data, error } = await supabase
    .from('dart_disclosures')
    .select('id, rcept_no, report_nm, rcept_dt, flr_nm, rm')
    .eq('company_id', companyId).order('rcept_dt', { ascending: false }).limit(limit);
  if (error) return [];
  return (data ?? []) as DartDisclosure[];
}

// ── 회사 목록 ────────────────────────────────────────────────────────────
export interface CompanyListRow {
  id: string;
  corp_name: string;
  is_listed: boolean;
  corp_code: string | null;
  brand_count: number;
  own_brand_count: number;
  fiscal_year: number | null;
  revenue: number | null;
  operating_income: number | null;
  net_income: number | null;
  total_assets: number | null;
  total_liabilities: number | null;
  op_margin: number | null;
  net_margin: number | null;
  debt_ratio: number | null;
  roe: number | null;
  rev_yoy: number | null;
  top_brands: string[];
  latest_disclosure_dt: string | null;
  latest_disclosure_nm: string | null;
}

export type CompanySortKey =
  | 'revenue' | 'net_income' | 'op_margin' | 'roe'
  | 'debt_ratio' | 'rev_yoy' | 'brand_count' | 'name' | 'dart';

export type RevRange = '대기업' | '중견기업' | '소기업' | '미수집';

export interface CompanyPageResult {
  total: number;
  rows: CompanyListRow[];
}

function mapCompanyRow(c: any): CompanyListRow {
  return {
    id:                   c.id,
    corp_name:            c.corp_name,
    is_listed:            c.is_listed,
    corp_code:            c.corp_code ?? null,
    brand_count:          Number(c.brand_count),
    own_brand_count:      Number(c.own_brand_count),
    fiscal_year:          c.fiscal_year ?? null,
    revenue:              c.revenue ?? null,
    operating_income:     c.operating_income ?? null,
    net_income:           c.net_income ?? null,
    total_assets:         c.total_assets ?? null,
    total_liabilities:    c.total_liabilities ?? null,
    op_margin:            c.op_margin  != null ? Number(c.op_margin)  : null,
    net_margin:           c.net_margin != null ? Number(c.net_margin) : null,
    debt_ratio:           c.debt_ratio != null ? Number(c.debt_ratio) : null,
    roe:                  c.roe        != null ? Number(c.roe)        : null,
    rev_yoy:              c.rev_yoy    != null ? Number(c.rev_yoy)    : null,
    top_brands:           (c.top_brands as string[]) ?? [],
    latest_disclosure_dt: c.latest_disclosure_dt ?? null,
    latest_disclosure_nm: c.latest_disclosure_nm ?? null,
  };
}

export async function fetchCompanyPage(params: {
  page: number;
  limit?: number;
  search?: string;
  sort?: CompanySortKey | null;
  listedOnly?: boolean;
  ownOnly?: boolean;
  hasFin?: boolean;
  revRanges?: RevRange[] | null;
}): Promise<CompanyPageResult> {
  const { page, limit = 50, search, sort, listedOnly, ownOnly, hasFin, revRanges } = params;
  const { data, error } = await supabase.rpc('get_company_list_page', {
    p_limit:       limit,
    p_offset:      page * limit,
    p_search:      search?.trim() || null,
    p_sort:        sort ?? null,
    p_listed_only: listedOnly ?? false,
    p_own_only:    ownOnly    ?? false,
    p_has_fin:     hasFin     ?? false,
    p_rev_ranges:  revRanges  ?? null,
  });
  if (error) throw error;
  const result = data as { total: number; rows: any[] };
  return {
    total: result.total,
    rows: (result.rows ?? []).map(mapCompanyRow),
  };
}

export async function fetchCompanyList(): Promise<CompanyListRow[]> {
  const { rows } = await fetchCompanyPage({ page: 0, limit: 9999 });
  return rows;
}

// ── 회사 랭킹 통계 ──────────────────────────────────────────────────
export interface CompanyRankStats {
  sku_count: number;
  top100_count: number;
  avg_rank: number;
  best_rank: number;
  best_product_name: string;
  snapshot_date: string;
  by_brand: { brand_name: string; sku_count: number; top100_count: number }[];
  by_category: { category_code: string; sku_count: number }[];
}

export async function fetchCompanyRankStats(brandNames: string[]): Promise<CompanyRankStats | null> {
  if (!brandNames.length) return null;

  const { data: latestRow } = await supabase
    .from('ranking_snapshots')
    .select('snapshot_date')
    .in('brand_name', brandNames.slice(0, 200))
    .eq('category_code', '000').eq('gender_filter', 'A').eq('age_filter', 'AGE_BAND_ALL')
    .order('snapshot_date', { ascending: false })
    .limit(1);

  const latestDate = (latestRow as any[])?.[0]?.snapshot_date;
  if (!latestDate) return null;

  const { data } = await supabase
    .from('ranking_snapshots')
    .select('brand_name, product_name, rank_position, musinsa_no, category_code')
    .in('brand_name', brandNames.slice(0, 200))
    .eq('gender_filter', 'A').eq('age_filter', 'AGE_BAND_ALL')
    .eq('snapshot_date', latestDate)
    .order('rank_position', { ascending: true })
    .limit(10000);

  const rows = (data ?? []) as any[];
  const allRows = rows.filter(r => r.category_code === '000');
  const sku_count = allRows.length;
  const top100_count = allRows.filter(r => r.rank_position <= 100).length;
  const avg_rank = sku_count > 0 ? Math.round(allRows.reduce((s, r) => s + r.rank_position, 0) / sku_count) : 0;
  const best = allRows[0];

  const brandMap = new Map<string, { sku_count: number; top100_count: number }>();
  for (const r of allRows) {
    const g = brandMap.get(r.brand_name) ?? { sku_count: 0, top100_count: 0 };
    g.sku_count++;
    if (r.rank_position <= 100) g.top100_count++;
    brandMap.set(r.brand_name, g);
  }

  const catMap = new Map<string, Set<number>>();
  for (const r of rows.filter((r: any) => r.category_code !== '000')) {
    const s = catMap.get(r.category_code) ?? new Set<number>();
    s.add(r.musinsa_no);
    catMap.set(r.category_code, s);
  }

  return {
    sku_count,
    top100_count,
    avg_rank,
    best_rank: best?.rank_position ?? 0,
    best_product_name: best?.product_name ?? '—',
    snapshot_date: latestDate,
    by_brand: [...brandMap.entries()]
      .map(([brand_name, v]) => ({ brand_name, ...v }))
      .sort((a, b) => b.sku_count - a.sku_count),
    by_category: [...catMap.entries()]
      .map(([category_code, s]) => ({ category_code, sku_count: s.size }))
      .sort((a, b) => b.sku_count - a.sku_count),
  };
}

export async function fetchCompanyTop100Trend(brandNames: string[], days = 30): Promise<{ date: string; top100_count: number }[]> {
  if (!brandNames.length) return [];
  const fromDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const { data } = await supabase
    .from('ranking_snapshots')
    .select('snapshot_date, rank_position')
    .in('brand_name', brandNames.slice(0, 200))
    .eq('category_code', '000').eq('gender_filter', 'A').eq('age_filter', 'AGE_BAND_ALL')
    .gte('snapshot_date', fromDate)
    .order('snapshot_date', { ascending: true })
    .limit(50000);

  const byDate = new Map<string, number>();
  for (const r of (data ?? []) as any[]) {
    if (r.rank_position <= 100) {
      byDate.set(r.snapshot_date, (byDate.get(r.snapshot_date) ?? 0) + 1);
    }
  }

  return [...byDate.entries()]
    .map(([date, top100_count]) => ({ date: date.slice(5), top100_count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── 회사 상품 분포 (성별×연령, 가격대, 할인율, 리뷰) ─────────────────────
export interface CompanyProductDist {
  genderAge:       { gender: string; age: string; sku_count: number }[];
  priceBuckets:    { label: string; count: number }[];
  discountBuckets: { label: string; count: number }[];
  reviewBuckets:   { label: string; count: number }[];
}

export async function fetchCompanyProductDist(brandNames: string[]): Promise<CompanyProductDist> {
  const empty: CompanyProductDist = { genderAge: [], priceBuckets: [], discountBuckets: [], reviewBuckets: [] };
  if (!brandNames.length) return empty;

  const { data: latestRow } = await supabase
    .from('ranking_snapshots').select('snapshot_date')
    .in('brand_name', brandNames.slice(0, 200))
    .eq('category_code', '000').eq('gender_filter', 'A').eq('age_filter', 'AGE_BAND_ALL')
    .order('snapshot_date', { ascending: false }).limit(1);
  const snapshotDate = (latestRow as any[])?.[0]?.snapshot_date;
  if (!snapshotDate) return empty;

  const { data } = await supabase
    .from('ranking_snapshots')
    .select('gender_filter, age_filter, category_code, musinsa_no, final_price, discount_rate, review_score')
    .in('brand_name', brandNames.slice(0, 200))
    .eq('snapshot_date', snapshotDate)
    .limit(50000);
  const rows = (data ?? []) as any[];

  const gaMap = new Map<string, Set<number>>();
  for (const r of rows) {
    const key = `${r.gender_filter}|${r.age_filter}`;
    const s = gaMap.get(key) ?? new Set<number>();
    s.add(r.musinsa_no);
    gaMap.set(key, s);
  }
  const genderAge = [...gaMap.entries()].map(([key, s]) => {
    const [gender, age] = key.split('|');
    return { gender, age, sku_count: s.size };
  });

  const base = rows.filter(r => r.category_code === '000');
  const uniqMap = new Map<number, any>();
  for (const r of base) { if (!uniqMap.has(r.musinsa_no)) uniqMap.set(r.musinsa_no, r); }
  const u = [...uniqMap.values()];

  const mkBuckets = <T extends { min: number; max: number; label: string }>(
    ranges: T[], getter: (r: any) => number | null
  ) => ranges.map(b => ({
    label: b.label,
    count: u.filter(r => { const v = getter(r); return v != null && v >= b.min && v < b.max; }).length,
  }));

  const priceBuckets = mkBuckets([
    { min: 0,      max: 30000,    label: '~3만' },
    { min: 30000,  max: 50000,    label: '3~5만' },
    { min: 50000,  max: 100000,   label: '5~10만' },
    { min: 100000, max: 200000,   label: '10~20만' },
    { min: 200000, max: 300000,   label: '20~30만' },
    { min: 300000, max: 500000,   label: '30~50만' },
    { min: 500000, max: Infinity, label: '50만+' },
  ], r => r.final_price);

  const discountBuckets = mkBuckets([
    { min: 0,  max: 1,   label: '무할인' },
    { min: 1,  max: 10,  label: '1~10%' },
    { min: 10, max: 20,  label: '10~20%' },
    { min: 20, max: 30,  label: '20~30%' },
    { min: 30, max: 40,  label: '30~40%' },
    { min: 40, max: 50,  label: '40~50%' },
    { min: 50, max: 101, label: '50%+' },
  ], r => r.discount_rate ?? 0);

  const reviewBuckets = mkBuckets([
    { min: 1,  max: 40,  label: '~40' },
    { min: 40, max: 60,  label: '40~60' },
    { min: 60, max: 70,  label: '60~70' },
    { min: 70, max: 80,  label: '70~80' },
    { min: 80, max: 90,  label: '80~90' },
    { min: 90, max: 101, label: '90+' },
  ], r => r.review_score);

  return { genderAge, priceBuckets, discountBuckets, reviewBuckets };
}

export interface BrandTrendRow {
  date: string;
  counts: { brand: string; top100: number }[];
}

export async function fetchCompanyBrandTrend(brandNames: string[], days = 30): Promise<BrandTrendRow[]> {
  if (brandNames.length <= 1) return [];
  const fromDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const { data } = await supabase
    .from('ranking_snapshots')
    .select('brand_name, snapshot_date, rank_position')
    .in('brand_name', brandNames.slice(0, 200))
    .eq('category_code', '000').eq('gender_filter', 'A').eq('age_filter', 'AGE_BAND_ALL')
    .gte('snapshot_date', fromDate)
    .order('snapshot_date', { ascending: true })
    .limit(50000);

  const rows = (data ?? []) as any[];
  const byDate = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!byDate.has(r.snapshot_date)) byDate.set(r.snapshot_date, new Map());
    const dm = byDate.get(r.snapshot_date)!;
    if (r.rank_position <= 100) dm.set(r.brand_name, (dm.get(r.brand_name) ?? 0) + 1);
  }

  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, dm]) => ({
      date: date.slice(5),
      counts: brandNames.map(brand => ({ brand, top100: dm.get(brand) ?? 0 })),
    }));
}

// ── 이상탐지 신호 ──────────────────────────────────────────────────
export type AnomalyRow = [string, string, string, string, string, string, string];
// [시각, sev('hi'|'md'|'lo'), 영역, 이벤트, 대상, status('open'), id]

export async function fetchAnomalySignals(days = 7): Promise<AnomalyRow[]> {
  const from = new Date(Date.now() + 9 * 3_600_000);
  from.setDate(from.getDate() - (days - 1));
  const fromDate = from.toISOString().slice(0, 10);

  const ANOMALY_EVENT_LABEL: Record<string, string> = {
    rank_spike:           '순위 급등',
    rank_drop_own:        '자사 순위 이탈',
    new_entrant_top10:    'TOP10 신규 진입',
    sold_out:             '품절 전환',
    price_drop:           '가격 급락',
    promo_heavy_discount: '고할인 프로모션',
    review_count_surge:   '리뷰 폭증',
    review_rating_drop:   '별점 급락',
    review_negative_surge:'부정 리뷰 급증',
  };

  function sevKey(s: string): string {
    return s === 'high' ? 'hi' : s === 'medium' ? 'md' : 'lo';
  }
  function areaKey(t: string): string {
    if (['rank_spike', 'new_entrant_top10', 'rank_drop_own', 'sold_out', 'price_drop'].includes(t)) return '상품';
    if (t === 'promo_heavy_discount') return '프로모션';
    return '리뷰';
  }

  const { data, error } = await supabase
    .from('anomalies')
    .select('id, detection_date, severity, anomaly_type, entity_name, description, meta')
    .gte('detection_date', fromDate)
    .order('detected_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('[fetchAnomalySignals] failed', error);
    return [];
  }

  return (data ?? []).map((r: any): AnomalyRow => {
    const m = r.meta || {};
    let event = r.description || ANOMALY_EVENT_LABEL[r.anomaly_type] || r.anomaly_type;
    if (r.anomaly_type === 'rank_spike' && m.delta != null)
      event = `순위 ↑${m.delta}계단 (${m.rank_prev}위→${m.rank_today}위)`;
    else if (r.anomaly_type === 'rank_drop_own' && m.delta != null)
      event = `순위 ↓${Math.abs(m.delta)}계단 (${m.rank_prev}위→${m.rank_today}위)`;
    else if (r.anomaly_type === 'price_drop' && m.drop_rate != null)
      event = `가격 -${Math.round(m.drop_rate * 100)}% (${(m.price_prev ?? 0).toLocaleString()}→${(m.price_today ?? 0).toLocaleString()}원)`;
    else if (r.anomaly_type === 'promo_heavy_discount' && m.discount_rate != null)
      event = `프로모션 할인율 ${m.discount_rate}%`;
    else if (r.anomaly_type === 'review_count_surge' && m.multiplier != null)
      event = `리뷰 폭증 ×${m.multiplier} (오늘 ${m.count_today}건)`;

    return [
      r.detection_date,
      sevKey(r.severity),
      areaKey(r.anomaly_type),
      event,
      r.entity_name ?? '—',
      '',
      r.id,
    ];
  });
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
  company_id: string | null;
  company_name: string | null;
}

export async function fetchBrandInfo(brandId: string): Promise<BrandInfo | null> {
  const { data, error } = await supabase
    .from('brands')
    .select('id, name, slug, is_own, nation_name, since_year, introduction, logo_url, company_id, companies(corp_name)')
    .eq('id', brandId).single();
  if (error) return null;
  const d = data as any;
  return {
    ...d,
    company_id: d.company_id ?? null,
    company_name: d.companies?.corp_name ?? null,
  } as BrandInfo;
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
  list_price: number | null;
  discount_rate: number | null;
  review_count: number;
  review_score: number;
  category_code: string;
  gender_filter: string;
  age_filter: string;
}

export async function fetchBrandProducts(brandName: string, limit = 100): Promise<BrandProduct[]> {
  const { data: latestRow } = await supabase
    .from('ranking_snapshots').select('snapshot_date')
    .eq('brand_name', brandName)
    .order('snapshot_date', { ascending: false }).limit(1);
  const latestDate = (latestRow as any[])?.[0]?.snapshot_date;
  if (!latestDate) return [];

  const { data } = await supabase
    .from('ranking_snapshots')
    .select('musinsa_no, product_name, rank_position, final_price, list_price, discount_rate, review_count, review_score, category_code, gender_filter, age_filter')
    .eq('brand_name', brandName)
    .eq('snapshot_date', latestDate)
    .order('rank_position', { ascending: true })
    .limit(5000);

  // 상품별 최고 순위 1개만
  const best = new Map<number, any>();
  for (const r of (data ?? []) as any[]) {
    const ex = best.get(r.musinsa_no);
    if (!ex || r.rank_position < ex.rank_position) best.set(r.musinsa_no, r);
  }

  return [...best.values()]
    .sort((a, b) => a.rank_position - b.rank_position)
    .slice(0, limit)
    .map(r => ({
      musinsa_no: r.musinsa_no,
      product_name: r.product_name,
      rank_position: r.rank_position,
      final_price: r.final_price,
      list_price: r.list_price ?? null,
      discount_rate: r.discount_rate,
      review_count: r.review_count ?? 0,
      review_score: r.review_score ?? 0,
      category_code: r.category_code,
      gender_filter: r.gender_filter,
      age_filter: r.age_filter,
    }));
}

export async function searchBrands(keyword: string, limit = 20): Promise<{ id: string; name: string; slug: string; company_name?: string | null }[]> {
  const kw = keyword.trim();
  if (!kw) return [];

  const sel = 'id, name, slug, companies(corp_name)';
  const [nameRes, slugRes, companyRes] = await Promise.all([
    supabase.from('brands').select(sel).ilike('name', `%${kw}%`).order('name').limit(limit),
    supabase.from('brands').select(sel).ilike('slug', `%${kw}%`).order('slug').limit(limit),
    supabase.from('brands').select('id, name, slug, companies!inner(corp_name)').ilike('companies.corp_name', `%${kw}%`).order('name').limit(limit),
  ]);

  const toRow = (row: any) => ({
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    company_name: (Array.isArray(row.companies) ? row.companies[0]?.corp_name : row.companies?.corp_name) ?? null,
  });

  const seen = new Set<string>();
  const merged: { id: string; name: string; slug: string; company_name?: string | null }[] = [];
  for (const row of [...(nameRes.data ?? []), ...(slugRes.data ?? []), ...(companyRes.data ?? [])]) {
    const r = toRow(row);
    if (!seen.has(r.id)) { seen.add(r.id); merged.push(r); }
  }

  // "리" 또는 "lee" 검색 시 slug='lee' 브랜드를 최상단으로
  if (kw === '리' || kw.toLowerCase() === 'lee') {
    const leeIdx = merged.findIndex(r => r.slug === 'lee');
    if (leeIdx > 0) {
      const [lee] = merged.splice(leeIdx, 1);
      merged.unshift(lee);
    } else if (leeIdx === -1) {
      const { data: leeData } = await supabase.from('brands').select(sel).eq('slug', 'lee').single();
      if (leeData) merged.unshift(toRow(leeData));
    }
  }

  return merged.slice(0, limit);
}

// ── 브랜드 리더보드 ──────────────────────────────────────────────
export interface BrandLeaderRow {
  brand_name: string;
  brand_id: string | null;
  nation_name: string | null;
  is_own: boolean;
  company_name: string | null;
  top100_count: number;
  avg_rank: number | null;
  best_rank: number | null;
  sku_count: number;
  avg_discount: number | null;
  avg_price: number | null;
  min_price: number | null;
  max_price: number | null;
  avg_review_score: number | null;
  total_review_count: number;
  snapshot_date: string;
  top100_change: number | null;
  avg_rank_change: number | null;
  brand_rank: number | null;       // brand_ranking_snapshots 기준 실제 브랜드 순위
  brand_rank_change: number | null; // 전일 대비 브랜드 순위 변동 (양수=상승)
}

interface BrandSnapshotGroup {
  ranks: number[];
  discounts: number[];
  prices: number[];
  reviewScores: number[];
  reviewCounts: number[];
}

async function fetchBrandSnapshot(opts: {
  categoryCode: string; genderFilter: string; ageFilter: string; beforeDate?: string;
}): Promise<{ date: string; map: Map<string, BrandSnapshotGroup> } | null> {
  const { data: dateRow } = await supabase
    .from('ranking_snapshots')
    .select('snapshot_date')
    .eq('category_code', opts.categoryCode)
    .eq('gender_filter', opts.genderFilter)
    .eq('age_filter', opts.ageFilter)
    .lte('snapshot_date', opts.beforeDate ?? '9999-12-31')
    .order('snapshot_date', { ascending: false })
    .limit(1);
  const date = (dateRow as any[])?.[0]?.snapshot_date;
  if (!date) return null;

  const { data } = await supabase
    .from('ranking_snapshots')
    .select('brand_name, rank_position, discount_rate, final_price, review_score, review_count')
    .eq('category_code', opts.categoryCode)
    .eq('gender_filter', opts.genderFilter)
    .eq('age_filter', opts.ageFilter)
    .eq('snapshot_date', date)
    .order('rank_position', { ascending: true })
    .limit(10000);

  const map = new Map<string, BrandSnapshotGroup>();
  for (const r of (data ?? []) as any[]) {
    if (!map.has(r.brand_name)) map.set(r.brand_name, { ranks: [], discounts: [], prices: [], reviewScores: [], reviewCounts: [] });
    const g = map.get(r.brand_name)!;
    g.ranks.push(r.rank_position);
    if (r.discount_rate != null && r.discount_rate > 0) g.discounts.push(r.discount_rate);
    if (r.final_price != null && r.final_price > 0) g.prices.push(r.final_price);
    if (r.review_score != null) g.reviewScores.push(r.review_score);
    if (r.review_count != null) g.reviewCounts.push(r.review_count);
  }
  return { date, map };
}

export async function fetchBrandLeaderboard(opts: {
  categoryCode?: string;
  genderFilter?: string;
  ageFilter?: string;
  targetDate?: string;
  compareDate?: string;
}): Promise<BrandLeaderRow[]> {
  const { categoryCode = '000', genderFilter = 'A', ageFilter = 'AGE_BAND_ALL', targetDate, compareDate } = opts;
  const baseOpts = { categoryCode, genderFilter, ageFilter };

  // ── 1. brand_ranking_snapshots를 주 소스로 (1위~200위 보장) ─────────────
  const brsRes = await supabase
    .from('brand_ranking_snapshots')
    .select('brand_name, rank_position, snapshot_date')
    .eq('category_code', categoryCode)
    .eq('gender_filter', genderFilter)
    .eq('age_filter', ageFilter)
    .lte('snapshot_date', targetDate ?? '9999-12-31')
    .order('snapshot_date', { ascending: false })
    .limit(400); // 200 brands × 2 dates

  const brsRows = (brsRes.data ?? []) as any[];
  const brsDates = [...new Set(brsRows.map((r: any) => r.snapshot_date as string))].sort().reverse();
  const brsToday = brsDates[0];
  const brsPrev  = brsDates[1];

  const brsTodayMap = new Map<string, number>(); // brand_name → rank_position
  const brsPrevMap  = new Map<string, number>();
  for (const r of brsRows) {
    if (r.snapshot_date === brsToday) brsTodayMap.set(r.brand_name, r.rank_position);
    else if (r.snapshot_date === brsPrev) brsPrevMap.set(r.brand_name, r.rank_position);
  }
  if (brsTodayMap.size === 0) return [];

  const brandNames = [...brsTodayMap.keys()];

  // ── 2. ranking_snapshots에서 상품 지표 집계 (enrichment) ─────────────────
  const [current, prev, brandInfoRes] = await Promise.all([
    fetchBrandSnapshot({ ...baseOpts, beforeDate: targetDate }),
    compareDate ? fetchBrandSnapshot({ ...baseOpts, beforeDate: compareDate }) : Promise.resolve(null),
    supabase
      .from('brands')
      .select('id, name, nation_name, is_own, companies(corp_name)')
      .in('name', brandNames.slice(0, 500)),
  ]);

  const infoMap = new Map((brandInfoRes.data ?? []).map((b: any) => [b.name as string, {
    id: b.id as string,
    nation_name: (b.nation_name ?? null) as string | null,
    is_own: (b.is_own ?? false) as boolean,
    company_name: (b.companies?.corp_name ?? null) as string | null,
  }]));

  // ── 3. brand_ranking_snapshots 기준으로 결과 조합 ──────────────────────
  const snapshotDate = current?.date ?? brsToday ?? '';
  const results: BrandLeaderRow[] = [];

  for (const [brand_name, brandRank] of brsTodayMap) {
    const g   = current?.map.get(brand_name) ?? null;
    const pg  = prev?.map.get(brand_name) ?? null;
    const prevRank = brsPrevMap.get(brand_name) ?? null;
    const info = infoMap.get(brand_name);

    const curTop100  = g ? g.ranks.filter(r => r <= 100).length : 0;
    const curAvg     = g ? Math.round(g.ranks.reduce((s, r) => s + r, 0) / g.ranks.length) : null;
    const prevTop100 = pg ? pg.ranks.filter(r => r <= 100).length : null;
    const prevAvg    = pg ? Math.round(pg.ranks.reduce((s, r) => s + r, 0) / pg.ranks.length) : null;
    const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null;

    results.push({
      brand_name,
      brand_id:    info?.id ?? null,
      nation_name: info?.nation_name ?? null,
      is_own:      info?.is_own ?? false,
      company_name: info?.company_name ?? null,
      brand_rank:        brandRank,
      brand_rank_change: prevRank !== null ? prevRank - brandRank : null,
      top100_count: curTop100,
      avg_rank:    curAvg,
      best_rank:   g ? Math.min(...g.ranks) : null,
      sku_count:   g ? g.ranks.length : 0,
      avg_discount:      g ? avg(g.discounts) : null,
      avg_price:         g ? avg(g.prices) : null,
      min_price:         g && g.prices.length > 0 ? Math.min(...g.prices) : null,
      max_price:         g && g.prices.length > 0 ? Math.max(...g.prices) : null,
      avg_review_score:  g ? avg(g.reviewScores) : null,
      total_review_count: g ? g.reviewCounts.reduce((s, v) => s + v, 0) : 0,
      snapshot_date: snapshotDate,
      top100_change:   prevTop100 !== null ? curTop100 - prevTop100 : null,
      avg_rank_change: prevAvg !== null && curAvg !== null ? prevAvg - curAvg : null,
    });
  }

  // 기본 정렬: 브랜드 랭킹 순위 오름차순
  return results.sort((a, b) => (a.brand_rank ?? 99999) - (b.brand_rank ?? 99999));
}

export interface BrandRankDay { date: string; avg_rank: number; sku_count: number; top100_count: number; }
export async function fetchBrandRankHistory(brandName: string): Promise<BrandRankDay[]> {
  const { data } = await supabase
    .from('ranking_snapshots')
    .select('snapshot_date, rank_position')
    .eq('brand_name', brandName)
    .eq('category_code', '000').eq('gender_filter', 'A').eq('age_filter', 'AGE_BAND_ALL')
    .order('snapshot_date', { ascending: true })
    .limit(3000);
  const byDate = new Map<string, number[]>();
  for (const r of (data ?? []) as any[]) {
    const arr = byDate.get(r.snapshot_date) ?? [];
    arr.push(r.rank_position);
    byDate.set(r.snapshot_date, arr);
  }
  return [...byDate.entries()].map(([date, ranks]) => ({
    date: date.slice(5),
    avg_rank: Math.round(ranks.reduce((s, r) => s + r, 0) / ranks.length),
    sku_count: ranks.length,
    top100_count: ranks.filter(r => r <= 100).length,
  }));
}

export interface BrandDistRow { category_code: string; gender_filter: string; age_filter: string; count: number; best_rank: number; }
export async function fetchBrandRankingDistribution(brandName: string): Promise<BrandDistRow[]> {
  const { data: latest } = await supabase
    .from('ranking_snapshots')
    .select('snapshot_date')
    .eq('brand_name', brandName)
    .order('snapshot_date', { ascending: false })
    .limit(1);
  const latestDate = (latest as any[])?.[0]?.snapshot_date;
  if (!latestDate) return [];

  // PostgREST max-rows(1000) 초과 대응 — 페이지 단위로 전부 수집
  const PAGE = 1000;
  let allRows: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('ranking_snapshots')
      .select('category_code, gender_filter, age_filter, rank_position')
      .eq('brand_name', brandName)
      .eq('snapshot_date', latestDate)
      .order('rank_position', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error || !data?.length) break;
    allRows = allRows.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  const groups = new Map<string, { count: number; best: number }>();
  for (const r of allRows) {
    const key = `${r.category_code}|${r.gender_filter}|${r.age_filter}`;
    const g = groups.get(key);
    if (!g) groups.set(key, { count: 1, best: r.rank_position });
    else { g.count++; }
  }
  return [...groups.entries()].map(([key, v]) => {
    const [category_code, gender_filter, age_filter] = key.split('|');
    return { category_code, gender_filter, age_filter, count: v.count, best_rank: v.best };
  }).sort((a, b) => a.best_rank - b.best_rank);
}

// ── 상품 상세 ─────────────────────────────────────────────────────
export interface ProductDetail {
  id: string;
  musinsa_no: string;
  name: string;
  name_eng: string | null;
  style_no: string | null;
  brand_name: string;
  brand_id: string | null;
  company_id: string | null;
  company_name: string | null;
  final_price: number | null;
  list_price: number | null;
  discount_rate: number | null;
  review_score: number | null;     // 0~100 만족도% (ranking_snapshots)
  rank_position: number | null;
  review_count: number;
  satisfaction_score: number | null;  // 별점 4.9 (products)
  category_code: string;
  category_d2_name: string | null;
  category_d3_name: string | null;
  category_path: string | null;
  gender: string | null;
  season_year: string | null;
  season_code: string | null;
  fit: string | null;
  texture: string | null;
  elasticity: string | null;
  transparency: string | null;
  thickness: string | null;
  item_seasons: string[];
  is_own: boolean;
  is_musinsa_monopoly: boolean;
  is_online_monopoly: boolean;
  is_first: boolean;
  is_clearance: boolean;
  is_outlet: boolean;
  is_limited_quantity: boolean;
  is_drop: boolean;
  is_free_return: boolean;
  labels: string[];
  colors: string[];
  sizes: string[];
  thumbnail_url: string | null;
  ranking_best_records: { rank: number; gender: string; depth1CategoryName: string; year: number; month: number }[];
}

export async function fetchProductDetail(musinsaNo: string): Promise<ProductDetail | null> {
  const no = parseInt(musinsaNo, 10);

  const [productRes, rankRes] = await Promise.all([
    supabase
      .from('products')
      .select(`
        id, musinsa_no, name, name_eng, style_no,
        review_count, satisfaction_score,
        category_code, category_d2_name, category_d3_name, category_path,
        gender, season_year, season_code,
        fit, texture, elasticity, transparency, thickness, item_seasons,
        is_own, is_musinsa_monopoly, is_online_monopoly, is_first,
        is_clearance, is_outlet, is_limited_quantity, is_drop, is_free_return,
        labels, colors, sizes, thumbnail_url, ranking_best_records,
        brand_id, brands(name, company_id, companies(corp_name))
      `)
      .eq('musinsa_no', no)
      .maybeSingle(),
    // 랭킹 스냅샷에서 최신 데이터 — 카테고리/성별 필터 없이 가장 최근 행 1개
    supabase
      .from('ranking_snapshots')
      .select('rank_position, final_price, list_price, discount_rate, review_score, product_name, brand_name')
      .eq('musinsa_no', no)
      .order('snapshot_date', { ascending: false })
      .order('rank_position', { ascending: true })
      .limit(1),
  ]);

  const p = productRes.data as any;
  const r = (rankRes.data ?? [])[0] as any;

  // stub이거나 products에 없는 경우 ranking_snapshots 데이터로 채움
  if (!p && !r) return null;
  const isStub = !p || p.name === '(stub)' || !p.name;

  return {
    id: p?.id ?? '',
    musinsa_no: p?.musinsa_no ?? no,
    name: isStub ? (r?.product_name ?? '상품명 미수집') : p.name,
    name_eng: p?.name_eng ?? null,
    style_no: p?.style_no ?? null,
    brand_name: isStub ? (r?.brand_name ?? '—') : (p?.brands?.name ?? r?.brand_name ?? '—'),
    brand_id: p?.brand_id ?? null,
    company_id: p?.brands?.company_id ?? null,
    company_name: p?.brands?.companies?.corp_name ?? null,
    final_price: r?.final_price ?? null,
    list_price: r?.list_price ?? null,
    discount_rate: r?.discount_rate ?? null,
    review_score: r?.review_score ?? null,
    rank_position: r?.rank_position ?? null,
    review_count: p?.review_count ?? 0,
    satisfaction_score: p?.satisfaction_score != null ? Number(p.satisfaction_score) : null,
    category_code: p?.category_code ?? '000',
    category_d2_name: p?.category_d2_name ?? null,
    category_d3_name: p?.category_d3_name ?? null,
    category_path: p?.category_path ?? null,
    gender: p?.gender ?? null,
    season_year: p?.season_year ?? null,
    season_code: p?.season_code ?? null,
    fit: p?.fit ?? null,
    texture: p?.texture ?? null,
    elasticity: p?.elasticity ?? null,
    transparency: p?.transparency ?? null,
    thickness: p?.thickness ?? null,
    item_seasons: p?.item_seasons ?? [],
    is_own: p?.is_own ?? false,
    is_musinsa_monopoly: p?.is_musinsa_monopoly ?? false,
    is_online_monopoly: p?.is_online_monopoly ?? false,
    is_first: p?.is_first ?? false,
    is_clearance: p?.is_clearance ?? false,
    is_outlet: p?.is_outlet ?? false,
    is_limited_quantity: p?.is_limited_quantity ?? false,
    is_drop: p?.is_drop ?? false,
    is_free_return: p?.is_free_return ?? false,
    labels: p?.labels ?? [],
    colors: p?.colors ?? [],
    sizes: p?.sizes ?? [],
    thumbnail_url: normImgUrl(p?.thumbnail_url),
    ranking_best_records: p?.ranking_best_records ?? [],
  };
}

export async function fetchProductPriceHistory(musinsaNo: string): Promise<{ date: string; price: number; discount_rate: number | null }[]> {
  const { data } = await supabase
    .from('ranking_snapshots')
    .select('snapshot_date, final_price, discount_rate, rank_position')
    .eq('musinsa_no', parseInt(musinsaNo, 10))
    .not('final_price', 'is', null)
    .gt('final_price', 0)
    .order('snapshot_date', { ascending: true })
    .order('rank_position', { ascending: true })  // best rank first → 날짜별 가장 대표적인 행
    .limit(500);
  const seen = new Set<string>();
  return (data ?? []).filter((r: any) => {
    if (seen.has(r.snapshot_date)) return false;
    seen.add(r.snapshot_date);
    return true;
  }).map((r: any) => ({ date: r.snapshot_date, price: r.final_price, discount_rate: r.discount_rate ?? null }));
}

// 카테고리별 진입 현황 — 최신 날짜 기준 카테고리별 최고 순위
export interface CategoryRankRow {
  category_code: string; best_rank: number; combo_count: number;
  best_gender: string; best_age: string;
  segments: { gender: string; age: string; rank: number }[];
}
export interface CategoryRanksResult {
  snapshot_date: string;
  rows: CategoryRankRow[];
}

export async function fetchProductCategoryRanks(musinsaNo: string): Promise<CategoryRanksResult> {
  const no = parseInt(musinsaNo, 10);
  const { data: latestRow } = await supabase
    .from('ranking_snapshots')
    .select('snapshot_date')
    .eq('musinsa_no', no)
    .order('snapshot_date', { ascending: false })
    .limit(1);
  if (!latestRow?.length) return { snapshot_date: '', rows: [] };
  const latestDate = (latestRow[0] as any).snapshot_date;

  const { data } = await supabase
    .from('ranking_snapshots')
    .select('category_code, rank_position, gender_filter, age_filter')
    .eq('musinsa_no', no)
    .eq('snapshot_date', latestDate)
    .order('rank_position', { ascending: true });

  const GENDER_ORDER: Record<string, number> = { A: 0, M: 1, F: 2 };
  const AGE_ORDER: Record<string, number> = {
    AGE_BAND_ALL: 0, AGE_BAND_MINOR: 1, AGE_BAND_20: 2, AGE_BAND_25: 3,
    AGE_BAND_30: 4, AGE_BAND_35: 5, AGE_BAND_40: 6,
  };
  const segSort = (a: { gender: string; age: string }, b: { gender: string; age: string }) =>
    (GENDER_ORDER[a.gender] ?? 9) - (GENDER_ORDER[b.gender] ?? 9) ||
    (AGE_ORDER[a.age] ?? 9) - (AGE_ORDER[b.age] ?? 9);

  const groups = new Map<string, { best: number; gender: string; age: string; segments: { gender: string; age: string; rank: number }[] }>();
  for (const r of (data ?? []) as any[]) {
    const g = groups.get(r.category_code);
    if (!g) {
      groups.set(r.category_code, { best: r.rank_position, gender: r.gender_filter, age: r.age_filter, segments: [{ gender: r.gender_filter, age: r.age_filter, rank: r.rank_position }] });
    } else {
      g.segments.push({ gender: r.gender_filter, age: r.age_filter, rank: r.rank_position });
    }
  }
  const rows = [...groups.entries()]
    .map(([code, v]) => ({
      category_code: code, best_rank: v.best, combo_count: v.segments.length,
      best_gender: v.gender, best_age: v.age,
      segments: v.segments.sort(segSort),
    }))
    .sort((a, b) => a.category_code.localeCompare(b.category_code));
  return { snapshot_date: latestDate, rows };
}

export async function fetchProductRankHistory(musinsaNo: string): Promise<{ date: string; rank: number; category: string }[]> {
  const { data } = await supabase
    .from('ranking_snapshots')
    .select('snapshot_date, rank_position, category_code')
    .eq('musinsa_no', parseInt(musinsaNo, 10))
    .not('rank_position', 'is', null)
    .order('snapshot_date', { ascending: true })
    .order('rank_position', { ascending: true })  // best rank first per date
    .limit(500);
  // 날짜별 best rank 1개만 — 여러 카테고리 중 가장 높은 순위
  const seen = new Map<string, { rank: number; category: string }>();
  for (const r of (data ?? []) as any[]) {
    if (!seen.has(r.snapshot_date)) {
      seen.set(r.snapshot_date, { rank: r.rank_position, category: r.category_code });
    }
  }
  return [...seen.entries()]
    .map(([date, v]) => ({ date, rank: v.rank, category: v.category }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── 홈 대시보드 전용 쿼리 ───────────────────────────────────────────────

export interface CollectionStat {
  id: string;
  label: string;
  count: number;
  latestDate: string | null;
  target: number | null;
  status: 'active' | 'partial' | 'pending';
  link: string | null;
}

export async function fetchCollectionStats(): Promise<CollectionStat[]> {
  const rs = await Promise.allSettled([
    /* 0  ranking_snapshots     */ supabase.from('ranking_snapshots').select('snapshot_date', { count: 'exact' }).order('snapshot_date', { ascending: false }).limit(1),
    /* 1  brand_ranking_snapshots */ supabase.from('brand_ranking_snapshots').select('snapshot_date', { count: 'exact' }).order('snapshot_date', { ascending: false }).limit(1),
    /* 2  products is_own       */ supabase.from('products').select('*', { count: 'exact', head: true }).eq('is_own', true),
    /* 3  products total        */ supabase.from('products').select('*', { count: 'exact', head: true }),
    /* 4  products detail       */ supabase.from('products').select('*', { count: 'exact', head: true }).not('detail_fetched_at', 'is', null),
    /* 5  snaps                 */ supabase.from('snaps').select('*', { count: 'exact', head: true }),
    /* 5b snap_rankings date   */ supabase.from('snap_rankings').select('snapshot_date').order('snapshot_date', { ascending: false }).limit(1),
    /* 6  magazine_articles     */ supabase.from('magazine_articles').select('published_at', { count: 'exact' }).order('published_at', { ascending: false }).limit(1),
    /* 7  reviews               */ supabase.from('reviews').select('created_at', { count: 'exact' }).order('created_at', { ascending: false }).limit(1),
    /* 8  promotions            */ supabase.from('promotions').select('snapshot_date', { count: 'exact' }).order('snapshot_date', { ascending: false }).limit(1),
    /* 9  dart_financials       */ supabase.from('dart_financials').select('*', { count: 'exact', head: true }),
    /* 10 companies             */ supabase.from('companies').select('*', { count: 'exact', head: true }),
    /* 11 dart_disclosures      */ supabase.from('dart_disclosures').select('*', { count: 'exact', head: true }),
    /* 12 own_sales_daily       */ supabase.from('own_sales_daily').select('*', { count: 'exact', head: true }),
    /* 13 own_inventory         */ supabase.from('own_inventory').select('*', { count: 'exact', head: true }),
    /* 14 review_analysis       */ supabase.from('review_analysis').select('*', { count: 'exact', head: true }),
  ]);

  const g = (i: number): { count: number; data: any[] } => {
    const r = rs[i];
    if (r.status !== 'fulfilled') return { count: 0, data: [] };
    return { count: (r.value as any).count ?? 0, data: (r.value as any).data ?? [] };
  };

  const rank   = g(0);  const brank  = g(1);
  const ownP   = g(2);  const allP   = g(3);  const detP   = g(4);
  const snps   = g(5);  const snpRnk = g(6);
  const mags   = g(7);  const revs   = g(8);  const proms  = g(9);
  const dartF  = g(10); const corps  = g(11); const dartD  = g(12);
  const sales  = g(13); const inv    = g(14); const revA   = g(15);

  const rankDate  = rank.data[0]?.snapshot_date?.slice(5) ?? null;
  const brankDate = brank.data[0]?.snapshot_date?.slice(5) ?? null;
  const snpsDate  = snpRnk.data[0]?.snapshot_date?.slice(5) ?? null;
  const magsDate  = mags.data[0]?.published_at?.slice(5, 10) ?? null;
  const revsDate  = revs.data[0]?.created_at?.slice(5, 10) ?? null;
  const promsDate = proms.data[0]?.snapshot_date?.slice(5) ?? null;

  const compTotal  = allP.count - ownP.count;
  const compDetail = Math.max(0, detP.count - ownP.count);

  return [
    { id: 'ranking',         label: '상품 랭킹 스냅샷',   count: rank.count,   latestDate: rankDate,  target: null,       status: 'active',                                  link: '/ranking' },
    { id: 'brand-ranking',   label: '브랜드 랭킹 스냅샷', count: brank.count,  latestDate: brankDate, target: null,       status: 'active',                                  link: '/brand-ranking' },
    { id: 'own-products',    label: '자사 상품 목록',     count: ownP.count,   latestDate: null,      target: null,       status: 'active',                                  link: '/matching' },
    { id: 'comp-detail',     label: '경쟁사 상품 상세',   count: compDetail,   latestDate: null,      target: compTotal,  status: compDetail > 0 ? 'partial' : 'pending',    link: '/product' },
    { id: 'promotions',      label: '프로모션 모듈',      count: proms.count,  latestDate: promsDate, target: null,       status: 'active',                                  link: '/promo' },
    { id: 'snaps',           label: '스냅',              count: snps.count,   latestDate: snpsDate,  target: null,       status: 'active',                                  link: '/snap' },
    { id: 'magazines',       label: '매거진 기사',        count: mags.count,   latestDate: magsDate,  target: null,       status: 'active',                                  link: '/magazine' },
    { id: 'reviews',         label: '자사 리뷰',          count: revs.count,   latestDate: revsDate,  target: null,       status: 'active',                                  link: '/reviews' },
    { id: 'companies',       label: '법인 마스터',        count: corps.count,  latestDate: null,      target: null,       status: 'active',                                  link: '/companies' },
    { id: 'dart-disc',       label: 'DART 공시',          count: dartD.count,  latestDate: null,      target: null,       status: dartD.count > 0 ? 'partial' : 'pending',   link: '/companies' },
    { id: 'dart-fin',        label: 'DART 재무제표',      count: dartF.count,  latestDate: null,      target: null,       status: dartF.count > 0 ? 'partial' : 'pending',   link: '/companies' },
    { id: 'own-sales',       label: '자사 매출 (ERP)',    count: sales.count,  latestDate: null,      target: null,       status: 'pending',                                 link: null },
    { id: 'own-inventory',   label: '자사 재고 (ERP)',    count: inv.count,    latestDate: null,      target: null,       status: 'pending',                                 link: null },
    { id: 'review-analysis', label: 'LLM 리뷰 분석',     count: revA.count,   latestDate: null,      target: revs.count, status: 'pending',                                 link: null },
  ];
}

export interface OwnBrandStat {
  id: string;
  slug: string;
  name: string;
  sku_count: number;
  top100_count: number;
  avg_satisfaction: number | null;
}

export async function fetchOwnBrandBreakdown(): Promise<OwnBrandStat[]> {
  const { data: brands, error } = await supabase
    .from('brands')
    .select('id, slug, name')
    .eq('is_own', true)
    .order('name');
  if (error || !brands?.length) return [];

  const [productCounts, rankData] = await Promise.all([
    Promise.all((brands as any[]).map(b =>
      supabase.from('products')
        .select('satisfaction_score', { count: 'exact' })
        .eq('brand_id', b.id)
        .limit(200)
    )),
    (async () => {
      const { data: dateRow } = await supabase
        .from('ranking_snapshots')
        .select('snapshot_date')
        .eq('category_code', '000').eq('gender_filter', 'A').eq('age_filter', 'AGE_BAND_ALL')
        .order('snapshot_date', { ascending: false }).limit(1);
      const latestDate = (dateRow as any[])?.[0]?.snapshot_date;
      if (!latestDate) return null;
      const names = (brands as any[]).map(b => b.name);
      const { data } = await supabase
        .from('ranking_snapshots')
        .select('brand_name, rank_position')
        .in('brand_name', names)
        .eq('category_code', '000').eq('gender_filter', 'A').eq('age_filter', 'AGE_BAND_ALL')
        .eq('snapshot_date', latestDate)
        .lte('rank_position', 100)
        .limit(5000);
      return data;
    })(),
  ]);

  const top100Map = new Map<string, number>();
  for (const r of (rankData ?? []) as any[]) {
    top100Map.set(r.brand_name, (top100Map.get(r.brand_name) ?? 0) + 1);
  }

  return (brands as any[]).map((brand, i) => {
    const res = productCounts[i];
    const count = res.count ?? 0;
    const sats = ((res.data ?? []) as any[])
      .map(p => p.satisfaction_score != null ? Number(p.satisfaction_score) : null)
      .filter((n): n is number => n !== null);
    const avgSat = sats.length > 0
      ? Math.round(sats.reduce((s, v) => s + v, 0) / sats.length * 100) / 100
      : null;
    return {
      id: brand.id as string,
      slug: brand.slug as string,
      name: brand.name as string,
      sku_count: count,
      top100_count: top100Map.get(brand.name) ?? 0,
      avg_satisfaction: avgSat,
    };
  });
}

export interface PromoSummary {
  id: string;
  title: string;
  promotion_type: string;
  items_count: number;
  end_at: string | null;
  snapshot_date: string;
  avg_discount_rate: number | null;
}

export async function fetchActivePromotions(limit = 20): Promise<PromoSummary[]> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('promotions')
    .select('id, title, promotion_type, items_count, end_at, snapshot_date')
    .or(`end_at.is.null,end_at.gte.${now}`)
    .order('snapshot_date', { ascending: false })
    .limit(limit);
  if (error) return [];

  const promos = (data ?? []) as any[];
  if (promos.length === 0) return [];

  const promoIds = promos.map((p: any) => p.id);
  const { data: itemsData } = await supabase
    .from('promotion_items')
    .select('promotion_id, discount_rate')
    .in('promotion_id', promoIds)
    .not('discount_rate', 'is', null)
    .gt('discount_rate', 0)
    .limit(10000);

  const discountMap = new Map<string, number[]>();
  for (const item of (itemsData ?? []) as any[]) {
    if (!discountMap.has(item.promotion_id)) discountMap.set(item.promotion_id, []);
    discountMap.get(item.promotion_id)!.push(Number(item.discount_rate));
  }

  return promos.map((p: any): PromoSummary => {
    const rates = discountMap.get(p.id) ?? [];
    return {
      ...p,
      avg_discount_rate: rates.length > 0
        ? Math.round(rates.reduce((s, v) => s + v, 0) / rates.length)
        : null,
    };
  });
}

export interface BrandRankRow {
  rank_position: number;
  brand_name: string;
  brand_image_url: string | null;
  musinsa_brand_slug: string;
  snapshot_date: string;
  is_own: boolean;
  rank_change: number | null;
  company_name: string | null;
  avg_discount: number | null;
  avg_price: number | null;
  min_price: number | null;
  max_price: number | null;
  avg_review_score: number | null;
  total_review_count: number;
}

export async function fetchTopBrandRanking(opts: {
  genderFilter?: string;
  limit?: number;
}): Promise<BrandRankRow[]> {
  const { genderFilter = 'A', limit = 10 } = opts;

  const { data: dateRow } = await supabase
    .from('brand_ranking_snapshots')
    .select('snapshot_date')
    .eq('category_code', '000')
    .eq('gender_filter', genderFilter)
    .eq('age_filter', 'AGE_BAND_ALL')
    .order('snapshot_date', { ascending: false })
    .limit(1);

  const latestDate = (dateRow as any[])?.[0]?.snapshot_date;
  if (!latestDate) return [];

  const [latestRes, prevDateRes] = await Promise.all([
    supabase
      .from('brand_ranking_snapshots')
      .select('rank_position, brand_name, brand_image_url, musinsa_brand_slug, brands(is_own, companies(corp_name))')
      .eq('category_code', '000')
      .eq('gender_filter', genderFilter)
      .eq('age_filter', 'AGE_BAND_ALL')
      .eq('snapshot_date', latestDate)
      .order('rank_position', { ascending: true })
      .limit(limit),
    supabase
      .from('brand_ranking_snapshots')
      .select('snapshot_date')
      .eq('category_code', '000')
      .eq('gender_filter', genderFilter)
      .eq('age_filter', 'AGE_BAND_ALL')
      .lt('snapshot_date', latestDate)
      .order('snapshot_date', { ascending: false })
      .limit(1),
  ]);

  if (latestRes.error) {
    console.error('[fetchTopBrandRanking] failed', latestRes.error);
    return [];
  }

  const prevDate = (prevDateRes.data as any[])?.[0]?.snapshot_date ?? null;
  const brandNames = (latestRes.data ?? []).map((r: any) => r.brand_name as string);
  const slugs = (latestRes.data ?? []).map((r: any) => r.musinsa_brand_slug as string);

  // ranking_snapshots 최신 날짜 조회 (brand_ranking_snapshots와 날짜 다를 수 있음)
  const [prevData, rsDateRow] = await Promise.all([
    prevDate && slugs.length > 0
      ? supabase
          .from('brand_ranking_snapshots')
          .select('musinsa_brand_slug, rank_position')
          .eq('category_code', '000')
          .eq('gender_filter', genderFilter)
          .eq('age_filter', 'AGE_BAND_ALL')
          .eq('snapshot_date', prevDate)
          .in('musinsa_brand_slug', slugs)
      : Promise.resolve({ data: [] }),
    supabase
      .from('ranking_snapshots')
      .select('snapshot_date')
      .eq('category_code', '000')
      .eq('gender_filter', genderFilter)
      .eq('age_filter', 'AGE_BAND_ALL')
      .order('snapshot_date', { ascending: false })
      .limit(1),
  ]);

  const prevMap = new Map<string, number>();
  for (const r of ((prevData as any).data ?? []) as any[]) {
    prevMap.set(r.musinsa_brand_slug, r.rank_position);
  }

  // 브랜드별 집계 지표: ranking_snapshots에서 TOP10 브랜드만 집계
  const metricsMap = new Map<string, {
    discounts: number[]; prices: number[]; reviewScores: number[]; reviewCounts: number[];
  }>();

  const rsDate = (rsDateRow.data as any[])?.[0]?.snapshot_date ?? null;
  if (rsDate && brandNames.length > 0) {
    const { data: metricsData } = await supabase
      .from('ranking_snapshots')
      .select('brand_name, discount_rate, final_price, review_score, review_count')
      .eq('category_code', '000')
      .eq('gender_filter', genderFilter)
      .eq('age_filter', 'AGE_BAND_ALL')
      .eq('snapshot_date', rsDate)
      .in('brand_name', brandNames)
      .limit(5000);

    for (const r of (metricsData ?? []) as any[]) {
      if (!metricsMap.has(r.brand_name)) {
        metricsMap.set(r.brand_name, { discounts: [], prices: [], reviewScores: [], reviewCounts: [] });
      }
      const g = metricsMap.get(r.brand_name)!;
      if (r.discount_rate != null && r.discount_rate > 0) g.discounts.push(r.discount_rate);
      if (r.final_price != null && r.final_price > 0) g.prices.push(r.final_price);
      if (r.review_score != null) g.reviewScores.push(r.review_score);
      if (r.review_count != null) g.reviewCounts.push(r.review_count);
    }
  }

  return (latestRes.data ?? []).map((r: any): BrandRankRow => {
    const prevRank = prevMap.get(r.musinsa_brand_slug);
    const g = metricsMap.get(r.brand_name);
    const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null;
    return {
      rank_position: r.rank_position,
      brand_name: r.brand_name,
      brand_image_url: r.brand_image_url ?? null,
      musinsa_brand_slug: r.musinsa_brand_slug,
      snapshot_date: latestDate,
      is_own: (r.brands as any)?.is_own ?? false,
      rank_change: prevRank != null ? prevRank - r.rank_position : null,
      company_name: (r.brands as any)?.companies?.corp_name ?? null,
      avg_discount: g ? avg(g.discounts) : null,
      avg_price: g ? avg(g.prices) : null,
      min_price: g && g.prices.length > 0 ? Math.min(...g.prices) : null,
      max_price: g && g.prices.length > 0 ? Math.max(...g.prices) : null,
      avg_review_score: g ? avg(g.reviewScores) : null,
      total_review_count: g ? g.reviewCounts.reduce((s, v) => s + v, 0) : 0,
    };
  });
}

// ── Collection Jobs (Realtime) ────────────────────────────────────────────

export interface CollectionJob {
  id: number;
  script: string;
  label: string;
  status: 'running' | 'done' | 'error';
  rows_done: number;
  target: number | null;
  error_msg: string | null;
  started_at: string;
  finished_at: string | null;
  updated_at: string;
}

// ── Shell UI 집계 (Sidebar 뱃지 + Topbar CONTEXTS) ────────────────────────

export interface ShellStats {
  anomalyCount: number;
  reviewTotal: number;
  reviewAvgRating: number;
  reviewLowCount: number;
  snapNew7d: number;
  magazineNew7d: number;
  promoActiveCount: number;
}

export async function fetchShellStats(): Promise<ShellStats> {
  const d7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const [anomalyRes, reviewRes, snapRes, magRes, promoRes] = await Promise.allSettled([
    supabase
      .from('anomalies')
      .select('*', { count: 'exact', head: true })
      .gte('detection_date', d7),
    fetchReviewStats(30),
    supabase.from('snaps').select('*', { count: 'exact', head: true }).gte('published_at', d7),
    supabase.from('magazine_articles').select('*', { count: 'exact', head: true }).gte('published_at', d7),
    supabase.from('promotions').select('*', { count: 'exact', head: true })
      .or(`end_at.is.null,end_at.gte.${new Date().toISOString()}`),
  ]);

  return {
    anomalyCount:     anomalyRes.status === 'fulfilled' ? ((anomalyRes.value as any).count ?? 0) : 0,
    reviewTotal:      reviewRes.status === 'fulfilled' ? reviewRes.value.total : 0,
    reviewAvgRating:  reviewRes.status === 'fulfilled' ? reviewRes.value.avgRating : 0,
    reviewLowCount:   reviewRes.status === 'fulfilled' ? reviewRes.value.lowCount : 0,
    snapNew7d:        snapRes.status === 'fulfilled' ? ((snapRes.value as any).count ?? 0) : 0,
    magazineNew7d:    magRes.status === 'fulfilled' ? ((magRes.value as any).count ?? 0) : 0,
    promoActiveCount: promoRes.status === 'fulfilled' ? ((promoRes.value as any).count ?? 0) : 0,
  };
}

/** 현재 실행 중인 작업 목록 조회 (초기 로드 및 Realtime 변경 시 재조회용) */
export async function fetchActiveJobs(): Promise<CollectionJob[]> {
  const { data, error } = await supabase
    .from('collection_jobs')
    .select('id, script, label, status, rows_done, target, error_msg, started_at, finished_at, updated_at')
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('[fetchActiveJobs] failed', error);
    return [];
  }
  return (data ?? []) as CollectionJob[];
}

// ── 자사 상품 (가격 포함) ──────────────────────────────────────────
export interface OwnProductWithPrice {
  id: string;
  musinsa_no: string;
  name: string;
  brand_name: string;
  brand_id: string;
  thumbnail_url: string | null;
  category_code: string | null;
  category_d2_name: string | null;
  gender: string | null;
  season_year: string | null;
  review_count: number;
  satisfaction_score: number | null;
  list_price: number | null;
  final_price: number | null;
  discount_rate: number | null;
  is_sold_out: boolean;
  style_no: string | null;
  erp_style_code: string | null;
}

export async function fetchOwnProductsWithPrices(opts: {
  brandIds?: string[];
  categoryCodes?: string[];
  gender?: string;
  keyword?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: OwnProductWithPrice[]; total: number }> {
  const { brandIds, categoryCodes, gender, keyword, limit = 50, offset = 0 } = opts;

  let q = supabase
    .from('products')
    .select(
      'id, musinsa_no, name, style_no, erp_style_code, thumbnail_url, category_code, category_d2_name, gender, season_year, review_count, satisfaction_score, brands(id, name)',
      { count: 'exact' }
    )
    .eq('is_own', true)
    .order('review_count', { ascending: false });

  q = (q as any).range(offset, offset + limit - 1);

  if (brandIds && brandIds.length > 0) q = (q as any).in('brand_id', brandIds);
  if (categoryCodes && categoryCodes.length > 0) q = (q as any).in('category_code', categoryCodes);
  if (gender) q = (q as any).eq('gender', gender);
  if (keyword) q = (q as any).or(`name.ilike.%${keyword}%,style_no.ilike.%${keyword}%,erp_style_code.ilike.%${keyword}%`);

  const { data, error, count } = await q;
  if (error) throw error;
  const products = (data ?? []) as any[];

  if (!products.length) return { rows: [], total: count ?? 0 };

  // 최신 가격 정보: ranking_snapshots 에서 per-product latest
  const musinsa_nos = products.map((p: any) => String(p.musinsa_no));
  const { data: snapData, error: snapError } = await supabase
    .from('ranking_snapshots')
    .select('musinsa_no, list_price, final_price, discount_rate, is_sold_out')
    .in('musinsa_no', musinsa_nos)
    .eq('category_code', '000')
    .eq('gender_filter', 'A')
    .eq('store_code', 'musinsa')
    .order('snapshot_date', { ascending: false })
    .limit(musinsa_nos.length * 5);
  if (snapError) console.warn('[fetchOwnProductsWithPrices] snapshot query failed', snapError);

  const snapMap = new Map<string, any>();
  for (const s of (snapData ?? []) as any[]) {
    const key = String(s.musinsa_no);
    if (!snapMap.has(key)) snapMap.set(key, s);
  }

  const rows: OwnProductWithPrice[] = products.map((p: any) => {
    const snap = snapMap.get(String(p.musinsa_no));
    return {
      id: p.id,
      musinsa_no: String(p.musinsa_no),
      name: p.name ?? '—',
      brand_name: (p.brands as any)?.name ?? '—',
      brand_id: (p.brands as any)?.id ?? '',
      thumbnail_url: normImgUrl(p.thumbnail_url),
      category_code: p.category_code ?? null,
      category_d2_name: p.category_d2_name ?? null,
      gender: p.gender ?? null,
      season_year: p.season_year ?? null,
      review_count: p.review_count ?? 0,
      satisfaction_score: p.satisfaction_score ?? null,
      list_price: snap?.list_price ?? null,
      final_price: snap?.final_price ?? null,
      discount_rate: snap?.discount_rate ?? null,
      is_sold_out: snap?.is_sold_out ?? false,
      style_no: p.style_no ?? null,
      erp_style_code: p.erp_style_code ?? null,
    };
  });

  return { rows, total: count ?? 0 };
}

// ── 자사매칭 ──────────────────────────────────────────────────────

export type OwnBrand = { id: string; name: string };

export interface CompetitorBrandRow {
  id: string;
  own_brand_id: string;
  brand_id: string;
  company_id: string | null;
  brand_name: string;
  slug: string | null;
  name_eng: string | null;
  nation_name: string | null;
  since_year: number | null;
  service_type: string | null;
  corp_name: string | null;
  ceo_name: string | null;
  is_listed: boolean | null;
  website: string | null;
  revenue: number | null;
  operating_income: number | null;
  fiscal_year: number | null;
  brand_rank: number | null;
  added_at: string;
}

export interface BrandSearchRow {
  id: string;
  name: string;
  slug: string | null;
  corp_name: string | null;
}

export interface CompetitorProductSearchResult {
  id: string;
  musinsa_no: string;
  name: string;
  brand_name: string;
  thumbnail_url: string | null;
  review_count: number;
  satisfaction_score: number | null;
  category_code: string | null;
}

export interface ProductMatchRow {
  id: string;
  own_product_id: string;
  competitor_product_id: string;
  competitor_name: string;
  competitor_brand: string;
  competitor_musinsa_no: string;
  competitor_thumbnail: string | null;
  competitor_review_count: number;
  competitor_satisfaction: number | null;
  competitor_category: string | null;
  status: 'auto' | 'confirmed' | 'excluded';
  score: number | null;
  created_at: string;
}

export async function fetchCompetitorBrands(ownBrandId: string): Promise<CompetitorBrandRow[]> {
  const { data, error } = await supabase
    .from('competitor_brands')
    .select(`id, own_brand_id, brand_id, added_at,
      brands!competitor_brands_brand_id_fkey(
        name, slug, name_eng, nation_name, since_year, service_type, company_id,
        companies(corp_name, ceo_name, is_listed, website)
      )`)
    .eq('own_brand_id', ownBrandId)
    .order('added_at', { ascending: false });
  if (error) throw error;

  const rows = (data ?? []).map((r: any) => {
    const b = r.brands ?? {};
    const c = b.companies ?? {};
    return {
      id: r.id,
      own_brand_id: r.own_brand_id,
      brand_id: r.brand_id,
      company_id: (b.company_id as string) ?? null,
      brand_name: b.name ?? '—',
      slug: b.slug ?? null,
      name_eng: b.name_eng ?? null,
      nation_name: b.nation_name ?? null,
      since_year: b.since_year ?? null,
      service_type: b.service_type ?? null,
      corp_name: c.corp_name ?? null,
      ceo_name: c.ceo_name ?? null,
      is_listed: (c.is_listed as boolean) ?? null,
      website: c.website ?? null,
      revenue: null as number | null,
      operating_income: null as number | null,
      fiscal_year: null as number | null,
      brand_rank: null as number | null,
      added_at: r.added_at,
    };
  });

  if (!rows.length) return rows;

  // 재무 데이터 (dart_financials) — 회사별 최신 연도
  const companyIds = [...new Set(rows.map(r => r.company_id).filter(Boolean))] as string[];
  if (companyIds.length) {
    const { data: fins } = await supabase
      .from('dart_financials')
      .select('company_id, fiscal_year, revenue, operating_income')
      .in('company_id', companyIds)
      .order('fiscal_year', { ascending: false });
    const finMap = new Map<string, any>();
    for (const f of (fins ?? []) as any[]) {
      if (!finMap.has(f.company_id)) finMap.set(f.company_id, f);
    }
    rows.forEach(r => {
      const fin = r.company_id ? finMap.get(r.company_id) : null;
      if (fin) { r.revenue = fin.revenue; r.operating_income = fin.operating_income; r.fiscal_year = fin.fiscal_year; }
    });
  }

  // 브랜드 순위 (brand_ranking_snapshots) — 전체 카테고리 최신
  const brandIds = rows.map(r => r.brand_id);
  const { data: ranks } = await supabase
    .from('brand_ranking_snapshots')
    .select('brand_id, rank_position, snapshot_date')
    .in('brand_id', brandIds)
    .eq('category_code', '000')
    .eq('gender_filter', 'A')
    .eq('age_filter', 'AGE_BAND_ALL')
    .order('snapshot_date', { ascending: false });
  const rankMap = new Map<string, number>();
  for (const rk of (ranks ?? []) as any[]) {
    if (!rankMap.has(rk.brand_id)) rankMap.set(rk.brand_id, rk.rank_position);
  }
  rows.forEach(r => { r.brand_rank = rankMap.get(r.brand_id) ?? null; });

  return rows;
}

export async function searchBrandsForPool(keyword: string, limit = 20): Promise<BrandSearchRow[]> {
  const kw = keyword.trim();
  if (!kw) return [];
  const { data, error } = await supabase
    .from('brands')
    .select('id, name, slug, companies(corp_name)')
    .ilike('name', `%${kw}%`)
    .order('name')
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    name: r.name,
    slug: r.slug ?? null,
    corp_name: (r.companies as any)?.corp_name ?? null,
  }));
}

export async function addCompetitorBrand(ownBrandId: string, brandId: string): Promise<void> {
  const { error } = await supabase
    .from('competitor_brands')
    .insert({ own_brand_id: ownBrandId, brand_id: brandId });
  if (error) throw error;
}

export async function removeCompetitorBrand(id: string): Promise<void> {
  const { error } = await supabase
    .from('competitor_brands')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export async function fetchProductMatches(ownProductId: string, includeExcluded = false): Promise<ProductMatchRow[]> {
  let q = supabase
    .from('product_matches')
    .select(`
      id, own_product_id, competitor_product_id, status, score, created_at,
      products!product_matches_competitor_product_id_fkey(musinsa_no, name, thumbnail_url, review_count, satisfaction_score, category_code, brands(name))
    `)
    .eq('own_product_id', ownProductId)
    .order('score', { ascending: false });
  if (!includeExcluded) q = q.neq('status', 'excluded');
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r: any) => {
    const p = r.products ?? {};
    return {
      id: r.id,
      own_product_id: r.own_product_id,
      competitor_product_id: r.competitor_product_id,
      competitor_name: p.name ?? '—',
      competitor_brand: p.brands?.name ?? '—',
      competitor_musinsa_no: String(p.musinsa_no ?? ''),
      competitor_thumbnail: normImgUrl(p.thumbnail_url),
      competitor_review_count: p.review_count ?? 0,
      competitor_satisfaction: p.satisfaction_score ?? null,
      competitor_category: p.category_code ?? null,
      status: r.status,
      score: r.score,
      created_at: r.created_at,
    };
  });
}

export async function setMatchStatus(matchId: string, status: 'confirmed' | 'excluded'): Promise<void> {
  const updates: Record<string, unknown> = { status };
  if (status === 'confirmed') updates.confirmed_at = new Date().toISOString();
  const { error } = await supabase
    .from('product_matches')
    .update(updates)
    .eq('id', matchId);
  if (error) throw error;
}

export async function runAutoMatch(ownProductId: string): Promise<number> {
  const { data: own } = await supabase
    .from('products')
    .select('category_code, category_d2_code, category_path, brand_id')
    .eq('id', ownProductId)
    .single();
  if (!own?.brand_id) return 0;

  // 해당 자사 브랜드에 등록된 경쟁 브랜드 풀만 사용
  const { data: pool } = await supabase
    .from('competitor_brands')
    .select('brand_id')
    .eq('own_brand_id', own.brand_id);
  if (!pool?.length) return 0;

  const poolBrandIds = new Set((pool as any[]).map((r: any) => r.brand_id as string));
  const poolIds = [...poolBrandIds];
  const excludeFromB = [...poolIds, own.brand_id];

  if (!own.category_code && !own.category_d2_code && !own.category_path) return 0;

  const pathParts = (own.category_path ?? '').split(' > ');

  // 매칭 레벨 — 정밀도 내림차순
  // A등급(풀 내 브랜드): score 70~100 / B등급(풀 외 브랜드): score 35~65
  const levels = [
    ...(own.category_path ? [{
      apply: (q: any) => q.eq('category_path', own.category_path),
      scoreA: 100, scoreB: 65,
    }] : []),
    ...(own.category_path && pathParts.length >= 2 ? [{
      apply: (q: any) => q.ilike('category_path', `% > ${pathParts[1]} > %`),
      scoreA: 90, scoreB: 60,
    }] : []),
    ...(own.category_d2_code ? [{
      apply: (q: any) => q.eq('category_d2_code', own.category_d2_code),
      scoreA: 85, scoreB: 50,
    }] : []),
    ...(own.category_code ? [{
      apply: (q: any) => q.eq('category_code', own.category_code),
      scoreA: 70, scoreB: 35,
    }] : []),
  ];

  let aCandidates: { id: string; score: number }[] = [];
  let bCandidates: { id: string; score: number }[] = [];

  for (const { apply, scoreA, scoreB } of levels) {
    const [aRes, bRes] = await Promise.all([
      apply(supabase.from('products').select('id').in('brand_id', poolIds).neq('is_own', true).limit(500)),
      apply(
        supabase.from('products').select('id')
          .neq('is_own', true)
          .not('brand_id', 'in', `(${excludeFromB.join(',')})`)
          .order('review_count', { ascending: false })
          .limit(30)
      ),
    ]);
    const aRows = (aRes.data ?? []) as { id: string }[];
    const bRows = (bRes.data ?? []) as { id: string }[];
    if (aRows.length > 0 || bRows.length > 0) {
      aCandidates = aRows.map(r => ({ id: r.id, score: scoreA }));
      bCandidates = bRows.map(r => ({ id: r.id, score: scoreB }));
      break;
    }
  }

  // 기존 auto 매칭 전부 삭제
  await supabase.from('product_matches').delete()
    .eq('own_product_id', ownProductId).eq('status', 'auto');

  const allCandidates = [...aCandidates, ...bCandidates];
  if (!allCandidates.length) return 0;

  const { data: existing } = await supabase
    .from('product_matches').select('competitor_product_id').eq('own_product_id', ownProductId);
  const existingSet = new Set((existing ?? []).map((m: any) => m.competitor_product_id));

  const newRows = allCandidates
    .filter(c => !existingSet.has(c.id))
    .map(c => ({ own_product_id: ownProductId, competitor_product_id: c.id, status: 'auto', score: c.score }));

  if (!newRows.length) return -allCandidates.length;

  const { error } = await supabase.from('product_matches').insert(newRows);
  if (error) throw error;

  return newRows.length;
}

/** 특정 자사 상품의 excluded 매칭을 전부 삭제하고 auto-match를 재실행 */
export async function resetAndAutoMatch(ownProductId: string): Promise<number> {
  await supabase
    .from('product_matches')
    .delete()
    .eq('own_product_id', ownProductId)
    .eq('status', 'excluded');
  return runAutoMatch(ownProductId);
}

export async function searchCompetitorProducts(keyword: string, limit = 20): Promise<CompetitorProductSearchResult[]> {
  const kw = keyword.trim();
  if (!kw) return [];
  const { data, error } = await supabase
    .from('products')
    .select('id, musinsa_no, name, thumbnail_url, review_count, satisfaction_score, category_code, brands(name)')
    .eq('is_own', false)
    .or(`name.ilike.%${kw}%,style_no.ilike.%${kw}%,erp_style_code.ilike.%${kw}%`)
    .order('review_count', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((p: any) => ({
    id: p.id,
    musinsa_no: String(p.musinsa_no),
    name: p.name ?? '—',
    brand_name: (p.brands as any)?.name ?? '—',
    thumbnail_url: normImgUrl(p.thumbnail_url),
    review_count: p.review_count ?? 0,
    satisfaction_score: p.satisfaction_score ?? null,
    category_code: p.category_code ?? null,
  }));
}

export async function addManualMatch(ownProductId: string, competitorProductId: string): Promise<void> {
  const { error } = await supabase
    .from('product_matches')
    .upsert(
      { own_product_id: ownProductId, competitor_product_id: competitorProductId, status: 'confirmed', score: null },
      { onConflict: 'own_product_id,competitor_product_id' },
    );
  if (error) throw error;
}
