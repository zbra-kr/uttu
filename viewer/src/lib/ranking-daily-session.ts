import { DAILY_STORE, DAILY_RANK_LIMIT, DAILY_READ_LIMIT, validateDailyRequest, type DailyRequest, type DailyData } from './ranking-daily-insights';

// A responsive remount may reuse one settled observation for at most one minute.
// No polling: expiry is checked on acquisition; the user can also explicitly refresh.
export const DAILY_REUSE_MS = 60_000;
export interface DailySessionEntry { key: string; loading: boolean; data: DailyData | null; error: boolean; completedAt: number | null }
export interface DailySessionSnapshot { active: boolean; ready: boolean; hasAccount: boolean; epoch: number; entry: DailySessionEntry | null }
export const EMPTY_DAILY_SESSION: DailySessionSnapshot = { active: false, ready: false, hasAccount: false, epoch: 0, entry: null };
export function dailySessionKey(request: DailyRequest): string {
  return JSON.stringify([DAILY_STORE, DAILY_RANK_LIMIT, DAILY_READ_LIMIT, 'left-enrichment-v1', request.categoryCode, request.genderFilter, request.ageFilter, request.date ?? 'latest']);
}

/** Provider-owned, single active entry. Never persisted or shared between providers. */
export function createDailyRankingSession(read: (request: DailyRequest, signal?: AbortSignal) => Promise<DailyData>, now = Date.now) {
  let snapshot = EMPTY_DAILY_SESSION, account: string | null = null, generation = 0;
  let controller: AbortController | null = null;
  const listeners = new Set<() => void>();
  const publish = (value: DailySessionSnapshot) => { snapshot = value; for (const listener of listeners) listener(); };
  const invalidate = () => { generation++; controller?.abort(); controller = null; };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => EMPTY_DAILY_SESSION,
    enter() { if (!snapshot.active) publish({ ...snapshot, active: true }); },
    identity(userId: string | null, forceEpoch = false) {
      if (!snapshot.active || (snapshot.ready && userId === account && !forceEpoch)) return;
      invalidate(); account = userId;
      publish({ ...snapshot, ready: true, hasAccount: !!userId, epoch: snapshot.epoch + 1, entry: null });
    },
    clearScope() { if (snapshot.entry) { invalidate(); publish({ ...snapshot, entry: null }); } },
    acquire(request: DailyRequest, force = false) {
      if (!snapshot.active || !snapshot.ready || !account || !validateDailyRequest(request)) return;
      const key = dailySessionKey(request), existing = snapshot.entry;
      if (!force && existing?.key === key && (existing.loading || (!existing.error && existing.completedAt !== null
        && now() >= existing.completedAt && now() - existing.completedAt < DAILY_REUSE_MS))) return;
      invalidate();
      const epoch = snapshot.epoch, owner = account, ticket = generation;
      const current = new AbortController(); controller = current;
      publish({ ...snapshot, entry: { key, loading: true, data: null, error: false, completedAt: null } });
      const stillCurrent = () => snapshot.active && snapshot.epoch === epoch && account === owner
        && generation === ticket && !current.signal.aborted;
      Promise.resolve().then(() => {
        if (!stillCurrent()) return null;
        return read({ ...request }, current.signal);
      }).then(data => {
        if (!data || !stillCurrent()) return;
        controller = null;
        publish({ ...snapshot, entry: { key, loading: false, data, error: false, completedAt: now() } });
      }).catch(() => {
        if (!stillCurrent()) return;
        controller = null;
        publish({ ...snapshot, entry: { key, loading: false, data: null, error: true, completedAt: null } });
      });
    },
    leave() {
      invalidate(); account = null;
      publish({ active: false, ready: false, hasAccount: false, epoch: snapshot.epoch + 1, entry: null });
    },
  };
}
export type DailyRankingSession = ReturnType<typeof createDailyRankingSession>;
