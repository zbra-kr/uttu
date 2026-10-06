'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAnomalyRecords } from '@/hooks/useAnomalyRecords';
import { isDailyRankObservation, prioritySeverity, observationExplanation } from '@/lib/anomaly-priority';
import { supabaseBrowser } from '@/lib/supabase/client';
import MobileFilterChips from '@/components/mobile/MobileFilterChips';
import MobileSeverityIndicator, { type Severity } from '@/components/mobile/MobileSeverityIndicator';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';

interface ARow {
  id: string;
  detected_at: string;
  detection_date: string;
  severity: string;
  meta: Record<string, unknown> | null;
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
  const params = useSearchParams();
  const [period, setPeriod] = useState('7d');
  const [sevFilter, setSevFilter] = useState('all');
  const [observationsOpen, setObservationsOpen] = useState(false);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  const from = period === 'today' ? today : kstDaysAgo(period === '7d' ? 6 : 29);
  const records = useAnomalyRecords(from, today);
  const rows: ARow[] = records.rows.map(r => ({ ...r, sev: prioritySeverity(r) }));
  const { loading } = records;
  const navigation = useRef(0);
  useEffect(() => {
    const value = params.get('sev');
    setSevFilter(value && ['hi', 'md', 'lo'].includes(value) ? value : 'all');
  }, [params]);
  useEffect(() => { navigation.current++; setObservationsOpen(false); setNavigationError(null); return () => { navigation.current++; }; }, [from, records.identityKey]);

  const filtered = rows.filter(r => sevFilter === 'all' || r.sev === sevFilter);

  const counts = {
    hi: rows.filter(r => r.sev === 'hi').length,
    md: rows.filter(r => r.sev === 'md').length,
    lo: rows.filter(r => r.sev === 'lo').length,
  };

  const chips = [
    { value: 'all', label: `불러온 기록 ${rows.length}` },
    { value: 'hi',  label: `🔴 HIGH ${counts.hi}` },
    { value: 'md',  label: `🟡 MED ${counts.md}` },
    { value: 'lo',  label: `🟢 낮음 ${counts.lo}` },
  ];

  async function handleRowClick(r: ARow) {
    const ownNavigation = ++navigation.current;
    setNavigationError(null);
    if (!r.entity_id || !r.entity_type) return;
    if (r.entity_type === 'brand') {
      router.push(`/brand?id=${r.entity_id}`);
      return;
    }
    // entity_id는 products.id (UUID) → musinsa_no 조회 필요
    try {
    const { data, error } = await supabaseBrowser()
      .from('products')
      .select('musinsa_no')
      .eq('id', r.entity_id)
      .single();
    if (error) throw error;
    if (ownNavigation === navigation.current && data?.musinsa_no) router.push(`/product?no=${data.musinsa_no}`);
    } catch {
      if (ownNavigation === navigation.current) setNavigationError('대상 정보를 조회할 수 없습니다.');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 12px 20px' , width: '100%', minWidth: 0 }}>
      {/* 기간 선택 */}
      <MobileFilterChips items={PERIOD_CHIPS} activeValue={period} onChange={setPeriod} />

      {/* 심각도 필터 */}
      <MobileFilterChips items={chips} activeValue={sevFilter} onChange={setSevFilter} />

      {loading && rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <MobileEmptyState icon="✅" title={records.error ? '조회 상태 확인' : '표시할 기록 없음'} description={records.error ? '조회 실패 내용을 확인하고 다시 시도해주세요.' : records.hasMore ? '불러온 기록에는 해당 항목이 없습니다. 아직 확인하지 않은 기록이 있습니다.' : '선택한 기간의 기록을 모두 불러왔으며 조건에 맞는 항목이 없습니다.'} />
      ) : (
        ([false, true] as const).map(observations => (
          <details key={String(observations)} open={observations ? observationsOpen : true}
            onToggle={event => { if (observations) setObservationsOpen(event.currentTarget.open); }}>
            <summary style={{ padding: '12px 4px', cursor: 'pointer' }}>
              {observations ? '일일 순위 관측' : '우선 확인'} · 불러온 기록 중 {filtered.filter(r => isDailyRankObservation(r) === observations).length}건
            </summary>
            {filtered.filter(r => isDailyRankObservation(r) === observations).map(r => (
          <div
            key={r.id}
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
                  {observationExplanation(r) || anomalyLabel(r.anomaly_type)}
                </span>
              </div>
              {r.entity_name && (
                <div style={{ fontSize: 12, color: 'var(--f3)', marginTop: 2 }}>{r.entity_name}</div>
              )}
              <details onClick={event => event.stopPropagation()}>
                <summary>기록 상세</summary>
                <p>기록된 심각도: {r.severity.toUpperCase()}</p>
                <p>{r.description || '설명 없음'}</p>
              </details>
              <button className="btn sm" disabled={!r.entity_id} onClick={event => { event.stopPropagation(); void handleRowClick(r); }}>대상 보기</button>
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
        ))}
          </details>
        ))
      )}
      {records.error && <div role="alert">조회 실패: {records.error}<button className="btn" onClick={records.retry} disabled={loading}>다시 시도</button></div>}
      {navigationError && <div role="alert">{navigationError}</div>}
      {records.hasMore && <><p>일부 기록만 불러왔습니다. 다음 기록에도 조건에 맞는 항목이 있을 수 있습니다.</p><button className="btn" onClick={records.loadMore} disabled={loading}>{filtered.length === 0 ? '다음 기록에서 조건 계속 확인' : '더 보기'}</button></>}
      <p>심각도와 섹션 건수는 불러온 기록 기준입니다.</p>
    </div>
  );
}
