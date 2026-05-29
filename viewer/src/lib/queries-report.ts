import { supabaseBrowser } from './supabase/client';

const sb = supabaseBrowser();

// ── 유틸 ─────────────────────────────────────────────────────────────────────

const addDays = (date: string, n: number): string => {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const AGE_LABEL: Record<string, string> = {
  AGE_BAND_ALL:   '전체',
  AGE_BAND_MINOR: '20세 미만',
  AGE_BAND_20:    '20~25세',
  AGE_BAND_25:    '25~30세',
  AGE_BAND_30:    '30~35세',
  AGE_BAND_35:    '35~40세',
  AGE_BAND_40:    '40세 이상',
};

export const GENDER_LABEL: Record<string, string> = {
  M: '남성',
  F: '여성',
  A: '전체',
};

const AGE_ORDER = [
  'AGE_BAND_ALL','AGE_BAND_MINOR','AGE_BAND_20',
  'AGE_BAND_25','AGE_BAND_30','AGE_BAND_35','AGE_BAND_40',
];

const PRICE_RANGES = [
  { label: '~3만',    min: 0,      max: 30000   },
  { label: '3~5만',   min: 30000,  max: 50000   },
  { label: '5~10만',  min: 50000,  max: 100000  },
  { label: '10~20만', min: 100000, max: 200000  },
  { label: '20~50만', min: 200000, max: 500000  },
  { label: '50만~',   min: 500000, max: Infinity },
];

const DISC_RANGES = [
  { label: '~20%',   min: 0,  max: 20  },
  { label: '20~40%', min: 20, max: 40  },
  { label: '40~60%', min: 40, max: 60  },
  { label: '60~80%', min: 60, max: 80  },
  { label: '80%~',   min: 80, max: 101 },
];

const BRAND_ORDER_REF = [
  '커버낫','커버낫 우먼','커버낫 뷰티','커버낫 키즈',
  '리','리키즈','와키윌리',
];

// ── 인터페이스 ────────────────────────────────────────────────────────────────

export interface ReportKpi {
  latestDate: string;
  dailyCount: number;
  weeklyDate: string | null;
  weeklyCount: number | null;
  risingCount: number;
  contentCount: number;
  contentBrandCount: number;
  recommendItemCount: number;
  recommendBrandCount: number;
  saleItemCount: number;
  saleBrandCount: number;
}

export interface OwnBrandSummary {
  brandName: string;
  brandId: string;
  dailyBestRank: number | null;
  dailyRankChange: number | null;
  weeklyBestRank: number | null;
  brandRank: number | null;
  brandRankChange: number | null;
  contentCount: number;
  contentTotalViews: number;
  hasPromo: boolean;
  hasSale: boolean;
  hasRecommend: boolean;
  demoHighlights: string[];
}

export interface CompetitorSummary {
  brandName: string;
  isOwn: boolean;
  bestRank: number | null;
  productCount: number;
  avgPrice: number | null;
  hasContent: boolean;
  hasSale: boolean;
  hasRecommend: boolean;
}

export interface ChannelConversion {
  channel: string;
  exposureBrands: number;
  matchedBrands: number;
  rate: number;
}

export interface RankRow {
  rank: number;
  musinsaNo: number;
  productName: string;
  brandName: string;
  price: number | null;
  discountRate: number | null;
  rankChange: number | null;
  isOwn: boolean;
}

export interface ContentRow {
  title: string;
  brandNames: string[];
  viewCount: number;
  commentCount: number;
  landingUrl: string | null;
  rankMatch: number | null;
}

export interface BrandRankRow {
  rank: number;
  brandName: string;
  rankChange: number | null;
  isOwn: boolean;
}

export interface DemoRow {
  gender: string;
  age: string;
  top3: { rank: number; brand: string; product: string }[];
}

export interface RecommendModuleRow {
  id: string;
  title: string;
  moduleType: string;
  position: number;
  itemsCount: number;
}

export interface DailyReportData {
  kpi: ReportKpi;
  ownBrands: OwnBrandSummary[];
  competitors: CompetitorSummary[];
  channelConversions: ChannelConversion[];
  priceBuckets: { label: string; count: number }[];
  topBrandsByCount: { brand: string; count: number; bestRank: number }[];
  rankingRows: RankRow[];
  topContent: ContentRow[];
  saleDist: { label: string; count: number }[];
  brandRanking: BrandRankRow[];
  demoGrid: DemoRow[];
  recommendModules: RecommendModuleRow[];
  recommendTopBrands: { brandName: string; count: number }[];
}

// ── 메인 쿼리 ─────────────────────────────────────────────────────────────────

export async function fetchDailyReport(): Promise<DailyReportData | null> {

  // ── 1. 최신 날짜 조회 ─────────────────────────────────────────────────────
  const { data: latestRow, error: latestErr } = await sb
    .from('ranking_snapshots')
    .select('snapshot_date')
    .eq('category_code', '000').eq('gender_filter', 'A').eq('age_filter', 'AGE_BAND_ALL')
    .order('snapshot_date', { ascending: false })
    .limit(1);

  if (latestErr) { console.error('[report] latest date', latestErr); return null; }
  const latestDate: string | undefined = (latestRow as any[])?.[0]?.snapshot_date;
  if (!latestDate) return null;

  const prevDate   = addDays(latestDate, -1);
  const weeklyDate = addDays(latestDate, -7);

  // ── 2. 병렬 조회 ──────────────────────────────────────────────────────────
  const [
    todayRankRes, prevRankRes, weeklyCountRes,
    ownBrandsRes, magazineRes,
    promoItemsRes, promotionsRes,
    brandRankRes, demoRes,
    recommendItemsRes, recommendModulesRes,
  ] = await Promise.all([

    // 오늘 랭킹 (전체/전체/전체)
    sb.from('ranking_snapshots')
      .select('rank_position, musinsa_no, product_name, brand_name, final_price, discount_rate, products(is_own)')
      .eq('category_code', '000').eq('gender_filter', 'A').eq('age_filter', 'AGE_BAND_ALL')
      .eq('snapshot_date', latestDate)
      .order('rank_position', { ascending: true })
      .limit(500),

    // 어제 랭킹 (rank_change 계산용)
    sb.from('ranking_snapshots')
      .select('rank_position, musinsa_no, brand_name')
      .eq('category_code', '000').eq('gender_filter', 'A').eq('age_filter', 'AGE_BAND_ALL')
      .eq('snapshot_date', prevDate)
      .limit(500),

    // 7일 전 총 상품 수
    sb.from('ranking_snapshots')
      .select('rank_position', { count: 'exact', head: true })
      .eq('category_code', '000').eq('gender_filter', 'A').eq('age_filter', 'AGE_BAND_ALL')
      .eq('snapshot_date', weeklyDate),

    // 자사 브랜드 목록
    sb.from('brands').select('id, name').eq('is_own', true).order('name'),

    // 매거진 기사 (최근 30일)
    sb.from('magazine_articles')
      .select('title, brand_names, view_count, comment_count, landing_url')
      .gte('published_at', addDays(latestDate, -30))
      .order('view_count', { ascending: false })
      .limit(50),

    // 프로모션 아이템 (오늘)
    sb.from('promotion_items')
      .select('promotion_id, musinsa_no, musinsa_brand_name, discount_rate, final_price')
      .eq('snapshot_date', latestDate)
      .limit(2000),

    // 프로모션 헤더 (오늘)
    sb.from('promotions')
      .select('id, title, promotion_type, items_count')
      .eq('snapshot_date', latestDate)
      .limit(50),

    // 브랜드 랭킹 (오늘 + 어제)
    sb.from('brand_ranking_snapshots')
      .select('rank_position, brand_name, snapshot_date, brands(is_own)')
      .eq('category_code', '000').eq('gender_filter', 'A').eq('age_filter', 'AGE_BAND_ALL')
      .gte('snapshot_date', prevDate)
      .lte('snapshot_date', latestDate)
      .order('snapshot_date', { ascending: false })
      .order('rank_position', { ascending: true })
      .limit(400),

    // 성별×연령 조합 (M/F × 7 age bands)
    sb.from('ranking_snapshots')
      .select('gender_filter, age_filter, rank_position, product_name, brand_name')
      .eq('category_code', '000')
      .in('gender_filter', ['M', 'F'])
      .eq('snapshot_date', latestDate)
      .order('gender_filter').order('age_filter').order('rank_position', { ascending: true })
      .limit(3000),

    // 추천판 아이템 (오늘, 전체)
    sb.from('recommend_items')
      .select('brand_name, musinsa_no')
      .eq('snapshot_date', latestDate)
      .eq('gender_filter', 'A')
      .limit(1000),

    // 추천판 모듈 (오늘, 전체)
    sb.from('recommend_modules')
      .select('id, title, module_type, position, items_count')
      .eq('snapshot_date', latestDate)
      .eq('gender_filter', 'A')
      .order('position', { ascending: true })
      .limit(50),
  ]);

  const todayRows       = (todayRankRes.data ?? []) as any[];
  const prevRows        = (prevRankRes.data ?? []) as any[];
  const ownBrandList    = (ownBrandsRes.data ?? []) as { id: string; name: string }[];
  const magazineRows    = (magazineRes.data ?? []) as any[];
  const promoItems      = (promoItemsRes.data ?? []) as any[];
  const promotions      = (promotionsRes.data ?? []) as any[];
  const brandRankAll    = (brandRankRes.data ?? []) as any[];
  const demoRows        = (demoRes.data ?? []) as any[];
  const recommendItems  = (recommendItemsRes.data ?? []) as { brand_name: string; musinsa_no: string }[];
  const recommendModuleRows = (recommendModulesRes.data ?? []) as any[];

  const ownBrandNames = ownBrandList.map(b => b.name);
  const ownBrandIds   = ownBrandList.map(b => b.id);

  // ── 3. 2차 병렬 조회 (Phase 1 결과 의존) ────────────────────────────────
  const [ownDemoRes, weeklyOwnRes, competitorRes] = await Promise.all([

    // 자사 브랜드 × 모든 조합 순위
    ownBrandNames.length > 0
      ? sb.from('ranking_snapshots')
          .select('brand_name, gender_filter, age_filter, rank_position')
          .in('brand_name', ownBrandNames)
          .eq('category_code', '000')
          .eq('snapshot_date', latestDate)
          .order('rank_position', { ascending: true })
          .limit(500)
      : Promise.resolve({ data: [], error: null }),

    // 자사 브랜드 7일 전 순위
    ownBrandNames.length > 0
      ? sb.from('ranking_snapshots')
          .select('brand_name, rank_position')
          .in('brand_name', ownBrandNames)
          .eq('category_code', '000').eq('gender_filter', 'A').eq('age_filter', 'AGE_BAND_ALL')
          .eq('snapshot_date', weeklyDate)
          .limit(100)
      : Promise.resolve({ data: [], error: null }),

    // 경쟁사 브랜드 풀
    ownBrandIds.length > 0
      ? sb.from('competitor_brands')
          .select('brand_id, brands!competitor_brands_brand_id_fkey(name)')
          .in('own_brand_id', ownBrandIds)
          .limit(500)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const ownDemoRows       = ((ownDemoRes as any).data ?? []) as any[];
  const weeklyOwnRows     = ((weeklyOwnRes as any).data ?? []) as any[];
  const competitorBrandRows = ((competitorRes as any).data ?? []) as any[];

  // ── 4. 집계 ───────────────────────────────────────────────────────────────

  // 어제 rank 맵
  const prevNoMap = new Map<number, number>();
  const prevBrandMap = new Map<string, number>();
  for (const r of prevRows) {
    prevNoMap.set(r.musinsa_no, r.rank_position);
    const cur = prevBrandMap.get(r.brand_name);
    if (cur === undefined || r.rank_position < cur) prevBrandMap.set(r.brand_name, r.rank_position);
  }

  // 오늘 브랜드별 최고순위
  const todayBrandBestMap = new Map<string, number>();
  for (const r of todayRows) {
    const cur = todayBrandBestMap.get(r.brand_name);
    if (cur === undefined || r.rank_position < cur) todayBrandBestMap.set(r.brand_name, r.rank_position);
  }

  // 랭킹 rows + rank_change
  const rankingRows: RankRow[] = todayRows.map((r: any) => {
    const prev = prevNoMap.get(r.musinsa_no);
    return {
      rank:        r.rank_position,
      musinsaNo:   r.musinsa_no,
      productName: r.product_name ?? '—',
      brandName:   r.brand_name ?? '—',
      price:       r.final_price ?? null,
      discountRate: r.discount_rate ?? null,
      rankChange:  prev !== undefined ? prev - r.rank_position : null,
      isOwn:       (r.products as any)?.is_own ?? false,
    };
  });

  const risingCount = rankingRows.filter(r => r.rankChange === null || r.rankChange > 10).length;

  // 가격 분포
  const uniqPriceMap = new Map<number, number | null>();
  for (const r of todayRows) {
    if (!uniqPriceMap.has(r.musinsa_no)) uniqPriceMap.set(r.musinsa_no, r.final_price);
  }
  const priceBuckets = PRICE_RANGES.map(b => ({
    label: b.label,
    count: [...uniqPriceMap.values()].filter(p => p != null && (p as number) >= b.min && (p as number) < b.max).length,
  }));

  // 상위 브랜드 (상품 수 기준)
  const brandCountMap = new Map<string, { count: number; best: number }>();
  for (const r of todayRows) {
    const g = brandCountMap.get(r.brand_name) ?? { count: 0, best: 9999 };
    g.count++;
    if (r.rank_position < g.best) g.best = r.rank_position;
    brandCountMap.set(r.brand_name, g);
  }
  const topBrandsByCount = [...brandCountMap.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[1].best - b[1].best)
    .slice(0, 10)
    .map(([brand, v]) => ({ brand, count: v.count, bestRank: v.best }));

  // 매거진 집계
  const contentBrandViewMap = new Map<string, { count: number; views: number }>();
  const allMagazineBrands = new Set<string>();
  for (const m of magazineRows) {
    for (const b of (m.brand_names ?? []) as string[]) {
      allMagazineBrands.add(b);
      const g = contentBrandViewMap.get(b) ?? { count: 0, views: 0 };
      g.count++;
      g.views += m.view_count ?? 0;
      contentBrandViewMap.set(b, g);
    }
  }

  // 프로모션 집계
  const promoHeaderMap = new Map<string, any>();
  for (const p of promotions) promoHeaderMap.set(p.id, p);

  const promoTypeBrandMap = new Map<string, Set<string>>();
  const discCounts = new Array(DISC_RANGES.length).fill(0);
  for (const item of promoItems) {
    const type = promoHeaderMap.get(item.promotion_id)?.promotion_type ?? 'general';
    if (!promoTypeBrandMap.has(type)) promoTypeBrandMap.set(type, new Set());
    promoTypeBrandMap.get(type)!.add(item.musinsa_brand_name ?? '');
    const dr = Number(item.discount_rate ?? 0);
    const idx = DISC_RANGES.findIndex(b => dr >= b.min && dr < b.max);
    if (idx >= 0) discCounts[idx]++;
  }

  const limitedBrands = promoTypeBrandMap.get('limited_offer') ?? new Set<string>();
  const brandWeekBrands = promoTypeBrandMap.get('brand_week') ?? new Set<string>();
  const saleBrands = new Set<string>([
    ...(promoTypeBrandMap.get('daily_sale') ?? []),
    ...(promoTypeBrandMap.get('general') ?? []),
  ]);
  const allPromoBrands = new Set<string>([...limitedBrands, ...brandWeekBrands, ...saleBrands]);

  const saleDist = DISC_RANGES.map((b, i) => ({ label: b.label, count: discCounts[i] }));

  // 추천판 집계
  const recommendBrandSet = new Set<string>(recommendItems.map(r => r.brand_name).filter(Boolean));
  const recommendBrandCountMap = new Map<string, number>();
  for (const item of recommendItems) {
    if (item.brand_name) recommendBrandCountMap.set(item.brand_name, (recommendBrandCountMap.get(item.brand_name) ?? 0) + 1);
  }
  const recommendTopBrands = [...recommendBrandCountMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([brandName, count]) => ({ brandName, count }));

  const recommendModules: RecommendModuleRow[] = recommendModuleRows.map((m: any) => ({
    id: m.id,
    title: m.title ?? '—',
    moduleType: m.module_type ?? '',
    position: m.position ?? 0,
    itemsCount: m.items_count ?? 0,
  }));

  // 채널 전환율
  const rankBrandSet = new Set(todayRows.map((r: any) => r.brand_name as string));
  const channelConversions: ChannelConversion[] = [
    {
      channel: '추천판',
      exposureBrands: recommendBrandSet.size,
      matchedBrands: [...recommendBrandSet].filter(b => rankBrandSet.has(b)).length,
      rate: recommendBrandSet.size > 0 ? Math.round([...recommendBrandSet].filter(b => rankBrandSet.has(b)).length / recommendBrandSet.size * 100) : 0,
    },
    {
      channel: '세일판',
      exposureBrands: saleBrands.size,
      matchedBrands: [...saleBrands].filter(b => rankBrandSet.has(b)).length,
      rate: saleBrands.size > 0 ? Math.round([...saleBrands].filter(b => rankBrandSet.has(b)).length / saleBrands.size * 100) : 0,
    },
    {
      channel: '콘텐츠판',
      exposureBrands: allMagazineBrands.size,
      matchedBrands: [...allMagazineBrands].filter(b => rankBrandSet.has(b)).length,
      rate: allMagazineBrands.size > 0 ? Math.round([...allMagazineBrands].filter(b => rankBrandSet.has(b)).length / allMagazineBrands.size * 100) : 0,
    },
  ];

  // 브랜드 랭킹
  const brsToday = brandRankAll.filter((r: any) => r.snapshot_date === latestDate);
  const brsPrev  = brandRankAll.filter((r: any) => r.snapshot_date === prevDate);
  const brsPrevMap = new Map<string, number>(brsPrev.map((r: any) => [r.brand_name as string, r.rank_position as number]));

  const brandRanking: BrandRankRow[] = brsToday
    .sort((a: any, b: any) => a.rank_position - b.rank_position)
    .slice(0, 30)
    .map((r: any) => ({
      rank:       r.rank_position,
      brandName:  r.brand_name,
      rankChange: brsPrevMap.has(r.brand_name) ? brsPrevMap.get(r.brand_name)! - r.rank_position : null,
      isOwn:      (r.brands as any)?.is_own ?? false,
    }));

  const brandRankingMap = new Map<string, { rank: number; change: number | null }>();
  for (const br of brandRanking) brandRankingMap.set(br.brandName, { rank: br.rank, change: br.rankChange });

  // 자사 브랜드 데모 하이라이트
  const ownDemoPerBrand = new Map<string, Map<string, number>>();
  for (const r of ownDemoRows) {
    if (!ownDemoPerBrand.has(r.brand_name)) ownDemoPerBrand.set(r.brand_name, new Map());
    const comboMap = ownDemoPerBrand.get(r.brand_name)!;
    const key = `${r.gender_filter}|${r.age_filter}`;
    const cur = comboMap.get(key);
    if (cur === undefined || r.rank_position < cur) comboMap.set(key, r.rank_position);
  }

  const weeklyOwnMap = new Map<string, number>();
  for (const r of weeklyOwnRows) {
    const cur = weeklyOwnMap.get(r.brand_name);
    if (cur === undefined || r.rank_position < cur) weeklyOwnMap.set(r.brand_name, r.rank_position);
  }

  // 자사 브랜드 요약
  const sortedOwn = [...ownBrandList].sort((a, b) => {
    const ia = BRAND_ORDER_REF.indexOf(a.name);
    const ib = BRAND_ORDER_REF.indexOf(b.name);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });

  const matchesBrandName = (set: Set<string>, name: string) => {
    if (set.has(name)) return true;
    for (const n of set) { if (n.includes(name) || name.includes(n)) return true; }
    return false;
  };

  const ownBrands: OwnBrandSummary[] = sortedOwn.map(b => {
    const dailyBestRank = todayBrandBestMap.get(b.name) ?? null;
    const prevBestRank  = prevBrandMap.get(b.name) ?? null;
    const br = brandRankingMap.get(b.name);
    const comboMap = ownDemoPerBrand.get(b.name);
    const ci = contentBrandViewMap.get(b.name) ?? { count: 0, views: 0 };

    const highlights: string[] = [];
    if (comboMap) {
      const sorted = [...comboMap.entries()].sort((a, b) => a[1] - b[1]);
      for (const [key, rank] of sorted) {
        if (rank > 100) continue;
        const [gender, age] = key.split('|');
        highlights.push(`${GENDER_LABEL[gender] ?? gender}_${AGE_LABEL[age] ?? age} #${rank}`);
        if (highlights.length >= 5) break;
      }
    }

    return {
      brandName:         b.name,
      brandId:           b.id,
      dailyBestRank,
      dailyRankChange:   dailyBestRank !== null && prevBestRank !== null ? prevBestRank - dailyBestRank : null,
      weeklyBestRank:    weeklyOwnMap.get(b.name) ?? null,
      brandRank:         br?.rank ?? null,
      brandRankChange:   br?.change ?? null,
      contentCount:      ci.count,
      contentTotalViews: ci.views,
      hasPromo:          matchesBrandName(limitedBrands, b.name) || matchesBrandName(brandWeekBrands, b.name),
      hasSale:           matchesBrandName(saleBrands, b.name),
      hasRecommend:      matchesBrandName(recommendBrandSet, b.name),
      demoHighlights:    highlights,
    };
  });

  // 경쟁사
  const compBrandNames = new Set<string>();
  for (const r of competitorBrandRows) {
    const name = (r.brands as any)?.name;
    if (name) compBrandNames.add(name as string);
  }

  const competitors: CompetitorSummary[] = [...compBrandNames]
    .map(name => {
      const rows = todayRows.filter((r: any) => r.brand_name === name);
      const best = rows.length > 0 ? Math.min(...rows.map((r: any) => r.rank_position as number)) : null;
      const prices = rows.map((r: any) => r.final_price).filter((p: any) => p != null) as number[];
      const avg = prices.length > 0 ? Math.round(prices.reduce((s, p) => s + p, 0) / prices.length) : null;
      return {
        brandName:    name,
        isOwn:        ownBrandNames.includes(name),
        bestRank:     best,
        productCount: rows.length,
        avgPrice:     avg,
        hasContent:   contentBrandViewMap.has(name),
        hasSale:      saleBrands.has(name),
        hasRecommend: recommendBrandSet.has(name),
      };
    })
    .sort((a, b) => {
      if (a.bestRank === null && b.bestRank === null) return 0;
      if (a.bestRank === null) return 1;
      if (b.bestRank === null) return -1;
      return a.bestRank - b.bestRank;
    });

  // 콘텐츠 TOP 10
  const topContent: ContentRow[] = magazineRows.slice(0, 10).map((m: any) => {
    const brands = (m.brand_names ?? []) as string[];
    let rankMatch: number | null = null;
    for (const b of brands) {
      const r = todayBrandBestMap.get(b);
      if (r !== undefined && (rankMatch === null || r < rankMatch)) rankMatch = r;
    }
    return {
      title:        m.title ?? '—',
      brandNames:   brands,
      viewCount:    m.view_count ?? 0,
      commentCount: m.comment_count ?? 0,
      landingUrl:   m.landing_url ?? null,
      rankMatch,
    };
  });

  // 성별×연령 그리드
  const demoGroupMap = new Map<string, DemoRow>();
  for (const r of demoRows) {
    const key = `${r.gender_filter}|${r.age_filter}`;
    if (!demoGroupMap.has(key)) {
      demoGroupMap.set(key, { gender: r.gender_filter, age: r.age_filter, top3: [] });
    }
    const g = demoGroupMap.get(key)!;
    if (g.top3.length < 3) {
      g.top3.push({ rank: r.rank_position, brand: r.brand_name, product: r.product_name });
    }
  }

  const demoGrid: DemoRow[] = [];
  for (const gender of ['M', 'F']) {
    for (const age of AGE_ORDER) {
      demoGrid.push(demoGroupMap.get(`${gender}|${age}`) ?? { gender, age, top3: [] });
    }
  }

  return {
    kpi: {
      latestDate,
      dailyCount: todayRows.length,
      weeklyDate: (weeklyCountRes.count ?? 0) > 0 ? weeklyDate : null,
      weeklyCount: weeklyCountRes.count ?? null,
      risingCount,
      contentCount: magazineRows.length,
      contentBrandCount: allMagazineBrands.size,
      recommendItemCount: recommendItems.length,
      recommendBrandCount: recommendBrandSet.size,
      saleItemCount: promoItems.length,
      saleBrandCount: allPromoBrands.size,
    },
    ownBrands,
    competitors,
    channelConversions,
    priceBuckets,
    topBrandsByCount,
    rankingRows,
    topContent,
    saleDist,
    brandRanking,
    demoGrid,
    recommendModules,
    recommendTopBrands,
  };
}
