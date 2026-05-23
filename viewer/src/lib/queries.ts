import { supabaseBrowser } from './supabase/client';
const supabase = supabaseBrowser();

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
        product_id, products!inner(is_own, brands(companies(corp_name)))`)
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
    q = q.or(`name.ilike.%${kw}%,style_no.ilike.%${kw}%`);
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
}

export async function fetchCompanyInfo(id: string): Promise<CompanyInfo | null> {
  const { data, error } = await supabase
    .from('companies')
    .select('id, corp_name, business_number, ceo_name, address, phone, email, mail_order_no, corp_code, stock_code, is_listed, website, dart_fetched_at')
    .eq('id', id).single();
  if (error || !data) return null;
  return data as CompanyInfo;
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
  rev_history: (number | null)[];  // [oldest → newest]
  top_brands: string[];            // is_own 우선, 최대 3개
}

export async function fetchCompanyList(): Promise<CompanyListRow[]> {
  const [companiesRes, finsRes] = await Promise.all([
    supabase
      .from('companies')
      .select('id, corp_name, is_listed, corp_code, brands(id, is_own, name)')
      .order('corp_name')
      .limit(500),
    supabase
      .from('dart_financials')
      .select('company_id, fiscal_year, revenue, operating_income, net_income, total_assets, total_liabilities')
      .order('company_id')
      .order('fiscal_year', { ascending: false })
      .limit(2000),
  ]);

  const companies = companiesRes.data ?? [];
  const fins      = finsRes.data ?? [];

  // company_id별로 연도 내림차순 그룹
  const finMap = new Map<string, typeof fins>();
  for (const f of fins) {
    const arr = finMap.get(f.company_id) ?? [];
    arr.push(f);
    finMap.set(f.company_id, arr);
  }

  return companies.map(c => {
    const brands  = (c.brands as any[]) ?? [];
    const fList   = finMap.get(c.id) ?? [];   // 최신 연도 먼저
    const latest  = fList[0] ?? null;
    const prev    = fList[1] ?? null;

    const eq        = latest?.total_assets != null && latest?.total_liabilities != null
      ? latest.total_assets - latest.total_liabilities : null;
    const opMargin  = latest?.revenue && latest.revenue > 0 && latest.operating_income != null
      ? Math.round((latest.operating_income / latest.revenue) * 1000) / 10 : null;
    const netMargin = latest?.revenue && latest.revenue > 0 && latest.net_income != null
      ? Math.round((latest.net_income / latest.revenue) * 1000) / 10 : null;
    const debtRatio = eq != null && eq > 0 && latest?.total_liabilities != null
      ? Math.round((latest.total_liabilities / eq) * 10) / 10 : null;
    const roe       = latest?.net_income != null && eq != null && eq > 0
      ? Math.round((latest.net_income / eq) * 1000) / 10 : null;
    const revYoy    = prev?.revenue && prev.revenue > 0 && latest?.revenue != null
      ? Math.round(((latest.revenue - prev.revenue) / prev.revenue) * 1000) / 10 : null;

    return {
      id:                c.id,
      corp_name:         c.corp_name,
      is_listed:         c.is_listed,
      corp_code:         c.corp_code,
      brand_count:       brands.length,
      own_brand_count:   brands.filter((b: any) => b.is_own).length,
      fiscal_year:       latest?.fiscal_year ?? null,
      revenue:           latest?.revenue ?? null,
      operating_income:  latest?.operating_income ?? null,
      net_income:        latest?.net_income ?? null,
      total_assets:      latest?.total_assets ?? null,
      total_liabilities: latest?.total_liabilities ?? null,
      op_margin:         opMargin,
      net_margin:        netMargin,
      debt_ratio:        debtRatio,
      roe,
      rev_yoy:           revYoy,
      rev_history:       [...fList].reverse().map(f => f.revenue),
      top_brands: [
        ...brands.filter((b: any) => b.is_own).map((b: any) => b.name as string),
        ...brands.filter((b: any) => !b.is_own).map((b: any) => b.name as string),
      ].slice(0, 3),
    };
  });
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
  avg_rank: number;
  best_rank: number;
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

  const [current, prev] = await Promise.all([
    fetchBrandSnapshot({ ...baseOpts, beforeDate: targetDate }),
    compareDate ? fetchBrandSnapshot({ ...baseOpts, beforeDate: compareDate }) : Promise.resolve(null),
  ]);
  if (!current) return [];

  const results: BrandLeaderRow[] = [];
  for (const [brand_name, g] of current.map) {
    const pg = prev?.map.get(brand_name) ?? null;
    const curTop100 = g.ranks.filter(r => r <= 100).length;
    const curAvg = Math.round(g.ranks.reduce((s, r) => s + r, 0) / g.ranks.length);
    const prevTop100 = pg ? pg.ranks.filter(r => r <= 100).length : null;
    const prevAvg = pg ? Math.round(pg.ranks.reduce((s, r) => s + r, 0) / pg.ranks.length) : null;
    results.push({
      brand_name, brand_id: null, nation_name: null, is_own: false, company_name: null,
      top100_count: curTop100, avg_rank: curAvg, best_rank: Math.min(...g.ranks), sku_count: g.ranks.length,
      avg_discount: g.discounts.length > 0 ? Math.round(g.discounts.reduce((s, v) => s + v, 0) / g.discounts.length) : null,
      avg_price: g.prices.length > 0 ? Math.round(g.prices.reduce((s, v) => s + v, 0) / g.prices.length) : null,
      min_price: g.prices.length > 0 ? Math.min(...g.prices) : null,
      max_price: g.prices.length > 0 ? Math.max(...g.prices) : null,
      avg_review_score: g.reviewScores.length > 0 ? Math.round(g.reviewScores.reduce((s, v) => s + v, 0) / g.reviewScores.length) : null,
      total_review_count: g.reviewCounts.reduce((s, v) => s + v, 0),
      snapshot_date: current.date,
      top100_change: prevTop100 !== null ? curTop100 - prevTop100 : null,
      avg_rank_change: prevAvg !== null ? prevAvg - curAvg : null,
    });
  }

  const names = results.map(r => r.brand_name);
  if (names.length > 0) {
    const { data: brandInfo } = await supabase
      .from('brands')
      .select('id, name, nation_name, is_own, companies(corp_name)')
      .in('name', names.slice(0, 500));
    const infoMap = new Map((brandInfo ?? []).map((b: any) => [b.name, {
      id: b.id as string, nation_name: (b.nation_name ?? null) as string | null,
      is_own: (b.is_own ?? false) as boolean, company_name: (b.companies?.corp_name ?? null) as string | null,
    }]));
    for (const r of results) {
      const info = infoMap.get(r.brand_name);
      if (info) { r.brand_id = info.id; r.nation_name = info.nation_name; r.is_own = info.is_own; r.company_name = info.company_name; }
    }
  }

  return results.sort((a, b) => b.top100_count - a.top100_count || a.avg_rank - b.avg_rank);
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

  const { data } = await supabase
    .from('ranking_snapshots')
    .select('category_code, gender_filter, age_filter, rank_position')
    .eq('brand_name', brandName)
    .eq('snapshot_date', latestDate)
    .order('rank_position', { ascending: true })
    .limit(2000);

  const groups = new Map<string, { count: number; best: number }>();
  for (const r of (data ?? []) as any[]) {
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
    thumbnail_url: p?.thumbnail_url ?? null,
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
export async function fetchProductCategoryRanks(musinsaNo: string): Promise<Array<{
  category_code: string; best_rank: number; combo_count: number;
}>> {
  const no = parseInt(musinsaNo, 10);
  const { data: latestRow } = await supabase
    .from('ranking_snapshots')
    .select('snapshot_date')
    .eq('musinsa_no', no)
    .order('snapshot_date', { ascending: false })
    .limit(1);
  if (!latestRow?.length) return [];
  const latestDate = (latestRow[0] as any).snapshot_date;

  const { data } = await supabase
    .from('ranking_snapshots')
    .select('category_code, rank_position')
    .eq('musinsa_no', no)
    .eq('snapshot_date', latestDate)
    .order('rank_position', { ascending: true });

  const groups = new Map<string, { best: number; count: number }>();
  for (const r of (data ?? []) as any[]) {
    const g = groups.get(r.category_code);
    if (!g) groups.set(r.category_code, { best: r.rank_position, count: 1 });
    else { g.count++; }
  }
  return [...groups.entries()]
    .map(([code, v]) => ({ category_code: code, best_rank: v.best, combo_count: v.count }))
    .sort((a, b) => a.best_rank - b.best_rank);
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
    /* 5  snaps                 */ supabase.from('snaps').select('published_at', { count: 'exact' }).order('published_at', { ascending: false }).limit(1),
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
  const snps   = g(5);  const mags   = g(6);  const revs   = g(7);  const proms  = g(8);
  const dartF  = g(9);  const corps  = g(10); const dartD  = g(11);
  const sales  = g(12); const inv    = g(13); const revA   = g(14);

  const rankDate  = rank.data[0]?.snapshot_date?.slice(5) ?? null;
  const brankDate = brank.data[0]?.snapshot_date?.slice(5) ?? null;
  const snpsDate  = snps.data[0]?.published_at?.slice(5, 10) ?? null;
  const magsDate  = mags.data[0]?.published_at?.slice(5, 10) ?? null;
  const revsDate  = revs.data[0]?.created_at?.slice(5, 10) ?? null;
  const promsDate = proms.data[0]?.snapshot_date?.slice(5) ?? null;

  const compTotal  = allP.count - ownP.count;
  const compDetail = Math.max(0, detP.count - ownP.count);

  return [
    { id: 'ranking',         label: '상품 랭킹 스냅샷',   count: rank.count,   latestDate: rankDate,  target: null,       status: 'active',                                  link: '/ranking' },
    { id: 'brand-ranking',   label: '브랜드 랭킹 스냅샷', count: brank.count,  latestDate: brankDate, target: null,       status: 'active',                                  link: '/brand-ranking' },
    { id: 'own-products',    label: '자사 상품 목록',     count: ownP.count,   latestDate: null,      target: null,       status: 'active',                                  link: '/matching' },
    { id: 'comp-detail',     label: '경쟁사 상품 상세',   count: compDetail,   latestDate: null,      target: compTotal,  status: 'partial',                                 link: '/product' },
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
}

export async function fetchActivePromotions(limit = 10): Promise<PromoSummary[]> {
  const { data, error } = await supabase
    .from('promotions')
    .select('id, title, promotion_type, items_count, end_at, snapshot_date')
    .order('snapshot_date', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as PromoSummary[];
}
