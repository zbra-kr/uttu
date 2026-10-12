import { validCSDate } from './cs-daily-review-check';

export const ERP_BRANDS = ['CO', 'LE', 'WA', 'CK', 'LK'] as const;
export type ErpBrand = typeof ERP_BRANDS[number];
export const ERP_VIEW_IDS = ['planning', 'sales', 'margin', 'carryover', 'quality'] as const;
export type ErpViewId = typeof ERP_VIEW_IDS[number];
export const REASON_TEXT = {
  ERP_UNCONNECTED: 'ERP 연결 미완료',
  KPI_UNVERIFIED: '실제 KPI 산식 확인 필요',
  KEY_UNVERIFIED: '브랜드·상품·옵션 연결키 확인 필요',
  VAT_UNRECONCILED: '중앙 매출과 상세 매출의 VAT·반품·반올림 기준 대사 필요',
  PERIOD_UNVERIFIED: '기간·시즌·이관 매장 제외 기준 확인 필요',
  SCOPE_UNVERIFIED: '무신사 날짜·카테고리·스토어·성별·연령 범위 확인 필요',
  REQUEST_REQUIRED: '조회 시작일·종료일·시즌 연도를 선택해 주세요',
  REQUEST_INVALID: '유효한 조회 기간·시즌·브랜드를 선택해 주세요',
  READ_FAILED: '자료 확인 실패 — 빈 결과나 매출 0으로 해석하지 마세요',
  UNSUPPORTED_RESULT: '검증되지 않은 입력은 현황 데이터로 표시하지 않습니다',
} as const;
export type ErpReason = keyof typeof REASON_TEXT;
export type ErpReadKind = 'unconnected' | 'loading' | 'error' | 'empty' | 'withheld';
export interface ErpReadState { kind: ErpReadKind; codes?: readonly ErpReason[] }
export interface ErpRequest { brand: 'all' | ErpBrand; from: string; to: string; year: string; season: 'SS' | 'FW' }
export const INITIAL_ERP_REQUEST: ErpRequest = { brand: 'all', from: '', to: '', year: '', season: 'FW' };
export const UNCONNECTED_ERP_STATE: ErpReadState = { kind: 'unconnected' };
const CHECKS: ErpReason[] = ['ERP_UNCONNECTED', 'KPI_UNVERIFIED', 'KEY_UNVERIFIED', 'VAT_UNRECONCILED', 'PERIOD_UNVERIFIED', 'SCOPE_UNVERIFIED'];

export function requestReason(input: unknown): ErpReason | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'REQUEST_INVALID';
  const request = input as ErpRequest;
  if (['brand', 'from', 'to', 'year', 'season'].some(key => typeof request[key as keyof ErpRequest] !== 'string')) return 'REQUEST_INVALID';
  if (!request.from || !request.to || !request.year) return 'REQUEST_REQUIRED';
  if (!validCSDate(request.from) || !validCSDate(request.to) || request.from > request.to
      || !/^20\d{2}$/.test(request.year) || !['SS', 'FW'].includes(request.season)
      || !['all', ...ERP_BRANDS].includes(request.brand)) return 'REQUEST_INVALID';
  return null;
}

// No ready/numeric state exists until an actual ERP adapter and receipt are reviewed.
export function resolveErpWorkspace(input: unknown, request: ErpRequest) {
  const candidate = input as Partial<ErpReadState> | null;
  const valid = candidate && typeof candidate.kind === 'string' && ['unconnected', 'loading', 'error', 'empty', 'withheld'].includes(candidate.kind);
  const kind: ErpReadKind = valid ? candidate.kind as ErpReadKind : 'error';
  const supplied = Array.isArray(candidate?.codes) ? candidate.codes.filter(code => typeof code === 'string' && Object.hasOwn(REASON_TEXT, code)) : [];
  const reason = requestReason(request);
  const codes = [...new Set<ErpReason>([...CHECKS, ...supplied, ...(!valid ? ['UNSUPPORTED_RESULT' as const] : []), ...(kind === 'error' ? ['READ_FAILED' as const] : []), ...(reason ? [reason] : [])])];
  const title = kind === 'loading' ? '연결 상태 확인 중 · 판단 보류' : kind === 'error' ? '자료 확인 실패 · 판단 보류'
    : kind === 'empty' ? '이 조회 범위의 검증된 자료 없음 · 판단 보류'
    : kind === 'withheld' ? '데이터 계약 확인 필요 · 판단 보류' : 'ERP 연결 미완료 · 판단 보류';
  return { kind, title, codes, messages: codes.map(code => REASON_TEXT[code]), rows: [] as readonly never[], value: null, executable: false as const };
}

