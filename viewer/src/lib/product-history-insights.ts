import type { ProductPriceHistory, ProductRankHistory } from './product-history-window';

const DAY = 86400000;
function day(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const value = Date.parse(date + 'T00:00:00Z');
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === date ? value / DAY : null;
}
const date = (value: number) => new Date(value * DAY).toISOString().slice(0, 10);
const monday = (value: number) => value - (new Date(value * DAY).getUTCDay() + 6) % 7;
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

/** Compare calendar periods from the receipt's horizon, never array positions or client time. */
export function productHistoryInsights(rank: ProductRankHistory, price: ProductPriceHistory) {
  const coverage = rank.coverage;
  const mode = coverage?.mode;
  const start = day(coverage?.horizonStart ?? ''), end = day(coverage?.horizonEnd ?? '');
  const weekly = mode === 'weekly';
  const sampleLabel = weekly ? '주별 대표값' : '일별 관측';
  const unavailable = {
    mean: null as number | null, stdDev: null as number | null, sampleCount: 0,
    sampleLabel, meanLabel: `${sampleLabel} 평균`, sampleNote: '조회 단위·범위를 확인할 수 없습니다.',
    trendLabel: weekly ? '종료 주 대표값 비교' : '최근 7일 평균 비교',
    velocity: null as number | null, trendNote: '조회 단위·범위를 확인할 수 없습니다.',
    discountDelta: null as number | null, discountCount: 0, discountNote: '조회 단위·범위를 확인할 수 없습니다.',
  };
  if ((mode !== 'daily' && mode !== 'weekly') || start === null || end === null || start > end) return unavailable;
  const entries = rank.flatMap(point => {
    const at = day(point.date);
    return at !== null && at >= start && at <= end && Number.isSafeInteger(point.rank) && point.rank > 0
      ? [{ at, rank: point.rank }] : [];
  }).sort((a, b) => a.at - b.at);
  // Ambiguous duplicate dates/weeks are not valid comparison samples.
  const byBucket = new Map<number, typeof entries>();
  for (const entry of entries) {
    const key = weekly ? monday(entry.at) : entry.at;
    byBucket.set(key, [...(byBucket.get(key) ?? []), entry]);
  }
  const valid = [...byBucket.values()].filter(points => points.length === 1).map(points => points[0]);
  const samples = valid.map(point => point.rank);
  const average = mean(samples);
  const stdDev = samples.length >= 3 && average !== null
    ? Math.sqrt(samples.reduce((sum, value) => sum + (value - average) ** 2, 0) / samples.length) : null;
  const recentStart = weekly ? monday(end) - 7 : end - 6;
  const recentEnd = weekly ? monday(end) - 1 : end;
  const previousStart = recentStart - 7, previousEnd = recentStart - 1;
  const recent = valid.filter(point => point.at >= recentStart && point.at <= recentEnd);
  const previous = valid.filter(point => point.at >= previousStart && point.at <= previousEnd);
  const needed = weekly ? 1 : 7;
  const complete = previousStart >= start && recent.length === needed && previous.length === needed;
  const velocity = complete ? Math.round(mean(previous.map(point => point.rank))! - mean(recent.map(point => point.rank))!) : null;
  const range = `${date(recentStart)} ~ ${date(recentEnd)} / ${date(previousStart)} ~ ${date(previousEnd)}`;
  const countNote = weekly ? `대표값 ${recent.length}/1개 · 이전 ${previous.length}/1개` : `관측 ${recent.length}/7일 · 이전 ${previous.length}/7일`;
  const partial = weekly && valid.some(point => monday(point.at) === monday(end));
  const trendNote = `${range} · ${countNote}${complete ? '' : ' · 비교 표본 부족'}${weekly ? ' · 주별 마지막 관측 · 진행 주 제외' : ''}`;

  const priceScope = price.coverage;
  const aligned = priceScope?.mode === mode && priceScope.horizonStart === coverage?.horizonStart && priceScope.horizonEnd === coverage?.horizonEnd;
  const rankByBucket = new Map(valid.map(point => [weekly ? monday(point.at) : point.at, point]));
  const prices = new Map<number, typeof price>();
  for (const point of price) {
    const at = day(point.date);
    if (at !== null && at >= start && at <= end) prices.set(at, [...(prices.get(at) ?? []), point]);
  }
  const deltas: number[] = [];
  if (aligned) for (const point of valid) {
    if (weekly && monday(point.at) >= monday(end)) continue;
    const recorded = prices.get(point.at);
    const rate = recorded?.length === 1 ? recorded[0].discount_rate : null;
    if (rate === null || rate === undefined || !Number.isFinite(rate) || rate <= 0) continue;
    const previousPoint = rankByBucket.get(weekly ? monday(point.at) - 7 : point.at - 1);
    if (previousPoint) deltas.push(point.rank - previousPoint.rank);
  }
  return {
    ...unavailable, mean: average, stdDev, sampleCount: valid.length,
    sampleNote: `${sampleLabel} ${valid.length}개${partial ? ' · 진행 주 포함' : ''}${stdDev === null ? ' · 안정성은 3개 이상 필요' : ''}`,
    velocity, trendNote,
    discountDelta: deltas.length ? Math.round(mean(deltas)!) : null, discountCount: deltas.length,
    discountNote: !aligned ? '순위·가격 조회 범위가 다릅니다.' : weekly
      ? `${deltas.length}개 인접 주 대표값 비교 · 진행 주 제외`
      : `${deltas.length}개 연속 관측일 비교`,
  };
}
