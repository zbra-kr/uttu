'use client';
import { useState, useEffect, useRef } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import MobileFilterChips from '@/components/mobile/MobileFilterChips';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

interface RecommendModule {
  id: string;
  title: string | null;
  module_type: string;
  gender_filter: string;
  position: number;
  snapshot_date: string;
  items_count: number;
}

interface RecommendResult {
  gender: string;
  modules: RecommendModule[];
  status: 'loading' | 'ready' | 'error';
}

const GENDER_CHIPS = [
  { value: 'A', label: '전체' },
  { value: 'M', label: '남성' },
  { value: 'F', label: '여성' },
];

function kstDaysAgo(n: number): string {
  const d = new Date(Date.now() + 9 * 3_600_000);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function MobileRecommendView() {
  const [result, setResult] = useState<RecommendResult>({ gender: 'A', modules: [], status: 'loading' });
  const [retry, setRetry] = useState(0);
  const requestPending = useRef(false);
  const [gender, setGender] = useState('A');

  const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  const fromDate = kstDaysAgo(7);

  useEffect(() => {
    const sb = supabaseBrowser();
    const controller = new AbortController();
    let active = true;
    requestPending.current = true;
    setResult({ gender, modules: [], status: 'loading' });
    void (async () => {
      try {
        const { data, error } = await sb.from('recommend_modules')
          .select('id, title, module_type, gender_filter, position, snapshot_date, items_count')
          .gte('snapshot_date', fromDate)
          .lte('snapshot_date', today)
          .eq('gender_filter', gender)
          .order('snapshot_date', { ascending: false })
          .order('position', { ascending: true })
          .limit(100)
          .abortSignal(controller.signal);
        if (!active || controller.signal.aborted) return;
        if (error) throw error;
        setResult({ gender, modules: (data ?? []) as RecommendModule[], status: 'ready' });
      } catch {
        if (active && !controller.signal.aborted) setResult({ gender, modules: [], status: 'error' });
      } finally {
        if (active && !controller.signal.aborted) requestPending.current = false;
      }
    })();
    return () => { active = false; controller.abort(); };
  // Preserve the existing date-window behavior; gender changes and retries request fresh data.
  }, [gender, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mask the previous filter's rows before its replacement effect runs.
  const current = result.gender === gender ? result : { gender, modules: [], status: 'loading' as const };
  const modules = current.modules;
  const loading = current.status === 'loading';
  const failed = current.status === 'error';
  function retryRequest() {
    if (requestPending.current) return;
    requestPending.current = true;
    setResult({ gender, modules: [], status: 'loading' });
    setRetry(value => value + 1);
  }

  const totalItems = modules.reduce((s, m) => s + (m.items_count ?? 0), 0);

  // 날짜별 모듈 수 / 노출 상품 수 추이 차트
  const chartData = (() => {
    const byDate = new Map<string, { items: number; moduleCount: number }>();
    for (const m of modules) {
      const d = m.snapshot_date;
      const cur = byDate.get(d) ?? { items: 0, moduleCount: 0 };
      byDate.set(d, {
        items: cur.items + (m.items_count ?? 0),
        moduleCount: cur.moduleCount + 1,
      });
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { items, moduleCount }]) => ({
        date: date.slice(5),
        items,
        moduleCount,
      }));
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 12px 20px' , width: '100%', minWidth: 0 }}>
      <MobileFilterChips items={GENDER_CHIPS} activeValue={gender} onChange={setGender} />

      {/* KPI */}
      <div style={{ display: 'flex', gap: 8 }}>
        {[
          { label: '추천 모듈', value: current.status === 'ready' ? modules.length : '—' },
          { label: '총 노출 상품', value: current.status === 'ready' ? totalItems.toLocaleString() : '—' },
          { label: '오늘 날짜', value: today.slice(5) },
        ].map(kpi => (
          <div key={kpi.label} style={{
            flex: 1, padding: '10px 12px', background: 'var(--sur)',
            border: '1px solid var(--bd)', borderRadius: 10, textAlign: 'center',
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--f1)', fontFamily: 'var(--mono)' }}>{kpi.value}</div>
            <div style={{ fontSize: 10, color: 'var(--f4)', marginTop: 2 }}>{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* 7일 노출 상품 수 추이 */}
      {current.status === 'ready' && chartData.length > 1 && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--f3)', marginBottom: 8 }}>노출 상품 수 7일 추이</div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--f4)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--f4)' }} domain={[0, 'auto']} />
              <Tooltip
                contentStyle={{ background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 5, fontSize: 11 }}
                formatter={(v: unknown) => [`${v}개`, '노출 상품']}
              />
              <Line
                type="monotone"
                dataKey="items"
                stroke="var(--hs)"
                strokeWidth={2}
                dot={{ r: 3, fill: 'var(--hs)' }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {failed ? (
        <div role="alert" style={{ padding: '12px 13px', background: 'var(--shb)', border: '1px solid var(--shf)', borderRadius: 10, color: 'var(--shf)', fontSize: 13 }}>
          <p style={{ margin: '0 0 8px' }}>추천 데이터를 불러오지 못했습니다.</p>
          <button onClick={retryRequest} style={{ padding: '6px 10px', border: '1px solid var(--bd)', borderRadius: 7, background: 'var(--sur)', color: 'var(--f1)', cursor: 'pointer' }}>다시 시도</button>
        </div>
      ) : loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>
      ) : modules.length === 0 ? (
        <MobileEmptyState icon="📋" title="추천 모듈 데이터가 없습니다" />
      ) : (
        modules.map(m => (
          <div key={m.id} style={{ padding: '10px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)', flex: 1 }}>
                {m.title ?? '(제목 없음)'}
              </span>
              <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--f4)', background: 'var(--snk)', padding: '1px 5px', borderRadius: 5 }}>
                {m.module_type === 'CAROUSEL_TWOROW_DYNAMIC_TAB' ? 'TAB' : 'STD'}
              </span>
            </div>
            <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 4, display: 'flex', gap: 8 }}>
              <span>상품 {m.items_count}개</span>
              <span>pos {m.position}</span>
              <span style={{ marginLeft: 'auto' }}>{m.snapshot_date}</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
