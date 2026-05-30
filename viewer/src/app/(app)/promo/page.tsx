'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { Bars, HBar, Donut } from '@/components/ui/charts';
import { IcFilter, IcDownload, IcChevL, IcChevR } from '@/components/ui/icons';
import { FilterBlock, CheckRow, PillGroup, SegGroup, SearchSelect } from '@/components/ui/filters';
import { BarChart, Bar, Cell as RCell, XAxis, YAxis, Tooltip, ResponsiveContainer, ScatterChart, Scatter } from 'recharts';
import { supabaseBrowser } from '@/lib/supabase/client';
import SavedFiltersDropdown from '@/components/me/SavedFiltersDropdown';
import { CATEGORY_MAP } from '@/lib/queries';

const sb = supabaseBrowser();

const PROMO_SS = 'promo-state-v1';
function readPromoSS(): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(sessionStorage.getItem(PROMO_SS) ?? '{}'); } catch { return {}; }
}

// ── 타입 매핑 ────────────────────────────────────────────────────
const TYPE_LABEL: Record<string, string> = {
  limited_offer: '선착순',
  daily_sale:    '기획전',
  brand_week:    '브랜드위크',
  general:       '기타',
};
const TYPE_SEV: Record<string, string> = {
  limited_offer: 'hi',
  daily_sale:    'md',
  brand_week:    'lo',
  general:       'lo',
};

// snapshot_date는 KST 기준으로 저장됨 — Viewer도 KST 기준 날짜 사용
function kstDateStr(offset = 0): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000); // KST offset to UTC
  if (offset) d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

// ── 대한민국 공휴일 (2024-2026) ──────────────────────────────────
const KR_HOLIDAYS: Record<string, string> = {
  // 2024
  '2024-01-01':'신정','2024-02-09':'설날연휴','2024-02-10':'설날','2024-02-11':'설날연휴',
  '2024-02-12':'대체공휴일','2024-03-01':'삼일절','2024-05-05':'어린이날','2024-05-06':'대체공휴일',
  '2024-05-15':'석가탄신일','2024-06-06':'현충일','2024-08-15':'광복절',
  '2024-09-16':'추석연휴','2024-09-17':'추석','2024-09-18':'추석연휴',
  '2024-10-03':'개천절','2024-10-09':'한글날','2024-12-25':'크리스마스',
  // 2025
  '2025-01-01':'신정','2025-01-28':'설날연휴','2025-01-29':'설날','2025-01-30':'설날연휴',
  '2025-03-01':'삼일절','2025-03-03':'대체공휴일',
  '2025-05-05':'어린이날·석가탄신일','2025-06-06':'현충일',
  '2025-08-15':'광복절','2025-10-03':'개천절','2025-10-05':'추석연휴',
  '2025-10-06':'추석','2025-10-07':'추석연휴','2025-10-08':'대체공휴일',
  '2025-10-09':'한글날','2025-12-25':'크리스마스',
  // 2026
  '2026-01-01':'신정','2026-02-17':'설날연휴','2026-02-18':'설날','2026-02-19':'설날연휴',
  '2026-03-01':'삼일절','2026-03-02':'대체공휴일',
  '2026-05-05':'어린이날','2026-05-23':'석가탄신일','2026-05-25':'대체공휴일',
  '2026-06-06':'현충일',
  '2026-08-15':'광복절','2026-08-17':'대체공휴일',
  '2026-09-24':'추석연휴','2026-09-25':'추석','2026-09-26':'추석연휴','2026-09-28':'대체공휴일',
  '2026-10-03':'개천절','2026-10-09':'한글날','2026-12-25':'크리스마스',
};

function fmtDate(s: string | null | undefined): string {
  if (!s) return '상시';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDiscount(rate: number | null | undefined): string {
  if (rate == null) return '—';
  return `−${Math.round(Number(rate))}%`;
}
function isActive(endAt: string | null | undefined, endedAt: string | null | undefined): boolean {
  if (endedAt) return false;
  if (!endAt) return true;
  return new Date(endAt) > new Date();
}
function inactiveReason(
  endAt: string | null | undefined,
  endedAt: string | null | undefined,
): 'unlisted' | 'end_at' | null {
  if (endedAt) return 'unlisted';
  if (endAt && new Date(endAt) <= new Date()) return 'end_at';
  return null;
}

// ── 인터페이스 ────────────────────────────────────────────────────
interface PromoRow {
  id: string;
  musinsa_event_id: string;
  title: string;
  promotion_type: string;
  items_count: number;
  end_at: string | null;
  ended_at: string | null;
  snapshot_date: string;
}
interface PromoItemRow {
  id: string;
  promotion_id: string;
  product_id: string | null;
  musinsa_no: string | null;
  musinsa_brand_slug: string | null;
  musinsa_brand_name: string | null;
  product_name: string | null;
  final_price: number | null;
  list_price: number | null;
  discount_rate: number | null;
  is_sold_out: boolean;
  review_count: number | null;
  review_score: number | null;
  limited_total: number | null;
  limited_remaining: number | null;
  limited_status: string | null;
  rank_in_module: number | null;
}
interface EnrichData {
  company_name: string | null;
  category_code: string | null;
  category_d2_name: string | null;
  gender: string | null;
  best_rank: number | null;
  best_rank_cat: string | null;
  best_rank_gender: string | null;
}

// ── 페이지 ────────────────────────────────────────────────────────
interface JumpPromo { id: string; snapshotDate: string; }

export default function PromoPage() {
  const pageSS = React.useRef(readPromoSS());
  const [tab, setTab] = React.useState<'hub' | 'calendar' | 'stats'>((pageSS.current.tab as 'hub' | 'calendar' | 'stats') ?? 'hub');

  React.useEffect(() => {
    const cur = readPromoSS();
    sessionStorage.setItem(PROMO_SS, JSON.stringify({ ...cur, tab }));
  }, [tab]);
  const [jumpPromo, setJumpPromo] = React.useState<JumpPromo | null>(() => {
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const id = sp.get('id'), date = sp.get('date');
      if (id && date) return { id, snapshotDate: date };
    }
    return null;
  });

  const handleCalSelect = React.useCallback((id: string, snapshotDate: string) => {
    setJumpPromo({ id, snapshotDate });
    setTab('hub');
  }, []);

  return (
    <>
      <div className="page-title">
        <h1>프로모션 / 세일</h1>
        <span className="sub">무신사 세일탭 · 기간·타입 필터 → 상품 분석</span>
      </div>
      <div className="tabs">
        <div className={`tab ${tab === 'hub'      ? 'active' : ''}`} onClick={() => setTab('hub')}>상품 분석</div>
        <div className={`tab ${tab === 'calendar' ? 'active' : ''}`} onClick={() => setTab('calendar')}>캘린더</div>
        <div className={`tab ${tab === 'stats'    ? 'active' : ''}`} onClick={() => setTab('stats')}>통계</div>
      </div>
      {tab === 'hub'      && <PromoHub jumpPromo={jumpPromo} onJumpConsumed={() => setJumpPromo(null)} />}
      {tab === 'calendar' && <PromoCalendar onSelectPromo={handleCalSelect} />}
      {tab === 'stats'    && <PromoStats />}
    </>
  );
}

// ── 허브 탭 ──────────────────────────────────────────────────────
const GRID      = '24px 70px 1fr 80px 70px 54px 44px 80px';
const ITEM_COLS = '40px 1fr 120px 70px 46px 90px 54px 72px 54px 54px';

