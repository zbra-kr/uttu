'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import MobileFilterChips from '@/components/mobile/MobileFilterChips';
import MobileSeverityIndicator, { type Severity } from '@/components/mobile/MobileSeverityIndicator';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';

interface ARow {
  id: string;
  detected_at: string;
  detection_date: string;
  severity: string;
  anomaly_type: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_name: string | null;
  description: string | null;
  sev: 'hi' | 'md' | 'lo';
}

const SEV_CHIPS = [
  { value: 'all', label: '전체' },
  { value: 'hi',  label: '🔴 HIGH' },
  { value: 'md',  label: '🟡 MED' },
  { value: 'lo',  label: '🟢 낮음' },
];

const SEV_MAP: Record<string, Severity> = { hi: 'high', md: 'medium', lo: 'low' };

function sevKey(s: string): 'hi' | 'md' | 'lo' {
  return s === 'high' ? 'hi' : s === 'medium' ? 'md' : 'lo';
}

function anomalyLabel(t: string): string {
  const map: Record<string, string> = {
    rank_spike:         '순위 급등',
    rank_drop_own:      '자사 순위 이탈',
    new_entrant_top10:  'TOP10 신규 진입',
    sold_out:           '품절 전환',
    price_drop:         '가격 하락',
    promo_heavy_discount: '과도한 프로모션',
    review_drop:        '리뷰 급락',
    review_spike:       '리뷰 급증',
  };
  return map[t] ?? t;
}

function formatTs(ts: string): string {
  const kst = new Date(new Date(ts).getTime() + 9 * 3_600_000);
  return kst.toISOString().slice(0, 16).replace('T', ' ').replace(/-/g, '.');
}

function kstDaysAgo(n: number): string {
  const d = new Date(Date.now() + 9 * 3_600_000);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const PERIOD_CHIPS = [
  { value: 'today', label: '오늘' },
  { value: '7d',    label: '7일' },
  { value: '30d',   label: '30일' },
];

export default function MobileAnomalyView() {
  const router = useRouter();
  const [rows, setRows] = useState<ARow[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('7d');
  const [sevFilter, setSevFilter] = useState('all');

  useEffect(() => {
    setLoading(true);
    const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
    const from = period === 'today' ? today : kstDaysAgo(period === '7d' ? 7 : 30);

    supabaseBrowser()
      .from('anomalies')
      .select('id, detected_at, detection_date, severity, anomaly_type, entity_type, entity_id, entity_name, description')
      .gte('detection_date', from)
      .lte('detection_date', today)
      .order('detected_at', { ascending: false })
      .limit(1000)
      .then(({ data, error }) => {
        if (!error && data) {
          setRows(data.map((r: any) => ({ ...r, sev: sevKey(r.severity) })));
        }
        setLoading(false);
      });
  }, [period]);

  const filtered = rows.filter(r => sevFilter === 'all' || r.sev === sevFilter);

  const counts = {
    hi: rows.filter(r => r.sev === 'hi').length,
    md: rows.filter(r => r.sev === 'md').length,
    lo: rows.filter(r => r.sev === 'lo').length,
  };

  const chips = [
    { value: 'all', label: `전체 ${rows.length}` },
    { value: 'hi',  label: `🔴 HIGH ${counts.hi}` },
    { value: 'md',  label: `🟡 MED ${counts.md}` },
    { value: 'lo',  label: `🟢 낮음 ${counts.lo}` },
  ];

  async function handleRowClick(r: ARow) {
    if (!r.entity_id || !r.entity_type) return;
    if (r.entity_type === 'brand') {
      router.push(`/brand?id=${r.entity_id}`);
      return;
    }
    // entity_id는 products.id (UUID) → musinsa_no 조회 필요
    const { data } = await supabaseBrowser()
      .from('products')
      .select('musinsa_no')
      .eq('id', r.entity_id)
      .single();
    if (data?.musinsa_no) router.push(`/product?no=${data.musinsa_no}`);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 12px 20px' , width: '100%', minWidth: 0 }}>
      {/* 기간 선택 */}
      <MobileFilterChips items={PERIOD_CHIPS} activeValue={period} onChange={setPeriod} />

      {/* 심각도 필터 */}
      <MobileFilterChips items={chips} activeValue={sevFilter} onChange={setSevFilter} />

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <MobileEmptyState icon="✅" title="이상 탐지 없음" description="선택한 기간에 이상 신호가 없습니다" />
      ) : (
        filtered.map(r => (
          <div
            key={r.id}
            onClick={() => handleRowClick(r)}
            style={{
              display: 'flex', alignItems: 'stretch', gap: 0,
              background: 'var(--sur)', border: '1px solid var(--bd)',
              borderRadius: 10, overflow: 'hidden',
              cursor: r.entity_id ? 'pointer' : 'default',
            }}
          >
            <div style={{ padding: '12px 0 12px 10px', display: 'flex', alignItems: 'center' }}>
              <MobileSeverityIndicator severity={SEV_MAP[r.sev]} height={40} />
            </div>
            <div style={{ flex: 1, padding: '10px 12px 10px 10px', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)' }}>
                  {anomalyLabel(r.anomaly_type)}
                </span>
              </div>
              {r.entity_name && (
                <div style={{ fontSize: 12, color: 'var(--f3)', marginTop: 2 }}>{r.entity_name}</div>
              )}
              {r.description && (
                <div style={{ fontSize: 11, color: 'var(--f4)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.description}
                </div>
              )}
              <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 4 }}>
                {formatTs(r.detected_at)}
              </div>
            </div>
            {r.entity_id && <div style={{ display: 'flex', alignItems: 'center', paddingRight: 12, color: 'var(--f4)', fontSize: 14 }}>→</div>}
          </div>
        ))
      )}
    </div>
  );
}
