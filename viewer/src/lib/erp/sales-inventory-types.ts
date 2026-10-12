import { JOIN_REASONS, type JoinSummary } from './join-coverage';
import { SCHEMA_REASONS } from './observed-schema-boundary';
import type { ErpBrand, ErpRequest } from '../erp-insight-workspace';

export interface SalesInventoryRequest extends ErpRequest {
  brand: ErpBrand; inventoryAsOf: string;
  market: { store: string; category: string; gender: string; age: string };
}
export const READ_REASONS = {
  ...SCHEMA_REASONS,
  ...JOIN_REASONS,
  UNCONNECTED: 'ERP 읽기 공급자 미연결',
  ACCESS_DENIED: 'ERP 읽기 권한 확인 필요',
  INVALID_REQUEST: '기간·브랜드·시장 범위 확인 필요',
  READ_FAILED: '조회 실패 — 매출·재고 0으로 해석하지 마세요',
  INCOMPLETE: '응답 파티션 누락 또는 일부 조회 미완료',
  CONTRACT: '원천·집계 단위·갱신 시점·정의 증빙 확인 필요',
  INVALID_ROW: '누락 값·중복·범위 밖 원천 행 확인 필요',
  MAPPING: '브랜드·상품·시장 카테고리 매핑 확인 필요',
  EMPTY: '조회 범위에 검증된 표본 없음',
} as const;
export type ReadReason = keyof typeof READ_REASONS;
export interface Observation {
  brand: ErpBrand; style: string; productId: string; musinsaNo: string;
  from: string; to: string; inventoryAsOf: string;
  sales: { date: string; shop: string; color: string | null; size: string | null; vatExcludedKRW: string; quantity: string }[];
  shops: { shop: string; color: string; size: string; inventory: string; available: string }[];
  warehouses: { warehouse: string; color: string; size: string; available: string; online: string; offline: string }[];
  market: { fromRank: number; toRank: number; from: string; to: string; scope: SalesInventoryRequest['market'] };
  orders: null; receipts: null;
}
export type SalesInventoryState =
  | { kind: 'ready'; observations: Observation[]; coverage?: JoinSummary[]; reasons: []; executable: false }
  | { kind: 'unconnected' | 'withheld' | 'error' | 'empty'; observations: []; coverage?: JoinSummary[]; reasons: ReadReason[]; executable: false };
export function blocked(kind: Exclude<SalesInventoryState['kind'], 'ready'>, reason: ReadReason): SalesInventoryState {
  return { kind, observations: [], reasons: [reason], executable: false };
}