function PromoHub({ jumpPromo, onJumpConsumed }: { jumpPromo?: JumpPromo | null; onJumpConsumed?: () => void }) {
  const router    = useRouter();
  const todayStr  = React.useMemo(() => kstDateStr(), []);
  // jumpPromo가 있으면 URL에서 온 딥링크 — session 무시
  const hubSS = React.useRef(jumpPromo ? {} : readPromoSS());

  const [period,     setPeriod]     = React.useState<'today' | '3d' | '7d' | '14d' | 'custom'>(
    jumpPromo ? 'custom' : (hubSS.current.period as 'today' | '3d' | '7d' | '14d' | 'custom') ?? '7d'
  );
  const [customFrom, setCustomFrom] = React.useState(jumpPromo?.snapshotDate ?? (hubSS.current.customFrom as string) ?? '');
  const [customTo,   setCustomTo]   = React.useState(jumpPromo?.snapshotDate ?? (hubSS.current.customTo as string) ?? todayStr);

  const { fromStr, toStr } = React.useMemo(() => {
    const today = kstDateStr();
    if (period === 'custom') return { fromStr: customFrom || today, toStr: customTo || today };
    if (period === 'today')  return { fromStr: today, toStr: today };
    const days = period === '3d' ? 3 : period === '7d' ? 7 : 14;
    return { fromStr: kstDateStr(-(days - 1)), toStr: today };
  }, [period, customFrom, customTo]);

  // ── 데이터 상태
  const [promos,      setPromos]     = React.useState<PromoRow[]>([]);
  const [loading,     setLoading]    = React.useState(true);
  const [error,       setError]      = React.useState<string | null>(null);

  // ── 필터 상태
  const [typeFilters,  setTypeFilters]  = React.useState<Set<string>>(new Set((hubSS.current.typeFilters as string[]) ?? []));
  const [statusFilter, setStatusFilter] = React.useState<'all' | 'active' | 'ended'>((hubSS.current.statusFilter as 'all' | 'active' | 'ended') ?? 'all');
  const [brandFilter,  setBrandFilter]  = React.useState<Set<string>>(new Set((hubSS.current.brandFilter as string[]) ?? []));
  const [sel,          setSel]          = React.useState<Set<string>>(new Set());
  const [pendingSelId, setPendingSelId] = React.useState<string | null>(jumpPromo?.id ?? null);
  const [summaryMap,   setSummaryMap]   = React.useState<Map<string, { discount: number | null }>>(new Map());
  const [detailItems,  setDetailItems]  = React.useState<PromoItemRow[]>([]);
  const [detailLoad,   setDetailLoad]   = React.useState(false);
  const [enrichMap,    setEnrichMap]    = React.useState<Map<string, EnrichData>>(new Map());
  const [brandIdMap,   setBrandIdMap]   = React.useState<Map<string, string>>(new Map());
  const [sortBy,       setSortBy]       = React.useState<'discount' | 'display'>((hubSS.current.sortBy as 'discount' | 'display') ?? 'discount');

  React.useEffect(() => {
    const cur = readPromoSS();
    sessionStorage.setItem(PROMO_SS, JSON.stringify({
      ...cur, period, customFrom, customTo,
      typeFilters: [...typeFilters], statusFilter, brandFilter: [...brandFilter], sortBy,
    }));
  }, [period, customFrom, customTo, typeFilters, statusFilter, brandFilter, sortBy]);

  // jumpPromo → 해당 날짜로 기간 세팅 + 해당 프로모션 선택 예약
  React.useEffect(() => {
    if (jumpPromo?.id && jumpPromo.snapshotDate) {
      setPeriod('custom');
      setCustomFrom(jumpPromo.snapshotDate);
      setCustomTo(jumpPromo.snapshotDate);
      setPendingSelId(jumpPromo.id);
      onJumpConsumed?.();
    }
  }, [jumpPromo]); // eslint-disable-line

  // ── 프로모션 목록 로드 (KST 기준 snapshot_date 범위 필터)
  React.useEffect(() => {
    setLoading(true);
    setDetailItems([]);
    setSel(new Set());
    sb.from('promotions')
      .select('id, musinsa_event_id, title, promotion_type, items_count, end_at, ended_at, snapshot_date')
      .gte('snapshot_date', fromStr)
      .lte('snapshot_date', toStr)
      .order('snapshot_date', { ascending: false })
      .order('end_at', { ascending: true, nullsFirst: false })
      .limit(300)
      .then(({ data, error: err }) => {
        if (err) { setError(err.message); setLoading(false); return; }
        const rows = (data ?? []) as PromoRow[];
        setPromos(rows);
        setLoading(false);
        // 캘린더에서 이동한 경우 해당 프로모션 자동 선택
        setPendingSelId(prev => {
          if (prev) {
            const found = rows.find(r => r.id === prev);
            if (found) { setSel(new Set([prev])); return null; }
          }
          return prev;
        });
      });
  }, [fromStr, toStr]);

  // ── 필터된 프로모션
  const filtered = React.useMemo(() => promos.filter(p => {
    if (typeFilters.size > 0 && !typeFilters.has(p.promotion_type)) return false;
    if (statusFilter !== 'all') {
      const active = isActive(p.end_at, p.ended_at);
      if (statusFilter === 'active' && !active) return false;
      if (statusFilter === 'ended'  &&  active) return false;
    }
    return true;
  }), [promos, typeFilters, statusFilter]);

  const selectedPromos = React.useMemo(() => filtered.filter(p => sel.has(p.id)), [filtered, sel]);
  const toggle = (id: string) => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });


  // ── 선택된 프로모션의 상품 로드
  React.useEffect(() => {
    if (selectedPromos.length === 0) { setDetailItems([]); setDetailLoad(false); return; }
    setDetailLoad(true);
    const detailFilter = selectedPromos
      .map(p => `and(promotion_id.eq.${p.id},snapshot_date.eq.${p.snapshot_date})`)
      .join(',');
    sb.from('promotion_items')
      .select('id, promotion_id, product_id, musinsa_no, musinsa_brand_slug, musinsa_brand_name, product_name, final_price, list_price, discount_rate, is_sold_out, review_count, review_score, limited_total, limited_remaining, limited_status, rank_in_module')
      .or(detailFilter)
      .limit(2000)
      .then(({ data, error: err }) => {
        if (!err) setDetailItems((data ?? []) as PromoItemRow[]);
        setDetailLoad(false);
      });
  }, [selectedPromos]);

  // summaryMap — 기간 내 모든 프로모션의 평균 할인율 (선택 없이도 표시)
  React.useEffect(() => {
    if (!fromStr || !toStr) { setSummaryMap(new Map()); return; }
    sb.from('promotion_items')
      .select('promotion_id, discount_rate')
      .gte('snapshot_date', fromStr)
      .lte('snapshot_date', toStr)
      .not('discount_rate', 'is', null)
      .limit(15000)
      .then(({ data }) => {
        const agg: Record<string, number[]> = {};
        for (const item of (data ?? [])) {
          if (!agg[item.promotion_id]) agg[item.promotion_id] = [];
          agg[item.promotion_id].push(parseFloat(String(item.discount_rate)));
        }
        const m = new Map<string, { discount: number | null }>();
        for (const [pid, rates] of Object.entries(agg)) {
          m.set(pid, { discount: rates.reduce((a, b) => a + b, 0) / rates.length });
        }
        setSummaryMap(m);
      });
  }, [fromStr, toStr]);

  // ── 상품 enrichment: products + brands + companies
  React.useEffect(() => {
    if (detailItems.length === 0) { setEnrichMap(new Map()); setBrandIdMap(new Map()); return; }
    const productIds = [...new Set(detailItems.map(i => i.product_id).filter(Boolean) as string[])];
    const slugs = [...new Set(detailItems.map(i => i.musinsa_brand_slug).filter(Boolean) as string[])];
    Promise.all([
      productIds.length > 0
        ? sb.from('products').select('id, category_code, category_d2_name, gender, ranking_best_records').in('id', productIds).limit(2000)
        : Promise.resolve({ data: [] as any[] }),
      slugs.length > 0
        ? sb.from('brands').select('slug, id, company_id').in('slug', slugs).limit(300)
        : Promise.resolve({ data: [] as any[] }),
    ]).then(async ([{ data: prodData }, { data: brandData }]) => {
      setBrandIdMap(new Map((brandData ?? []).map((b: any) => [b.slug, b.id as string])));
      const companyIds = [...new Set((brandData ?? []).map((b: any) => b.company_id).filter(Boolean) as string[])];
      const bCompMap   = new Map((brandData ?? []).map((b: any) => [b.slug, b.company_id as string | null]));
      const { data: coData } = companyIds.length > 0
        ? await sb.from('companies').select('id, corp_name').in('id', companyIds).limit(300)
        : { data: [] as any[] };
      const coMap   = new Map((coData ?? []).map((c: any) => [c.id, c.corp_name as string]));
      const prodMap = new Map((prodData ?? []).map((p: any) => [p.id, p]));
      const em = new Map<string, EnrichData>();
      for (const item of detailItems) {
        const prod = item.product_id ? prodMap.get(item.product_id) : null;
        const companyId = item.musinsa_brand_slug ? bCompMap.get(item.musinsa_brand_slug) : null;
        let bestRank: number | null = null, bestRankCat: string | null = null, bestRankGender: string | null = null;
        const records: any[] = prod?.ranking_best_records ?? [];
        if (records.length > 0) {
          const best = records.reduce((b: any, r: any) => !b || r.rank < b.rank ? r : b, null);
          if (best) {
            bestRank = best.rank;
            bestRankCat = best.depth1CategoryName ?? null;
            bestRankGender = best.gender === 'M' ? '남' : best.gender === 'F' ? '여' : best.gender === 'A' ? '전체' : null;
          }
        }
        em.set(item.id, {
          company_name:    companyId ? (coMap.get(companyId) ?? null) : null,
          category_code:   prod?.category_code ?? null,
          category_d2_name: prod?.category_d2_name ?? null,
          gender:          prod?.gender ?? null,
          best_rank: bestRank, best_rank_cat: bestRankCat, best_rank_gender: bestRankGender,
        });
      }
      setEnrichMap(em);
    });
  }, [detailItems]);

  const toggleType = (t: string) => setTypeFilters(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });
  const reset = () => { setTypeFilters(new Set()); setStatusFilter('all'); setBrandFilter(new Set()); setPeriod('7d'); setSel(new Set()); };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleLoadFilter = (filter: unknown) => {
    const f = filter as any;
    if (f.period !== undefined)          setPeriod(f.period);
    if (f.customFrom !== undefined)      setCustomFrom(f.customFrom);
    if (f.customTo !== undefined)        setCustomTo(f.customTo);
    if (Array.isArray(f.typeFilters))    setTypeFilters(new Set(f.typeFilters));
    if (f.statusFilter !== undefined)    setStatusFilter(f.statusFilter);
    if (Array.isArray(f.brandFilter))    setBrandFilter(new Set(f.brandFilter));
    if (f.sortBy !== undefined)          setSortBy(f.sortBy);
  };

  const availableBrands = React.useMemo(
    () => [...new Set(detailItems.map(i => i.musinsa_brand_name).filter(Boolean) as string[])].sort(),
    [detailItems],
  );

  const sortedItems = [...detailItems].sort((a, b) =>
    sortBy === 'discount'
      ? parseFloat(String(b.discount_rate ?? 0)) - parseFloat(String(a.discount_rate ?? 0))
      : (a.rank_in_module ?? 9999) - (b.rank_in_module ?? 9999),
  );
  const visibleItems = brandFilter.size > 0
    ? sortedItems.filter(i => i.musinsa_brand_name && brandFilter.has(i.musinsa_brand_name))
    : sortedItems;

  // 집계 — 브랜드별 상품 수 (TOP7)
  const brandCounts: Record<string, number> = {};
  for (const item of detailItems) {
    const b = item.musinsa_brand_name ?? '—';
    brandCounts[b] = (brandCounts[b] ?? 0) + 1;
  }
  const topBrands   = Object.entries(brandCounts).sort((a, b) => b[1] - a[1]).slice(0, 7);
  const maxBrandCnt = topBrands[0]?.[1] ?? 1;

  // 할인율 분포
  const BIN_LABELS   = ['~5%','~10%','~15%','~20%','~25%','~30%','~40%','~50%','50%+'];
  const binEdges     = [5, 10, 15, 20, 25, 30, 40, 50, Infinity];
  const discountBins = new Array(9).fill(0) as number[];
  for (const item of detailItems) {
    const dr = item.discount_rate ? parseFloat(String(item.discount_rate)) : 0;
    for (let i = 0; i < binEdges.length; i++) {
      if (dr < binEdges[i]) { discountBins[i]++; break; }
    }
  }
  const discountChartData = BIN_LABELS.map((name, i) => ({ name, count: discountBins[i] }));
  const maxBinCount = Math.max(...discountBins, 1);

  // 브랜드별 평균 할인율
  const brandDrMap: Record<string, number[]> = {};
  for (const item of detailItems) {
    if (!item.musinsa_brand_name || item.discount_rate == null) continue;
    if (!brandDrMap[item.musinsa_brand_name]) brandDrMap[item.musinsa_brand_name] = [];
    brandDrMap[item.musinsa_brand_name].push(parseFloat(String(item.discount_rate)));
  }
  const brandAvgDiscount = Object.entries(brandDrMap)
    .map(([brand, rates]) => [brand, rates.reduce((a, b) => a + b, 0) / rates.length] as [string, number])
    .sort((a, b) => b[1] - a[1]).slice(0, 7);
  const maxAvgDr = brandAvgDiscount[0]?.[1] ?? 1;

  // 만족도 vs 할인율 산점도
  const scatterData = detailItems
    .filter(i => i.review_score != null && i.discount_rate != null)
    .map(i => ({ x: Math.round(parseFloat(String(i.discount_rate))), y: i.review_score! }));

  // 타입별 평균 상품수 (필터된 프로모션 기준)
  const typeItemsMap: Record<string, number[]> = {};
  for (const promo of filtered) {
    if (!typeItemsMap[promo.promotion_type]) typeItemsMap[promo.promotion_type] = [];
    typeItemsMap[promo.promotion_type].push(promo.items_count);
  }
  const typeAvgData = Object.entries(typeItemsMap).map(([type, counts]) => ({
    name: TYPE_LABEL[type] ?? type,
    avg: Math.round(counts.reduce((a, b) => a + b, 0) / counts.length),
  }));

  // 선착순 품절 현황
  const limitedItems    = detailItems.filter(i => i.limited_status != null);
  const limitedProgress = limitedItems.filter(i => i.limited_status === 'PROGRESS').length;
  const limitedSoldOut  = limitedItems.filter(i => i.limited_status === 'SOLD_OUT').length;
  const limitedPct      = limitedItems.length > 0 ? Math.round(limitedSoldOut / limitedItems.length * 100) : 0;

  // 종료 요일 패턴 (전체 조회 기간의 프로모션 기준)
  const weekdayLabels = ['일','월','화','수','목','금','토'];
  const weekdayCounts = new Array(7).fill(0);
  for (const promo of promos) {
    if (promo.end_at) weekdayCounts[new Date(promo.end_at).getDay()]++;
  }
  const maxWeekdayCnt = Math.max(...weekdayCounts, 1);

  // 겹침 감지 — 동일 상품(musinsa_no)이 2개 이상 선택된 프로모션에 포함
  const overlapMap = new Map<string, { promoIds: string[]; item: PromoItemRow }>();
  for (const item of detailItems) {
    if (!item.musinsa_no) continue;
    const existing = overlapMap.get(item.musinsa_no);
    if (existing) {
      if (!existing.promoIds.includes(item.promotion_id)) existing.promoIds.push(item.promotion_id);
    } else {
      overlapMap.set(item.musinsa_no, { promoIds: [item.promotion_id], item });
    }
  }
  const overlaps = [...overlapMap.values()].filter(v => v.promoIds.length >= 2);

  // 성별 × 카테고리 히트맵 (선택 상품 기준)
  const genderCatHeatmapHub = React.useMemo(() => {
    if (detailItems.length === 0 || enrichMap.size === 0) return null;
    const catCounts: Record<string, number> = {};
    for (const item of detailItems) {
      const enrich = enrichMap.get(item.id);
      const cat = enrich?.category_d2_name ?? '미분류';
      catCounts[cat] = (catCounts[cat] ?? 0) + 1;
    }
    const topCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k]) => k);
    const GENDERS = ['M', 'F', 'A', 'null'];
    const GENDER_LABELS: Record<string, string> = { M: '남성', F: '여성', A: '전체', 'null': '미확인' };
    const matrix: Record<string, Record<string, number>> = {};
    for (const item of detailItems) {
      const enrich = enrichMap.get(item.id);
      const cat = enrich?.category_d2_name ?? '미분류';
      if (!topCats.includes(cat)) continue;
      const gKey = enrich?.gender ?? 'null';
      if (!matrix[gKey]) matrix[gKey] = {};
      matrix[gKey][cat] = (matrix[gKey][cat] ?? 0) + 1;
    }
    const hmMax = Math.max(...GENDERS.flatMap(g => topCats.map(c => matrix[g]?.[c] ?? 0)), 1);
    return { topCats, GENDERS, GENDER_LABELS, matrix, hmMax };
  }, [detailItems, enrichMap]);

  if (error) return <div className="panel" style={{ padding: 24, color: 'var(--f3)' }}>오류: {error}</div>;

  const periodLabel = period === 'today' ? '오늘'
    : period === 'custom' ? `${customFrom}~${customTo}`
    : `최근 ${period.replace('d', '')}일`;

  const TOOLTIP_STYLE = {
    contentStyle: { background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, fontSize: 11, fontFamily: 'var(--mono)' },
    labelStyle:   { color: 'var(--f3)' },
    itemStyle:    { color: 'var(--f1)' },
  };
  const AXIS_TICK = { fontSize: 9, fill: 'var(--f4)', fontFamily: 'var(--mono)' } as const;

  return (
    <div className="grid" style={{ gridTemplateColumns: '240px 1fr', gap: 14 }}>

      {/* ── 필터 레일 ── */}
      <aside className="filter-rail">
        <div className="frh">
          <h3>필터</h3>
          <button className="btn sm" onClick={reset}>초기화</button>
        </div>
        <div style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--bs)' }}>
          <SavedFiltersDropdown
            page="/promo"
            currentFilter={{
              period, customFrom, customTo,
              typeFilters: [...typeFilters], statusFilter,
              brandFilter: [...brandFilter], sortBy,
            }}
            onLoad={handleLoadFilter}
          />
        </div>
        <div className="frb">

          <FilterBlock label="기간" hint={periodLabel}>
            <SegGroup
              value={period}
              onChange={v => setPeriod(v as typeof period)}
              options={[['today','오늘'],['3d','3일'],['7d','7일'],['14d','14일'],['custom','직접']]}
            />
            {period === 'custom' && (
              <div className="daterange" style={{ marginTop: 6 }}>
                <input type="date" className="input-date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
                <span className="mono dim" style={{ fontSize: 11 }}>~</span>
                <input type="date" className="input-date" value={customTo}   onChange={e => setCustomTo(e.target.value)} />
              </div>
            )}
          </FilterBlock>

          <FilterBlock label="타입" hint={typeFilters.size > 0 ? `${typeFilters.size}개 선택` : '전체'}>
            {Object.entries(TYPE_LABEL).map(([k, label]) => (
              <CheckRow key={k}
                on={typeFilters.has(k)}
                onToggle={() => toggleType(k)}
                label={<span className={`sev ${TYPE_SEV[k]}`} style={{ fontSize: 10 }}><span className="pip" />{label}</span>}
                count={promos.filter(p => p.promotion_type === k).length}
              />
            ))}
          </FilterBlock>

          <FilterBlock label="상태">
            <PillGroup
              value={statusFilter}
              onChange={v => setStatusFilter(v as typeof statusFilter)}
              options={[['all', '전체'], ['active', '진행중'], ['ended', '종료']]}
            />
          </FilterBlock>

          <FilterBlock label="브랜드" hint={brandFilter.size > 0 ? `${brandFilter.size}개` : '전체'}>
            <SearchSelect
              options={availableBrands}
              selected={brandFilter}
              onAdd={b => setBrandFilter(prev => new Set([...prev, b]))}
              onRemove={b => setBrandFilter(prev => { const n = new Set(prev); n.delete(b); return n; })}
              placeholder="브랜드 검색"
            />
          </FilterBlock>
        </div>
      </aside>

      {/* ── 우측 콘텐츠 ── */}
      <div className="col-flex gap-12">

        {/* ── 마스터 그리드 ── */}
        <section className="panel" style={{ padding: 0 }}>
          <div className="row-flex between center" style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--bs)' }}>
            <div className="row-flex center gap-10">
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>마스터 그리드</h3>
              {loading
                ? <span className="sec-tag mono dim">로딩중…</span>
                : <span className="sec-tag">{filtered.length}건 · 클릭해서 선택</span>}
            </div>
            <div className="row-flex gap-4 center">
              <span className="mono dim" style={{ fontSize: 11 }}>· {sel.size} 선택</span>
              <button className="btn sm" onClick={() => setSel(new Set(filtered.map(p => p.id)))}>전체 선택</button>
              <button className="btn sm" onClick={() => setSel(new Set())}>해제</button>
            </div>
          </div>
          <div className="tbl" style={{ border: 'none', borderRadius: 0, maxHeight: 280, overflowY: 'auto' }}>
            <div className="row head" style={{ gridTemplateColumns: GRID, lineHeight: 1.3 }}>
              <span /><span>타입</span><span>제목</span>
              <span>수집일<br/><span style={{ fontWeight: 400, opacity: 0.6 }}>(시작일)</span></span>
              <span>종료일</span>
              <span className="cell-r">평균할인</span><span className="cell-r">상품</span><span>상태</span>
            </div>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className={`row ${i % 2 ? 'alt' : ''}`} style={{ gridTemplateColumns: GRID }}>
                  {Array.from({ length: 9 }).map((_, j) => (
                    <span key={j}><div style={{ height: 10, background: 'var(--bs)', borderRadius: 3, opacity: 0.5 }} /></span>
                  ))}
                </div>
              ))
            ) : filtered.length === 0 ? (
              <div className="col-flex center" style={{ padding: '32px 0', color: 'var(--f4)', alignItems: 'center', gap: 6 }}>
                <span className="mono" style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>no data</span>
                <span style={{ fontSize: 12 }}>수집된 프로모션이 없습니다</span>
              </div>
            ) : (
              filtered.map(row => {
                const on          = sel.has(row.id);
                const summ        = summaryMap.get(row.id);
                const dr          = summ?.discount ?? null;
                const reason      = inactiveReason(row.end_at, row.ended_at);
                return (
                  <div key={row.id}
                    className={`row hover ${on ? 'flag' : ''}`}
                    style={{ gridTemplateColumns: GRID, cursor: 'pointer', background: on ? 'var(--snk)' : undefined, opacity: reason === 'unlisted' ? 0.55 : 1 }}
                    onClick={() => toggle(row.id)}>
                    <span><div className={`checkbox ${on ? 'on' : ''}`} style={{ pointerEvents: 'none' }}>{on && '✓'}</div></span>
                    <span>
                      <span className={`sev ${TYPE_SEV[row.promotion_type] ?? 'lo'}`}>
                        <span className="pip" />{TYPE_LABEL[row.promotion_type] ?? row.promotion_type}
                      </span>
                    </span>
                    <span style={{ fontWeight: on ? 500 : 400 }}>{row.title}</span>
                    <span className="mono dim" style={{ fontSize: 11 }}>{fmtDate(row.snapshot_date)}</span>
                    <span className="mono dim" style={{ fontSize: 11 }}>{fmtDate(row.end_at)}</span>
                    <span className={`mono cell-r ${dr != null && dr >= 30 ? 'hs' : 'muted'}`}
                      style={{ fontWeight: dr != null && dr >= 30 ? 500 : 400 }}>
                      {fmtDiscount(dr)}
                    </span>
                    <span className="mono muted cell-r">{row.items_count}</span>
                    <span>
                      {reason === null
                        ? <span className="sev lo"><span className="pip" />진행중</span>
                        : reason === 'end_at'
                          ? <span className="sev lo" style={{ color: 'var(--f4)' }}><span className="pip" />종료</span>
                          : <span className="mono" style={{ fontSize: 11, color: 'var(--f4)' }}>미노출</span>
                      }
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* ── 상품 리스트 ── */}
        <section className="panel" style={{ padding: 0 }}>
          <div className="row-flex between center" style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--bs)' }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>
              상품 리스트
              <span className="sub" style={{ marginLeft: 8 }}>
                {sel.size === 0 ? '선택 없음'
                  : detailLoad ? '로딩중…'
                  : `${visibleItems.length}건${brandFilter.size > 0 ? ` (필터: ${detailItems.length}건 중)` : ''}`}
              </span>
            </h3>
            <div className="row-flex gap-4 center">
              <button className="btn sm" onClick={() => setSortBy(s => s === 'discount' ? 'display' : 'discount')}>
                {sortBy === 'discount' ? '할인폭 ▾' : '표시순 ▾'}
              </button>
            </div>
          </div>
          {sel.size === 0 ? (
            <div className="col-flex center" style={{ padding: '36px 0', color: 'var(--f4)', alignItems: 'center', gap: 6 }}>
              <span className="mono" style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>no selection</span>
              <span style={{ fontSize: 12 }}>마스터에서 프로모션을 선택해 보세요</span>
            </div>
          ) : detailLoad ? (
            <div className="col-flex center" style={{ padding: '36px 0', color: 'var(--f4)', alignItems: 'center' }}>
              <span style={{ fontSize: 12 }}>로딩중…</span>
            </div>
          ) : (
            <div className="tbl" style={{ border: 'none', borderRadius: 0, maxHeight: 480, overflowY: 'auto' }}>
              <div className="row head" style={{ gridTemplateColumns: ITEM_COLS, lineHeight: 1.3 }}>
                <span>표시순</span>
                <span>상품명</span>
                <span>브랜드<br/>회사</span>
                <span>카테고리</span>
                <span>성별</span>
                <span className="cell-r">판매가격<br/>소비자가</span>
                <span className="cell-r">할인율</span>
                <span className="cell-r">최고순위</span>
                <span className="cell-r">리뷰점수</span>
                <span className="cell-r">리뷰수</span>
              </div>
              {visibleItems.slice(0, 200).map((item, i) => {
                const dr     = parseFloat(String(item.discount_rate ?? 0));
                const bId    = item.musinsa_brand_slug ? brandIdMap.get(item.musinsa_brand_slug) : undefined;
                const enrich = enrichMap.get(item.id);
                const catName = enrich?.category_d2_name ?? (enrich?.category_code ? CATEGORY_MAP[enrich.category_code] : null);
                return (
                  <div key={item.id} className={`row hover ${i % 2 ? 'alt' : ''}`}
                    style={{ gridTemplateColumns: ITEM_COLS, alignItems: 'start', paddingTop: 6, paddingBottom: 6 }}>
                    {/* 표시순 */}
                    <span className="mono muted" style={{ paddingTop: 2, fontSize: 11 }}>
                      {item.rank_in_module != null ? item.rank_in_module + 1 : '—'}
                    </span>
                    {/* 상품명 */}
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden' }}>
                      <span
                        style={{ fontSize: 12, color: item.is_sold_out ? 'var(--f4)' : 'var(--f1)', cursor: item.musinsa_no ? 'pointer' : 'default', lineHeight: '1.3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        onClick={() => item.musinsa_no && router.push(`/product?no=${item.musinsa_no}`)}>
                        {item.product_name ?? '—'}
                        {item.is_sold_out && <span className="mono dim" style={{ fontSize: 9, marginLeft: 4 }}>품절</span>}
                      </span>
                    </span>
                    {/* 브랜드/회사 */}
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span
                        className="chip"
                        style={{ fontSize: 10, width: 'fit-content', cursor: bId ? 'pointer' : 'default', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        onClick={() => bId && router.push(`/brand?id=${bId}`)}>
                        {item.musinsa_brand_name ?? '—'}
                      </span>
                      {enrich?.company_name && (
                        <span className="mono dim" style={{ fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {enrich.company_name}
                        </span>
                      )}
                    </span>
                    {/* 카테고리 */}
                    <span className="mono dim" style={{ fontSize: 10, paddingTop: 2 }}>
                      {catName ?? '—'}
                    </span>
                    {/* 성별 */}
                    <span className="mono dim" style={{ fontSize: 10, paddingTop: 2 }}>
                      {enrich?.gender === 'M' ? '남' : enrich?.gender === 'F' ? '여' : enrich?.gender === 'A' ? '전체' : '—'}
                    </span>
                    {/* 판매가/소비자가 */}
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1, paddingTop: 2 }}>
                      <span className="mono" style={{ fontSize: 12 }}>
                        {item.final_price != null ? item.final_price.toLocaleString() : '—'}
                      </span>
                      {item.list_price != null && item.list_price !== item.final_price && (
                        <span className="mono dim" style={{ fontSize: 9, textDecoration: 'line-through' }}>
                          {item.list_price.toLocaleString()}
                        </span>
                      )}
                    </span>
                    {/* 할인율 */}
                    <span className={`mono cell-r ${dr >= 30 ? 'hs' : 'muted'}`} style={{ paddingTop: 2, fontWeight: dr >= 30 ? 500 : 400, fontSize: 11 }}>
                      {fmtDiscount(item.discount_rate)}
                    </span>
                    {/* 최고순위 */}
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1, paddingTop: 2 }}>
                      {enrich?.best_rank != null ? (
                        <>
                          <span className="mono" style={{ fontSize: 11 }}>{enrich.best_rank}위</span>
                          {(enrich.best_rank_cat || enrich.best_rank_gender) && (
                            <span className="mono dim" style={{ fontSize: 9 }}>
                              {[enrich.best_rank_cat, enrich.best_rank_gender].filter(Boolean).join('·')}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="mono muted" style={{ fontSize: 11 }}>—</span>
                      )}
                    </span>
                    {/* 리뷰점수 */}
                    <span className="mono muted cell-r" style={{ paddingTop: 2, fontSize: 11 }}>
                      {item.review_score != null ? `${item.review_score}%` : '—'}
                    </span>
                    {/* 리뷰수 */}
                    <span className="mono muted cell-r" style={{ paddingTop: 2, fontSize: 11 }}>
                      {item.review_count != null ? item.review_count.toLocaleString() : '—'}
                    </span>
                  </div>
                );
              })}
              {visibleItems.length > 200 && (
                <div style={{ padding: '6px 14px' }}>
                  <span className="mono dim" style={{ fontSize: 11 }}>+ {visibleItems.length - 200}건 더 있음</span>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── 차트 3×3 그리드 ── */}
        <div className="grid grid-3 gap-12">

          {/* 할인율 분포 */}
          <section className="panel">
            <div className="sec-head">
              <h3>할인율 분포 <span className="sub">{sel.size === 0 ? '—' : `${detailItems.length}건`}</span></h3>
            </div>
            <div style={{ width: '100%', height: 110 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={discountChartData} margin={{ top: 4, right: 0, left: -22, bottom: 0 }}>
                  <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis hide domain={[0, maxBinCount]} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [`${v}건`, '상품 수']} />
                  <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                    {discountChartData.map((entry, idx) => (
                      <RCell key={idx} fill={entry.count === maxBinCount && maxBinCount > 0 ? 'var(--hs)' : 'var(--f3)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* 브랜드 TOP 7 */}
          <section className="panel">
            <div className="sec-head">
              <h3>브랜드 TOP 7 <span className="sub">{sel.size === 0 ? '—' : '상품 수 기준'}</span></h3>
            </div>
            {(sel.size === 0 ? [['—', 0], ['—', 0], ['—', 0]] : topBrands.length > 0 ? topBrands : [['데이터 없음', 0]])
              .map(([n, c], i) => (
                <div key={i} className="row-flex center gap-8" style={{ padding: '3px 0' }}>
                  <span style={{ flex: 1, fontSize: 11, color: (c as number) === 0 ? 'var(--f4)' : 'var(--f2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n}</span>
                  <HBar value={c as number} max={maxBrandCnt} accent={i === 0 && (c as number) > 0} w={70} />
                  <span className="mono dim" style={{ fontSize: 10, width: 22, textAlign: 'right' }}>{(c as number) || '—'}</span>
                </div>
              ))}
          </section>

          {/* 브랜드별 평균 할인율 */}
          <section className="panel">
            <div className="sec-head">
              <h3>브랜드별 평균 할인율 <span className="sub">{sel.size === 0 ? '—' : `TOP${brandAvgDiscount.length}`}</span></h3>
            </div>
            {sel.size === 0 || brandAvgDiscount.length === 0 ? (
              <span className="dim" style={{ fontSize: 12 }}>{sel.size === 0 ? '선택 없음' : '데이터 없음'}</span>
            ) : brandAvgDiscount.map(([brand, avg], i) => (
              <div key={brand} className="row-flex center gap-8" style={{ padding: '3px 0' }}>
                <span style={{ flex: 1, fontSize: 11, color: 'var(--f2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{brand}</span>
                <HBar value={avg} max={maxAvgDr} accent={i === 0} w={60} />
                <span className="mono dim" style={{ fontSize: 10, width: 32, textAlign: 'right' }}>-{Math.round(avg)}%</span>
              </div>
            ))}
          </section>

          {/* 만족도 vs 할인율 산점도 */}
          <section className="panel">
            <div className="sec-head">
              <h3>만족도 vs 할인율 <span className="sub">{scatterData.length > 0 ? `${scatterData.length}건` : '—'}</span></h3>
            </div>
            <div style={{ width: '100%', height: 110 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                  <XAxis dataKey="x" type="number" name="할인율" unit="%" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis dataKey="y" type="number" name="만족도" unit="%" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <Tooltip {...TOOLTIP_STYLE} cursor={{ strokeDasharray: '3 3', stroke: 'var(--bd)' }}
                    formatter={(v: any) => [`${v}%`]} />
                  <Scatter data={scatterData} fill="var(--hs)" fillOpacity={0.5} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* 타입별 평균 상품수 */}
          <section className="panel">
            <div className="sec-head">
              <h3>타입별 평균 상품수 <span className="sub">{filtered.length > 0 ? `${filtered.length}건 기준` : '—'}</span></h3>
            </div>
            <div style={{ width: '100%', height: 110 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={typeAvgData.length > 0 ? typeAvgData : [{ name: '—', avg: 0 }]} margin={{ top: 4, right: 0, left: -22, bottom: 0 }}>
                  <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [`${v}개`, '평균 상품수']} />
                  <Bar dataKey="avg" fill="var(--f3)" radius={[2, 2, 0, 0]}>
                    {typeAvgData.map((_, idx) => <RCell key={idx} fill="var(--f3)" />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* 선착순 품절 현황 */}
          <section className="panel">
            <div className="sec-head">
              <h3>선착순 품절 현황</h3>
            </div>
            {limitedItems.length === 0 ? (
              <span className="dim" style={{ fontSize: 12 }}>{sel.size === 0 ? '선택 없음' : '선착순 상품 없음'}</span>
            ) : (
              <>
                <div className="row-flex between" style={{ padding: '4px 0' }}>
                  <span style={{ fontSize: 12, color: 'var(--f3)' }}>선착순 총</span>
                  <span className="mono" style={{ fontSize: 12 }}>{limitedItems.length}개</span>
                </div>
                <div className="row-flex between" style={{ padding: '4px 0' }}>
                  <span style={{ fontSize: 12, color: 'var(--f2)' }}>판매중</span>
                  <span className="mono hs" style={{ fontSize: 12 }}>{limitedProgress}개</span>
                </div>
                <div className="row-flex between" style={{ padding: '4px 0' }}>
                  <span style={{ fontSize: 12, color: 'var(--f4)' }}>품절</span>
                  <span className="mono dim" style={{ fontSize: 12 }}>{limitedSoldOut}개 · {limitedPct}%</span>
                </div>
                <div style={{ marginTop: 10, background: 'var(--bs)', borderRadius: 4, height: 5 }}>
                  <div style={{ width: `${100 - limitedPct}%`, background: 'var(--hs)', height: '100%', borderRadius: 4, transition: 'width 0.4s' }} />
                </div>
              </>
            )}
          </section>

          {/* 종료 요일 패턴 */}
          <section className="panel">
            <div className="sec-head">
              <h3>종료 요일 패턴 <span className="sub">전체 기간</span></h3>
            </div>
            <div style={{ width: '100%', height: 110 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={weekdayLabels.map((d, i) => ({ name: d, count: weekdayCounts[i] }))}
                  margin={{ top: 4, right: 0, left: -22, bottom: 0 }}>
                  <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [`${v}건`, '종료 프로모션']} />
                  <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                    {weekdayLabels.map((_, i) => (
                      <RCell key={i} fill={weekdayCounts[i] === maxWeekdayCnt && maxWeekdayCnt > 0 ? 'var(--hs)' : 'var(--f3)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* 겹침 감지 */}
          <section className="panel">
            <div className="sec-head">
              <h3>겹침 감지 <span className="sub">
                {sel.size < 2 ? '2개 이상 선택' : overlaps.length > 0 ? `${overlaps.length}개 중복` : '중복 없음'}
              </span></h3>
            </div>
            {sel.size < 2 ? (
              <span className="dim" style={{ fontSize: 12 }}>프로모션 2개 이상 선택 시 중복 상품을 표시합니다</span>
            ) : overlaps.length === 0 ? (
              <div className="col-flex center" style={{ padding: '18px 0', color: 'var(--f4)', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 12 }}>선택한 프로모션 간 중복 상품 없음</span>
              </div>
            ) : (
              <div style={{ maxHeight: 150, overflowY: 'auto' }}>
                {overlaps.slice(0, 15).map(({ item, promoIds }) => (
                  <div key={item.musinsa_no} className="row-flex between center"
                    style={{ padding: '5px 0', borderBottom: '0.5px solid var(--bs)' }}>
                    <div className="col-flex" style={{ gap: 2, flex: 1, overflow: 'hidden' }}>
                      <span style={{ fontSize: 11, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.product_name ?? '—'}
                      </span>
                      <span className="mono dim" style={{ fontSize: 10 }}>{item.musinsa_brand_name}</span>
                    </div>
                    <span className="chip" style={{ fontSize: 10, marginLeft: 8, flexShrink: 0, background: 'var(--snk)' }}>
                      {promoIds.length}건 중복
                    </span>
                  </div>
                ))}
                {overlaps.length > 15 && (
                  <span className="mono dim" style={{ fontSize: 10, display: 'block', marginTop: 4 }}>+ {overlaps.length - 15}건 더</span>
                )}
              </div>
            )}
          </section>

          {/* 요약 */}
          <section className="panel surface">
            <div className="sec-head">
              <h3>요약</h3>
            </div>
            {sel.size === 0 ? (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--f4)' }}>선택된 프로모션이 없습니다.</p>
            ) : (
              <p style={{ margin: 0, fontSize: 12, lineHeight: '20px', color: 'var(--f2)' }}>
                선택된 <span style={{ fontWeight: 500 }}>{selectedPromos.length}건</span>의 프로모션 내
                상품 {detailItems.length}개.{' '}
                {topBrands.length > 0 && (
                  <><span className="hs" style={{ fontWeight: 500 }}>
                    {topBrands.slice(0, 3).map(([b]) => b).join(', ')}
                  </span>{' '}등이 강세. </>
                )}
                {detailItems.filter(i => parseFloat(String(i.discount_rate ?? 0)) >= 30).length}건은 −30% 이상 대형 할인.
                {overlaps.length > 0 && ` 겹치는 상품 ${overlaps.length}개.`}
              </p>
            )}
          </section>

        </div>{/* grid-3 */}

        {/* 성별 × 카테고리 히트맵 */}
        {genderCatHeatmapHub && (
          <section className="panel">
            <div className="sec-head">
              <h3>성별 × 카테고리 히트맵 <span className="sub">{detailItems.length}건 기준</span></h3>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '4px 8px', color: 'var(--f4)', fontWeight: 400, textAlign: 'left', fontSize: 10, minWidth: 60 }} />
                    {genderCatHeatmapHub.topCats.map(cat => (
                      <th key={cat} style={{ padding: '4px 6px', color: 'var(--f3)', fontWeight: 400, textAlign: 'center', fontSize: 10, whiteSpace: 'nowrap' }}>{cat}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {genderCatHeatmapHub.GENDERS.map(g => {
                    const row = genderCatHeatmapHub.matrix[g] ?? {};
                    const rowTotal = genderCatHeatmapHub.topCats.reduce((s, c) => s + (row[c] ?? 0), 0);
                    if (rowTotal === 0) return null;
                    return (
                      <tr key={g}>
                        <td style={{ padding: '3px 8px', color: 'var(--f3)', fontWeight: 500, fontSize: 11, whiteSpace: 'nowrap' }}>
                          {genderCatHeatmapHub.GENDER_LABELS[g]}
                        </td>
                        {genderCatHeatmapHub.topCats.map(cat => {
                          const val = row[cat] ?? 0;
                          const intensity = val > 0 ? Math.max(0.1, val / genderCatHeatmapHub.hmMax) : 0;
                          return (
                            <td key={cat} style={{ padding: '2px 4px', textAlign: 'center', position: 'relative', minWidth: 52 }}>
                              {val > 0 && <div style={{ position: 'absolute', inset: 2, background: 'var(--hs)', opacity: intensity, borderRadius: 3 }} />}
                              <span style={{ position: 'relative', zIndex: 1, fontSize: 10, fontFamily: 'var(--mono)', color: intensity > 0.5 ? 'var(--bg)' : 'var(--f2)' }}>
                                {val > 0 ? val.toLocaleString() : '—'}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

      </div>{/* col-flex 우측 */}
    </div>/* grid 240px 1fr */
  );
}

// ── 캘린더 탭 ─────────────────────────────────────────────────────
interface CalEvt { id: string; title: string; sev: string; type: string; snapshotDate: string; }
interface CalPopup { day: number; dateStr: string; evts: CalEvt[]; }

function PromoCalendar({ onSelectPromo }: { onSelectPromo: (id: string, snapshotDate: string) => void }) {
  const today = new Date();
  const todayKst = kstDateStr();
  const [year,           setYear]           = React.useState(today.getFullYear());
  const [month,          setMonth]          = React.useState(today.getMonth());
  const [viewMode,       setViewMode]       = React.useState<'month' | 'week'>('month');
  const [weekAnchor,     setWeekAnchor]     = React.useState(todayKst);
  const [promos,         setPromos]         = React.useState<PromoRow[]>([]);
  const [loading,        setLoading]        = React.useState(true);
  const [popup,          setPopup]          = React.useState<CalPopup | null>(null);
  const [activeTypes,    setActiveTypes]    = React.useState<Set<string>>(
    new Set(Object.keys(TYPE_LABEL))
  );

  const monthStr    = `${String(year).padStart(4,'0')}-${String(month+1).padStart(2,'0')}`;
  const firstOfMonth = `${monthStr}-01`;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const lastOfMonth = `${monthStr}-${String(daysInMonth).padStart(2,'0')}`;

  const weekBounds = React.useMemo(() => {
    const d = new Date(weekAnchor + 'T00:00:00');
    const dow = d.getDay(); // 0=Sun
    const ws = new Date(d); ws.setDate(d.getDate() - dow);
    const we = new Date(ws); we.setDate(ws.getDate() + 6);
    const fmt = (dd: Date) => `${dd.getFullYear()}-${String(dd.getMonth()+1).padStart(2,'0')}-${String(dd.getDate()).padStart(2,'0')}`;
    return { start: fmt(ws), end: fmt(we) };
  }, [weekAnchor]);

  const fetchFrom = viewMode === 'month' ? firstOfMonth : weekBounds.start;
  const fetchTo   = viewMode === 'month' ? lastOfMonth  : weekBounds.end;

  React.useEffect(() => {
    setLoading(true);
    sb.from('promotions')
      .select('id, musinsa_event_id, title, promotion_type, items_count, end_at, ended_at, snapshot_date')
      .lte('snapshot_date', fetchTo)
      .or(`ended_at.is.null,ended_at.gte.${fetchFrom}`)
      .order('snapshot_date', { ascending: true })
      .limit(500)
      .then(({ data }) => { setPromos((data ?? []) as PromoRow[]); setLoading(false); });
  }, [fetchFrom, fetchTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // 날짜별 이벤트 맵 (date string key)
  const eventsMap: Record<string, CalEvt[]> = {};
  for (const promo of promos) {
    if (!activeTypes.has(promo.promotion_type)) continue;
    const sev    = TYPE_SEV[promo.promotion_type] ?? 'lo';
    const snap   = promo.snapshot_date;
    const endStr = promo.ended_at ?? (promo.end_at ? promo.end_at.slice(0, 10) : null);
    if (endStr && endStr < fetchFrom) continue;
    if (snap > fetchTo) continue;
    const startStr = snap >= fetchFrom ? snap : fetchFrom;
    const endStr2  = endStr && endStr <= fetchTo ? endStr : fetchTo;
    const evt: CalEvt = { id: promo.id, title: promo.title, sev, type: promo.promotion_type, snapshotDate: snap };
    const cur = new Date(startStr + 'T00:00:00');
    const ed  = new Date(endStr2  + 'T00:00:00');
    while (cur <= ed) {
      const ds = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
      if (!eventsMap[ds]) eventsMap[ds] = [];
      if (!eventsMap[ds].some(e => e.id === evt.id)) eventsMap[ds].push(evt);
      cur.setDate(cur.getDate() + 1);
    }
  }

  const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const prevMonth = () => month === 0 ? (setYear(y => y-1), setMonth(11)) : setMonth(m => m-1);
  const nextMonth = () => month === 11 ? (setYear(y => y+1), setMonth(0)) : setMonth(m => m+1);
  const prevWeek = () => {
    const d = new Date(weekAnchor + 'T00:00:00'); d.setDate(d.getDate() - 7);
    setWeekAnchor(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
  };
  const nextWeek = () => {
    const d = new Date(weekAnchor + 'T00:00:00'); d.setDate(d.getDate() + 7);
    setWeekAnchor(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
  };

  const weekDayStrs = React.useMemo(() => {
    const result: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekBounds.start + 'T00:00:00'); d.setDate(d.getDate() + i);
      result.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
    }
    return result;
  }, [weekBounds.start]);

  const firstDay   = new Date(year, month, 1).getDay();
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
  const activeCount = promos.filter(p => isActive(p.end_at, p.ended_at)).length;

  const DAY_HEADERS = ['일','월','화','수','목','금','토'];
  const SUN_COLOR   = 'var(--shf)';
  const SAT_COLOR   = '#3B82F6'; // 파란색 (토)

  return (
    <>
      <div className="row-flex between center">
        <div className="row-flex baseline gap-10">
          {viewMode === 'month' ? (
            <h2 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>{year}년 {MONTHS[month]}</h2>
          ) : (
            <h2 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>
              {parseInt(weekBounds.start.slice(0,4))}년{' '}
              {parseInt(weekBounds.start.slice(5,7))}월{' '}
              {parseInt(weekBounds.start.slice(8))}일 주
              <span style={{ fontSize: 12, fontWeight: 400, marginLeft: 6, color: 'var(--f3)' }}>
                {weekBounds.start.slice(5)} ~ {weekBounds.end.slice(5)}
              </span>
            </h2>
          )}
          <span className="mono dim" style={{ fontSize: 11 }}>
            · {loading ? '로딩중…' : `진행중 ${activeCount}건`}
          </span>
        </div>
        <div className="row-flex gap-4 center">
          {Object.entries(TYPE_LABEL).map(([k, label]) => {
            const on = activeTypes.has(k);
            return (
              <span
                key={k}
                className={`sev ${on ? TYPE_SEV[k] : ''}`}
                style={{ fontSize: 11, cursor: 'pointer', opacity: on ? 1 : 0.28, userSelect: 'none', transition: 'opacity 0.15s' }}
                onClick={() => setActiveTypes(prev => {
                  const n = new Set(prev);
                  n.has(k) ? n.delete(k) : n.add(k);
                  return n;
                })}>
                <span className="pip" />{label}
              </span>
            );
          })}
          <span style={{ width: 4 }} />
          <button className={`btn sm ${viewMode === 'month' ? 'active' : ''}`} onClick={() => setViewMode('month')}>월</button>
          <button className={`btn sm ${viewMode === 'week' ? 'active' : ''}`} onClick={() => setViewMode('week')}>주</button>
          <span style={{ width: 4 }} />
          {viewMode === 'month' ? (
            <>
              <button className="btn sm icon" onClick={prevMonth}><IcChevL /></button>
              <button className="btn sm" onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); }}>오늘</button>
              <button className="btn sm icon" onClick={nextMonth}><IcChevR /></button>
            </>
          ) : (
            <>
              <button className="btn sm icon" onClick={prevWeek}><IcChevL /></button>
              <button className="btn sm" onClick={() => setWeekAnchor(kstDateStr())}>오늘</button>
              <button className="btn sm icon" onClick={nextWeek}><IcChevR /></button>
            </>
          )}
        </div>
      </div>

      {viewMode === 'week' ? (
        <section className="panel" style={{ padding: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '0.5px solid var(--bs)' }}>
            {DAY_HEADERS.map((d, i) => (
              <div key={i} className="h" style={{ color: i === 0 ? SUN_COLOR : i === 6 ? SAT_COLOR : undefined, padding: '6px 8px' }}>{d}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {weekDayStrs.map((dateStr, i) => {
              const isToday   = dateStr === todayKst;
              const isHoliday = !!KR_HOLIDAYS[dateStr];
              const isSun     = i === 0;
              const isSat     = i === 6;
              const holName   = KR_HOLIDAYS[dateStr] ?? null;
              const numColor  = (isHoliday || isSun) ? SUN_COLOR : isSat ? SAT_COLOR : undefined;
              const evts      = eventsMap[dateStr] ?? [];
              const SHOW      = 8;
              return (
                <div key={dateStr}
                  className={`cal-day ${isToday ? 'today' : ''}`}
                  style={{ borderLeft: i > 0 ? '0.5px solid var(--bs)' : undefined, minHeight: 220 }}>
                  <div className="num" style={{ display: 'flex', alignItems: 'baseline', gap: 4, color: numColor }}>
                    <span style={{ fontSize: 10, color: 'var(--f4)' }}>{parseInt(dateStr.slice(5,7))}월</span>
                    <span>{parseInt(dateStr.slice(8))}</span>
                    {holName && <span style={{ fontSize: 8, fontWeight: 400, color: SUN_COLOR, lineHeight: 1 }}>{holName}</span>}
                  </div>
                  {evts.slice(0, SHOW).map((e, j) => (
                    <div key={j} className={`cal-evt ${e.sev}`} style={{ cursor: 'pointer' }}
                      onClick={() => onSelectPromo(e.id, e.snapshotDate)}>
                      {e.title}
                    </div>
                  ))}
                  {evts.length > SHOW && (
                    <button className="btn sm" style={{ fontSize: 10, padding: '1px 0', width: '100%', marginTop: 2, textAlign: 'center' }}
                      onClick={() => setPopup({ day: parseInt(dateStr.slice(8)), dateStr, evts })}>
                      + {evts.length - SHOW}개 더
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="cal-head">
            {DAY_HEADERS.map((d, i) => (
              <div key={i} className="h" style={{ color: i === 0 ? SUN_COLOR : i === 6 ? SAT_COLOR : undefined }}>{d}</div>
            ))}
          </div>
          <div className="cal">
            {Array.from({ length: totalCells }).map((_, i) => {
              const day      = i - firstDay + 1;
              const inMonth  = day >= 1 && day <= daysInMonth;
              const dayStr   = inMonth ? `${monthStr}-${String(day).padStart(2,'0')}` : '';
              const isToday  = dayStr === todayKst;
              const isHoliday = inMonth && !!KR_HOLIDAYS[dayStr];
              const isSun    = i % 7 === 0;
              const isSat    = i % 7 === 6;
              const evts     = inMonth ? (eventsMap[dayStr] ?? []) : [];
              const numColor = (isHoliday || isSun) ? SUN_COLOR : isSat ? SAT_COLOR : undefined;
              const holName  = isHoliday ? KR_HOLIDAYS[dayStr] : null;
              const SHOW     = 3;
              return (
                <div key={i} className={`cal-day ${!inMonth ? 'out' : ''} ${isToday ? 'today' : ''}`}>
                  <div className="num" style={{ display: 'flex', alignItems: 'baseline', gap: 4, color: numColor }}>
                    <span>{inMonth ? day : ''}</span>
                    {holName && <span style={{ fontSize: 8, fontWeight: 400, color: SUN_COLOR, lineHeight: 1 }}>{holName}</span>}
                  </div>
                  {evts.slice(0, SHOW).map((e, j) => (
                    <div key={j} className={`cal-evt ${e.sev}`} style={{ cursor: 'pointer' }}
                      onClick={() => onSelectPromo(e.id, e.snapshotDate)}>
                      {e.title}
                    </div>
                  ))}
                  {evts.length > SHOW && (
                    <button className="btn sm" style={{ fontSize: 10, padding: '1px 0', width: '100%', marginTop: 2, textAlign: 'center' }}
                      onClick={() => setPopup({ day, dateStr: dayStr, evts })}>
                      + {evts.length - SHOW}개 더
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 팝업 모달 */}
      {popup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setPopup(null)}>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 12, padding: 20,
            minWidth: 340, maxWidth: 500, maxHeight: '75vh', overflowY: 'auto',
            boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--f1)' }}>
                {parseInt(popup.dateStr.slice(5,7))}월 {parseInt(popup.dateStr.slice(8))}일 · {popup.evts.length}건
              </div>
              <button className="btn sm icon" onClick={() => setPopup(null)}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {popup.evts.map(e => (
                <div key={e.id} onClick={() => { onSelectPromo(e.id, e.snapshotDate); setPopup(null); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                    borderRadius: 8, border: '1px solid var(--bd)', cursor: 'pointer',
                    background: 'var(--snk)' }}
                  onMouseEnter={el => (el.currentTarget as HTMLElement).style.background = 'var(--hs-soft)'}
                  onMouseLeave={el => (el.currentTarget as HTMLElement).style.background = 'var(--snk)'}>
                  <span className={`sev ${e.sev}`} style={{ flexShrink: 0 }}>
                    <span className="pip" />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--f1)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.title}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--f4)', marginTop: 2 }}>
                      {TYPE_LABEL[e.type] ?? e.type} · 수집 {e.snapshotDate}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── 통계 탭 ──────────────────────────────────────────────────────
function PromoStats() {
  type StatsWin = '오늘' | '어제' | '이번주' | '지난주' | '30D' | '90D' | '180D' | '1Y';
  const router = useRouter();
  const [win,        setWin]       = React.useState<StatsWin>('30D');
  const [loading,    setLoading]   = React.useState(true);
  const [promoRows,  setPromoRows] = React.useState<any[]>([]);
  const [itemRows,   setItemRows]  = React.useState<any[]>([]);
  const [promoTotal, setPromoTotal] = React.useState(0);
  const [itemTotal,  setItemTotal] = React.useState(0);
  const [brandIdMap, setBrandIdMap] = React.useState<Map<string, string>>(new Map());
  const [statsProductMap, setStatsProductMap] = React.useState<Map<string, { gender: string | null; category_d2_name: string | null }>>(new Map());

  const PROMO_LIMIT = 5000;
  const ITEM_LIMIT  = 20000;

  React.useEffect(() => {
    const todayStr = kstDateStr();
    let fromStr: string;
    let toStr: string = todayStr;
    if (win === '오늘') {
      fromStr = todayStr;
    } else if (win === '어제') {
      fromStr = kstDateStr(-1);
      toStr   = kstDateStr(-1);
    } else if (win === '이번주') {
      const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const dow = d.getUTCDay(); // 0=Sun
      fromStr = kstDateStr(dow === 0 ? -6 : -(dow - 1));
    } else if (win === '지난주') {
      const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const dow = d.getUTCDay();
      const toMon = dow === 0 ? 6 : dow - 1;
      fromStr = kstDateStr(-(toMon + 7));
      toStr   = kstDateStr(-(toMon + 1));
    } else {
      const daysBack = win === '30D' ? 30 : win === '90D' ? 90 : win === '180D' ? 180 : 365;
      fromStr = kstDateStr(-daysBack);
    }
    setLoading(true);
    Promise.all([
      sb.from('promotions')
        .select('id, promotion_type, snapshot_date, items_count, end_at, ended_at', { count: 'exact' })
        .gte('snapshot_date', fromStr)
        .lte('snapshot_date', toStr)
        .order('snapshot_date', { ascending: true })
        .limit(PROMO_LIMIT),
      sb.from('promotion_items')
        .select('promotion_id, product_id, musinsa_brand_name, musinsa_brand_slug, discount_rate, snapshot_date, is_sold_out, review_score, musinsa_no', { count: 'exact' })
        .gte('snapshot_date', fromStr)
        .lte('snapshot_date', toStr)
        .limit(ITEM_LIMIT),
    ]).then(([pr, ir]) => {
      setPromoRows((pr.data ?? []) as any[]);
      setItemRows((ir.data ?? []) as any[]);
      setPromoTotal(pr.count ?? 0);
      setItemTotal(ir.count ?? 0);
      setLoading(false);
    });
  }, [win]);

  // 브랜드 slug → id 조회 (브랜드 링크용)
  React.useEffect(() => {
    if (itemRows.length === 0) return;
    const slugs = [...new Set(itemRows.map(i => i.musinsa_brand_slug).filter(Boolean) as string[])];
    if (slugs.length === 0) return;
    sb.from('brands').select('slug, id').in('slug', slugs).limit(500)
      .then(({ data }) => setBrandIdMap(new Map((data ?? []).map((b: any) => [b.slug, b.id as string]))));
  }, [itemRows]);

  // product_id → gender/category 조회 (히트맵용)
  React.useEffect(() => {
    if (itemRows.length === 0) { setStatsProductMap(new Map()); return; }
    const productIds = [...new Set((itemRows as any[]).map(i => i.product_id).filter(Boolean) as string[])].slice(0, 2000);
    if (productIds.length === 0) { setStatsProductMap(new Map()); return; }
    sb.from('products').select('id, gender, category_d2_name').in('id', productIds).limit(2000)
      .then(({ data }) => setStatsProductMap(new Map((data ?? []).map((p: any) => [
        p.id as string,
        { gender: p.gender as string | null, category_d2_name: p.category_d2_name as string | null },
      ]))));
  }, [itemRows]);

  // ── 집계 ────────────────────────────────────────────────────────

  const promosByType = React.useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of promoRows) m[p.promotion_type] = (m[p.promotion_type] ?? 0) + 1;
    return m;
  }, [promoRows]);

  // 상품 전체 지표
  const itemStats = React.useMemo(() => {
    const binEdges = [5, 10, 15, 20, 25, 30, 40, 50, Infinity];
    const bins = new Array(9).fill(0) as number[];
    const drList: number[] = [];
    let totalDr = 0, cntDr = 0, highDr = 0, soldOut = 0, noDr = 0;
    let totalRvScore = 0, cntRvScore = 0;
    const brandSet = new Set<string>();
    const noCountMap = new Map<string, number>(); // musinsa_no → 출현 횟수

    for (const item of itemRows) {
      const dr = item.discount_rate != null ? parseFloat(item.discount_rate) : 0;
      if (dr > 0) { totalDr += dr; cntDr++; drList.push(dr); if (dr >= 30) highDr++; }
      else { noDr++; }
      if (item.is_sold_out) soldOut++;
      if (item.musinsa_brand_name) brandSet.add(item.musinsa_brand_name);
      if (item.review_score != null) { totalRvScore += item.review_score; cntRvScore++; }
      if (item.musinsa_no) noCountMap.set(item.musinsa_no, (noCountMap.get(item.musinsa_no) ?? 0) + 1);
      for (let i = 0; i < binEdges.length; i++) { if (dr < binEdges[i]) { bins[i]++; break; } }
    }

    drList.sort((a, b) => a - b);
    const median = drList.length > 0
      ? drList.length % 2 === 1
        ? drList[Math.floor(drList.length / 2)]
        : (drList[drList.length / 2 - 1] + drList[drList.length / 2]) / 2
      : null;
    const maxDr = drList.length > 0 ? drList[drList.length - 1] : null;
    const dupItems = [...noCountMap.values()].filter(c => c >= 2).length;

    return {
      avgDiscount:   cntDr > 0 ? totalDr / cntDr : null,
      medianDiscount: median,
      maxDiscount:   maxDr,
      discountBins:  bins,
      highPct:       itemRows.length > 0 ? Math.round(highDr  / itemRows.length * 100) : 0,
      soldOutPct:    itemRows.length > 0 ? Math.round(soldOut / itemRows.length * 100) : 0,
      noDrPct:       itemRows.length > 0 ? Math.round(noDr    / itemRows.length * 100) : 0,
      uniqueBrands:  brandSet.size,
      avgReviewScore: cntRvScore > 0 ? Math.round(totalRvScore / cntRvScore) : null,
      dupItemCount:  dupItems,
    };
  }, [itemRows]);

  const brandCounts = React.useMemo((): [string, number][] => {
    const m: Record<string, number> = {};
    for (const item of itemRows) { const b = item.musinsa_brand_name ?? '—'; m[b] = (m[b] ?? 0) + 1; }
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [itemRows]);

  const typeAvgDiscount = React.useMemo(() => {
    const promoTypeMap = new Map(promoRows.map((p: any) => [p.id, p.promotion_type]));
    const m: Record<string, number[]> = {};
    for (const item of itemRows) {
      const type = promoTypeMap.get(item.promotion_id);
      if (!type || item.discount_rate == null) continue;
      if (!m[type]) m[type] = [];
      m[type].push(parseFloat(item.discount_rate));
    }
    return Object.entries(m)
      .map(([type, rates]) => ({ name: TYPE_LABEL[type] ?? type, avg: rates.reduce((a, b) => a + b, 0) / rates.length, count: rates.length }))
      .sort((a, b) => b.avg - a.avg);
  }, [promoRows, itemRows]);

  // 종료 요일 분포
  const weekdayCounts = React.useMemo(() => {
    const arr = new Array(7).fill(0);
    for (const p of promoRows) { if (p.end_at) arr[new Date(p.end_at).getDay()]++; }
    return arr;
  }, [promoRows]);

  // 활성 프로모션
  const activePromos = React.useMemo(() => {
    const now = new Date().toISOString();
    return promoRows.filter(p => !p.ended_at && (!p.end_at || p.end_at > now)).length;
  }, [promoRows]);

  // ── 시계열 — 실제 데이터 범위 자동 적응 ─────────────────────────
  const { timeSeriesData, granularity } = React.useMemo(() => {
    if (promoRows.length === 0) return { timeSeriesData: [] as { name: string; count: number }[], granularity: '일별' };

    // 실제 수집일 목록 (중복 제거)
    const dateCountMap: Record<string, number> = {};
    for (const p of promoRows) dateCountMap[p.snapshot_date] = (dateCountMap[p.snapshot_date] ?? 0) + 1;

    const sortedDates = Object.keys(dateCountMap).sort();
    const firstDate   = sortedDates[0];
    const lastDate    = sortedDates[sortedDates.length - 1];
    const spanDays    = Math.ceil(
      (new Date(lastDate + 'T00:00:00Z').getTime() - new Date(firstDate + 'T00:00:00Z').getTime()) / 86400000
    ) + 1;

    // 실제 스팬 기준으로 단위 결정 (window 선택 무관)
    const useWeekly  = spanDays > 60 && spanDays <= 200;
    const useMonthly = spanDays > 200;

    if (!useWeekly && !useMonthly) {
      // 일별: firstDate ~ lastDate
      const result: { name: string; count: number }[] = [];
      let cur = new Date(firstDate + 'T00:00:00Z');
      const end = new Date(lastDate + 'T00:00:00Z');
      while (cur <= end) {
        const ds = cur.toISOString().slice(0, 10);
        result.push({ name: ds.slice(5), count: dateCountMap[ds] ?? 0 });
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
      return { timeSeriesData: result, granularity: '일별' };
    }

    if (useWeekly) {
      const result: { name: string; count: number }[] = [];
      let ws = new Date(firstDate + 'T00:00:00Z');
      const end = new Date(lastDate + 'T00:00:00Z');
      while (ws <= end) {
        const we = new Date(ws);
        we.setUTCDate(we.getUTCDate() + 6);
        if (we > end) we.setTime(end.getTime());
        const wsStr = ws.toISOString().slice(0, 10);
        const weStr = we.toISOString().slice(0, 10);
        const count = Object.entries(dateCountMap)
          .filter(([ds]) => ds >= wsStr && ds <= weStr)
          .reduce((s, [, c]) => s + c, 0);
        result.push({ name: weStr.slice(5), count });
        ws.setUTCDate(ws.getUTCDate() + 7);
      }
      return { timeSeriesData: result, granularity: '주별' };
    }

    // 월별
    const monthMap: Record<string, number> = {};
    for (const [ds, cnt] of Object.entries(dateCountMap)) {
      const m = ds.slice(0, 7);
      monthMap[m] = (monthMap[m] ?? 0) + cnt;
    }
    const result = Object.keys(monthMap).sort().map(m => ({
      name: `${parseInt(m.slice(5))}월`,
      count: monthMap[m],
    }));
    return { timeSeriesData: result, granularity: '월별' };
  }, [promoRows]);

  // 상품 노출 추이 (프로모션 시계열과 동일한 adaptive granularity)
  const itemTimeSeriesData = React.useMemo(() => {
    if (itemRows.length === 0) return [] as { name: string; count: number }[];
    const dateMap: Record<string, number> = {};
    for (const item of itemRows) dateMap[item.snapshot_date] = (dateMap[item.snapshot_date] ?? 0) + 1;
    const sortedDates = Object.keys(dateMap).sort();
    const first = sortedDates[0], last = sortedDates[sortedDates.length - 1];
    const spanDays = Math.ceil((new Date(last + 'T00:00:00Z').getTime() - new Date(first + 'T00:00:00Z').getTime()) / 86400000) + 1;
    if (spanDays <= 60) {
      const result: { name: string; count: number }[] = [];
      let cur = new Date(first + 'T00:00:00Z');
      const end = new Date(last + 'T00:00:00Z');
      while (cur <= end) {
        const ds = cur.toISOString().slice(0, 10);
        result.push({ name: ds.slice(5), count: dateMap[ds] ?? 0 });
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
      return result;
    }
    const result: { name: string; count: number }[] = [];
    let ws = new Date(first + 'T00:00:00Z');
    const end = new Date(last + 'T00:00:00Z');
    while (ws <= end) {
      const we = new Date(ws); we.setUTCDate(we.getUTCDate() + 6);
      if (we > end) we.setTime(end.getTime());
      const wsStr = ws.toISOString().slice(0, 10), weStr = we.toISOString().slice(0, 10);
      const count = Object.entries(dateMap).filter(([ds]) => ds >= wsStr && ds <= weStr).reduce((s, [, c]) => s + c, 0);
      result.push({ name: weStr.slice(5), count });
      ws.setUTCDate(ws.getUTCDate() + 7);
    }
    return result;
  }, [itemRows]);

  // 리뷰 점수 분포
  const reviewScoreDist = React.useMemo(() => {
    const bins = [0, 0, 0, 0, 0];
    for (const item of itemRows) {
      if (item.review_score == null) continue;
      const s = item.review_score;
      if      (s < 60) bins[0]++;
      else if (s < 70) bins[1]++;
      else if (s < 80) bins[2]++;
      else if (s < 90) bins[3]++;
      else             bins[4]++;
    }
    return ['<60%', '60~70', '70~80', '80~90', '90%+'].map((name, i) => ({ name, count: bins[i] }));
  }, [itemRows]);

  // 할인율 구간별 품절율
  const soldOutByDiscount = React.useMemo(() => {
    const binEdges  = [10, 20, 30, 40, 50, Infinity];
    const binLabels = ['~10%', '~20%', '~30%', '~40%', '~50%', '50%+'];
    const total = new Array(6).fill(0) as number[];
    const sold  = new Array(6).fill(0) as number[];
    for (const item of itemRows) {
      const dr = item.discount_rate != null ? parseFloat(item.discount_rate) : 0;
      for (let i = 0; i < binEdges.length; i++) {
        if (dr < binEdges[i]) { total[i]++; if (item.is_sold_out) sold[i]++; break; }
      }
    }
    return binLabels.map((name, i) => ({ name, pct: total[i] > 0 ? Math.round(sold[i] / total[i] * 100) : 0, total: total[i] }));
  }, [itemRows]);

  // 할인율 구간별 평균 리뷰점수
  const reviewByDiscount = React.useMemo(() => {
    const binEdges  = [10, 20, 30, 40, 50, Infinity];
    const binLabels = ['~10%', '~20%', '~30%', '~40%', '~50%', '50%+'];
    const scores: number[][] = Array.from({ length: 6 }, () => []);
    for (const item of itemRows) {
      if (item.review_score == null || item.discount_rate == null) continue;
      const dr = parseFloat(item.discount_rate);
      for (let i = 0; i < binEdges.length; i++) {
        if (dr < binEdges[i]) { scores[i].push(item.review_score); break; }
      }
    }
    return binLabels.map((name, i) => ({
      name,
      avg: scores[i].length > 0 ? Math.round(scores[i].reduce((a, v) => a + v, 0) / scores[i].length) : 0,
    }));
  }, [itemRows]);

  // 브랜드명 → brand ID (링크용)
  const brandNameToId = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const item of itemRows) {
      if (item.musinsa_brand_name && item.musinsa_brand_slug) {
        const id = brandIdMap.get(item.musinsa_brand_slug);
        if (id) m.set(item.musinsa_brand_name, id);
      }
    }
    return m;
  }, [itemRows, brandIdMap]);

  // 브랜드별 평균 할인율 TOP 8
  const brandAvgDrTop = React.useMemo((): { name: string; avg: number }[] => {
    const m: Record<string, number[]> = {};
    for (const item of itemRows) {
      if (!item.musinsa_brand_name || item.discount_rate == null) continue;
      if (!m[item.musinsa_brand_name]) m[item.musinsa_brand_name] = [];
      m[item.musinsa_brand_name].push(parseFloat(item.discount_rate));
    }
    return Object.entries(m)
      .map(([name, rates]) => ({ name, avg: Math.round(rates.reduce((a, v) => a + v, 0) / rates.length) }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 8);
  }, [itemRows]);

  // 브랜드별 품절율 TOP 8 (3건 이상 노출된 브랜드만)
  const brandSoldOutPct = React.useMemo((): { name: string; pct: number; total: number }[] => {
    const m: Record<string, { total: number; sold: number }> = {};
    for (const item of itemRows) {
      const b = item.musinsa_brand_name;
      if (!b) continue;
      if (!m[b]) m[b] = { total: 0, sold: 0 };
      m[b].total++;
      if (item.is_sold_out) m[b].sold++;
    }
    return Object.entries(m)
      .filter(([, { total }]) => total >= 3)
      .map(([name, { total, sold }]) => ({ name, pct: Math.round(sold / total * 100), total }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 8);
  }, [itemRows]);

  // 타입별 품절율
  const soldOutByType = React.useMemo(() => {
    const promoTypeMap = new Map(promoRows.map((p: any) => [p.id, p.promotion_type]));
    const m: Record<string, { total: number; sold: number }> = {};
    for (const item of itemRows) {
      const type = promoTypeMap.get(item.promotion_id);
      if (!type) continue;
      if (!m[type]) m[type] = { total: 0, sold: 0 };
      m[type].total++;
      if (item.is_sold_out) m[type].sold++;
    }
    return Object.entries(m)
      .map(([type, { total, sold }]) => ({ name: TYPE_LABEL[type] ?? type, pct: total > 0 ? Math.round(sold / total * 100) : 0, total }))
      .sort((a, b) => b.pct - a.pct);
  }, [promoRows, itemRows]);

  // 프로모션 지속기간 분포 (snapshot_date → end_at)
  const promoDurationDist = React.useMemo(() => {
    const bins = [0, 0, 0, 0, 0];
    for (const p of promoRows) {
      if (!p.end_at) continue;
      const days = Math.ceil((new Date(p.end_at).getTime() - new Date(p.snapshot_date + 'T00:00:00Z').getTime()) / 86400000);
      if      (days <= 3)  bins[0]++;
      else if (days <= 7)  bins[1]++;
      else if (days <= 14) bins[2]++;
      else if (days <= 30) bins[3]++;
      else                 bins[4]++;
    }
    return ['~3일', '~7일', '~14일', '~30일', '30일+'].map((name, i) => ({ name, count: bins[i] }));
  }, [promoRows]);

  // 시간대별 종료 패턴 (4시간 단위)
  const endHourDist = React.useMemo(() => {
    const hours = new Array(24).fill(0) as number[];
    for (const p of promoRows) {
      if (!p.end_at) continue;
      hours[new Date(p.end_at).getHours()]++;
    }
    return Array.from({ length: 6 }, (_, i) => ({
      name: `${String(i * 4).padStart(2, '0')}시`,
      count: hours[i * 4] + hours[i * 4 + 1] + hours[i * 4 + 2] + hours[i * 4 + 3],
    }));
  }, [promoRows]);

  // 리뷰점수 vs 할인율 산점도
  const reviewVsDiscount = React.useMemo(() =>
    itemRows
      .filter(i => i.review_score != null && i.discount_rate != null)
      .map(i => ({ x: Math.round(parseFloat(i.discount_rate)), y: i.review_score as number }))
      .slice(0, 500),
  [itemRows]);

  // 성별 × 카테고리 히트맵
  const genderCatHeatmap = React.useMemo(() => {
    if (statsProductMap.size === 0 || itemRows.length === 0) return null;
    const catCounts: Record<string, number> = {};
    for (const item of itemRows as any[]) {
      const p = item.product_id ? statsProductMap.get(item.product_id) : null;
      const cat = p?.category_d2_name ?? '미분류';
      catCounts[cat] = (catCounts[cat] ?? 0) + 1;
    }
    const topCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k]) => k);
    const GENDERS = ['M', 'F', 'A', 'null'];
    const GENDER_LABELS: Record<string, string> = { M: '남성', F: '여성', A: '전체', 'null': '미확인' };
    const matrix: Record<string, Record<string, number>> = {};
    for (const item of itemRows as any[]) {
      const p = item.product_id ? statsProductMap.get(item.product_id) : null;
      const cat = p?.category_d2_name ?? '미분류';
      if (!topCats.includes(cat)) continue;
      const gKey = p?.gender ?? 'null';
      if (!matrix[gKey]) matrix[gKey] = {};
      matrix[gKey][cat] = (matrix[gKey][cat] ?? 0) + 1;
    }
    const hmMax = Math.max(...GENDERS.flatMap(g => topCats.map(c => matrix[g]?.[c] ?? 0)), 1);
    return { topCats, GENDERS, GENDER_LABELS, matrix, hmMax };
  }, [itemRows, statsProductMap]);

  if (loading) return (
    <div className="panel" style={{ padding: 48, color: 'var(--f4)', textAlign: 'center', fontSize: 13 }}>
      통계 로딩중…
    </div>
  );

  const totalPromos  = promoRows.length;
  const totalItems   = itemRows.length;
  const truncated    = itemTotal > ITEM_LIMIT;
  const topBrand     = brandCounts[0];
  const maxBrandCnt  = topBrand?.[1] ?? 1;
  const maxTypeAvg   = typeAvgDiscount[0]?.avg ?? 1;
  const {
    discountBins, avgDiscount, medianDiscount, maxDiscount,
    highPct, soldOutPct, noDrPct, uniqueBrands, avgReviewScore, dupItemCount,
  } = itemStats;
  const maxBin       = Math.max(...discountBins, 1);
  const maxTime      = Math.max(...timeSeriesData.map(d => d.count), 1);
  const maxWeekday   = Math.max(...weekdayCounts, 1);
  const avgItemsPerPromo = totalPromos > 0 ? Math.round(totalItems / totalPromos) : null;

  const typeTotal    = Object.values(promosByType).reduce((a, b) => a + b, 0);
  const typeDistPct  = Object.entries(TYPE_LABEL).map(([k, label]) => {
    const count = promosByType[k] ?? 0;
    return { key: k, label, pct: typeTotal > 0 ? Math.round(count / typeTotal * 100) : 0, count };
  }).sort((a, b) => b.count - a.count);
  const topTypePct   = typeDistPct[0] ?? { label: '—', pct: 0, key: '', count: 0 };

  const BIN_LABELS    = ['~5%','~10%','~15%','~20%','~25%','~30%','~40%','~50%','50%+'];
  const WEEKDAY_LABELS = ['일','월','화','수','목','금','토'];

  const TOOLTIP_STYLE = {
    contentStyle: { background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, fontSize: 11, fontFamily: 'var(--mono)' },
    labelStyle:   { color: 'var(--f3)' },
    itemStyle:    { color: 'var(--f1)' },
  };
  const AXIS_TICK = { fontSize: 9, fill: 'var(--f4)', fontFamily: 'var(--mono)' } as const;

  return (
    <>
      {/* 헤더 */}
      <div className="row-flex between center">
        <div className="row-flex center gap-8">
          <h2 style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>프로모션 통계</h2>
          {truncated && (
            <span style={{ fontSize: 10, color: 'var(--warn, #f0a500)', background: 'var(--snk)', padding: '1px 6px', borderRadius: 3 }}>
              * 상위 {ITEM_LIMIT.toLocaleString()}건 기준 (전체 {itemTotal.toLocaleString()}건)
            </span>
          )}
        </div>
        <div className="row-flex gap-4 wrap">
          {(['오늘', '어제', '이번주', '지난주', '30D', '90D', '180D', '1Y'] as StatsWin[]).map(w => (
            <button key={w} className={`btn sm ${win === w ? 'active' : ''}`} onClick={() => setWin(w)}>{w}</button>
          ))}
        </div>
      </div>

      {/* KPI Row 1 — 프로모션 개요 */}
      <div className="grid grid-5 gap-8">
        {([
          ['프로모션 수',      totalPromos > 0 ? totalPromos.toLocaleString() + '건' : '—',              win + ' 기간 내'],
          ['현재 활성',        activePromos > 0 ? activePromos + '건' : '0건',                           '미종료 프로모션'],
          ['상품 노출',        totalItems  > 0 ? totalItems.toLocaleString()  + '건' : '—',             '중복 포함'],
          ['반복 노출 상품',   dupItemCount > 0 ? dupItemCount.toLocaleString() + '개' : '0개',         '2회+ 등장'],
          ['건당 평균 상품',   avgItemsPerPromo != null ? avgItemsPerPromo.toLocaleString() + '개' : '—', '프로모션당'],
        ] as [string, string, string][]).map(([label, val, sub], i) => (
          <div key={i} className="kpi">
            <span className="label">{label}</span>
            <div className="val">{val}</div>
            <div className="dlt"><span className="muted">{sub}</span></div>
          </div>
        ))}
      </div>

      {/* KPI Row 2 — 할인 지표 */}
      <div className="grid grid-5 gap-8">
        {([
          ['평균 할인율',     avgDiscount    != null ? `−${avgDiscount.toFixed(1)}%` : '—',    '할인 상품 기준'],
          ['중위 할인율',     medianDiscount != null ? `−${medianDiscount.toFixed(1)}%` : '—', '50th 퍼센타일'],
          ['최대 할인율',     maxDiscount    != null ? `−${maxDiscount}%` : '—',               '최고 단일 할인'],
          ['고할인 (≥30%)', totalItems > 0 ? `${highPct}%` : '—',                             '전체 상품 대비'],
          ['할인 없음',       totalItems > 0 ? `${noDrPct}%` : '—',                            '할인율 0 또는 미집계'],
        ] as [string, string, string][]).map(([label, val, sub], i) => (
          <div key={i} className="kpi">
            <span className="label">{label}</span>
            <div className="val">{val}</div>
            <div className="dlt"><span className="muted">{sub}</span></div>
          </div>
        ))}
      </div>

      {/* KPI Row 3 — 품질 지표 */}
      <div className="grid grid-5 gap-8">
        {([
          ['품절 비율',        totalItems > 0 ? `${soldOutPct}%` : '—',                                     '노출 상품 중'],
          ['평균 리뷰 점수',   avgReviewScore != null ? `${avgReviewScore}%` : '—',                         '리뷰 있는 상품'],
          ['고유 브랜드 수',   uniqueBrands > 0 ? uniqueBrands.toLocaleString() + '개' : '—',              '기간 내 노출'],
          ['주요 타입',        topTypePct.count > 0 ? `${topTypePct.label} ${topTypePct.pct}%` : '—',      '최다 프로모션'],
          ['최다 노출 브랜드', topBrand ? topBrand[0] : '—',                                                topBrand ? `${topBrand[1]}건` : ''],
        ] as [string, string, string][]).map(([label, val, sub], i) => (
          <div key={i} className="kpi">
            <span className="label">{label}</span>
            <div className="val" style={{ fontSize: i >= 3 ? 13 : undefined }}>{val}</div>
            <div className="dlt"><span className="muted">{sub}</span></div>
          </div>
        ))}
      </div>

      {/* 시계열 + 할인폭 */}
      <div className="grid grid-2 gap-12">
        <section className="panel">
          <div className="sec-head">
            <h3>프로모션 수 추이 <span className="sub">{granularity} · {totalPromos}건</span></h3>
          </div>
          <div style={{ width: '100%', height: 130 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={timeSeriesData} margin={{ top: 4, right: 0, left: -22, bottom: 0 }}>
                <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis hide domain={[0, maxTime]} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [`${v}건`, '프로모션']} />
                <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                  {timeSeriesData.map((_, idx) => (
                    <RCell key={idx} fill={idx === timeSeriesData.length - 1 ? 'var(--hs)' : 'var(--f3)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel">
          <div className="sec-head">
            <h3>할인폭 분포 <span className="sub">상품 기준 · {totalItems.toLocaleString()}건</span></h3>
          </div>
          <div style={{ width: '100%', height: 130 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={BIN_LABELS.map((name, i) => ({ name, count: discountBins[i] }))}
                margin={{ top: 4, right: 0, left: -22, bottom: 0 }}>
                <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis hide domain={[0, maxBin]} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [`${v}건`, '상품 수']} />
                <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                  {discountBins.map((cnt, idx) => (
                    <RCell key={idx} fill={cnt === maxBin && maxBin > 0 ? 'var(--hs)' : 'var(--f3)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* 하단 3열 */}
      <div className="grid grid-3 gap-12">

        {/* 타입 분포 */}
        <section className="panel">
          <div className="sec-head">
            <h3>타입 분포 <span className="sub">총 {totalPromos}건</span></h3>
          </div>
          {totalPromos === 0 ? (
            <span className="dim" style={{ fontSize: 12 }}>데이터 없음</span>
          ) : (
            <div className="row-flex center gap-12">
              <Donut size={80} percent={topTypePct.pct} label={`${topTypePct.pct}%`} sub={topTypePct.label} />
              <div className="flex-1">
                {typeDistPct.map(({ key, label, pct, count }) => (
                  <div key={key} className="row-flex between center" style={{ padding: '4px 0' }}>
                    <span style={{ fontSize: 11, color: 'var(--f2)', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span className={`sev ${TYPE_SEV[key]}`} style={{ lineHeight: 1 }}><span className="pip" /></span>
                      {label}
                    </span>
                    <span className="mono dim" style={{ fontSize: 10 }}>{count} · {pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* 브랜드 TOP 8 */}
        <section className="panel">
          <div className="sec-head"><h3>브랜드 TOP 8 <span className="sub">노출 상품 수</span></h3></div>
          {brandCounts.length === 0 ? (
            <span className="dim" style={{ fontSize: 12 }}>데이터 없음</span>
          ) : brandCounts.map(([name, count], i) => {
            const bId = brandNameToId.get(name as string);
            return (
              <div key={i} className="row-flex center gap-8" style={{ padding: '3px 0' }}>
                <span style={{ width: 14, fontSize: 10, color: 'var(--f4)', textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                <span
                  style={{ flex: 1, fontSize: 11, color: bId ? 'var(--hs)' : 'var(--f2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: bId ? 'pointer' : 'default' }}
                  onClick={() => bId && router.push(`/brand?id=${bId}`)}>
                  {name}
                </span>
                <HBar value={count as number} max={maxBrandCnt} accent={i === 0} w={70} />
                <span className="mono dim" style={{ fontSize: 10, width: 28, textAlign: 'right' }}>{count}</span>
              </div>
            );
          })}
        </section>

        {/* 타입별 평균 할인율 */}
        <section className="panel">
          <div className="sec-head"><h3>타입별 평균 할인율</h3></div>
          {typeAvgDiscount.length === 0 ? (
            <span className="dim" style={{ fontSize: 12 }}>데이터 없음</span>
          ) : typeAvgDiscount.map(({ name, avg, count }, i) => (
            <div key={i} className="row-flex center gap-8" style={{ padding: '5px 0' }}>
              <span style={{ flex: 1, fontSize: 11, color: 'var(--f2)' }}>{name}</span>
              <HBar value={avg} max={maxTypeAvg} accent={i === 0} w={70} />
              <span className="mono" style={{ fontSize: 10, width: 38, textAlign: 'right', color: avg >= 30 ? 'var(--dn)' : 'var(--f3)', fontWeight: avg >= 30 ? 600 : 400 }}>
                −{Math.round(avg)}%
              </span>
            </div>
          ))}
        </section>

      </div>

      {/* 종료 요일 + 요약 */}
      <div className="grid grid-2 gap-12">

        <section className="panel">
          <div className="sec-head">
            <h3>종료 요일 패턴 <span className="sub">end_at 기준</span></h3>
          </div>
          <div style={{ width: '100%', height: 110 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={WEEKDAY_LABELS.map((d, i) => ({ name: d, count: weekdayCounts[i] }))}
                margin={{ top: 4, right: 0, left: -22, bottom: 0 }}>
                <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [`${v}건`, '종료 프로모션']} />
                <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                  {weekdayCounts.map((cnt, i) => (
                    <RCell key={i} fill={cnt === maxWeekday && maxWeekday > 0 ? 'var(--hs)' : 'var(--f3)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel surface">
          <div className="sec-head"><h3>요약</h3></div>
          {totalPromos === 0 ? (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--f4)' }}>수집된 데이터가 없습니다.</p>
          ) : (
            <div className="col-flex gap-6" style={{ fontSize: 12, color: 'var(--f2)', lineHeight: 1.65 }}>
              <div>
                <span className="mono dim">{win} 기간 내 </span>
                <span style={{ fontWeight: 500 }}>{totalPromos}건</span> 프로모션,
                상품 노출 <span style={{ fontWeight: 500 }}>{totalItems.toLocaleString()}건</span>
              </div>
              <div>
                평균 할인율 <span className="hs" style={{ fontWeight: 500 }}>
                  {avgDiscount != null ? `−${avgDiscount.toFixed(1)}%` : '—'}
                </span> ·
                고할인(≥30%) 상품 <span style={{ fontWeight: 500 }}>{highPct}%</span>
              </div>
              {topTypePct.count > 0 && (
                <div>
                  <span className={`sev ${TYPE_SEV[topTypePct.key]}`}><span className="pip" />{topTypePct.label}</span>
                  {' '}유형이 {topTypePct.pct}%로 최다
                </div>
              )}
              {topBrand && (
                <div>
                  최다 노출 브랜드:
                  <span style={{ fontWeight: 500 }}> {topBrand[0]}</span> ({topBrand[1]}건)
                </div>
              )}
              {weekdayCounts.reduce((a, b) => a + b, 0) > 0 && (() => {
                const peakDay = WEEKDAY_LABELS[weekdayCounts.indexOf(maxWeekday)];
                return <div>프로모션 종료 집중 요일: <span style={{ fontWeight: 500 }}>{peakDay}요일</span></div>;
              })()}
            </div>
          )}
        </section>

      </div>

      {/* ── 추가 차트 10개 ────────────────────────────────────── */}

      {/* 상품 노출 추이 + 리뷰 점수 분포 */}
      <div className="grid grid-2 gap-12">
        <section className="panel">
          <div className="sec-head">
            <h3>상품 노출 추이 <span className="sub">{granularity} · {totalItems.toLocaleString()}건</span></h3>
          </div>
          <div style={{ width: '100%', height: 110 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={itemTimeSeriesData} margin={{ top: 4, right: 0, left: -22, bottom: 0 }}>
                <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis hide />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [`${v.toLocaleString()}건`, '상품 노출']} />
                <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                  {itemTimeSeriesData.map((_, idx) => (
                    <RCell key={idx} fill={idx === itemTimeSeriesData.length - 1 ? 'var(--hs)' : 'var(--f3)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel">
          <div className="sec-head">
            <h3>리뷰 점수 분포 <span className="sub">{itemRows.filter(i => i.review_score != null).length}건</span></h3>
          </div>
          <div style={{ width: '100%', height: 110 }}>
            {(() => {
              const maxV = Math.max(...reviewScoreDist.map(d => d.count), 1);
              return (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={reviewScoreDist} margin={{ top: 4, right: 0, left: -22, bottom: 0 }}>
                    <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [`${v}건`, '상품 수']} />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                      {reviewScoreDist.map((entry, idx) => (
                        <RCell key={idx} fill={entry.count === maxV && maxV > 0 ? 'var(--hs)' : 'var(--f3)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              );
            })()}
          </div>
        </section>
      </div>

      {/* 할인율 구간별 품절율 + 타입별 품절율 + 프로모션 지속기간 */}
      <div className="grid grid-3 gap-12">
        <section className="panel">
          <div className="sec-head">
            <h3>할인율 구간별 품절율</h3>
          </div>
          <div style={{ width: '100%', height: 110 }}>
            {(() => {
              const maxV = Math.max(...soldOutByDiscount.map(d => d.pct), 1);
              return (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={soldOutByDiscount} margin={{ top: 4, right: 0, left: -22, bottom: 0 }}>
                    <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                    <YAxis hide domain={[0, 100]} />
                    <Tooltip {...TOOLTIP_STYLE} formatter={(v: any, _: any, p: any) => [`${v}% (${p.payload.total}건)`, '품절율']} />
                    <Bar dataKey="pct" radius={[2, 2, 0, 0]}>
                      {soldOutByDiscount.map((entry, idx) => (
                        <RCell key={idx} fill={entry.pct === maxV && maxV > 0 ? 'var(--hs)' : 'var(--f3)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              );
            })()}
          </div>
        </section>

        <section className="panel">
          <div className="sec-head">
            <h3>타입별 품절율</h3>
          </div>
          {soldOutByType.length === 0 ? (
            <span className="dim" style={{ fontSize: 12 }}>데이터 없음</span>
          ) : (
            <div style={{ width: '100%', height: 110 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={soldOutByType} margin={{ top: 4, right: 0, left: -22, bottom: 0 }}>
                  <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis hide domain={[0, 100]} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: any, _: any, p: any) => [`${v}% (${p.payload.total}건)`, '품절율']} />
                  <Bar dataKey="pct" fill="var(--f3)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="sec-head">
            <h3>프로모션 지속기간 <span className="sub">end_at 기준</span></h3>
          </div>
          <div style={{ width: '100%', height: 110 }}>
            {(() => {
              const maxV = Math.max(...promoDurationDist.map(d => d.count), 1);
              return (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={promoDurationDist} margin={{ top: 4, right: 0, left: -22, bottom: 0 }}>
                    <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [`${v}건`, '프로모션']} />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                      {promoDurationDist.map((entry, idx) => (
                        <RCell key={idx} fill={entry.count === maxV && maxV > 0 ? 'var(--hs)' : 'var(--f3)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              );
            })()}
          </div>
        </section>
      </div>

      {/* 브랜드별 평균 할인율 + 브랜드별 품절율 + 시간대별 종료 */}
      <div className="grid grid-3 gap-12">
        <section className="panel">
          <div className="sec-head">
            <h3>브랜드별 평균 할인율 <span className="sub">TOP 8</span></h3>
          </div>
          {brandAvgDrTop.length === 0 ? (
            <span className="dim" style={{ fontSize: 12 }}>데이터 없음</span>
          ) : brandAvgDrTop.map(({ name, avg }, i) => {
            const bId = brandNameToId.get(name);
            return (
              <div key={i} className="row-flex center gap-8" style={{ padding: '3px 0' }}>
                <span style={{ width: 14, fontSize: 10, color: 'var(--f4)', textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                <span
                  style={{ flex: 1, fontSize: 11, color: bId ? 'var(--hs)' : 'var(--f2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: bId ? 'pointer' : 'default' }}
                  onClick={() => bId && router.push(`/brand?id=${bId}`)}>
                  {name}
                </span>
                <HBar value={avg} max={brandAvgDrTop[0]?.avg ?? 1} accent={i === 0} w={60} />
                <span className="mono dim" style={{ fontSize: 10, width: 32, textAlign: 'right' }}>−{avg}%</span>
              </div>
            );
          })}
        </section>

        <section className="panel">
          <div className="sec-head">
            <h3>브랜드별 품절율 <span className="sub">TOP 8 · 3건+</span></h3>
          </div>
          {brandSoldOutPct.length === 0 ? (
            <span className="dim" style={{ fontSize: 12 }}>데이터 없음</span>
          ) : brandSoldOutPct.map(({ name, pct, total }, i) => {
            const bId = brandNameToId.get(name);
            return (
              <div key={i} className="row-flex center gap-8" style={{ padding: '3px 0' }}>
                <span style={{ width: 14, fontSize: 10, color: 'var(--f4)', textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                <span
                  style={{ flex: 1, fontSize: 11, color: bId ? 'var(--hs)' : 'var(--f2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: bId ? 'pointer' : 'default' }}
                  onClick={() => bId && router.push(`/brand?id=${bId}`)}>
                  {name}
                </span>
                <HBar value={pct} max={brandSoldOutPct[0]?.pct ?? 1} accent={i === 0} w={60} />
                <span className="mono dim" style={{ fontSize: 10, width: 44, textAlign: 'right' }}>{pct}% · {total}</span>
              </div>
            );
          })}
        </section>

        <section className="panel">
          <div className="sec-head">
            <h3>시간대별 종료 패턴 <span className="sub">4시간 단위</span></h3>
          </div>
          <div style={{ width: '100%', height: 110 }}>
            {(() => {
              const maxV = Math.max(...endHourDist.map(d => d.count), 1);
              return (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={endHourDist} margin={{ top: 4, right: 0, left: -22, bottom: 0 }}>
                    <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [`${v}건`, '종료']} />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                      {endHourDist.map((entry, idx) => (
                        <RCell key={idx} fill={entry.count === maxV && maxV > 0 ? 'var(--hs)' : 'var(--f3)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              );
            })()}
          </div>
        </section>
      </div>

      {/* 리뷰점수 vs 할인율 산점도 + 할인율 구간별 평균 리뷰점수 */}
      <div className="grid grid-2 gap-12">
        <section className="panel">
          <div className="sec-head">
            <h3>리뷰점수 vs 할인율 <span className="sub">{reviewVsDiscount.length}건</span></h3>
          </div>
          <div style={{ width: '100%', height: 130 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                <XAxis dataKey="x" type="number" name="할인율" unit="%" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis dataKey="y" type="number" name="리뷰점수" unit="%" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <Tooltip {...TOOLTIP_STYLE} cursor={{ strokeDasharray: '3 3', stroke: 'var(--bd)' }}
                  formatter={(v: any) => [`${v}%`]} />
                <Scatter data={reviewVsDiscount} fill="var(--hs)" fillOpacity={0.4} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel">
          <div className="sec-head">
            <h3>할인율 구간별 평균 리뷰점수</h3>
          </div>
          <div style={{ width: '100%', height: 130 }}>
            {(() => {
              const maxV = Math.max(...reviewByDiscount.map(d => d.avg), 1);
              return (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={reviewByDiscount} margin={{ top: 4, right: 0, left: -22, bottom: 0 }}>
                    <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                    <YAxis hide domain={[0, 100]} />
                    <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [`${v}%`, '평균 리뷰점수']} />
                    <Bar dataKey="avg" radius={[2, 2, 0, 0]}>
                      {reviewByDiscount.map((entry, idx) => (
                        <RCell key={idx} fill={entry.avg === maxV && maxV > 0 ? 'var(--hs)' : 'var(--f3)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              );
            })()}
          </div>
        </section>
      </div>

      {/* 성별 × 카테고리 히트맵 */}
      {genderCatHeatmap && (
        <section className="panel">
          <div className="sec-head">
            <h3>성별 × 카테고리 히트맵 <span className="sub">상품 노출 건수</span></h3>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ padding: '4px 8px', color: 'var(--f4)', fontWeight: 400, textAlign: 'left', fontSize: 10, minWidth: 60 }} />
                  {genderCatHeatmap.topCats.map(cat => (
                    <th key={cat} style={{ padding: '4px 6px', color: 'var(--f3)', fontWeight: 400, textAlign: 'center', fontSize: 10, whiteSpace: 'nowrap' }}>{cat}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {genderCatHeatmap.GENDERS.map(g => {
                  const row = genderCatHeatmap.matrix[g] ?? {};
                  const rowTotal = genderCatHeatmap.topCats.reduce((s, c) => s + (row[c] ?? 0), 0);
                  if (rowTotal === 0) return null;
                  return (
                    <tr key={g}>
                      <td style={{ padding: '3px 8px', color: 'var(--f3)', fontWeight: 500, fontSize: 11, whiteSpace: 'nowrap' }}>
                        {genderCatHeatmap.GENDER_LABELS[g]}
                      </td>
                      {genderCatHeatmap.topCats.map(cat => {
                        const val = row[cat] ?? 0;
                        const intensity = val > 0 ? Math.max(0.1, val / genderCatHeatmap.hmMax) : 0;
                        return (
                          <td key={cat} style={{ padding: '2px 4px', textAlign: 'center', position: 'relative', minWidth: 52 }}>
                            {val > 0 && <div style={{ position: 'absolute', inset: 2, background: 'var(--hs)', opacity: intensity, borderRadius: 3 }} />}
                            <span style={{ position: 'relative', zIndex: 1, fontSize: 10, fontFamily: 'var(--mono)', color: intensity > 0.5 ? 'var(--bg)' : 'var(--f2)' }}>
                              {val > 0 ? val.toLocaleString() : '—'}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

    </>
  );
}
