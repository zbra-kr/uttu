'use client';
import type { RecommendState, RecommendSource, RecommendModules, RecommendItems, RecommendEvidence } from '@/lib/report-recommend-evidence';

function SourceStatus<T>({ kind, label, source, retry }: { kind: string; label: string; source: RecommendState<RecommendSource<T>>; retry: () => void }) {
  const message = source.state === 'loading' ? `${label} 불러오는 중…`
    : source.state === 'error' ? `${label} 조회 실패 — 빈 결과나 미노출로 해석하지 않습니다.`
    : source.state === 'signedout' ? `${label}: 로그인이 필요합니다.`
    : !source.data?.sampledRows ? `저장된 ${label}이 없습니다.`
    : `${label} 기준일 ${source.data.date} · 해당 날짜 ${source.data.latestRows.length}행 · 조회 ${source.data.sampledRows}행${source.data.atLimit ? ' · 조회 상한 도달: 일부 결과일 수 있습니다.' : ''}`;
  return <div data-recommend-source={kind} data-state={source.state} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
    <span role="status" style={{ flex: '1 1 240px' }}>{message}</span>
    {source.state !== 'signedout' && <button className="btn sm" type="button" aria-label={`${label} 다시 조회`}
      aria-disabled={source.state === 'loading'} onClick={() => { if (source.state !== 'loading') retry(); }}>다시 조회</button>}
  </div>;
}
export default function RecommendEvidenceStatus({ modules, items, evidence, retryModules, retryItems, rankingDate, showRows = false }:
  { modules: RecommendState<RecommendModules>; items: RecommendState<RecommendItems>; evidence: RecommendEvidence;
    retryModules: () => void; retryItems: () => void; rankingDate?: string; showRows?: boolean }) {
  return <div data-recommend-evidence style={{ padding: 12, border: '1px solid var(--bs)', borderRadius: 8,
    fontSize: 12, color: 'var(--f3)', lineHeight: 1.6, minWidth: 0, overflowWrap: 'anywhere' }}>
    <SourceStatus kind="modules" label="추천 모듈" source={modules} retry={retryModules} />
    <SourceStatus kind="items" label="추천 아이템" source={items} retry={retryItems} />
    {evidence.itemCount !== null && <div role="status">
      아이템 기준일 {evidence.itemDate ?? '없음'} · 관찰 {evidence.itemCount}행 · 브랜드명 확인 {evidence.knownBrandCount}개
      {` · 모듈 연결 미확인 ${evidence.unknownJoin}행 · 브랜드명 미확인 ${evidence.unknownBrand}행`}
    </div>}
    {modules.state === 'ready' && <div>아이템 수가 일치하지 않거나 확인되지 않은 모듈 {evidence.unaccountedModules}개</div>}
    <div>전체 성별 조회 범위의 날짜별 관찰입니다. 모듈 ID·기준일·성별이 일치할 때만 노출을 연결하며, 전체 수집 완료나 현재 노출 여부는 확인하지 못합니다.</div>
    {rankingDate && (!evidence.coherent || evidence.itemDate !== rankingDate) &&
      <div>추천판 랭킹 비교 보류 — 모듈·아이템·조회 범위 또는 랭킹 기준일({rankingDate})과의 일치를 확인하지 못했습니다.</div>}
    {showRows && evidence.modules.length > 0 && <div aria-label="독립 조회 추천 모듈">
      {evidence.modules.map(m => <div key={m.id}>{m.position + 1}. {m.title} · {m.itemsCount ?? '—'}개 상품</div>)}
    </div>}
    {showRows && evidence.topBrands.length > 0 && <div aria-label="독립 조회 추천 아이템 브랜드">
      {evidence.topBrands.map(b => <div key={b.brandName}>{b.brandName} · 관찰 {b.count}행</div>)}
    </div>}
  </div>;
}
