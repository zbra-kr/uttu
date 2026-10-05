import type { BrandEvidence } from '@/lib/report-brand-evidence';

export default function BrandEvidenceStatus({ source, rankingDate, showRows = false, retry }: {
  source: { state: 'loading' | 'signedout' | 'error' | 'ready'; data: BrandEvidence | null };
  rankingDate?: string;
  showRows?: boolean;
  retry?: () => void;
}) {
  const value = source.data;
  return <div data-report-source="brand-ranking" data-state={source.state} role="status" style={{ fontSize: 12, color: 'var(--f3)', marginBottom: 8 }}>
    {source.state === 'loading' ? '브랜드 순위 불러오는 중…' : source.state === 'signedout' ? '브랜드 순위: 로그인이 필요합니다.'
      : source.state === 'error' ? '브랜드 순위를 확인하지 못했습니다. 빈 결과로 해석하지 마세요.'
      : !value?.date ? '이 조회 범위에 저장된 브랜드 순위가 없습니다.'
      : <>
        브랜드 순위 기준일 {value.date} · 비교일 {value.comparisonDate ?? '조회 범위 내 없음'}
        {rankingDate && value.date < rankingDate ? ` · 랭킹 기준일 ${rankingDate}보다 이전 자료` : rankingDate && value.date !== rankingDate ? ` · 랭킹 기준일 ${rankingDate}와 다른 날짜` : ''}
        <br />전체 카테고리 / 전체 성별 / 전체 연령 · 조회 {value.sampledRows}행 (최대 400행), 최신일 TOP {value.rows.length}
        {value.atLimit ? ' · 조회 상한 도달, 이전 날짜와 브랜드 포함 범위가 제한될 수 있습니다.' : ' · 전체 수집 완료 여부는 이 조회로 확인하지 않습니다.'}
      </>}
    {retry && source.state !== 'signedout' && <button type="button" className="btn sm" aria-label="브랜드 순위 다시 조회"
      aria-disabled={source.state === 'loading'} onClick={() => { if (source.state !== 'loading') retry(); }} style={{ marginLeft: 8 }}>다시 조회</button>}
    {showRows && source.state === 'ready' && value?.rows.map(row => <div key={row.brandName}>#{row.rank} {row.brandName}</div>)}
  </div>;
}
