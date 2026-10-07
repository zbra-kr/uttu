import type { ProductHistoryCoverage as Coverage } from '@/lib/product-history-window';

export default function ProductHistoryCoverage({ coverage, status = 'ready', onRetry }: {
  coverage?: Coverage; status?: 'loading' | 'ready' | 'error'; onRetry?: () => void;
}) {
  const style = { fontSize: 11, color: 'var(--f4)', lineHeight: 1.6, padding: '0 12px' };
  if (status === 'loading') return <p role="status" style={style}>상품 순위·가격 이력을 불러오는 중입니다.</p>;
  if (status === 'error') return <div role="alert" style={style}>상품 순위·가격 이력을 불러오지 못했습니다. 이전 이력을 대신 표시하지 않습니다.
    <button type="button" onClick={onRetry}>이력 다시 시도</button>
  </div>;
  if (!coverage) return null;
  return <p role="status" style={style}>
    {coverage.mode === 'weekly' ? '주별 마지막 관측일 순위·동일 관측 가격. ' : '일별 최고 순위·동일 관측 가격. '}
    {coverage.horizonStart && `조회 범위 ${coverage.horizonStart} ~ ${coverage.horizonEnd} (최근 52개 달력 주). `}
    {coverage.firstDate && coverage.lastDate ? `표시 관측 기간 ${coverage.firstDate} ~ ${coverage.lastDate}. ` : '조회 범위에 저장된 순위 관측이 없습니다. '}
    전체 카테고리·성별·연령 중 각 날짜의 최고 순위 관측이며 가격도 같은 관측을 사용합니다. 선택한 랭킹 관측의 추이가 아닙니다.
    {' '}저장 관측 기준이며 수집 완료를 뜻하지 않습니다.
    {coverage.latestPartialWeek && ' 최신 진행 중인 주의 부분 관측을 포함합니다.'}
    {coverage.mode === 'weekly' && coverage.latestObservedDays && ` 최신 표시 주는 ${coverage.latestObservedDays}일의 저장 관측이며, 주 전체 수집 완료를 뜻하지 않습니다.`}
    {coverage.missingPrices > 0 && ` 동일 관측에 유효 가격이 없는 ${coverage.missingPrices}개 구간은 가격 선을 끊어 표시합니다.`}
  </p>;
}
