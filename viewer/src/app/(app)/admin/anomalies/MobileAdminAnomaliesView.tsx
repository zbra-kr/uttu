'use client';
import { useState, useEffect } from 'react';
import { fetchDetectorRules, type DetectorRule } from '@/lib/queries-admin';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';

const SEV_COLOR: Record<string, string> = {
  high:   'var(--shf)',
  medium: 'var(--smf)',
  low:    'var(--f3)',
};
const SEV_BG: Record<string, string> = {
  high:   'var(--shb)',
  medium: 'var(--smb)',
  low:    'var(--snk)',
};

export default function MobileAdminAnomaliesView() {
  const [rules, setRules] = useState<DetectorRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');

  useEffect(() => {
    fetchDetectorRules()
      .then(data => { setRules(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>;

  const filtered = filter === 'all' ? rules : rules.filter(r => r.severity === filter);

  const counts = {
    high: rules.filter(r => r.severity === 'high').length,
    medium: rules.filter(r => r.severity === 'medium').length,
    low: rules.filter(r => r.severity === 'low').length,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 12px 20px' , width: '100%', minWidth: 0 }}>
      {/* 심각도 필터 칩 */}
      <div style={{ display: 'flex', gap: 6 }}>
        {([['all', '전체', rules.length], ['high', 'HIGH', counts.high], ['medium', 'MED', counts.medium], ['low', 'LOW', counts.low]] as [typeof filter, string, number][]).map(([v, label, cnt]) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            style={{
              flex: 1, padding: '6px 0', fontSize: 11, fontWeight: filter === v ? 700 : 400,
              background: filter === v ? 'var(--hs)' : 'var(--sur)',
              color: filter === v ? 'var(--rai)' : 'var(--f3)',
              border: '1px solid var(--bd)', borderRadius: 8, cursor: 'pointer',
            }}
          >
            {label} <span style={{ opacity: 0.75 }}>({cnt})</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <MobileEmptyState icon="🚩" title="탐지 규칙이 없습니다" />
      ) : (
        filtered.map(r => (
          <div key={r.id} style={{
            padding: '10px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10,
            borderLeft: `3px solid ${SEV_COLOR[r.severity] ?? 'var(--f4)'}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.label}
                </div>
                <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 2 }}>
                  {r.detector_key}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                <span style={{
                  fontSize: 9, fontWeight: 600, fontFamily: 'var(--mono)',
                  color: SEV_COLOR[r.severity] ?? 'var(--f4)',
                  background: SEV_BG[r.severity] ?? 'var(--snk)',
                  padding: '2px 6px', borderRadius: 4,
                }}>
                  {r.severity}
                </span>
                <span style={{
                  fontSize: 9, fontWeight: 600, fontFamily: 'var(--mono)',
                  color: r.enabled ? 'var(--slf)' : 'var(--f4)',
                  background: r.enabled ? 'var(--slb)' : 'var(--snk)',
                  padding: '2px 6px', borderRadius: 4,
                }}>
                  {r.enabled ? 'ON' : 'OFF'}
                </span>
              </div>
            </div>
            {r.description && (
              <div style={{ fontSize: 11, color: 'var(--f3)', marginTop: 5 }}>{r.description}</div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
