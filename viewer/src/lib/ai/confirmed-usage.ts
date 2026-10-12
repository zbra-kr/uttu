// Confirmed lower-bound deltas, not an estimate of missing provider usage.
const MAX_COUNTER = 2_147_483_647; // Existing PostgreSQL INTEGER columns.
export type ConfirmedUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  // Caller-scoped call/turn identity; a raw provider id alone is insufficient.
  responseKey?: string;
};
export function confirmedTokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNTER
    ? value : null;
}

export class ConfirmedUsageLedger {
  inputTokens: number | null = null;
  outputTokens: number | null = null;
  incomplete = false;
  private keyed = new Map<string, Set<'inputTokens' | 'outputTokens'>>();
  private unkeyed = new WeakMap<object, Set<'inputTokens' | 'outputTokens'>>();

  observe(usage: ConfirmedUsage): void {
    // Non-streaming events represent one call/turn. Each confirmed axis can enter
    // this request's ledger once. A later duplicate may fill an unknown axis.
    const keyed = typeof usage.responseKey === 'string' && usage.responseKey.length > 0;
    let seen = keyed ? this.keyed.get(usage.responseKey!) : this.unkeyed.get(usage);
    if (!seen) {
      seen = new Set();
      if (keyed) this.keyed.set(usage.responseKey!, seen);
      else this.unkeyed.set(usage, seen);
    }
    for (const axis of ['inputTokens', 'outputTokens'] as const) {
      const value = confirmedTokenCount(usage[axis]);
      if (value === null) { this.incomplete = true; continue; }
      if (seen.has(axis)) continue;
      seen.add(axis);
      const next = (this[axis] ?? 0) + value;
      if (next > MAX_COUNTER) { this.incomplete = true; continue; }
      this[axis] = next;
    }
  }
}
