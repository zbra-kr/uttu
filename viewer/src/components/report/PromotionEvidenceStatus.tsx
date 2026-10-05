'use client';
import type { EvidenceState, PromotionSource, PromotionHeaders, PromotionItems, PromotionEvidence } from '@/lib/report-promotion-evidence';

function SourceStatus<T>({ label, source, retry }: { label: string; source: EvidenceState<PromotionSource<T>>; retry: () => void }) {
  const message = source.state === 'loading' ? `${label} 불러오는 중…`
    : source.state === 'error' ? `${label} 조회 실패 — 빈 결과로 해석하지 않습니다.`
    : source.state === 'signedout' ? `${label}: 로그인이 필요합니다.`
    : !source.data?.sampledRows ? `저장된 ${label}${label.endsWith('아이템') ? '이' : '가'} 없습니다.`
    : `${label} 최신 반환 기준일 ${source.data.date} · 조회 ${source.data.sampledRows.toLocaleString()}행${source.data.atLimit ? ' · 조회 상한 도달: 일부 결과일 수 있습니다.' : ''}`;
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
    <span role="status" style={{ flex: '1 1 240px' }}>{message}</span>
    {source.state !== 'signedout' && <button className="btn sm" type="button" aria-label={`${label} 다시 조회`}
      aria-disabled={source.state === 'loading'} onClick={() => { if (source.state !== 'loading') retry(); }}>다시 조회</button>}
  </div>;
}
export default function PromotionEvidenceStatus({ headers, items, evidence, retryHeaders, retryItems, rankingDate }:
  { headers: EvidenceState<PromotionHeaders>; items: EvidenceState<PromotionItems>; evidence: PromotionEvidence;
    retryHeaders: () => void; retryItems: () => void; rankingDate?: string }) {
  return <div data-promotion-evidence style={{ padding: 12, border: '1px solid var(--bs)', borderRadius: 8,
    fontSize: 12, color: 'var(--f3)', lineHeight: 1.6, minWidth: 0, overflowWrap: 'anywhere' }}>
    <SourceStatus label="프로모션 헤더" source={headers} retry={retryHeaders} />
    <SourceStatus label="프로모션 아이템" source={items} retry={retryItems} />
    {evidence.itemCount !== null && <div role="status">
      아이템 기준일 {evidence.date ?? '없음'} · 해당 날짜 조회 {evidence.itemCount.toLocaleString()}행
      {` · 유형 미확인 ${evidence.unknownClassification}행 · 할인율 미확인 ${evidence.unknownDiscount}행 · 브랜드명 미확인 ${evidence.unknownBrand}행`}
    </div>}
    <div>유형은 헤더와 아이템의 ID·기준일이 일치할 때만 분류합니다. 날짜별 기록은 당일 수정될 수 있으며, 전체 수집 완료·당시 또는 현재 행사 진행 여부는 확인하지 못합니다.</div>
    {rankingDate && (!evidence.coherent || evidence.date !== rankingDate) &&
      <div>세일판 랭킹 비교 보류 — 유형·조회 범위 또는 랭킹 기준일({rankingDate})과의 일치를 확인하지 못했습니다.</div>}
  </div>;
}
