'use client';
import { useState, useEffect } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import MobileFilterChips from '@/components/mobile/MobileFilterChips';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';

interface RecommendModule {
  id: string;
  module_name: string;
  module_type: string;
  gender_filter: string;
  position: number;
  snapshot_date: string;
  item_count: number | null;
  own_item_count: number | null;
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
  const [modules, setModules] = useState<RecommendModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [gender, setGender] = useState('A');

  const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  const fromDate = kstDaysAgo(7);

  useEffect(() => {
    const sb = supabaseBrowser();
    setLoading(true);
    sb.from('recommend_modules')
      .select('id, module_name, module_type, gender_filter, position, snapshot_date, item_count, own_item_count')
      .gte('snapshot_date', fromDate)
      .lte('snapshot_date', today)
      .eq('gender_filter', gender)
      .order('snapshot_date', { ascending: false })
      .order('position', { ascending: true })
      .limit(100)
      .then(({ data, error }) => {
        if (!error && data) setModules(data as RecommendModule[]);
        setLoading(false);
      });
  }, [gender]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalItems = modules.reduce((s, m) => s + (m.item_count ?? 0), 0);
  const totalOwn   = modules.reduce((s, m) => s + (m.own_item_count ?? 0), 0);
  const ownRate    = totalItems > 0 ? ((totalOwn / totalItems) * 100).toFixed(1) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 12px 20px' }}>
      <MobileFilterChips items={GENDER_CHIPS} activeValue={gender} onChange={setGender} />

      {/* KPI */}
      <div style={{ display: 'flex', gap: 8 }}>
        {[
          { label: '추천 모듈', value: modules.length },
          { label: '총 노출 상품', value: totalItems.toLocaleString() },
          { label: '자사 노출 비율', value: ownRate != null ? `${ownRate}%` : '—' },
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

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>
      ) : modules.length === 0 ? (
        <MobileEmptyState icon="📋" title="추천 모듈 데이터가 없습니다" />
      ) : (
        modules.map(m => {
          const ownPct = m.item_count && m.item_count > 0 && m.own_item_count != null
            ? ((m.own_item_count / m.item_count) * 100).toFixed(0)
            : null;
          return (
            <div key={m.id} style={{ padding: '10px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)', flex: 1 }}>{m.module_name}</span>
                {m.own_item_count != null && m.own_item_count > 0 && (
                  <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--hs)', background: 'var(--hs-soft)', padding: '1px 5px', borderRadius: 4 }}>
                    자사 {m.own_item_count}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 4, display: 'flex', gap: 8 }}>
                <span>상품 {m.item_count ?? 0}개</span>
                {ownPct != null && <span>자사 {ownPct}%</span>}
                <span style={{ marginLeft: 'auto' }}>{m.snapshot_date}</span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
