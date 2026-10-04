'use client';
import React from 'react';
import Link from 'next/link';
import { CATEGORY_MAP, AGE_MAP } from '@/lib/queries';
import { kstDaysAgo } from '@/lib/format';
import { rankingContextToSearchParams, type RankingSourceContext } from '@/lib/notes/ranking-context';
import { compareDailyRanking, dailyRequest, pinDailyContext, dailyEvidenceContext, displayDiscountDirection, DAILY_RANK_LIMIT, type DailyData, type DailyRiser } from '@/lib/ranking-daily-insights';
import { fetchRankingDaily } from '@/lib/queries-ranking-daily';
import { useRankingDailySession } from './RankingDailyProvider';
import { EMPTY_DAILY_SESSION, dailySessionKey } from '@/lib/ranking-daily-session';

export interface DailyLoad { key: string; loading: boolean; data: DailyData | null; error: boolean; refresh?: () => void }
const subscribeEmpty = () => () => {};
const getEmptySession = () => EMPTY_DAILY_SESSION;

/** The authenticated shell provider owns shared reads; isolated mounts remain cancellable. */
export function useRankingDailyInsights(scope: RankingSourceContext | null): DailyLoad | null {
  const session = useRankingDailySession();
  const shared = React.useSyncExternalStore(session?.subscribe ?? subscribeEmpty,
    session?.getSnapshot ?? getEmptySession, session?.getServerSnapshot ?? getEmptySession);
  const parsed = dailyRequest(scope);
  const category = parsed?.categoryCode, gender = parsed?.genderFilter, age = parsed?.ageFilter, date = parsed?.date;
  const supported = !!parsed;
  const unsupported = scope !== null && !supported;
  const request = React.useMemo(() => supported ? { categoryCode: category!, genderFilter: gender!, ageFilter: age!, ...(date ? { date } : {}) } : null,
    [supported, category, gender, age, date]);
  const key = request ? JSON.stringify(request) : '';
  const [state, setState] = React.useState<DailyLoad>({ key: '', loading: true, data: null, error: false });
  const [refreshIndex, setRefreshIndex] = React.useState(0);
  const refresh = React.useCallback(() => {
    if (!request) return;
    if (session) session.acquire(request, true);
    else setRefreshIndex(value => value + 1);
  }, [session, request]);
  React.useEffect(() => {
    if (session) {
      if (request) session.acquire(request);
      else if (unsupported) session.clearScope();
      return; // Subscriber remounts do not cancel the provider-owned read.
    }
    if (!request) return;
    const controller = new AbortController();
    let obsolete = false;
    const requestKey = JSON.stringify(request);
    setState({ key: requestKey, loading: true, data: null, error: false });
    fetchRankingDaily(request, controller.signal).then(data => {
      if (!obsolete && !controller.signal.aborted) setState({ key: requestKey, loading: false, data, error: false });
    }).catch(() => {
      if (!obsolete && !controller.signal.aborted) setState({ key: requestKey, loading: false, data: null, error: true });
    });
    return () => { obsolete = true; controller.abort(); };
  }, [request, session, shared.active, shared.ready, shared.epoch, refreshIndex, unsupported]);
  if (!request) return null;
  if (session) {
    if (shared.entry?.key === dailySessionKey(request)) return { ...shared.entry, refresh };
    return { key, loading: !shared.ready || shared.hasAccount, data: null, error: shared.ready && !shared.hasAccount, refresh };
  }
  return state.key === key ? { ...state, refresh } : { key, loading: true, data: null, error: false, refresh };
}

const number = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });
const price = (value: number | null) => value === null ? '미확인' : `${number.format(value)}원`;
const discount = (value: number | null) => value === null ? '미확인' : `${number.format(value)}%`;

const salesCheck = {
  increased: '표시 할인율 상승 · 가격과 행사 기간·적용 조건을 확인하세요.',
  unchanged: '표시 할인율 같음 · 상품 노출·품절 상태와 카테고리 조건을 확인하세요.',
  decreased: '표시 할인율 하락 · 가격과 행사 종료·적용 조건을 확인하세요.',
  unknown: '표시 할인율 비교 불가 · 양일의 가격·할인 자료를 확인하세요.',
};

