'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { BarChart, Bar, Cell as RCell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
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
type GenderFilter = 'A' | 'M' | 'F';

const GF_LABEL: Record<GenderFilter, string> = { A: '전체', M: '남성', F: '여성' };
const MODULE_TYPE_BADGE: Record<string, { label: string; hi: boolean }> = {
  CAROUSEL_TWOROW:             { label: '일반', hi: false },
  CAROUSEL_TWOROW_DYNAMIC_TAB: { label: '탭',   hi: true  },
};

const AXIS_TICK = { fontSize: 9, fill: 'var(--f4)', fontFamily: 'var(--mono)' } as const;
const TOOLTIP_STYLE = {
  contentStyle: { background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, fontSize: 11, fontFamily: 'var(--mono)' },
  labelStyle:   { color: 'var(--f3)' },
  itemStyle:    { color: 'var(--f1)' },
};

const MODULE_GRID = '28px 1fr 44px 40px 40px';
const ITEM_GRID   = '28px 110px 1fr 72px 46px 44px 44px';

// ──────────────────────────────────────────────────────────────────────────────
// RecommendHub — 분석 탭
// ──────────────────────────────────────────────────────────────────────────────
function RecommendHub() {
  const router = useRouter();
  const [date, setDate]         = React.useState(kstDateStr());
  const [gender, setGender]     = React.useState<GenderFilter>('A');
  const [modules, setModules]   = React.useState<RecModule[]>([]);
  const [items, setItems]       = React.useState<RecItem[]>([]);
  const [selModule, setSelModule] = React.useState<string | null>(null);
  const [loading, setLoading]       = React.useState(false);
  const [loadingItems, setLoadingItems] = React.useState(false);

  // 모듈 로드
  React.useEffect(() => {
    setLoading(true);
    setSelModule(null);
    setItems([]);
    sb.from('recommend_modules')
      .select('*')
      .eq('snapshot_date', date)
      .eq('gender_filter', gender)
      .order('position', { ascending: true })
      .limit(100)
      .then(({ data, error }) => {
        setLoading(false);
        if (error) { console.error('[recommend] modules', error); return; }
        setModules(data ?? []);
      });
  }, [date, gender]);

  // 아이템 로드 (선택 모듈)
  React.useEffect(() => {
    if (!selModule) { setItems([]); return; }
    setLoadingItems(true);
    sb.from('recommend_items')
      .select('*')
      .eq('module_id', selModule)
      .order('position', { ascending: true })
      .limit(200)
      .then(({ data, error }) => {
        setLoadingItems(false);
        if (error) { console.error('[recommend] items', error); return; }
        setItems(data ?? []);
      });
  }, [selModule]);

  // ── 차트 계산 ─────────────────────────────────────────────────
  const brandCounts = React.useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of items) {
      if (!it.brand_name) continue;
      m[it.brand_name] = (m[it.brand_name] ?? 0) + 1;
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [items]);

  const discountDist = React.useMemo(() => {
    const bins = [0, 0, 0, 0, 0, 0];
    const labels = ['0%', '~10%', '~20%', '~30%', '~40%', '40%+'];
    for (const it of items) {
      const dr = it.discount_rate ?? 0;
      if      (dr === 0)   bins[0]++;
      else if (dr < 10)    bins[1]++;
      else if (dr < 20)    bins[2]++;
      else if (dr < 30)    bins[3]++;
      else if (dr < 40)    bins[4]++;
      else                 bins[5]++;
    }
    return labels.map((name, i) => ({ name, count: bins[i] }));
  }, [items]);

  const reviewDist = React.useMemo(() => {
    const bins = [0, 0, 0, 0, 0];
    for (const it of items) {
      if (it.review_score == null) continue;
      const s = it.review_score;
      if      (s < 60) bins[0]++;
      else if (s < 70) bins[1]++;
      else if (s < 80) bins[2]++;
      else if (s < 90) bins[3]++;
      else             bins[4]++;
    }
    return ['<60', '60~70', '70~80', '80~90', '90+'].map((name, i) => ({ name, count: bins[i] }));
  }, [items]);

  const soldOutByBrand = React.useMemo(() => {
    const m: Record<string, { total: number; sold: number }> = {};
    for (const it of items) {
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
  }, [items]);

  const selMod = modules.find(m => m.id === selModule);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* 필터 바 */}
      <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px' }}>
        <label style={{ fontSize: 11, color: 'var(--f4)', flexShrink: 0 }}>날짜</label>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          style={{
            fontSize: 12, padding: '3px 8px',
            border: '1px solid var(--bd)', borderRadius: 4,
            background: 'var(--bg)', color: 'var(--f1)', cursor: 'pointer',
          }}
        />
        <div style={{ width: 1, height: 16, background: 'var(--bd)' }} />
        <label style={{ fontSize: 11, color: 'var(--f4)', flexShrink: 0 }}>성별</label>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['A', 'M', 'F'] as GenderFilter[]).map(g => (
            <button key={g} className={`btn sm ${gender === g ? 'active' : ''}`} onClick={() => setGender(g)}>
              {GF_LABEL[g]}
            </button>
          ))}
        </div>
        {modules.length > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--f4)' }}>
            모듈 {modules.length}개 · 상품 {modules.reduce((s, m) => s + m.items_count, 0)}개
          </span>
        )}
      </div>

      {/* 모듈 + 아이템 그리드 */}
      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 12 }}>

        {/* ── 모듈 목록 ── */}
        <div className="panel" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: MODULE_GRID, gap: 4,
            padding: '7px 12px', borderBottom: '1px solid var(--bd)',
            background: 'var(--snk)',
          }}>
            {['#', '제목', '타입', '탭', '상품'].map(h => (
              <span key={h} style={{ fontSize: 10, color: 'var(--f4)', fontWeight: 500 }}>{h}</span>
            ))}
          </div>
          <div style={{ overflowY: 'auto', flex: 1, maxHeight: 500 }}>
            {loading ? (
              <div style={{ padding: 32, textAlign: 'center', fontSize: 12, color: 'var(--f4)' }}>로딩중…</div>
            ) : modules.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', fontSize: 12, color: 'var(--f4)' }}>
                해당 날짜 데이터 없음
                <br /><span style={{ fontSize: 11, marginTop: 4, display: 'block' }}>다른 날짜를 선택해 주세요</span>
              </div>
            ) : modules.map(m => {
              const badge = MODULE_TYPE_BADGE[m.module_type];
              const isSel = selModule === m.id;
              return (
                <div
                  key={m.id}
                  onClick={() => setSelModule(isSel ? null : m.id)}
                  style={{
                    display: 'grid', gridTemplateColumns: MODULE_GRID, gap: 4,
                    padding: '6px 12px', cursor: 'pointer',
                    background: isSel ? 'color-mix(in srgb, var(--hs) 8%, transparent)' : 'transparent',
                    borderBottom: '1px solid var(--bd)',
                    borderLeft: isSel ? '2px solid var(--hs)' : '2px solid transparent',
                    transition: 'background 80ms',
                  }}
                  onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'var(--snk)'; }}
                  onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', paddingTop: 1 }}>{m.position}</span>
                  <span
                    style={{ fontSize: 11, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={m.title ?? undefined}
                  >
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
            display: 'grid', gridTemplateColumns: ITEM_GRID, gap: 4,
            padding: '7px 12px', borderBottom: '1px solid var(--bd)',
            background: 'var(--snk)',
          }}>
            {['#', '브랜드', '상품명', '판매가', '할인', '평점', '품절'].map(h => (
              <span key={h} style={{ fontSize: 10, color: 'var(--f4)', fontWeight: 500 }}>{h}</span>
            ))}
          </div>
          {selMod && (
            <div style={{
              padding: '5px 12px', background: 'var(--snk)',
              borderBottom: '1px solid var(--bd)', fontSize: 11, color: 'var(--f2)',
            }}>
              {selMod.title ?? selMod.module_type}
              {selMod.brand_tabs?.length > 0 && (
                <span style={{ marginLeft: 8, color: 'var(--f4)', fontSize: 10 }}>
                  탭: {selMod.brand_tabs.join(' · ')}
                </span>
              )}
            </div>
          )}
          <div style={{ overflowY: 'auto', flex: 1, maxHeight: selMod ? 476 : 500 }}>
            {!selModule ? (
              <div style={{ padding: 40, textAlign: 'center', fontSize: 12, color: 'var(--f4)' }}>
                왼쪽에서 모듈을 클릭하면 상품 목록이 표시됩니다
              </div>
            ) : loadingItems ? (
              <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--f4)' }}>로딩중…</div>
            ) : items.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--f4)' }}>상품 없음</div>
            ) : items.map(it => (
              <div
                key={it.id}
                style={{
                  display: 'grid', gridTemplateColumns: ITEM_GRID, gap: 4,
                  padding: '5px 12px', borderBottom: '1px solid var(--bd)',
                  cursor: 'pointer', transition: 'background 80ms',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--snk)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                onClick={() => router.push(`/product?no=${it.musinsa_no}`)}
              >
                <span style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', paddingTop: 1 }}>{it.position}</span>
                <span style={{ fontSize: 11, color: 'var(--f2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={it.brand_name}>{it.brand_name || '—'}</span>
                <span style={{ fontSize: 11, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={it.product_name}>{it.product_name || '—'}</span>
                <span style={{ fontSize: 11, color: 'var(--f1)', fontFamily: 'var(--mono)', textAlign: 'right' }}>
                  {it.final_price != null ? it.final_price.toLocaleString() : '—'}
                </span>
                <span style={{
                  fontSize: 11, fontFamily: 'var(--mono)', textAlign: 'right',
                  color: (it.discount_rate ?? 0) >= 30 ? 'var(--dn)' : 'var(--f3)',
                  fontWeight: (it.discount_rate ?? 0) >= 30 ? 600 : 400,
                }}>
                  {it.discount_rate ? `−${it.discount_rate}%` : '—'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--f2)', fontFamily: 'var(--mono)', textAlign: 'right' }}>
                  {it.review_score != null ? `${it.review_score}%` : '—'}
                </span>
                <span style={{
                  fontSize: 10, textAlign: 'center', paddingTop: 1,
                  color: it.is_sold_out ? 'var(--dn)' : 'var(--f4)',
                }}>
                  {it.is_sold_out ? '품절' : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 차트 섹션 (아이템 로드됐을 때) ── */}
      {items.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

          {/* 브랜드 분포 */}
          <section className="panel">
            <div className="sec-head">
              <h3>브랜드 분포 <span className="sub">노출 상품 수 · TOP 8</span></h3>
            </div>
            {brandCounts.length === 0 ? (
              <span className="dim" style={{ fontSize: 12 }}>데이터 없음</span>
            ) : brandCounts.map(([name, count], i) => (
              <div key={name} className="row-flex center gap-8" style={{ padding: '3px 0' }}>
                <span style={{ width: 14, fontSize: 10, color: 'var(--f4)', textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                <span style={{ flex: 1, fontSize: 11, color: 'var(--f2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                <HBar value={count} max={brandCounts[0]?.[1] ?? 1} accent={i === 0} w={70} />
                <span className="mono dim" style={{ fontSize: 10, width: 24, textAlign: 'right' }}>{count}</span>
              </div>
            ))}
          </section>

          {/* 할인율 분포 */}
          <section className="panel">
            <div className="sec-head">
              <h3>할인율 분포 <span className="sub">{items.length}개 상품</span></h3>
            </div>
            <div style={{ width: '100%', height: 120 }}>
              {(() => {
                const maxV = Math.max(...discountDist.map(d => d.count), 1);
                return (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={discountDist} margin={{ top: 4, right: 0, left: -22, bottom: 0 }}>
                      <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [`${v}개`, '상품 수']} />
                      <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                        {discountDist.map((entry, idx) => (
                          <RCell key={idx} fill={entry.count === maxV && maxV > 0 ? 'var(--hs)' : 'var(--f3)'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                );
              })()}
            </div>
          </section>

          {/* 리뷰점수 분포 */}
          <section className="panel">
            <div className="sec-head">
              <h3>리뷰점수 분포 <span className="sub">{items.filter(i => i.review_score != null).length}개</span></h3>
            </div>
            <div style={{ width: '100%', height: 120 }}>
              {(() => {
                const maxV = Math.max(...reviewDist.map(d => d.count), 1);
                return (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reviewDist} margin={{ top: 4, right: 0, left: -22, bottom: 0 }}>
                      <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [`${v}개`, '상품 수']} />
                      <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                        {reviewDist.map((entry, idx) => (
                          <RCell key={idx} fill={entry.count === maxV && maxV > 0 ? 'var(--hs)' : 'var(--f3)'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                );
              })()}
            </div>
          </section>

          {/* 브랜드별 품절율 */}
          <section className="panel">
            <div className="sec-head">
              <h3>브랜드별 품절율 <span className="sub">2개+ 노출 기준</span></h3>
            </div>
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
      color: up ? 'var(--up, #22c55e)' : 'var(--dn)',
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
            marginLeft: 'auto', fontSize: 11, padding: '2px 8px', borderRadius: 4,
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
