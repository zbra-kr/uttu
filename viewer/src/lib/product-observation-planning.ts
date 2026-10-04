import type { ObservedProductResult } from './queries-product-observation';

/** Only a resolved, exact observation can carry a planning check. */
export function observationPlanningCheck(result: ObservedProductResult | null): string | null {
  if (result?.status !== 'ready') return null;
  switch (result.row.own) {
    case true:
      return '현재 자사 상품으로 분류됩니다. 관측된 순위·표시 가격·할인율과 상품 사양·행사 조건을 원자료에서 확인하세요. 이 관측만으로 판매량·재고·수요는 알 수 없습니다.';
    case false:
      return '현재 자사 상품으로 분류되지 않습니다. 해당 상품의 사양·표시 가격·행사 조건을 원자료에서 확인하세요. 이 관측만으로 판매량·재고·수요는 알 수 없습니다.';
    default:
      return '현재 자사 분류가 확인되지 않습니다. 분류와 상품 사양·표시 가격·행사 조건을 원자료에서 확인하세요. 이 관측만으로 판매량·재고·수요는 알 수 없습니다.';
  }
}
