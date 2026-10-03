/** Stored observations only: these values never establish collector/process health. */
export type CountResult =
  | { state: 'available'; count: number }
  | { state: 'unavailable'; count: null };

export function readCount(result: PromiseSettledResult<{ count?: number | null; error?: unknown }>): CountResult {
  if (result.status === 'fulfilled' && !result.value.error &&
      Number.isSafeInteger(result.value.count) && result.value.count! >= 0) {
    return { state: 'available', count: result.value.count! };
  }
  return { state: 'unavailable', count: null };
}

export function formatStoredCount(count: number | null | undefined): string {
  return count == null ? '조회 불가' : count.toLocaleString();
}

/** Storage insertion timestamp, explicitly KST; not source freshness/completeness. */
export function kstInsertDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(time + 9 * 3600000).toISOString().slice(0, 10);
}

export const RUNNING_RECORD_LIMIT = 20;
export type RunningRecords<T> =
  | { state: 'available'; jobs: T[]; limit: number }
  | { state: 'unavailable'; jobs: []; limit: number };

export function runningRecordsLabel(result: RunningRecords<unknown> | null): string {
  if (!result) return 'running 기록 조회 중';
  if (result.state === 'unavailable') return 'running 기록 조회 불가';
  return `running 기록 ${result.jobs.length}건 (최근 최대 ${result.limit}건)`;
}
