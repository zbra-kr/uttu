export const LEGACY_RANK_RULES = new Set([
  'rank_spike', 'rank_drop_own', 'new_entrant_top10', 'rank_return_own',
  'rank_exit_own', 'rank_multi_drop_own', 'brand_rank_drop_own',
  'brand_rank_spike_competitor', 'brand_new_entrant_top10',
  'brand_exit_top50_own', 'brand_rank_gender_diverge',
]);

export function isDailyRankObservation(row: { anomaly_type: string; meta?: Record<string, unknown> | null }) {
  const version = row.meta?.policy_version;
  return LEGACY_RANK_RULES.has(row.anomaly_type)
    && (version == null || version === 'legacy-rank-noise-v1');
}

export function observationExplanation(row: { anomaly_type: string; meta?: Record<string, unknown> | null }) {
  if (!isDailyRankObservation(row)) return null;
  if ((row.anomaly_type === 'rank_exit_own' || row.anomaly_type === 'brand_exit_top50_own')
      && row.meta?.rank_today == null) return '이전 이탈 기록 — 누락 원인 미확인';
  return '일일 순위 관측 — 지속성·기준선 확인 전';
}

export function prioritySeverity(row: { severity: string; anomaly_type: string; meta?: Record<string, unknown> | null }) {
  return isDailyRankObservation(row) ? 'lo' : row.severity === 'high' ? 'hi' : row.severity === 'medium' ? 'md' : 'lo';
}
