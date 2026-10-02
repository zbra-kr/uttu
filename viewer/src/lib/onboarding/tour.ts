export const TOUR_VERSION = 1;
export const TOUR_STEPS = [
  { id: 'ai-entry', route: null, target: 'ai-entry', title: 'UTTU AI와 시작해요', description: 'AI 버튼에서 데이터 조회와 분석을 시작할 수 있어요. 먼저 안전한 예제로 둘러볼까요?', action: 'AI 열어보기' },
  { id: 'ai-question', route: null, target: 'ai-input', title: '질문 한 문장으로 분석하기', description: '현재 화면을 보면서 AI에게 질문할 수 있어요. 아래 예제를 눌러 답변이 어떻게 보이는지 연습해 보세요.', action: '다음' },
  { id: 'note-entry', route: '/ranking', target: 'note-entry', title: '동료와 나눌 내용은 메모에', description: 'PC 랭킹이나 상품·브랜드·회사 상세화면의 메모에서 의견을 남길 수 있어요. 연습용 메모를 열어볼게요.', action: '메모 열어보기' },
  { id: 'mention', route: '/ranking', target: null, title: '@이름으로 동료 부르기', description: '메모에서 @이름을 입력하면 동료를 선택할 수 있어요. 아래에서 @정호철을 입력하고 연습용 후보를 선택해 보세요.', action: '다음' },
  { id: 'bookmark', route: '/ranking', target: null, title: '다시 볼 항목은 북마크', description: '상품·브랜드·회사 화면에서 북마크 버튼을 누르면 나중에 쉽게 찾을 수 있어요. 연습용 상품을 저장해 보세요.', action: '저장한 곳 보기' },
  { id: 'saved-bookmarks', route: '/me', target: 'saved-bookmarks', title: '내 북마크는 마이페이지에', description: '실제로 저장한 북마크는 마이페이지에 모여요. 연습용 항목은 저장되지 않아요. 이제 직접 UTTU를 둘러보세요!', action: '시작하기' },
] as const;

export type TourState = { userId: string; eligible: boolean; status: 'pending' | 'completed' | 'skipped' | 'legacy'; step: number };
export type Rect = { top: number; left: number; width: number; height: number };
export function isTourState(value: unknown): value is TourState {
  if (!value || typeof value !== 'object') return false;
  const s = value as TourState;
  return typeof s.userId === 'string' && typeof s.eligible === 'boolean'
    && ['pending', 'completed', 'skipped', 'legacy'].includes(s.status)
    && Number.isInteger(s.step) && s.step >= 0 && s.step < TOUR_STEPS.length;
}
export function shouldAutoStart(state: TourState, dismissed: boolean) {
  return state.eligible && state.status === 'pending' && !dismissed;
}
export function clampSpotlight(rect: Rect, width: number, height: number): Rect | null {
  const left = Math.max(4, rect.left - 6);
  const top = Math.max(4, rect.top - 6);
  const right = Math.min(width - 4, rect.left + rect.width + 6);
  const bottom = Math.min(height - 4, rect.top + rect.height + 6);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}
export function positionCallout(rect: Rect | null, viewport: { width: number; height: number }, card: { width: number; height: number }) {
  const margin = 16;
  const gap = 16;
  const maxHeight = Math.max(1, viewport.height - margin * 2);
  const width = Math.min(card.width, Math.max(1, viewport.width - margin * 2));
  const height = Math.min(card.height, maxHeight);
  const maxLeft = Math.max(margin, viewport.width - width - margin);
  const maxTop = Math.max(margin, viewport.height - height - margin);
  const centered = { left: Math.max(margin, (viewport.width - width) / 2), top: Math.max(margin, (viewport.height - height) / 2), maxHeight, anchored: false };
  if (!rect || rect.top >= viewport.height || rect.top + rect.height <= 0) return centered;
  const left = Math.min(maxLeft, Math.max(margin, rect.left + rect.width / 2 - width / 2));
  const bottom = rect.top + rect.height;
  const below = bottom + gap;
  const above = rect.top - height - gap;
  const clampTop = (top: number) => Math.min(maxTop, Math.max(margin, top));
  // A slightly short preferred gap is better than covering the target. Check
  // the clamped rectangles, not just whether the full 16px gap fits exactly.
  for (const top of [clampTop(below), clampTop(above)]) {
    if (top >= bottom || top + height <= rect.top) return { left, top, maxHeight, anchored: true };
  }
  const aboveSpace = Math.max(0, rect.top - gap - margin);
  const belowSpace = Math.max(0, viewport.height - margin - bottom - gap);
  const clearHeight = Math.max(aboveSpace, belowSpace);
  if (clearHeight >= Math.min(180, maxHeight)) {
    // Keep the target clear and scroll the existing callout internally. The
    // caller measures natural scroll height so this cap cannot oscillate.
    return { left, top: aboveSpace >= belowSpace ? margin : below, maxHeight: Math.min(maxHeight, clearHeight), anchored: true };
  }
  // An almost full-screen target leaves no usable clear band. Present a
  // centered explanation with no spotlight rather than a covered spotlight.
  return centered;
}
