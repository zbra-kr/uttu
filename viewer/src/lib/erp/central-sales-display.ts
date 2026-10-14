// Display convention from pinned EIS709c1a7: sales API Number(REVENUE),
// formatters.ts fmtM (value/1e6, one fractional digit), sales page VAT-ex label.
// FLOAT remains approximate; a numeric string is transport, not precision repair.
export const CENTRAL_AMOUNT_REASONS = {
  FLOAT_DISPLAY_ONLY: 'FLOAT 근사 표시 · 원단위 정밀도 미확인',
  NULL_AGGREGATE: '원천 집계 NULL · 금액 보류',
  INVALID_AMOUNT: '유효한 숫자 집계가 아님 · 금액 보류',
  NUMBER_OVERFLOW: 'Number 유한 범위 초과 · 금액 보류',
  NUMBER_UNDERFLOW: 'Number 변환 시 0으로 소실 · 금액 보류',
  TOTAL_INCOMPLETE: '금액 보류 행이 있어 합계 보류',
} as const;
export type AmountReason = keyof typeof CENTRAL_AMOUNT_REASONS;
export interface CentralAmountDisplay {
  sourceType: 'FLOAT';
  transportType: 'number' | 'numeric-string' | 'null' | 'invalid';
  sourceValue: number | string | null;
  approximateValue: number | null;
  millionsText: string | null;
  reason: AmountReason;
  exactValue: null;
}
export interface CentralDisplayRow {
  brand: string; styleId: string; saleDate: string; amount: CentralAmountDisplay;
}
export interface CentralDisplayTotal {
  approximateValue: number | null; millionsText: string | null;
  reason: 'FLOAT_DISPLAY_ONLY' | 'TOTAL_INCOMPLETE' | 'NUMBER_OVERFLOW'; exactValue: null;
}
export function formatEisMillions(value: number): string {
  // Explicit Korean locale keeps server and browser output deterministic.
  return (value / 1e6).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
export function centralAmountDisplay(raw: unknown): CentralAmountDisplay {
  const state: CentralAmountDisplay = { sourceType:'FLOAT', transportType:'invalid', sourceValue:null,
    approximateValue:null, millionsText:null, reason:'INVALID_AMOUNT', exactValue:null };
  if (raw === null) return { ...state, transportType:'null', reason:'NULL_AGGREGATE' };
  if (typeof raw === 'number') {
    state.transportType = 'number';
    if (!Number.isFinite(raw)) return { ...state, reason:'NUMBER_OVERFLOW' };
    state.sourceValue = raw;
  } else if (typeof raw === 'string' && raw.length <= 100 && /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) {
    state.transportType = 'numeric-string'; state.sourceValue = raw;
  } else return state;
  const approximateValue = Number(raw);
  if (!Number.isFinite(approximateValue)) return { ...state, reason:'NUMBER_OVERFLOW' };
  if (typeof raw === 'string' && approximateValue === 0 && /[1-9]/.test(raw.split(/[eE]/)[0])) return { ...state, reason:'NUMBER_UNDERFLOW' };
  return { ...state, approximateValue, millionsText:formatEisMillions(approximateValue), reason:'FLOAT_DISPLAY_ONLY' };
}
export function centralDisplayTotal(rows: readonly Pick<CentralDisplayRow,'amount'>[]): CentralDisplayTotal {
  if (rows.some(row => row.amount.approximateValue === null)) return { approximateValue:null, millionsText:null, reason:'TOTAL_INCOMPLETE', exactValue:null };
  // Neumaier compensated summation reduces avoidable addition loss between the
  // represented Number inputs. It cannot recover precision already lost in the
  // source FLOAT/SQL SUM or Number conversion. Never add rounded cell text.
  let sum = 0, compensation = 0;
  for (const row of rows) {
    const value = row.amount.approximateValue!;
    const next = sum + value;
    if (!Number.isFinite(next)) return { approximateValue:null, millionsText:null, reason:'NUMBER_OVERFLOW', exactValue:null };
    compensation += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
    if (!Number.isFinite(compensation)) return { approximateValue:null, millionsText:null, reason:'NUMBER_OVERFLOW', exactValue:null };
    sum = next;
  }
  const approximateValue = sum + compensation;
  if (!Number.isFinite(approximateValue)) return { approximateValue:null, millionsText:null, reason:'NUMBER_OVERFLOW', exactValue:null };
  return { approximateValue, millionsText:formatEisMillions(approximateValue), reason:'FLOAT_DISPLAY_ONLY', exactValue:null };
}
