'use client';
import React from 'react';
import { useIsMobile } from '@/hooks/useViewport';
import MobileRecommendView from './MobileRecommendView';
import { useRouter } from 'next/navigation';
import {
  BarChart, Bar, Cell as RCell, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line,
  AreaChart, Area,
  ComposedChart,
  PieChart, Pie,
  ScatterChart, Scatter, ZAxis,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  CartesianGrid,
} from 'recharts';
import { supabaseBrowser } from '@/lib/supabase/client';
import { HBar } from '@/components/ui/charts';

const sb = supabaseBrowser();

function kstDateStr(offset = 0): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  if (offset) d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

// ── 타입 ────────────────────────────────────────────────────────────────────

interface RecModule {
  id: string;
  snapshot_date: string;
  gender_filter: string;
  module_key: string;
  module_type: string;
  title: string | null;
  position: number;
  brand_tabs: string[];
  items_count: number;
}

interface RecItem {
  id: string;
  module_id: string;
  musinsa_no: string;
  brand_name: string;
  product_name: string;
  list_price: number | null;
  final_price: number | null;
  discount_rate: number | null;
  review_count: number;
  review_score: number | null;
  is_sold_out: boolean;
  position: number;
}

type Tab = 'hub' | 'stats' | 'effect';
type StatsWin = '7D' | '30D' | '90D';
type DateMode = 'today' | 'yesterday' | '3d' | '7d' | '30d' | 'custom';
type GenderFilter = 'A' | 'M' | 'F';

const GF_LABEL: Record<GenderFilter, string> = { A: '전체', M: '남성', F: '여성' };
const MODULE_TYPE_BADGE: Record<string, { label: string; hi: boolean }> = {
  CAROUSEL_TWOROW:             { label: '일반', hi: false },
  CAROUSEL_TWOROW_DYNAMIC_TAB: { label: '탭',   hi: true  },
};

const AXIS_TICK = { fontSize: 9, fill: 'var(--f4)', fontFamily: 'var(--mono)' } as const;
const TOOLTIP_STYLE = {
  contentStyle: { background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 5, fontSize: 11, fontFamily: 'var(--mono)' },
  labelStyle:   { color: 'var(--f3)' },
  itemStyle:    { color: 'var(--f1)' },
};

const HUB_MOD_GRID  = '20px 24px 1fr 46px 36px 38px';
const HUB_ITEM_GRID = '20px 24px 110px 1fr 64px 64px 44px 40px 40px 44px';
const KPI_COLORS = [
  'color-mix(in srgb, var(--chart-orange) 80%, var(--f3))',
  'var(--hs)',
  'var(--f3)',
];

// ──────────────────────────────────────────────────────────────────────────────
// RecommendHub — 분석 탭
// ──────────────────────────────────────────────────────────────────────────────

const HUB_SS_KEY = 'rhub-state-v1';

function readHubSession(): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(sessionStorage.getItem(HUB_SS_KEY) ?? '{}'); } catch { return {}; }
}