function SalesPlanningCheck({ item }: { item: DailyRiser }) {
  const direction = displayDiscountDirection(item);
  return <p data-discount-direction={direction} style={{ fontSize: 11, lineHeight: 1.6, margin: '8px 0 0', color: 'var(--f2)' }}>
    <strong>영업기획 확인 포인트</strong> · {salesCheck[direction]}
    {item.discountPoints === 0 && (direction === 'increased' || direction === 'decreased') &&
      ' 원자료의 작은 차이가 표시 반올림으로 같게 보일 수 있습니다.'}
  </p>;
}

export default function RankingDailyInsights({ scope, load, compact }: {
  scope: RankingSourceContext | null; load: DailyLoad | null; compact: boolean;
}) {
  const data = load?.data;
  const comparison = React.useMemo(() => data ? compareDailyRanking(data, scope) : null, [data, scope]);
  const pinned = data?.date && scope ? pinDailyContext(scope, data.date) : null;
  const replayHref = pinned ? `/ranking?${rankingContextToSearchParams(pinned).toString()}` : null;
  const evidenceContext = React.useMemo(() => data && scope && !load?.loading && !load?.error ? dailyEvidenceContext(data, scope) : null,
    [data, scope, load?.loading, load?.error]);
  const evidenceQuery = evidenceContext ? rankingContextToSearchParams(evidenceContext) : null;
  evidenceQuery?.set('notes', 'open');
  const evidenceNoteHref = evidenceQuery ? `/ranking?${evidenceQuery.toString()}` : null;
  const today = data?.date ? kstDaysAgo(0) : null;
  const partial = comparison?.status === 'partial';
  let message = '';
  if (!load) message = '일별 비교는 최근 수집일 또는 하루 지정 조건에서만 제공합니다.';
  else if (load.error) message = '조회에 실패했습니다. 자료 없음과는 다릅니다. 조건을 다시 선택하거나 새로고침해 주세요.';
  else if (comparison?.status === 'capped') message = '조회 상한에 도달해 비교를 보류했습니다. 전체 상승 상위로 해석할 수 없습니다.';
  else if (comparison?.status === 'missing-current') message = '선택한 구간·날짜의 관측이 없습니다.';
  else if (comparison?.status === 'missing-previous') message = '직전 달력 날짜의 관측이 없어 비교할 수 없습니다. 더 오래된 날짜로 대체하지 않습니다.';
  else if (comparison && !comparison.risers.length) message = partial ? '일부 자료를 비교할 수 없습니다. 확인 가능한 일치 상품에서 상승을 찾지 못했습니다.' : '두 날짜에서 일치하는 관측 상품 중 순위 상승이 없습니다.';

  return (
    <section className="panel" aria-labelledby="ranking-daily-title" style={{ padding: compact ? 12 : 16, marginBottom: 14 }}>
      <div className="sec-head" style={{ flexWrap: 'wrap', gap: 8, padding: 0, marginBottom: 10 }}>
        <h3 id="ranking-daily-title" style={{ margin: 0 }}>{scope && dailyRequest(scope)?.date ? '지정 수집일 순위·할인 변화' : '최근 수집일 순위·할인 변화'}</h3>
        <div className="row-flex gap-6" style={{ flexWrap: 'wrap' }}>
          {load?.refresh && <button type="button" className="btn sm" onClick={load.refresh}>다시 조회</button>}
          {replayHref && <Link href={replayHref} className="btn sm">조건·날짜 다시보기</Link>}
          {evidenceNoteHref && <Link href={evidenceNoteHref} className="btn sm">이 관측 메모</Link>}
        </div>
      </div>
      {scope && <p className="dim" style={{ fontSize: 11, margin: '0 0 8px' }}>
        Musinsa · {CATEGORY_MAP[scope.selectedCategory] || scope.selectedCategory} · {scope.gender === 'A' ? '전체 성별' : scope.gender === 'M' ? '남성' : '여성'} · {AGE_MAP[scope.age] || scope.age} · 순위 1–{DAILY_RANK_LIMIT} 관측 범위
      </p>}
      {data?.date && <p className="mono dim" style={{ fontSize: 11, margin: '0 0 8px' }}>
        조회 기준 {data.date} · 비교 기준 {data.previousDate} · {today && data.date < today ? `현재 ${today}보다 이전 날짜` : today && data.date > today ? '현재 날짜 이후: 확인 필요' : '실시간 자료가 아님'}
      </p>}
      {load?.loading ? <p role="status" aria-live="polite" className="dim" style={{ fontSize: 12 }}>두 날짜의 같은 구간 관측을 조회하는 중…</p>
        : message ? <p role={load?.error ? 'alert' : undefined} className="dim" style={{ fontSize: 12, margin: '8px 0' }}>{message}</p> : null}
      {comparison && comparison.status !== 'capped' && (comparison.status === 'ready' || partial) && <>
        <p className="dim" style={{ fontSize: 11, margin: '8px 0' }}>
          일치 {comparison.matched}개 · 전일 관측 없음 {comparison.missingPrevious}개 (상승 후보 제외)
          {partial && ` · 판별 불가/중복 ${comparison.invalidRows + comparison.ambiguousRows}행 · 전일 판별 불가 ${comparison.ambiguousPairs}개 · 필터 확인 불가 ${comparison.unknownFilterRows}개 · 가격/할인 미확인 ${comparison.unknownMetrics}개`}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: compact ? 'minmax(0, 1fr)' : 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8 }}>
          {comparison.risers.map(item => <article key={item.current.product} style={{ background: 'var(--snk)', border: '0.5px solid var(--bs)', borderRadius: 6, padding: 12, minWidth: 0 }}>
            <div className="row-flex gap-6" style={{ justifyContent: 'space-between', alignItems: 'start' }}>
              <Link href={`/product?no=${encodeURIComponent(item.current.product)}`} style={{ fontSize: 12, fontWeight: 500, overflowWrap: 'anywhere' }}>{item.current.name}</Link>
              <span className="mono" style={{ color: 'var(--tu)', fontSize: 12, flexShrink: 0 }}>↑{item.rise}</span>
            </div>
            {item.current.brand && <p className="dim" style={{ fontSize: 10, margin: '4px 0' }}>{item.current.brand}</p>}
            <dl style={{ fontSize: 11, margin: '8px 0 0', lineHeight: 1.8 }}>
              <div><dt style={{ display: 'inline', color: 'var(--f3)' }}>순위 </dt><dd className="mono" style={{ display: 'inline', margin: 0 }}>{item.previous.rank} → {item.current.rank}</dd></div>
              <div><dt style={{ display: 'inline', color: 'var(--f3)' }}>표시 가격 </dt><dd className="mono" style={{ display: 'inline', margin: 0 }}>{price(item.previous.price)} → {price(item.current.price)}</dd></div>
              <div><dt style={{ display: 'inline', color: 'var(--f3)' }}>할인율 </dt><dd className="mono" style={{ display: 'inline', margin: 0 }}>{discount(item.previous.discount)} → {discount(item.current.discount)}</dd></div>
              <div className="dim">할인율 차이 {item.discountPoints === null ? '미확인' : `${item.discountPoints > 0 ? '+' : ''}${number.format(item.discountPoints)}%p`}</div>
            </dl>
            <SalesPlanningCheck item={item} />
          </article>)}
        </div>
      </>}
      <p className="dim" style={{ fontSize: 10, lineHeight: 1.6, margin: '10px 0 0' }}>
        확인 가능한 일치 관측의 상승 최대 5개입니다. 할인율 차이는 퍼센트포인트(%p)이며, 매출이나 원인을 뜻하지 않습니다.
        전체 수집 완료 여부는 확인되지 않습니다. 링크는 저장된 날짜·조건의 관측을 다시 조회하며 고정된 증빙이 아닙니다.
        이 관측 메모는 위 조회 기준 날짜를 고정합니다. 일반 표 메모는 표의 조회 기준을 사용합니다.
      </p>
    </section>
  );
}
