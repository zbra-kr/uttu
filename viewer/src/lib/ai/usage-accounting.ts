import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export type UsageSettlement = {
  status: 'recorded' | 'unrecorded' | 'unknown';
  reason: 'acknowledged' | 'invalid' | 'read_failed' | 'write_failed' | 'ambiguous_receipt' | 'contention' | 'deadline' | 'cancelled';
};
export type UsageSettlementOptions = { signal?: AbortSignal; deadlineAt?: number };
const SETTLEMENT_TIMEOUT_MS = 2_000;
const MAX_ATTEMPTS = 5;
const MAX_COUNTER = 2_147_483_647; // Existing PostgreSQL INTEGER columns.
const validCounter = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_COUNTER;

function matchesReceipt(data: unknown, next: Record<string, number>): boolean {
  if (!Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== 'object') return false;
  return Object.keys(next).every(column => data[0][column] === next[column]);
}

async function accumulate(
  client: SupabaseClient,
  table: 'ai_usage_daily' | 'mcp_usage_daily',
  keys: Record<string, string>,
  delta: Record<string, number>,
  options: UsageSettlementOptions,
): Promise<UsageSettlement> {
  const columns = Object.keys(delta);
  if (Object.values(keys).some(value => !value) || !Object.values(delta).every(validCounter)) {
    return { status: 'unrecorded', reason: 'invalid' };
  }
  const controller = new AbortController();
  let stopReason: 'deadline' | 'cancelled' = 'cancelled';
  let writeAttempted = false;
  const stopped = new Error('usage settlement stopped');
  let rejectStopped!: (error: Error) => void;
  const stopPromise = new Promise<never>((_, reject) => { rejectStopped = reject; });
  // Attach a handler even when cancellation happens before the first query.
  void stopPromise.catch(() => {});
  controller.signal.addEventListener('abort', () => rejectStopped(stopped), { once: true });
  const cancel = () => {
    if (controller.signal.aborted) return;
    stopReason = options.deadlineAt !== undefined && Date.now() >= options.deadlineAt ? 'deadline' : 'cancelled';
    controller.abort();
  };
  const timeLeft = Math.min(SETTLEMENT_TIMEOUT_MS, (options.deadlineAt ?? Infinity) - Date.now());
  const timer = setTimeout(() => {
    if (!controller.signal.aborted) { stopReason = 'deadline'; controller.abort(); }
  }, Math.max(0, timeLeft));
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  else if (timeLeft <= 0) { stopReason = 'deadline'; controller.abort(); }
  async function execute<T>(query: PromiseLike<T>, write = false): Promise<T> {
    if (controller.signal.aborted) throw stopped;
    if (write) writeAttempted = true;
    // The race bounds caller latency even if a transport ignores AbortSignal.
    // A late response has handlers attached but cannot restart/replay settlement.
    return Promise.race([Promise.resolve(query), stopPromise]);
  }
  try {
    // Retry only a receipt proving no write: a conditional UPDATE matched zero
    // rows, or INSERT got a unique violation. Never retry an ambiguous write.
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let existing: Record<string, number> | null;
      try {
        let query = client.from(table).select(columns.join(','));
        for (const [key, value] of Object.entries(keys)) query = query.eq(key, value);
        const read = await execute(query.abortSignal(controller.signal).maybeSingle());
        if (read.error) return { status: 'unrecorded', reason: 'read_failed' };
        existing = read.data as Record<string, number> | null;
        if (existing !== null && (!existing || !columns.every(column => validCounter(existing![column])))) {
          return { status: 'unrecorded', reason: 'invalid' };
        }
      } catch (error) {
        return { status: 'unrecorded', reason: error === stopped ? stopReason : 'read_failed' };
      }
      const next = Object.fromEntries(columns.map(column => [column, (existing?.[column] ?? 0) + delta[column]]));
      if (!Object.values(next).every(validCounter)) return { status: 'unrecorded', reason: 'invalid' };
      try {
        if (existing === null) {
          const query = table === 'ai_usage_daily'
            ? client.from(table).insert({ user_id: keys.user_id, usage_date: keys.usage_date,
                input_tokens: next.input_tokens, output_tokens: next.output_tokens,
                session_count: next.session_count, message_count: next.message_count }).select(columns.join(','))
            : client.from(table).insert({ usage_date: keys.usage_date,
                input_tokens: next.input_tokens, output_tokens: next.output_tokens,
                call_count: next.call_count }).select(columns.join(','));
          const inserted = await execute(query.abortSignal(controller.signal), true);
          if (inserted.error?.code === '23505') { writeAttempted = false; continue; }
          if (inserted.error) return { status: 'unknown', reason: 'write_failed' };
          if (matchesReceipt(inserted.data, next)) {
            return { status: 'recorded', reason: 'acknowledged' };
          }
          return { status: 'unknown', reason: 'ambiguous_receipt' };
        }
        let query = client.from(table).update(next);
        for (const [key, value] of Object.entries(keys)) query = query.eq(key, value);
        for (const column of columns) query = query.eq(column, existing[column]);
        const updated = await execute(query.select(columns.join(',')).abortSignal(controller.signal), true);
        if (updated.error) return { status: 'unknown', reason: 'write_failed' };
        if (Array.isArray(updated.data) && updated.data.length === 0) { writeAttempted = false; continue; }
        if (matchesReceipt(updated.data, next)) {
          return { status: 'recorded', reason: 'acknowledged' };
        }
        return { status: 'unknown', reason: 'ambiguous_receipt' };
      } catch (error) {
        return { status: writeAttempted ? 'unknown' : 'unrecorded',
                 reason: error === stopped ? stopReason : 'write_failed' };
      }
    }
    return { status: 'unrecorded', reason: 'contention' };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}

export function accumulateAiUsage(
  client: SupabaseClient, userId: string, usageDate: string, inputTokens: number, outputTokens: number,
  options: UsageSettlementOptions = {},
): Promise<UsageSettlement> {
  return accumulate(client, 'ai_usage_daily', { user_id: userId, usage_date: usageDate }, {
    input_tokens: inputTokens, output_tokens: outputTokens, session_count: 1, message_count: 2,
  }, options);
}

export function accumulateMcpDailyUsage(
  client: SupabaseClient, usageDate: string, inputTokens: number, outputTokens: number,
  options: UsageSettlementOptions = {},
): Promise<UsageSettlement> {
  return accumulate(client, 'mcp_usage_daily', { usage_date: usageDate }, {
    input_tokens: inputTokens, output_tokens: outputTokens, call_count: 1,
  }, options);
}