function RecommendHub() {
  const router = useRouter();

  // 세션 복구값 (마운트 시 1회)
  const ss = React.useRef(readHubSession());

  const [dateMode, setDateMode]     = React.useState<DateMode>((ss.current.dateMode as DateMode) ?? 'today');
  const [customFrom, setCustomFrom] = React.useState((ss.current.customFrom as string) ?? kstDateStr(-6));
  const [customTo, setCustomTo]     = React.useState((ss.current.customTo as string) ?? kstDateStr());
  const { fromDate, toDate } = React.useMemo(() => {
    if (dateMode === 'today')     return { fromDate: kstDateStr(),    toDate: kstDateStr() };
    if (dateMode === 'yesterday') return { fromDate: kstDateStr(-1),  toDate: kstDateStr(-1) };
    if (dateMode === '3d')        return { fromDate: kstDateStr(-2),  toDate: kstDateStr() };
    if (dateMode === '7d')        return { fromDate: kstDateStr(-6),  toDate: kstDateStr() };
    if (dateMode === '30d')       return { fromDate: kstDateStr(-29), toDate: kstDateStr() };
    return { fromDate: customFrom, toDate: customTo };
  }, [dateMode, customFrom, customTo]);
  const [gender, setGender]     = React.useState<GenderFilter>((ss.current.gender as GenderFilter) ?? 'A');
  const [modules, setModules]   = React.useState<RecModule[]>([]);
  const [items, setItems]       = React.useState<RecItem[]>([]);
  const [selModules, setSelModules] = React.useState<Set<string>>(new Set());
  const [selItems, setSelItems]     = React.useState<Set<string>>(new Set());
  const [loading, setLoading]           = React.useState(false);
  const [loadingItems, setLoadingItems] = React.useState(false);

  const [rankMap, setRankMap] = React.useState<Map<string, { rank: number | null; delta: number | null }>>(new Map());

  // 추가 필터
  const [filterModType, setFilterModType]         = React.useState<'all' | 'tab' | 'regular'>((ss.current.filterModType as 'all' | 'tab' | 'regular') ?? 'all');
  const [filterBrandKw, setFilterBrandKw]         = React.useState((ss.current.filterBrandKw as string) ?? '');
  const [filterProdKw, setFilterProdKw]           = React.useState((ss.current.filterProdKw as string) ?? '');
  const [filterMinDiscount, setFilterMinDiscount] = React.useState((ss.current.filterMinDiscount as string) ?? '');
  const [filterHideSoldOut, setFilterHideSoldOut] = React.useState((ss.current.filterHideSoldOut as boolean) ?? false);

  // 저장된 선택 모듈 ID — 모듈 로드 후 복구
  const pendingModuleIds = React.useRef<string[]>((ss.current.selModules as string[]) ?? []);
  const isFirstModuleLoad = React.useRef(true);

  // 상태 → sessionStorage 동기화
  React.useEffect(() => {
    sessionStorage.setItem(HUB_SS_KEY, JSON.stringify({
      dateMode, customFrom, customTo, gender,
      filterModType, filterBrandKw, filterProdKw, filterMinDiscount, filterHideSoldOut,
      selModules: [...selModules],
    }));
  }, [dateMode, customFrom, customTo, gender, filterModType, filterBrandKw, filterProdKw, filterMinDiscount, filterHideSoldOut, selModules]);

  // 모듈 로드
  React.useEffect(() => {
    setLoading(true);
    if (!isFirstModuleLoad.current) {
      // 날짜/성별 변경 시 선택 초기화
      setSelModules(new Set());
      pendingModuleIds.current = [];
    }
    setItems([]);
    setSelItems(new Set());
    setRankMap(new Map());
    sb.from('recommend_modules')
      .select('*')
      .gte('snapshot_date', fromDate)
      .lte('snapshot_date', toDate)
      .eq('gender_filter', gender)
      .order('position', { ascending: true })
      .limit(300)
      .then(({ data, error }) => {
        setLoading(false);
        if (error) { console.error('[recommend] modules', error); return; }
        const mods = data ?? [];
        setModules(mods);
        // 첫 로드 시 저장된 선택 복구
        if (isFirstModuleLoad.current && pendingModuleIds.current.length > 0) {
          const validIds = new Set(mods.map(m => m.id));
          const toRestore = pendingModuleIds.current.filter(id => validIds.has(id));
          if (toRestore.length > 0) setSelModules(new Set(toRestore));
          pendingModuleIds.current = [];
        }
        isFirstModuleLoad.current = false;
      });
  // 필터 3종 변경 시에만 재요청. sb·setters·ref 안정 참조
  }, [fromDate, toDate, gender]); // eslint-disable-line react-hooks/exhaustive-deps

  // 아이템 로드 (멀티 모듈)
  React.useEffect(() => {
    if (selModules.size === 0) { setItems([]); setSelItems(new Set()); return; }
    setLoadingItems(true);
    sb.from('recommend_items')
      .select('*')
      .in('module_id', [...selModules])
      .order('position', { ascending: true })
      .limit(1000)
      .then(({ data, error }) => {
        setLoadingItems(false);
        if (error) { console.error('[recommend] items', error); return; }
        setItems(data ?? []);
        setSelItems(new Set());
      });
  // selModules 변경 시에만 재요청. sb·setters 안정 참조
  }, [selModules]); // eslint-disable-line react-hooks/exhaustive-deps

  // 랭킹 데이터 (아이템 로드 후)
  React.useEffect(() => {
    if (items.length === 0) { setRankMap(new Map()); return; }
    const nos = [...new Set(items.map(it => it.musinsa_no))];
    // 추천판 수집일 기준 ±5일 범위
    const refDate = toDate;
    const rankFrom = (() => { const d = new Date(refDate); d.setDate(d.getDate() - 5); return d.toISOString().slice(0, 10); })();
    sb.from('ranking_snapshots')
      .select('musinsa_no, rank_position, snapshot_date')
      .in('musinsa_no', nos.slice(0, 300))
      .gte('snapshot_date', rankFrom)
      .lte('snapshot_date', refDate)
      .order('snapshot_date', { ascending: true })
      .limit(10000)
      .then(({ data }) => {
        const byNo: Record<string, { date: string; rank: number }[]> = {};
        for (const row of (data ?? [])) {
          if (row.rank_position == null) continue;
          if (!byNo[row.musinsa_no]) byNo[row.musinsa_no] = [];
          byNo[row.musinsa_no].push({ date: row.snapshot_date, rank: row.rank_position });
        }
        const m = new Map<string, { rank: number | null; delta: number | null }>();
        for (const [no, rows] of Object.entries(byNo)) {
          const sorted = rows.sort((a, b) => a.date.localeCompare(b.date));
          const latest = sorted[sorted.length - 1]?.rank ?? null;
          const oldest = sorted[0]?.rank ?? null;
          const delta = (latest != null && oldest != null && sorted.length > 1) ? oldest - latest : null;
          m.set(no, { rank: latest, delta });
        }
        setRankMap(m);
      });
  // items·toDate 변경 시에만 재요청. sb·setter 안정 참조
  }, [items, toDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // 모듈 타입 필터
  const displayedModules = React.useMemo(() => {
    if (filterModType === 'all') return modules;
    const isTab = filterModType === 'tab';
    return modules.filter(m => (m.module_type === 'CAROUSEL_TWOROW_DYNAMIC_TAB') === isTab);
  }, [modules, filterModType]);

  // 아이템 클라이언트 필터
  const displayedItems = React.useMemo(() => {
    let res = items;
    const bq = filterBrandKw.trim().toLowerCase();
    const pq = filterProdKw.trim().toLowerCase();
    if (bq) res = res.filter(it => (it.brand_name ?? '').toLowerCase().includes(bq));
    if (pq) res = res.filter(it => (it.product_name ?? '').toLowerCase().includes(pq));
    if (filterMinDiscount) res = res.filter(it => (it.discount_rate ?? 0) >= parseInt(filterMinDiscount));
    if (filterHideSoldOut) res = res.filter(it => !it.is_sold_out);
    return res;
  }, [items, filterBrandKw, filterProdKw, filterMinDiscount, filterHideSoldOut]);

  // 20 KPI 카드
  const kpiCards = React.useMemo(() => {
    if (selModules.size === 0) return [];
    const src = selItems.size > 0 ? displayedItems.filter(it => selItems.has(it.id)) : displayedItems;
    const selMods = modules.filter(m => selModules.has(m.id));
    const brandSet = new Set(src.map(it => it.brand_name).filter(Boolean));
    const withScore = src.filter(it => it.review_score != null);
    const withPrice = src.filter(it => it.final_price != null);
    const discList  = src.map(it => it.discount_rate ?? 0);
    const avgScore    = withScore.length > 0 ? Math.round(withScore.reduce((s, it) => s + it.review_score!, 0) / withScore.length) : null;
    const avgPrice    = withPrice.length > 0 ? Math.round(withPrice.reduce((s, it) => s + it.final_price!, 0) / withPrice.length) : null;
    const avgDisc     = src.length > 0 ? Math.round(discList.reduce((s, v) => s + v, 0) / src.length) : null;
    const soldOutCnt  = src.filter(it => it.is_sold_out).length;
    const noReviewCnt = src.filter(it => it.review_score == null).length;
    const avgPerBrand = brandSet.size > 0 ? (src.length / brandSet.size).toFixed(1) : null;
    const fmtW   = (v: number | null) => v == null ? '—' : v >= 10000 ? `${(v / 10000).toFixed(1)}만` : v.toLocaleString();
    const fmtPct = (v: number | null) => v == null ? '—' : `${v}%`;
    return [
      { g: 0, label: '노출 브랜드',   value: brandSet.size.toString(),                                                sub: avgPerBrand ? `상품당 ${avgPerBrand}개` : '' },
      { g: 0, label: '품절 상품',     value: `${soldOutCnt}개`,                                                       sub: src.length > 0 ? `${Math.round(soldOutCnt / src.length * 100)}%` : '' },
      { g: 1, label: '평균 리뷰점수', value: fmtPct(avgScore),                                                        sub: `${withScore.length}개 집계` },
      { g: 1, label: '90점+ 상품',    value: src.filter(it => (it.review_score ?? 0) >= 90).length.toString(),       sub: `/ ${withScore.length}개` },
      { g: 1, label: '리뷰없는 상품', value: noReviewCnt.toString(),                                                  sub: src.length > 0 ? `${Math.round(noReviewCnt / src.length * 100)}%` : '' },
      { g: 2, label: '평균 판매가',   value: fmtW(avgPrice),                                                         sub: '원' },
      { g: 2, label: '평균 할인율',   value: fmtPct(avgDisc),                                                        sub: '' },
      { g: 2, label: '무할인 상품',   value: src.filter(it => (it.discount_rate ?? 0) === 0).length.toString(),      sub: `/ ${src.length}개` },
      { g: 2, label: '30%+ 할인',     value: src.filter(it => (it.discount_rate ?? 0) >= 30).length.toString(),     sub: `/ ${src.length}개` },
    ].map(k => ({ ...k, color: KPI_COLORS[k.g] }));
  }, [displayedItems, selItems, selModules, modules]);

  // 차트 계산 (displayedItems 기반)
  const brandCounts = React.useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of displayedItems) {
      if (!it.brand_name) continue;
      m[it.brand_name] = (m[it.brand_name] ?? 0) + 1;
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [displayedItems]);

  const discountDist = React.useMemo(() => {
    const bins = [0, 0, 0, 0, 0, 0];
    const labels = ['0%', '~10%', '~20%', '~30%', '~40%', '40%+'];
    for (const it of displayedItems) {
      const dr = it.discount_rate ?? 0;
      if      (dr === 0)   bins[0]++;
      else if (dr < 10)    bins[1]++;
      else if (dr < 20)    bins[2]++;
      else if (dr < 30)    bins[3]++;
      else if (dr < 40)    bins[4]++;
      else                 bins[5]++;
    }
    return labels.map((name, i) => ({ name, count: bins[i] }));
  }, [displayedItems]);

  const reviewDist = React.useMemo(() => {
    const bins = [0, 0, 0, 0, 0];
    for (const it of displayedItems) {
      if (it.review_score == null) continue;
      const s = it.review_score;
      if      (s < 60) bins[0]++;
      else if (s < 70) bins[1]++;
      else if (s < 80) bins[2]++;
      else if (s < 90) bins[3]++;
      else             bins[4]++;
    }
    return ['<60', '60~70', '70~80', '80~90', '90+'].map((name, i) => ({ name, count: bins[i] }));
  }, [displayedItems]);

  const soldOutByBrand = React.useMemo(() => {
    const m: Record<string, { total: number; sold: number }> = {};
    for (const it of displayedItems) {
      if (!it.brand_name) continue;
      if (!m[it.brand_name]) m[it.brand_name] = { total: 0, sold: 0 };
      m[it.brand_name].total++;
      if (it.is_sold_out) m[it.brand_name].sold++;
    }
    return Object.entries(m)
      .filter(([, { total }]) => total >= 2)
      .map(([name, { total, sold }]) => ({ name, pct: Math.round(sold / total * 100), total }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 8);
  }, [displayedItems]);

  // ── 추가 차트용 데이터 ──────────────────────────────────────────────

  // 도넛1: 할인율 구간 비중
  const discountPie = React.useMemo(() =>
    discountDist.filter(d => d.count > 0), [discountDist]);

  // 도넛2: 품절/정상 비중
  const soldOutPie = React.useMemo(() => {
    const soldOut = displayedItems.filter(it => it.is_sold_out).length;
    return [{ name: '정상', value: displayedItems.length - soldOut }, { name: '품절', value: soldOut }];
  }, [displayedItems]);

  // 꺾은선: 포지션별 리뷰점수 + 할인율 (상위 30개)
  const positionLine = React.useMemo(() =>
    displayedItems.slice(0, 30).map(it => ({
      pos: it.position,
      score: it.review_score,
      disc: it.discount_rate ?? 0,
    })), [displayedItems]);

  // 수평 막대: 브랜드별 평균 리뷰점수
  const brandAvgScore = React.useMemo(() => {
    const m: Record<string, { sum: number; cnt: number }> = {};
    for (const it of displayedItems) {
      if (!it.brand_name || it.review_score == null) continue;
      if (!m[it.brand_name]) m[it.brand_name] = { sum: 0, cnt: 0 };
      m[it.brand_name].sum += it.review_score;
      m[it.brand_name].cnt++;
    }
    return Object.entries(m)
      .map(([name, { sum, cnt }]) => ({ name, avg: Math.round(sum / cnt) }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 8);
  }, [displayedItems]);

  // 복합: 브랜드별 상품 수 + 평균 할인율
  const brandComposed = React.useMemo(() => {
    const m: Record<string, { count: number; discSum: number }> = {};
    for (const it of displayedItems) {
      if (!it.brand_name) continue;
      if (!m[it.brand_name]) m[it.brand_name] = { count: 0, discSum: 0 };
      m[it.brand_name].count++;
      m[it.brand_name].discSum += it.discount_rate ?? 0;
    }
    return Object.entries(m)
      .map(([name, { count, discSum }]) => ({ name, count, avgDisc: Math.round(discSum / count) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [displayedItems]);

  // 스택 막대: 브랜드별 할인/무할인
  const brandDiscStack = React.useMemo(() => {
    const m: Record<string, { disc: number; none: number }> = {};
    for (const it of displayedItems) {
      if (!it.brand_name) continue;
      if (!m[it.brand_name]) m[it.brand_name] = { disc: 0, none: 0 };
      if ((it.discount_rate ?? 0) > 0) m[it.brand_name].disc++;
      else m[it.brand_name].none++;
    }
    return Object.entries(m)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => (b.disc + b.none) - (a.disc + a.none))
      .slice(0, 8);
  }, [displayedItems]);

  // 면적: 가격대별 상품 수
  const priceBuckets = React.useMemo(() => {
    const withPrice = displayedItems.filter(it => it.final_price != null);
    if (withPrice.length === 0) return [];
    const maxP = Math.max(...withPrice.map(it => it.final_price!));
    const step = Math.ceil(maxP / 8 / 10000) * 10000 || 10000;
    const buckets: Record<number, number> = {};
    for (const it of withPrice) {
      const bucket = Math.floor(it.final_price! / step) * step;
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    return Object.entries(buckets)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([price, count]) => ({
        price: Number(price) >= 10000 ? `${Number(price) / 10000}만` : String(price),
        count,
      }));
  }, [displayedItems]);

  // 산점도: 판매가 vs 리뷰점수
  const scatterData = React.useMemo(() =>
    displayedItems
      .filter(it => it.final_price != null && it.review_score != null)
      .slice(0, 120)
      .map(it => ({ x: it.final_price!, y: it.review_score! })),
    [displayedItems]);

  // 레이더: 상위 3개 브랜드 다차원 비교
  const radarChart = React.useMemo(() => {
    const m: Record<string, { count: number; scoreSum: number; scoreCnt: number; discSum: number; soldOut: number }> = {};
    for (const it of displayedItems) {
      if (!it.brand_name) continue;
      if (!m[it.brand_name]) m[it.brand_name] = { count: 0, scoreSum: 0, scoreCnt: 0, discSum: 0, soldOut: 0 };
      const s = m[it.brand_name];
      s.count++;
      if (it.review_score != null) { s.scoreSum += it.review_score; s.scoreCnt++; }
      s.discSum += it.discount_rate ?? 0;
      if (it.is_sold_out) s.soldOut++;
    }
    const top = Object.entries(m).sort((a, b) => b[1].count - a[1].count).slice(0, 3);
    if (top.length < 2) return null;
    const maxCnt = Math.max(...top.map(([, v]) => v.count), 1);
    const data = [
      { subject: '노출수', ...Object.fromEntries(top.map(([n, v]) => [n, Math.round(v.count / maxCnt * 100)])) },
      { subject: '리뷰점수', ...Object.fromEntries(top.map(([n, v]) => [n, v.scoreCnt > 0 ? Math.round(v.scoreSum / v.scoreCnt) : 0])) },
      { subject: '할인율', ...Object.fromEntries(top.map(([n, v]) => [n, Math.round(v.discSum / v.count)])) },
      { subject: '품절(역)', ...Object.fromEntries(top.map(([n, v]) => [n, 100 - Math.round(v.soldOut / v.count * 100)])) },
      { subject: '다양성', ...Object.fromEntries(top.map(([n, v]) => [n, Math.min(100, v.count * 10)])) },
    ];
    return { data, brands: top.map(([n]) => n) };
  }, [displayedItems]);

  const PIE_COLORS = ['var(--hs)', 'var(--f3)', 'var(--f2)', 'var(--f4)',
    'color-mix(in srgb, var(--hs) 60%, var(--f3))', 'color-mix(in srgb, var(--hs) 30%, var(--f3))'];
  const RADAR_COLORS = ['var(--hs)', 'var(--f2)', 'var(--f3)'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* 필터 바 */}
      <div className="panel" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '8px 12px' }}>
        <label style={{ fontSize: 11, color: 'var(--f4)', flexShrink: 0 }}>날짜</label>
        {([['today', '오늘'], ['yesterday', '어제'], ['3d', '3일'], ['7d', '7일'], ['30d', '30일'], ['custom', '직접']] as [DateMode, string][]).map(([m, l]) => (
          <button key={m} className={`btn sm ${dateMode === m ? 'active' : ''}`} onClick={() => setDateMode(m)}>{l}</button>
        ))}
        {dateMode === 'custom' && (
          <>
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              style={{ fontSize: 11, padding: '2px 6px', border: '1px solid var(--bd)', borderRadius: 5, background: 'var(--bg)', color: 'var(--f1)' }} />
            <span style={{ fontSize: 11, color: 'var(--f4)' }}>~</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              style={{ fontSize: 11, padding: '2px 6px', border: '1px solid var(--bd)', borderRadius: 5, background: 'var(--bg)', color: 'var(--f1)' }} />
          </>
        )}
        <div style={{ width: 1, height: 16, background: 'var(--bd)', flexShrink: 0 }} />

        <label style={{ fontSize: 11, color: 'var(--f4)', flexShrink: 0 }}>성별</label>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['A', 'M', 'F'] as GenderFilter[]).map(g => (
            <button key={g} className={`btn sm ${gender === g ? 'active' : ''}`} onClick={() => setGender(g)}>{GF_LABEL[g]}</button>
          ))}
        </div>
        <div style={{ width: 1, height: 16, background: 'var(--bd)', flexShrink: 0 }} />

        <label style={{ fontSize: 11, color: 'var(--f4)', flexShrink: 0 }}>모듈</label>
        {([['all', '전체'], ['tab', '탭'], ['regular', '일반']] as ['all' | 'tab' | 'regular', string][]).map(([v, l]) => (
          <button key={v} className={`btn sm ${filterModType === v ? 'active' : ''}`} onClick={() => setFilterModType(v)}>{l}</button>
        ))}
        <div style={{ width: 1, height: 16, background: 'var(--bd)', flexShrink: 0 }} />

        <input type="text" value={filterBrandKw} onChange={e => setFilterBrandKw(e.target.value)}
          placeholder="브랜드 검색…"
          style={{ width: 100, fontSize: 11, padding: '3px 7px', border: '0.5px solid var(--bs)', borderRadius: 5, background: 'var(--bg)', color: 'var(--f1)' }} />
        <input type="text" value={filterProdKw} onChange={e => setFilterProdKw(e.target.value)}
          placeholder="상품명 검색…"
          style={{ width: 110, fontSize: 11, padding: '3px 7px', border: '0.5px solid var(--bs)', borderRadius: 5, background: 'var(--bg)', color: 'var(--f1)' }} />

        <label style={{ fontSize: 11, color: 'var(--f4)', flexShrink: 0 }}>할인</label>
        <input type="number" value={filterMinDiscount} onChange={e => setFilterMinDiscount(e.target.value)}
          placeholder="최소%" min={0} max={100}
          style={{ width: 52, fontSize: 11, padding: '3px 6px', border: '0.5px solid var(--bs)', borderRadius: 5, background: 'var(--bg)', color: 'var(--f1)' }} />
        <span style={{ fontSize: 10, color: 'var(--f4)' }}>%+</span>

        <button className={`btn sm ${filterHideSoldOut ? 'active' : ''}`} onClick={() => setFilterHideSoldOut(v => !v)}>
          품절제외
        </button>

        {modules.length > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--f4)' }}>
            {selModules.size > 0 ? <span style={{ color: 'var(--hs)', fontWeight: 500 }}>{selModules.size}개 선택 · </span> : null}
            모듈 {displayedModules.length}개
          </span>
        )}
      </div>

      {/* 모듈 + 아이템 그리드 */}
      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 12 }}>

        {/* ── 모듈 목록 ── */}
        <div className="panel" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: HUB_MOD_GRID, gap: 4, alignItems: 'center',
            padding: '6px 12px', borderBottom: '1px solid var(--bd)', background: 'var(--snk)',
          }}>
            {['', '#', '제목', '타입', '탭', '상품'].map(h => (
              <span key={h} style={{ fontSize: 10, color: 'var(--f4)', fontWeight: 500 }}>{h}</span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4, padding: '4px 12px', borderBottom: '1px solid var(--bd)', background: 'var(--snk)', alignItems: 'center' }}>
            <button className="btn sm" style={{ fontSize: 10 }} onClick={() => setSelModules(new Set(displayedModules.map(m => m.id)))}>전체선택</button>
            <button className="btn sm" style={{ fontSize: 10 }} onClick={() => setSelModules(new Set())}>해제</button>
            {selModules.size > 0 && <span style={{ fontSize: 10, color: 'var(--hs)', marginLeft: 4 }}>{selModules.size}개</span>}
          </div>
          <div style={{ overflowY: 'auto', flex: 1, maxHeight: 460 }}>
            {loading ? (
              <div style={{ padding: 32, textAlign: 'center', fontSize: 12, color: 'var(--f4)' }}>로딩중…</div>
            ) : displayedModules.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', fontSize: 12, color: 'var(--f4)' }}>
                해당 날짜 데이터 없음
                <br /><span style={{ fontSize: 11, marginTop: 4, display: 'block' }}>다른 날짜를 선택해 주세요</span>
              </div>
            ) : displayedModules.map(m => {
              const badge = MODULE_TYPE_BADGE[m.module_type];
              const isSel = selModules.has(m.id);
              return (
                <div
                  key={m.id}
                  onClick={() => setSelModules(prev => { const n = new Set(prev); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })}
                  style={{
                    display: 'grid', gridTemplateColumns: HUB_MOD_GRID, gap: 4, alignItems: 'center',
                    padding: '6px 12px', cursor: 'pointer',
                    background: isSel ? 'color-mix(in srgb, var(--hs) 8%, transparent)' : 'transparent',
                    borderBottom: '1px solid var(--bd)',
                    borderLeft: isSel ? '2px solid var(--hs)' : '2px solid transparent',
                    transition: 'background 80ms',
                  }}
                  onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'var(--snk)'; }}
                  onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{
                    width: 14, height: 14, borderRadius: 3,
                    border: `1px solid ${isSel ? 'var(--hs)' : 'var(--bd)'}`,
                    background: isSel ? 'var(--hs)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--bg)', fontSize: 9, fontWeight: 700, flexShrink: 0,
                  }}>
                    {isSel && '✓'}
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', paddingTop: 1 }}>{m.position}</span>
                  <span style={{ fontSize: 11, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.title ?? undefined}>
                    {m.title ?? <span style={{ color: 'var(--f4)' }}>—</span>}
                  </span>
                  <span style={{
                    fontSize: 9, padding: '1px 4px', borderRadius: 3, alignSelf: 'center',
                    background: badge?.hi ? 'color-mix(in srgb, var(--hs) 12%, transparent)' : 'var(--snk)',
                    color: badge?.hi ? 'var(--hs)' : 'var(--f3)',
                    whiteSpace: 'nowrap',
                  }}>
                    {badge?.label ?? '—'}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--f3)', fontFamily: 'var(--mono)', paddingTop: 1, textAlign: 'center' }}>
                    {m.brand_tabs?.length > 0 ? m.brand_tabs.length : '—'}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--f3)', fontFamily: 'var(--mono)', paddingTop: 1, textAlign: 'right' }}>
                    {m.items_count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── 아이템 목록 ── */}
        <div className="panel" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: HUB_ITEM_GRID, gap: 4, alignItems: 'center',
            padding: '6px 12px', borderBottom: '1px solid var(--bd)', background: 'var(--snk)',
          }}>
            {['', '#', '브랜드', '상품명', '정가', '할인가', '할인율', '평점', '랭킹', '변동'].map(h => (
              <span key={h} style={{ fontSize: 10, color: 'var(--f4)', fontWeight: 500 }}>{h}</span>
            ))}
          </div>
          {selModules.size > 0 && (
            <div style={{ display: 'flex', gap: 4, padding: '4px 12px', borderBottom: '1px solid var(--bd)', background: 'var(--snk)', alignItems: 'center' }}>
              <button className="btn sm" style={{ fontSize: 10 }} onClick={() => setSelItems(new Set(displayedItems.map(it => it.id)))}>전체선택</button>
              <button className="btn sm" style={{ fontSize: 10 }} onClick={() => setSelItems(new Set())}>해제</button>
              {selItems.size > 0 && <span style={{ fontSize: 10, color: 'var(--hs)', marginLeft: 4 }}>{selItems.size}개 선택</span>}
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--f4)' }}>
                {selModules.size > 1 ? `${selModules.size}개 모듈 · ` : ''}{displayedItems.length}개
              </span>
            </div>
          )}
          <div style={{ overflowY: 'auto', flex: 1, maxHeight: 500 }}>
            {!selModules.size ? (
              <div style={{ padding: 40, textAlign: 'center', fontSize: 12, color: 'var(--f4)' }}>
                왼쪽에서 모듈을 클릭하면 상품 목록이 표시됩니다
              </div>
            ) : loadingItems ? (
              <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--f4)' }}>로딩중…</div>
            ) : displayedItems.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--f4)' }}>상품 없음</div>
            ) : displayedItems.map(it => {
              const isSel = selItems.has(it.id);
              return (
                <div
                  key={it.id}
                  onClick={() => setSelItems(prev => { const n = new Set(prev); if (n.has(it.id)) n.delete(it.id); else n.add(it.id); return n; })}
                  style={{
                    display: 'grid', gridTemplateColumns: HUB_ITEM_GRID, gap: 4, alignItems: 'center',
                    padding: '5px 12px', borderBottom: '1px solid var(--bd)',
                    cursor: 'pointer', transition: 'background 80ms',
                    background: isSel ? 'color-mix(in srgb, var(--hs) 7%, transparent)' : 'transparent',
                    borderLeft: isSel ? '2px solid var(--hs)' : '2px solid transparent',
                  }}
                  onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'var(--snk)'; }}
                  onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = isSel ? 'color-mix(in srgb, var(--hs) 7%, transparent)' : 'transparent'; }}
                >
                  <div style={{
                    width: 14, height: 14, borderRadius: 3,
                    border: `1px solid ${isSel ? 'var(--hs)' : 'var(--bd)'}`,
                    background: isSel ? 'var(--hs)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--bg)', fontSize: 9, fontWeight: 700, flexShrink: 0,
                  }}>
                    {isSel && '✓'}
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', paddingTop: 1 }}>{it.position}</span>
                  <span style={{ fontSize: 11, color: 'var(--f2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.brand_name}>{it.brand_name || '—'}</span>
                  <span
                    style={{ fontSize: 11, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={it.product_name}
                    onClick={e => { e.stopPropagation(); router.push(`/product?no=${it.musinsa_no}`); }}
                  >
                    {it.product_name || '—'}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--f3)', fontFamily: 'var(--mono)', textAlign: 'right' }}>
                    {it.list_price != null ? it.list_price.toLocaleString() : '—'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--f1)', fontFamily: 'var(--mono)', textAlign: 'right', fontWeight: 500 }}>
                    {it.final_price != null ? it.final_price.toLocaleString() : '—'}
                  </span>
                  <span style={{
                    fontSize: 11, fontFamily: 'var(--mono)', textAlign: 'right',
                    color: (it.discount_rate ?? 0) >= 30 ? 'var(--dn)' : 'var(--f3)',
                    fontWeight: (it.discount_rate ?? 0) >= 30 ? 600 : 400,
                  }}>
                    {it.discount_rate ? `${it.discount_rate}%` : '—'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--f2)', fontFamily: 'var(--mono)', textAlign: 'right' }}>
                    {it.review_score != null ? `${it.review_score}%` : '—'}
                  </span>
                  {(() => {
                    const ri = rankMap.get(it.musinsa_no);
                    return (
                      <>
                        <span style={{ fontSize: 11, color: 'var(--f1)', fontFamily: 'var(--mono)', textAlign: 'right' }}>
                          {ri?.rank != null ? ri.rank.toLocaleString() : '—'}
                        </span>
                        <span style={{
                          fontSize: 10, fontFamily: 'var(--mono)', textAlign: 'right',
                          color: ri?.delta == null ? 'var(--f4)' : ri.delta > 0 ? 'var(--tu)' : ri.delta < 0 ? 'var(--td)' : 'var(--f4)',
                          fontWeight: ri?.delta != null && ri.delta !== 0 ? 600 : 400,
                        }}>
                          {ri?.delta == null ? '—' : ri.delta > 0 ? `▲${ri.delta}` : ri.delta < 0 ? `▼${Math.abs(ri.delta)}` : '–'}
                        </span>
                      </>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── KPI 지표 요약 (선택 그리드 아래) ── */}
      {kpiCards.length > 0 && (
        <section className="panel" style={{ padding: '10px 14px' }}>
          <div style={{ fontSize: 11, color: 'var(--f3)', fontWeight: 500, marginBottom: 8 }}>
            지표 요약{selItems.size > 0 ? ` — 선택 ${selItems.size}개 상품 기준` : ''}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 6 }}>
            {kpiCards.map((k, i) => (
              <div key={i} style={{ padding: '7px 10px', borderRadius: 5, background: 'var(--snk)', borderLeft: `2px solid ${k.color}` }}>
                <div style={{ fontSize: 9, color: 'var(--f4)', marginBottom: 2 }}>{k.label}</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--f1)', fontFamily: 'var(--mono)' }}>{k.value}</div>
                {k.sub && <div style={{ fontSize: 9, color: 'var(--f4)', marginTop: 1 }}>{k.sub}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── 차트 섹션 ── */}
      {displayedItems.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

          {/* 1. 막대 — 브랜드 분포 (노출 상품 수) */}
          <section className="panel">
            <div className="sec-head"><h3>브랜드 분포 <span className="sub">노출 수 · TOP 8</span></h3></div>
            {brandCounts.map(([name, count], i) => (
              <div key={name} className="row-flex center gap-8" style={{ padding: '3px 0' }}>
                <span style={{ width: 14, fontSize: 10, color: 'var(--f4)', textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                <span style={{ flex: 1, fontSize: 11, color: 'var(--f2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                <HBar value={count} max={brandCounts[0]?.[1] ?? 1} accent={i === 0} w={70} />
                <span className="mono dim" style={{ fontSize: 10, width: 24, textAlign: 'right' }}>{count}</span>
              </div>
            ))}
          </section>

          {/* 2. 막대 — 리뷰점수 분포 */}
          <section className="panel">
            <div className="sec-head"><h3>리뷰점수 분포 <span className="sub">{displayedItems.filter(i => i.review_score != null).length}개</span></h3></div>
            <div style={{ width: '100%', height: 130 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={reviewDist} margin={{ top: 4, right: 0, left: -22, bottom: 0 }}>
                  <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [`${v}개`, '상품 수']} />
                  <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                    {reviewDist.map((entry, idx) => {
                      const maxV = Math.max(...reviewDist.map(d => d.count), 1);
                      return <RCell key={idx} fill={entry.count === maxV && maxV > 0 ? 'var(--hs)' : 'var(--f3)'} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* 3. 도넛 — 할인율 구간 비중 */}
          <section className="panel">
            <div className="sec-head"><h3>할인율 구간 비중 <span className="sub">도넛</span></h3></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 130, height: 130, flexShrink: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={discountPie} dataKey="count" nameKey="name" cx="50%" cy="50%"
                      innerRadius={36} outerRadius={58} paddingAngle={2}>
                      {discountPie.map((_, idx) => (
                        <RCell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [`${v}개`, '상품 수']} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {discountPie.map((d, idx) => (
                  <div key={d.name} className="row-flex center gap-6">
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: PIE_COLORS[idx % PIE_COLORS.length], flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: 'var(--f2)' }}>{d.name}</span>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--f4)' }}>{d.count}개</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* 4. 도넛 — 품절/정상 비중 */}
          <section className="panel">
            <div className="sec-head"><h3>품절 비중 <span className="sub">도넛</span></h3></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 130, height: 130, flexShrink: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={soldOutPie} dataKey="value" nameKey="name" cx="50%" cy="50%"
                      innerRadius={36} outerRadius={58} paddingAngle={3}>
                      <RCell fill="var(--hs)" />
                      <RCell fill="var(--dn)" />
                    </Pie>
                    <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [`${v}개`]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {soldOutPie.map((d, idx) => (
                  <div key={d.name} className="row-flex center gap-6">
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: idx === 0 ? 'var(--hs)' : 'var(--dn)', flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: 'var(--f2)' }}>{d.name}</span>
                    <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--f1)' }}>{d.value}개</span>
                    <span className="mono dim" style={{ fontSize: 10 }}>
                      {displayedItems.length > 0 ? `${Math.round(d.value / displayedItems.length * 100)}%` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* 5. 꺾은선 — 포지션별 리뷰점수 */}
          <section className="panel">
            <div className="sec-head"><h3>포지션별 리뷰점수 <span className="sub">상위 30개 · 꺾은선</span></h3></div>
            <div style={{ width: '100%', height: 130 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={positionLine} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
                  <XAxis dataKey="pos" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} domain={[0, 100]} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [`${v}%`, '리뷰점수']} />
                  <CartesianGrid stroke="var(--bd)" strokeDasharray="2 3" vertical={false} />
                  <Line type="monotone" dataKey="score" stroke="var(--hs)" strokeWidth={1.5}
                    dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* 6. 꺾은선 — 포지션별 할인율 */}
          <section className="panel">
            <div className="sec-head"><h3>포지션별 할인율 <span className="sub">상위 30개 · 꺾은선</span></h3></div>
            <div style={{ width: '100%', height: 130 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={positionLine} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
                  <XAxis dataKey="pos" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} unit="%" />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [`${v}%`, '할인율']} />
                  <CartesianGrid stroke="var(--bd)" strokeDasharray="2 3" vertical={false} />
                  <Line type="monotone" dataKey="disc" stroke="var(--f2)" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* 7. 수평 막대 — 브랜드별 평균 리뷰점수 */}
          <section className="panel">
            <div className="sec-head"><h3>브랜드별 평균 리뷰점수 <span className="sub">수평 막대</span></h3></div>
            <div style={{ width: '100%', height: 170 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={brandAvgScore} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
                  <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} domain={[0, 100]} unit="%" />
                  <YAxis type="category" dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} width={64} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [`${v}%`, '평균 리뷰점수']} />
                  <Bar dataKey="avg" radius={[0, 2, 2, 0]}>
                    {brandAvgScore.map((_, idx) => (
                      <RCell key={idx} fill={idx === 0 ? 'var(--hs)' : 'var(--f3)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* 8. 복합 — 브랜드별 상품 수 + 평균 할인율 */}
          <section className="panel">
            <div className="sec-head"><h3>브랜드별 상품 수 / 평균 할인율 <span className="sub">복합 차트</span></h3></div>
            <div style={{ width: '100%', height: 170 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={brandComposed} margin={{ top: 4, right: 24, left: -22, bottom: 0 }}>
                  <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="l" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="r" orientation="right" tick={AXIS_TICK} axisLine={false} tickLine={false} unit="%" />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <CartesianGrid stroke="var(--bd)" strokeDasharray="2 3" vertical={false} />
                  <Bar yAxisId="l" dataKey="count" fill="var(--f3)" radius={[2, 2, 0, 0]} name="상품 수" />
                  <Line yAxisId="r" type="monotone" dataKey="avgDisc" stroke="var(--hs)"
                    strokeWidth={2} dot={{ r: 3, fill: 'var(--hs)' }} name="평균 할인율" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* 9. 스택 막대 — 브랜드별 할인/무할인 */}
          <section className="panel">
            <div className="sec-head"><h3>브랜드별 할인/무할인 <span className="sub">스택 막대</span></h3></div>
            <div style={{ width: '100%', height: 160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={brandDiscStack} margin={{ top: 4, right: 0, left: -22, bottom: 0 }}>
                  <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Bar dataKey="disc" stackId="a" fill="var(--hs)" name="할인" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="none" stackId="a" fill="var(--f3)" name="무할인" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* 10. 면적 — 가격대별 상품 수 */}
          <section className="panel">
            <div className="sec-head"><h3>가격대별 상품 수 <span className="sub">면적 차트</span></h3></div>
            <div style={{ width: '100%', height: 160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={priceBuckets} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
                  <defs>
                    <linearGradient id="priceAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--hs)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--hs)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="price" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [`${v}개`, '상품 수']} />
                  <CartesianGrid stroke="var(--bd)" strokeDasharray="2 3" vertical={false} />
                  <Area type="monotone" dataKey="count" stroke="var(--hs)" strokeWidth={1.5}
                    fill="url(#priceAreaGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* 11. 막대 — 할인율 분포 */}
          <section className="panel">
            <div className="sec-head"><h3>할인율 분포 <span className="sub">{displayedItems.length}개 상품</span></h3></div>
            <div style={{ width: '100%', height: 130 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={discountDist} margin={{ top: 4, right: 0, left: -22, bottom: 0 }}>
                  <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [`${v}개`, '상품 수']} />
                  <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                    {discountDist.map((entry, idx) => {
                      const maxV = Math.max(...discountDist.map(d => d.count), 1);
                      return <RCell key={idx} fill={entry.count === maxV && maxV > 0 ? 'var(--hs)' : 'var(--f3)'} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* 12. 막대 — 브랜드별 품절율 */}
          <section className="panel">
            <div className="sec-head"><h3>브랜드별 품절율 <span className="sub">2개+ 노출 기준</span></h3></div>
            {soldOutByBrand.length === 0 ? (
              <span className="dim" style={{ fontSize: 12 }}>품절 없음</span>
            ) : soldOutByBrand.map(({ name, pct, total }, i) => (
              <div key={name} className="row-flex center gap-8" style={{ padding: '3px 0' }}>
                <span style={{ width: 14, fontSize: 10, color: 'var(--f4)', textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                <span style={{ flex: 1, fontSize: 11, color: 'var(--f2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                <HBar value={pct} max={soldOutByBrand[0]?.pct ?? 1} accent={i === 0} w={60} />
                <span className="mono dim" style={{ fontSize: 10, width: 44, textAlign: 'right' }}>{pct}% · {total}</span>
              </div>
            ))}
          </section>

          {/* 13. 산점도 — 판매가 vs 리뷰점수 */}
          {scatterData.length > 0 && (
            <section className="panel">
              <div className="sec-head"><h3>판매가 vs 리뷰점수 <span className="sub">산점도</span></h3></div>
              <div style={{ width: '100%', height: 160 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <XAxis type="number" dataKey="x" name="판매가" tick={AXIS_TICK} axisLine={false} tickLine={false}
                      tickFormatter={v => v >= 10000 ? `${Math.round(v / 10000)}만` : String(v)} />
                    <YAxis type="number" dataKey="y" name="리뷰점수" tick={AXIS_TICK} axisLine={false} tickLine={false}
                      domain={[0, 100]} unit="%" />
                    <ZAxis range={[20, 20]} />
                    <Tooltip {...TOOLTIP_STYLE}
                      formatter={(v: any, name: any) => [name === '판매가' ? `${v.toLocaleString()}원` : `${v}%`, name]} />
                    <CartesianGrid stroke="var(--bd)" strokeDasharray="2 3" />
                    <Scatter data={scatterData} fill="var(--hs)" fillOpacity={0.5} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* 14. 레이더 — 상위 브랜드 비교 */}
          {radarChart && (
            <section className="panel">
              <div className="sec-head"><h3>브랜드 다차원 비교 <span className="sub">레이더 · TOP {radarChart.brands.length}</span></h3></div>
              <div style={{ width: '100%', height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarChart.data} margin={{ top: 8, right: 24, left: 24, bottom: 8 }}>
                    <PolarGrid stroke="var(--bd)" />
                    <PolarAngleAxis dataKey="subject" tick={AXIS_TICK} />
                    {radarChart.brands.map((brand, idx) => (
                      <Radar key={brand} name={brand} dataKey={brand}
                        stroke={RADAR_COLORS[idx % RADAR_COLORS.length]}
                        fill={RADAR_COLORS[idx % RADAR_COLORS.length]}
                        fillOpacity={0.1} strokeWidth={1.5} />
                    ))}
                    <Tooltip {...TOOLTIP_STYLE} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              <div className="row-flex center gap-10" style={{ marginTop: 4 }}>
                {radarChart.brands.map((brand, idx) => (
                  <div key={brand} className="row-flex center gap-4">
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: RADAR_COLORS[idx % RADAR_COLORS.length] }} />
                    <span style={{ fontSize: 10, color: 'var(--f3)' }}>{brand}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// RecommendStats — 통계 탭
// ──────────────────────────────────────────────────────────────────────────────

interface StatsItem {
  snapshot_date: string;
  gender_filter: string;
  brand_name: string;
  discount_rate: number | null;
  review_score: number | null;
  is_sold_out: boolean;
  musinsa_no: string;
}

interface StatsMod {
  snapshot_date: string;
  gender_filter: string;
  title: string | null;
  position: number;
  items_count: number;
}

const STATS_DAYS: Record<StatsWin, number> = { '7D': 7, '30D': 30, '90D': 90 };

function RecommendStats() {
  const [win, setWin]         = React.useState<StatsWin>('30D');
  const [modules, setModules] = React.useState<StatsMod[]>([]);
  const [items, setItems]     = React.useState<StatsItem[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    setLoading(true);
    const cutoff = new Date(Date.now() + 9 * 60 * 60 * 1000);
    cutoff.setUTCDate(cutoff.getUTCDate() - STATS_DAYS[win]);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    Promise.all([
      sb.from('recommend_modules')
        .select('snapshot_date, gender_filter, title, position, items_count')
        .gte('snapshot_date', cutoffStr)
        .limit(5000),
      sb.from('recommend_items')
        .select('snapshot_date, gender_filter, brand_name, discount_rate, review_score, is_sold_out, musinsa_no')
        .gte('snapshot_date', cutoffStr)
        .limit(20000),
    ]).then(([{ data: mods, error: e1 }, { data: its, error: e2 }]) => {
      setLoading(false);
      if (e1) console.error('[recommend-stats] modules', e1);
      if (e2) console.error('[recommend-stats] items', e2);
      setModules((mods ?? []) as StatsMod[]);
      setItems((its ?? []) as StatsItem[]);
    });
  }, [win]);

  // ── KPI ──────────────────────────────────────────────────────
  const uniqueDates  = React.useMemo(() => new Set(modules.map(m => m.snapshot_date)).size, [modules]);
  const totalModules = modules.length;
  const totalItems   = items.length;
  const uniqueBrands = React.useMemo(() => new Set(items.map(i => i.brand_name).filter(Boolean)).size, [items]);

  const avgDiscount = React.useMemo(() => {
    const vals = items.filter(i => i.discount_rate != null && i.discount_rate > 0).map(i => i.discount_rate!);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, [items]);

  const avgReview = React.useMemo(() => {
    const vals = items.filter(i => i.review_score != null).map(i => i.review_score!);
    return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }, [items]);

  const soldOutPct = React.useMemo(() =>
    items.length > 0 ? Math.round(items.filter(i => i.is_sold_out).length / items.length * 100) : 0,
  [items]);

  // 브랜드 TOP 8 (전체 기간 누적)
  const brandTop = React.useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of items) {
      if (!it.brand_name) continue;
      m[it.brand_name] = (m[it.brand_name] ?? 0) + 1;
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [items]);

  // 반복 등장 모듈 제목 TOP 8 (전체 성별 기준, 날짜 중복 제거)
  const titleTop = React.useMemo(() => {
    const seen = new Set<string>();
    const m: Record<string, number> = {};
    for (const mod of modules) {
      if (!mod.title) continue;
      const key = `${mod.snapshot_date}|${mod.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      m[mod.title] = (m[mod.title] ?? 0) + 1;
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [modules]);

  // 일별 모듈 수 (A 성별)
  const dailyModules = React.useMemo(() => {
    const m: Record<string, number> = {};
    for (const mod of modules) {
      if (mod.gender_filter !== 'A') continue;
      m[mod.snapshot_date] = (m[mod.snapshot_date] ?? 0) + 1;
    }
    return Object.keys(m).sort().map(date => ({ name: date.slice(5), count: m[date] }));
  }, [modules]);

  // 할인율 분포
  const discountDist = React.useMemo(() => {
    const bins = [0, 0, 0, 0, 0, 0];
    const labels = ['0%', '~10%', '~20%', '~30%', '~40%', '40%+'];
    for (const it of items) {
      const dr = it.discount_rate ?? 0;
      if      (dr === 0) bins[0]++;
      else if (dr < 10)  bins[1]++;
      else if (dr < 20)  bins[2]++;
      else if (dr < 30)  bins[3]++;
      else if (dr < 40)  bins[4]++;
      else               bins[5]++;
    }
    return labels.map((name, i) => ({ name, count: bins[i] }));
  }, [items]);

  if (loading) return (
    <div className="panel" style={{ padding: 48, textAlign: 'center', fontSize: 13, color: 'var(--f4)' }}>
      통계 로딩중…
    </div>
  );

  const maxDailyMod = Math.max(...dailyModules.map(d => d.count), 1);
  const maxDiscBin  = Math.max(...discountDist.map(d => d.count), 1);

  return (
    <>
      {/* 헤더 */}
      <div className="row-flex between center">
        <h2 style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>추천판 통계</h2>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['7D', '30D', '90D'] as StatsWin[]).map(w => (
            <button key={w} className={`btn sm ${win === w ? 'active' : ''}`} onClick={() => setWin(w)}>{w}</button>
          ))}
        </div>
      </div>

      {/* KPI 행 1 */}
      <div className="grid grid-5 gap-8">
        {([
          ['수집일 수',     uniqueDates > 0 ? `${uniqueDates}일`                  : '—', `${win} 기간 내`],
          ['총 모듈 수',    totalModules > 0 ? `${totalModules.toLocaleString()}건` : '—', '3개 성별 합산'],
          ['총 노출 상품',  totalItems > 0   ? `${totalItems.toLocaleString()}건`   : '—', '중복 포함'],
          ['고유 브랜드',   uniqueBrands > 0  ? `${uniqueBrands}개`               : '—', '기간 내 노출'],
          ['품절 비율',     `${soldOutPct}%`,                                              '전체 노출 대비'],
        ] as [string, string, string][]).map(([label, val, sub], i) => (
          <div key={i} className="kpi">
            <span className="label">{label}</span>
            <div className="val">{val}</div>
            <div className="dlt"><span className="muted">{sub}</span></div>
          </div>
        ))}
      </div>

      {/* KPI 행 2 */}
      <div className="grid grid-5 gap-8">
        {([
          ['평균 할인율',     avgDiscount != null ? `−${avgDiscount.toFixed(1)}%`      : '—', '할인 상품 기준'],
          ['평균 리뷰점수',   avgReview != null   ? `${avgReview}%`                    : '—', '리뷰 있는 상품'],
          ['최다 노출 브랜드', brandTop[0]?.[0]  ?? '—', brandTop[0] ? `${brandTop[0][1]}건` : ''],
          ['반복 최다 모듈',  titleTop[0]?.[0]?.slice(0, 14) ?? '—', titleTop[0] ? `${titleTop[0][1]}일간` : ''],
          ['일평균 모듈',     uniqueDates > 0 ? `${Math.round(totalModules / 3 / uniqueDates)}개` : '—', '성별당'],
        ] as [string, string, string][]).map(([label, val, sub], i) => (
          <div key={i} className="kpi">
            <span className="label">{label}</span>
            <div className="val" style={{ fontSize: i === 3 ? 11 : undefined }}>{val}</div>
            <div className="dlt"><span className="muted">{sub}</span></div>
          </div>
        ))}
      </div>

      {/* 일별 모듈 추이 + 할인율 분포 */}
      <div className="grid grid-2 gap-12">
        <section className="panel">
          <div className="sec-head">
            <h3>일별 모듈 수 <span className="sub">전체(A) 성별 · {uniqueDates}일</span></h3>
          </div>
          <div style={{ width: '100%', height: 130 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyModules} margin={{ top: 4, right: 0, left: -22, bottom: 0 }}>
                <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis hide domain={[0, maxDailyMod]} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [`${v}개`, '모듈']} />
                <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                  {dailyModules.map((_, idx) => (
                    <RCell key={idx} fill={idx === dailyModules.length - 1 ? 'var(--hs)' : 'var(--f3)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel">
          <div className="sec-head">
            <h3>할인율 분포 <span className="sub">{totalItems.toLocaleString()}개 상품</span></h3>
          </div>
          <div style={{ width: '100%', height: 130 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={discountDist} margin={{ top: 4, right: 0, left: -22, bottom: 0 }}>
                <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis hide domain={[0, maxDiscBin]} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [`${v.toLocaleString()}개`, '상품 수']} />
                <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                  {discountDist.map((entry, idx) => (
                    <RCell key={idx} fill={entry.count === maxDiscBin && maxDiscBin > 0 ? 'var(--hs)' : 'var(--f3)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* 브랜드 TOP 8 + 반복 모듈 제목 */}
      <div className="grid grid-2 gap-12">
        <section className="panel">
          <div className="sec-head"><h3>브랜드 TOP 8 <span className="sub">기간 누적 노출</span></h3></div>
          {brandTop.length === 0 ? (
            <span className="dim" style={{ fontSize: 12 }}>데이터 없음</span>
          ) : brandTop.map(([name, count], i) => (
            <div key={name} className="row-flex center gap-8" style={{ padding: '3px 0' }}>
              <span style={{ width: 14, fontSize: 10, color: 'var(--f4)', textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
              <span style={{ flex: 1, fontSize: 11, color: 'var(--f2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
              <HBar value={count} max={brandTop[0]?.[1] ?? 1} accent={i === 0} w={70} />
              <span className="mono dim" style={{ fontSize: 10, width: 28, textAlign: 'right' }}>{count}</span>
            </div>
          ))}
        </section>

        <section className="panel">
          <div className="sec-head">
            <h3>반복 등장 모듈 제목 <span className="sub">무신사 편집팀 트렌드 메시지 · 날짜 중복 제거</span></h3>
          </div>
          {titleTop.length === 0 ? (
            <span className="dim" style={{ fontSize: 12 }}>데이터 없음</span>
          ) : titleTop.map(([title, days], i) => (
            <div key={title} className="row-flex center gap-8" style={{ padding: '3px 0' }}>
              <span style={{ width: 14, fontSize: 10, color: 'var(--f4)', textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
              <span
                style={{ flex: 1, fontSize: 11, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={title}
              >{title}</span>
              <HBar value={days} max={titleTop[0]?.[1] ?? 1} accent={i === 0} w={50} />
              <span className="mono dim" style={{ fontSize: 10, width: 30, textAlign: 'right' }}>{days}일</span>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// RecommendEffect — 랭킹 효과 탭
// ──────────────────────────────────────────────────────────────────────────────

interface EffectRow {
  rec_date: string;
  module_type: string;
  module_position: number;
  item_position: number;
  musinsa_no: string;
  brand_name: string;
  product_name: string;
  product_id: string;
  rank_before: number | null;
  rank_d1: number | null;
  rank_d3: number | null;
  rank_d7: number | null;
  delta_d1: number | null;
  delta_d3: number | null;
  delta_d7: number | null;
}

interface NewTodayRow {
  module_type: string;
  module_position: number;
  module_title: string | null;
  item_position: number;
  musinsa_no: string;
  brand_name: string;
  product_name: string;
  final_price: number | null;
  discount_rate: number | null;
  rank_yesterday: number | null;
  rank_today: number | null;
}

const MODULE_SHORT: Record<string, string> = {
  CAROUSEL_TWOROW:                       '일반',
  CAROUSEL_TWOROW_DYNAMIC_TAB:           '탭',
  CAROUSEL_TWOROW_SPECIALTY_STORE_BUTTON:'전문관',
  CAROUSEL_ONEROW_SNAPPING:              '원행',
};

const EFFECT_WIN_DAYS: Record<StatsWin, number> = { '7D': 7, '30D': 30, '90D': 90 };

const NEW_GRID = '28px 44px 110px 1fr 68px 44px 72px 72px';

function DeltaBadge({ v }: { v: number | null }) {
  if (v == null) return <span style={{ fontSize: 10, color: 'var(--f4)' }}>—</span>;
  if (v === 0)   return <span style={{ fontSize: 10, color: 'var(--f3)' }}>±0</span>;
  const up = v > 0;
  return (
    <span style={{
      fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 600,
      color: up ? 'var(--up)' : 'var(--dn)',
    }}>
      {up ? `▲${v}` : `▼${Math.abs(v)}`}
    </span>
  );
}

function RecommendEffect() {
  const router = useRouter();
  const [gender, setGender]     = React.useState<GenderFilter>('A');
  const [win, setWin]           = React.useState<StatsWin>('30D');
  const [newRows, setNewRows]   = React.useState<NewTodayRow[]>([]);
  const [effRows, setEffRows]   = React.useState<EffectRow[]>([]);
  const [loadingNew, setLoadingNew] = React.useState(false);
  const [loadingEff, setLoadingEff] = React.useState(false);

  // 오늘 신규 등장
  React.useEffect(() => {
    setLoadingNew(true);
    sb.rpc('recommend_new_today', { p_gender: gender })
      .then(({ data, error }) => {
        setLoadingNew(false);
        if (error) { console.error('[effect] new_today', error); return; }
        setNewRows((data ?? []) as NewTodayRow[]);
      });
  }, [gender]);

  // 랭킹 효과 분석
  React.useEffect(() => {
    setLoadingEff(true);
    sb.rpc('recommend_ranking_effect', { p_days: EFFECT_WIN_DAYS[win], p_gender: gender })
      .then(({ data, error }) => {
        setLoadingEff(false);
        if (error) { console.error('[effect] ranking_effect', error); return; }
        setEffRows((data ?? []) as EffectRow[]);
      });
  }, [gender, win]);

  // ── 효과 분석 계산 ──────────────────────────────────────────────
  const measurable = effRows.filter(r => r.rank_before != null);

  // 모듈 타입별 평균 delta
  const byType = React.useMemo(() => {
    const m: Record<string, { d1: number[]; d3: number[]; d7: number[]; total: number }> = {};
    for (const r of effRows) {
      if (!m[r.module_type]) m[r.module_type] = { d1: [], d3: [], d7: [], total: 0 };
      m[r.module_type].total++;
      if (r.delta_d1 != null) m[r.module_type].d1.push(r.delta_d1);
      if (r.delta_d3 != null) m[r.module_type].d3.push(r.delta_d3);
      if (r.delta_d7 != null) m[r.module_type].d7.push(r.delta_d7);
    }
    return Object.entries(m).map(([type, { d1, d3, d7, total }]) => ({
      type,
      label: MODULE_SHORT[type] ?? type,
      total,
      samples_d7: d7.length,
      avg_d1: d1.length > 0 ? Math.round(d1.reduce((a, b) => a + b, 0) / d1.length) : null,
      avg_d3: d3.length > 0 ? Math.round(d3.reduce((a, b) => a + b, 0) / d3.length) : null,
      avg_d7: d7.length > 0 ? Math.round(d7.reduce((a, b) => a + b, 0) / d7.length) : null,
      pct_up_d7: d7.length > 0 ? Math.round(d7.filter(v => v > 0).length / d7.length * 100) : null,
    })).sort((a, b) => (b.avg_d7 ?? -999) - (a.avg_d7 ?? -999));
  }, [effRows]);

  // 모듈 노출 위치별 평균 delta (0–2 최상단 / 3–6 상단 / 7+ 하단)
  const byPos = React.useMemo(() => {
    const buckets: Record<string, { d7: number[]; total: number }> = {
      '최상단 (0–2)': { d7: [], total: 0 },
      '상단 (3–6)':   { d7: [], total: 0 },
      '하단 (7+)':    { d7: [], total: 0 },
    };
    for (const r of effRows) {
      const key = r.module_position <= 2 ? '최상단 (0–2)'
                : r.module_position <= 6 ? '상단 (3–6)'
                : '하단 (7+)';
      buckets[key].total++;
      if (r.delta_d7 != null) buckets[key].d7.push(r.delta_d7);
    }
    return Object.entries(buckets).map(([label, { d7, total }]) => ({
      label,
      total,
      samples: d7.length,
      avg_d7: d7.length > 0 ? Math.round(d7.reduce((a, b) => a + b, 0) / d7.length) : null,
      pct_up:  d7.length > 0 ? Math.round(d7.filter(v => v > 0).length / d7.length * 100) : null,
    }));
  }, [effRows]);

  // 랭킹 상승 TOP 상품 (delta_d7 기준, 없으면 delta_d1)
  const topGainers = React.useMemo(() =>
    [...effRows]
      .filter(r => (r.delta_d7 ?? r.delta_d1) != null && (r.delta_d7 ?? r.delta_d1)! > 0)
      .sort((a, b) => ((b.delta_d7 ?? b.delta_d1) ?? 0) - ((a.delta_d7 ?? a.delta_d1) ?? 0))
      .slice(0, 10),
  [effRows]);

  // 오늘 신규 중 어제 랭킹 있던 상품 (이미 랭킹 있는데 추천에 등장 → 시너지 예상)
  const newWithRank = newRows.filter(r => r.rank_yesterday != null);

  // 모듈별로 묶어서 표시
  const newByModule = React.useMemo(() => {
    const m: Record<string, NewTodayRow[]> = {};
    for (const r of newRows) {
      const key = `${r.module_position}|${r.module_title ?? r.module_type}`;
      if (!m[key]) m[key] = [];
      m[key].push(r);
    }
    return Object.entries(m).sort(([a], [b]) => {
      const pa = parseInt(a.split('|')[0]);
      const pb = parseInt(b.split('|')[0]);
      return pa - pb;
    });
  }, [newRows]);

  return (
    <div className="col-flex gap-12">

      {/* 필터 바 */}
      <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px' }}>
        <label style={{ fontSize: 11, color: 'var(--f4)', flexShrink: 0 }}>성별</label>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['A', 'M', 'F'] as GenderFilter[]).map(g => (
            <button key={g} className={`btn sm ${gender === g ? 'active' : ''}`} onClick={() => setGender(g)}>
              {GF_LABEL[g]}
            </button>
          ))}
        </div>
        <div style={{ width: 1, height: 16, background: 'var(--bd)', marginLeft: 4 }} />
        <label style={{ fontSize: 11, color: 'var(--f4)', flexShrink: 0 }}>효과 측정 기간</label>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['7D', '30D', '90D'] as StatsWin[]).map(w => (
            <button key={w} className={`btn sm ${win === w ? 'active' : ''}`} onClick={() => setWin(w)}>{w}</button>
          ))}
        </div>
        {newWithRank.length > 0 && (
          <span style={{
            marginLeft: 'auto', fontSize: 11, padding: '2px 8px', borderRadius: 5,
            background: 'color-mix(in srgb, var(--hs) 10%, transparent)',
            color: 'var(--hs)', fontWeight: 500,
          }}>
            오늘 신규 {newRows.length}개 · 기존 랭킹 보유 {newWithRank.length}개
          </span>
        )}
      </div>

      {/* ── 오늘 신규 등장 ── */}
      <section className="panel" style={{ padding: 0 }}>
        <div className="sec-head" style={{ padding: '10px 14px', borderBottom: '1px solid var(--bd)' }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>
            오늘 신규 등장
            <span className="sub" style={{ marginLeft: 6 }}>
              어제 추천판에 없다가 오늘 처음 등장 · 적시 발견 포인트
            </span>
          </h3>
        </div>

        {/* 헤더 */}
        <div style={{
          display: 'grid', gridTemplateColumns: NEW_GRID, gap: 4,
          padding: '6px 14px', background: 'var(--snk)', borderBottom: '1px solid var(--bd)',
        }}>
          {['#', '타입', '브랜드', '상품명', '판매가', '할인', '어제 랭킹', '오늘 랭킹'].map(h => (
            <span key={h} style={{ fontSize: 10, color: 'var(--f4)', fontWeight: 500 }}>{h}</span>
          ))}
        </div>

        {loadingNew ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--f4)' }}>로딩중…</div>
        ) : newRows.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--f4)' }}>
            오늘 추천판 데이터 없음 (수집 전)
          </div>
        ) : (
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {newByModule.map(([key, rows]) => {
              const first = rows[0];
              const titleLine = (first.module_title ?? first.module_type).replace(/\n/g, ' ');
              return (
                <React.Fragment key={key}>
                  {/* 모듈 그룹 헤더 */}
                  <div style={{
                    padding: '4px 14px', background: 'var(--snk)',
                    borderBottom: '1px solid var(--bd)', borderTop: '1px solid var(--bd)',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <span style={{
                      fontSize: 9, padding: '1px 5px', borderRadius: 3,
                      background: first.module_type === 'CAROUSEL_TWOROW_DYNAMIC_TAB'
                        ? 'color-mix(in srgb, var(--hs) 12%, transparent)'
                        : 'var(--bd)',
                      color: first.module_type === 'CAROUSEL_TWOROW_DYNAMIC_TAB' ? 'var(--hs)' : 'var(--f3)',
                    }}>
                      {MODULE_SHORT[first.module_type] ?? first.module_type} · pos {first.module_position}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--f2)', fontWeight: 500 }}>{titleLine}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--f4)' }}>
                      {rows.filter(r => r.rank_yesterday != null).length}/{rows.length} 기존 랭킹
                    </span>
                  </div>
                  {/* 모듈 내 상품 */}
                  {rows.map(r => (
                    <div
                      key={r.musinsa_no}
                      style={{
                        display: 'grid', gridTemplateColumns: NEW_GRID, gap: 4,
                        padding: '5px 14px', borderBottom: '1px solid var(--bd)',
                        cursor: 'pointer', transition: 'background 80ms',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--snk)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      onClick={() => router.push(`/product?no=${r.musinsa_no}`)}
                    >
                      <span style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', paddingTop: 1 }}>{r.item_position}</span>
                      <span style={{
                        fontSize: 9, padding: '1px 4px', borderRadius: 3, alignSelf: 'center',
                        background: 'var(--snk)', color: 'var(--f3)',
                      }}>
                        {MODULE_SHORT[r.module_type] ?? '—'}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--f2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={r.brand_name}>{r.brand_name}</span>
                      <span style={{ fontSize: 11, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={r.product_name}>{r.product_name}</span>
                      <span style={{ fontSize: 11, fontFamily: 'var(--mono)', textAlign: 'right', color: 'var(--f1)' }}>
                        {r.final_price != null ? r.final_price.toLocaleString() : '—'}
                      </span>
                      <span style={{ fontSize: 11, fontFamily: 'var(--mono)', textAlign: 'right', color: (r.discount_rate ?? 0) >= 30 ? 'var(--dn)' : 'var(--f3)' }}>
                        {r.discount_rate ? `−${r.discount_rate}%` : '—'}
                      </span>
                      <span style={{
                        fontSize: 11, fontFamily: 'var(--mono)', textAlign: 'right',
                        color: r.rank_yesterday != null ? (r.rank_yesterday <= 30 ? 'var(--hs)' : 'var(--f2)') : 'var(--f4)',
                        fontWeight: r.rank_yesterday != null && r.rank_yesterday <= 30 ? 600 : 400,
                      }}>
                        {r.rank_yesterday != null ? r.rank_yesterday : '미랭킹'}
                      </span>
                      <span style={{
                        fontSize: 11, fontFamily: 'var(--mono)', textAlign: 'right',
                        color: r.rank_today != null ? (r.rank_today <= 30 ? 'var(--hs)' : 'var(--f2)') : 'var(--f4)',
                      }}>
                        {r.rank_today != null ? r.rank_today : '—'}
                      </span>
                    </div>
                  ))}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </section>

      {/* ── 모듈 타입별 효과 분석 ── */}
      <div className="grid grid-2 gap-12">

        <section className="panel">
          <div className="sec-head">
            <h3>모듈 타입별 평균 랭킹 변화
              <span className="sub"> D+1 / D+3 / D+7 기준 · 양수 = 상승</span>
            </h3>
          </div>
          {loadingEff ? (
            <span className="dim" style={{ fontSize: 12 }}>로딩중…</span>
          ) : byType.every(t => t.samples_d7 === 0) ? (
            <div style={{ fontSize: 12, color: 'var(--f4)', lineHeight: 1.8 }}>
              아직 D+7 데이터 없음
              <br /><span style={{ fontSize: 11 }}>추천판 수집 7일 후부터 자동으로 채워집니다</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {/* 헤더 */}
              <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 52px 52px 52px 56px', gap: 6 }}>
                {['타입', '', 'D+1', 'D+3', 'D+7', '상승률'].map(h => (
                  <span key={h} style={{ fontSize: 10, color: 'var(--f4)', textAlign: h === '' ? 'left' : 'right' }}>{h}</span>
                ))}
              </div>
              {byType.map(t => (
                <div key={t.type} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 52px 52px 52px 56px', gap: 6, alignItems: 'center' }}>
                  <span style={{
                    fontSize: 9, padding: '2px 5px', borderRadius: 3, textAlign: 'center',
                    background: t.type === 'CAROUSEL_TWOROW_DYNAMIC_TAB'
                      ? 'color-mix(in srgb, var(--hs) 12%, transparent)'
                      : 'var(--snk)',
                    color: t.type === 'CAROUSEL_TWOROW_DYNAMIC_TAB' ? 'var(--hs)' : 'var(--f3)',
                  }}>
                    {t.label}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--f4)' }}>{t.total}개 노출</span>
                  <span style={{ textAlign: 'right' }}><DeltaBadge v={t.avg_d1} /></span>
                  <span style={{ textAlign: 'right' }}><DeltaBadge v={t.avg_d3} /></span>
                  <span style={{ textAlign: 'right' }}><DeltaBadge v={t.avg_d7} /></span>
                  <span style={{ fontSize: 10, color: 'var(--f3)', textAlign: 'right', fontFamily: 'var(--mono)' }}>
                    {t.pct_up_d7 != null ? `${t.pct_up_d7}%↑` : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="sec-head">
            <h3>노출 위치별 평균 D+7 변화
              <span className="sub"> 상단일수록 효과가 큰가</span>
            </h3>
          </div>
          {loadingEff ? (
            <span className="dim" style={{ fontSize: 12 }}>로딩중…</span>
          ) : byPos.every(p => p.samples === 0) ? (
            <div style={{ fontSize: 12, color: 'var(--f4)', lineHeight: 1.8 }}>
              아직 D+7 데이터 없음
              <br /><span style={{ fontSize: 11 }}>추천판 수집 7일 후부터 자동으로 채워집니다</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {byPos.map(p => (
                <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 90, fontSize: 11, color: 'var(--f2)', flexShrink: 0 }}>{p.label}</span>
                  {p.avg_d7 != null ? (
                    <>
                      <HBar value={Math.abs(p.avg_d7)} max={Math.max(...byPos.map(x => Math.abs(x.avg_d7 ?? 0)), 1)} accent={p.avg_d7 > 0} w={80} />
                      <DeltaBadge v={p.avg_d7} />
                      <span style={{ fontSize: 10, color: 'var(--f4)', marginLeft: 4 }}>{p.pct_up}%↑</span>
                    </>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--f4)' }}>{p.total}개 노출 · 측정 대기</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ── 랭킹 상승 TOP 상품 ── */}
      {topGainers.length > 0 && (
        <section className="panel">
          <div className="sec-head">
            <h3>랭킹 상승 TOP 상품
              <span className="sub"> 추천 노출 후 D+7(없으면 D+1) 기준 · 상위 10개</span>
            </h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '24px 44px 110px 1fr 70px 52px 52px 52px', gap: 4, padding: '5px 0', borderBottom: '1px solid var(--bd)' }}>
            {['', '타입', '브랜드', '상품명', '노출일', 'D-1', 'D+1', 'D+7'].map(h => (
              <span key={h} style={{ fontSize: 10, color: 'var(--f4)', fontWeight: 500, textAlign: 'right' }}>{h}</span>
            ))}
          </div>
          {topGainers.map((r, i) => (
            <div
              key={`${r.rec_date}-${r.musinsa_no}`}
              style={{
                display: 'grid', gridTemplateColumns: '24px 44px 110px 1fr 70px 52px 52px 52px', gap: 4,
                padding: '5px 0', borderBottom: '1px solid var(--bd)',
                cursor: 'pointer', transition: 'background 80ms',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--snk)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              onClick={() => router.push(`/product?no=${r.musinsa_no}`)}
            >
              <span style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', textAlign: 'right' }}>{i + 1}</span>
              <span style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, background: 'var(--snk)', color: 'var(--f3)', alignSelf: 'center', textAlign: 'center' }}>
                {MODULE_SHORT[r.module_type] ?? '—'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--f2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.brand_name}</span>
              <span style={{ fontSize: 11, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.product_name}</span>
              <span style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', textAlign: 'right' }}>{r.rec_date.slice(5)}</span>
              <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--f3)', textAlign: 'right' }}>
                {r.rank_before ?? '—'}
              </span>
              <span style={{ textAlign: 'right' }}><DeltaBadge v={r.delta_d1} /></span>
              <span style={{ textAlign: 'right' }}><DeltaBadge v={r.delta_d7} /></span>
            </div>
          ))}
        </section>
      )}

    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────────
export default function RecommendPage() {
  const isMobile = useIsMobile();
  if (isMobile) return <MobileRecommendView />;
  return <RecommendDesktopView />;
}

function RecommendDesktopView() {
  const [tab, setTab] = React.useState<Tab>('hub');

  return (
    <div className="col-flex gap-12">
      <div className="row-flex between center">
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>추천판</h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--f4)' }}>
            무신사 큐레이션 모듈 · 매일 스냅샷
          </p>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className={`btn ${tab === 'hub'    ? 'active' : ''}`} onClick={() => setTab('hub')}>분석</button>
          <button className={`btn ${tab === 'stats'  ? 'active' : ''}`} onClick={() => setTab('stats')}>통계</button>
          <button className={`btn ${tab === 'effect' ? 'active' : ''}`} onClick={() => setTab('effect')}>랭킹 효과</button>
        </div>
      </div>

      {tab === 'hub'    && <RecommendHub />}
      {tab === 'stats'  && <RecommendStats />}
      {tab === 'effect' && <RecommendEffect />}
    </div>
  );
}