export const ERP_VIEWS: Record<ErpViewId, { label: string; title: string; description: string; metrics: string[]; columns: string[]; question: string; basis: string }> = {
  planning: { label: '기획 × 시장', title: '기획·시장 기회', description: '포털의 발주·입고·판매율·재고 기준에 동일 범위 무신사 동향을 나란히 연결합니다.',
    metrics: ['매출 · VAT 제외', '판매율', '발주 수량', '입고 수량', '재고 수량', '시장 연결 대상'],
    columns: ['상품 / 품목', '브랜드', '시즌', '발주', '입고', '판매율', '재고', '온라인 가용', '시장 순위', '확인 근거'],
    question: '시장 순위 상승과 낮은 내부 판매율이 같은 상품·기간에서 관측되는가?', basis: '발주·누적 입고와 기간 매출을 혼합하지 않습니다. 판매율 분모와 자회사 이관 제외 기준 확인이 필요합니다.' },
  sales: { label: '매출 × 시장', title: '매출 실적·시장 반응', description: '포털의 실적·목표·전주 비교 기준을 유지하며 시장 관측과 내부 실적의 방향을 비교합니다.',
    metrics: ['매출 · VAT 제외', '판매 수량', '전주 대비', '목표 달성률', '원가율', '제조이익'],
    columns: ['상품 / 채널', '브랜드', '시즌', '매출', '수량', '목표 달성률', '전주 대비', '시장 순위', '기준일', '확인 근거'],
    question: '시장 반응은 상승했는데 내부 매출은 하락한 상품이 같은 범위에서 관측되는가?', basis: '중앙 VW_SALES_VAT와 상세 SW_SALEINFO / 1.1은 자동으로 같은 실적으로 취급하지 않습니다. 전사·무신사 채널도 구분해야 합니다.' },
  margin: { label: '할인 × 이익', title: '할인·제조이익과 경쟁 가격', description: '내부 할인·원가·제조이익과 동일 조건 경쟁상품의 표시 가격을 구분해 확인합니다.',
    metrics: ['매출 · VAT 제외', '내부 할인율', '제조이익', '경쟁 표시 할인', '경쟁 표본', '점검 대상'],
    columns: ['상품', '브랜드', '시즌', '매출', '내부 할인', '제조이익', '경쟁 표시 할인', '경쟁 표본', '확인 근거'],
    question: '내부 할인 확대와 이익 감소가 함께 관측되는 상품의 경쟁 가격 조건은 무엇인가?', basis: 'EIS 집계 할인율과 외부 표시 할인율·단순 평균은 서로 다른 지표입니다. 경쟁 할인으로 원가나 실현이익을 추정하지 않습니다.' },
  carryover: { label: '이월 × 재노출', title: '이월재고·재노출 검토', description: '포털의 시즌·이월·재고금액·재고주수 기준을 유지하고 외부 관측을 확인 근거로 추가합니다.',
    metrics: ['이월 매출', '재고 수량', '재고금액', '판매율', '재고주수', '시장 연결 대상'],
    columns: ['이월 상품', '브랜드', '시즌', '재고', '온라인 가용', '재고금액', '판매율', '재고주수', '시장 순위', '확인 근거'],
    question: '이월 재고가 있는 상품과 동일 범위의 시장 관측 상승이 함께 확인되는가?', basis: 'SS/FW 모두 스탠다드 시즌을 포함합니다. 실제 이월 정의와 재고주수 분모 확인 전 소진일·발주량을 제안하지 않습니다.' },
  quality: { label: '리뷰 × 품질', title: '실적·리뷰 품질 확인', description: '상품 실적과 익명 리뷰 표본을 같은 상품·기간으로 연결해 품질 확인 대상을 찾습니다.',
    metrics: ['매출 · VAT 제외', '판매 수량', '리뷰 표본', '저평점 표본', '저평점 비율', '반품 연결 상태'],
    columns: ['상품', '브랜드', '시즌', '매출', '수량', '시장 순위', '리뷰 표본', '저평점 비율', '리뷰 기간', '확인 근거'],
    question: '상품 실적·시장 관심과 저평점 리뷰가 같은 기간에서 함께 관측되는가?', basis: '리뷰 표본 0은 만족도 100%가 아닙니다. 수집일·리뷰 작성일·반품 기간을 구분하며 고객 개인 식별키를 연결하지 않습니다.' },
};
