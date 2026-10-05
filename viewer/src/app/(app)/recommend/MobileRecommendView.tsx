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
  fromDate: string;
  today: string;
}

const GENDER_CHIPS = [
  { value: 'A', label: '전체' },
  { value: 'M', label: '남성' },
  { value: 'F', label: '여성' },
];

export function recommendRequestWindow(timestamp = Date.now()) {
  const d = new Date(timestamp + 9 * 3_600_000);
  const today = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() - 7);
  return { fromDate: d.toISOString().slice(0, 10), today };
}

export default function MobileRecommendView() {
  const [result, setResult] = useState<RecommendResult>(() => ({ gender: 'A', modules: [], status: 'loading', ...recommendRequestWindow() }));
  const [retry, setRetry] = useState(0);
  const requestPending = useRef(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [gender, setGender] = useState('A');

  useEffect(() => {
    const sb = supabaseBrowser();
    const controller = new AbortController();
    let active = true;
    const window = recommendRequestWindow();
    requestPending.current = true;
    setResult({ gender, modules: [], status: 'loading', ...window });
    void (async () => {
      try {
        const { data, error } = await sb.from('recommend_modules')
          .select('id, title, module_type, gender_filter, position, snapshot_date, items_count')
          .gte('snapshot_date', window.fromDate)
          .lte('snapshot_date', window.today)
          .eq('gender_filter', gender)
          .order('snapshot_date', { ascending: false })
          .order('position', { ascending: true })
          .limit(100)
          .abortSignal(controller.signal);
        if (!active || controller.signal.aborted) return;
        if (error) throw error;
        setResult({ gender, modules: (data ?? []) as RecommendModule[], status: 'ready', ...window });
      } catch {
        if (active && !controller.signal.aborted) setResult({ gender, modules: [], status: 'error', ...window });
      } finally {
        if (active && !controller.signal.aborted) requestPending.current = false;
      }
    })();
    return () => { active = false; controller.abort(); };
  // Preserve the existing date-window behavior; gender changes and retries request fresh data.
  }, [gender, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mask the previous filter's rows before its replacement effect runs.
  const current = result.gender === gender ? result : { ...result, gender, modules: [], status: 'loading' as const };
  const { fromDate, today } = current;
  const modules = current.modules;
  const loading = current.status === 'loading';
  const failed = current.status === 'error';
  function retryRequest() {
    if (requestPending.current) return;
    if (typeof document !== 'undefined' && resultsRef.current?.contains(document.activeElement)) resultsRef.current.focus();
    requestPending.current = true;
    setResult({ ...result, gender, modules: [], status: 'loading' });
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

      <div style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--f2)', overflowWrap: 'anywhere' }}>
        <div>조회 기간: {fromDate} ~ {today} (KST, 양끝 포함 8일)</div>
        <div>선택한 성별의 기간 전체에서 최신순 최대 100개 모듈 스냅샷을 조회합니다.</div>
        <div>상품 항목 합계는 조회한 모듈의 상품 목록 길이를 더한 값으로, 중복을 포함할 수 있습니다. 실제 노출 수·고유 상품 수·시장 전체 합계가 아닙니다.</div>
        {current.status === 'ready' && modules.length >= 100 && <div>100개 조회: 전체 데이터가 포함되었는지는 알 수 없습니다.</div>}
      </div>

      {/* KPI */}
      <div style={{ display: 'flex', gap: 8 }}>
        {[
          { label: '조회한 모듈 스냅샷', value: current.status === 'ready' ? modules.length : '—' },
          { label: '조회분 상품 항목 합계', value: current.status === 'ready' ? totalItems.toLocaleString() : '—' },
          { label: '조회 끝 날짜', value: today.slice(5) },
        ].map(kpi => (
          <div key={kpi.label} style={{
            flex: 1, minWidth: 0, padding: '10px 12px', background: 'var(--sur)',
            border: '1px solid var(--bd)', borderRadius: 10, textAlign: 'center',
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--f1)', fontFamily: 'var(--mono)' }}>{kpi.value}</div>
            <div style={{ fontSize: 10, color: 'var(--f2)', marginTop: 2, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* 조회한 날짜별 상품 항목 합계 */}
      {current.status === 'ready' && chartData.length > 1 && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--f2)', marginBottom: 8 }}>조회분 상품 항목 추이</div>
          <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--f2)', marginBottom: 8 }}>표시된 날짜의 조회분만 연결합니다. 빠진 날짜는 0이 아니며, 날짜별 전체 수집 여부는 확인되지 않았습니다.</div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--f4)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--f4)' }} domain={[0, 'auto']} />
              <Tooltip
                contentStyle={{ background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 5, fontSize: 11 }}
                formatter={(v: unknown) => [`${v}개`, '조회분 상품 항목']}
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

      <div ref={resultsRef} role="region" aria-label="추천 조회 결과" tabIndex={-1} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {failed ? (
        <div role="alert" style={{ padding: '12px 13px', background: 'var(--shb)', border: '1px solid var(--shf)', borderRadius: 10, color: 'var(--shf)', fontSize: 13 }}>
          <p style={{ margin: '0 0 8px' }}>추천 데이터를 불러오지 못했습니다.</p>
          <button onClick={retryRequest} style={{ padding: '6px 10px', border: '1px solid var(--bd)', borderRadius: 7, background: 'var(--sur)', color: 'var(--f1)', cursor: 'pointer' }}>다시 시도</button>
        </div>
      ) : loading ? (
        <div role="status" aria-live="polite" style={{ textAlign: 'center', padding: '40px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>
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
              <span>상품 항목 {m.items_count}개</span>
              <span>pos {m.position}</span>
              <span style={{ marginLeft: 'auto' }}>{m.snapshot_date}</span>
            </div>
          </div>
        ))
      )}
      </div>
    </div>
  );
}
