'use client';
import { useEffect, useMemo } from 'react';
import RankingDailyInsights, { useRankingDailyInsights } from '@/components/ranking/RankingDailyInsights';
import { useRankingDailySession } from '@/components/ranking/RankingDailyProvider';
import { staffDailyPlanningScope } from '@/lib/staff-daily-planning';

/** Keep the subscriber above the responsive branch; tab exit invalidates its receipt. */
export function useStaffDailyPlanningCheck(date: string, today: string, active: boolean) {
  const scope = useMemo(() => active ? staffDailyPlanningScope(date, today) : null, [date, today, active]);
  const load = useRankingDailyInsights(scope);
  const session = useRankingDailySession();
  useEffect(() => { if (!scope) session?.clearScope(); }, [scope, session]);
  return { scope, load };
}

export default function StaffDailyPlanningCheck({ state, compact }: {
  state: ReturnType<typeof useStaffDailyPlanningCheck>; compact: boolean;
}) {
  if (!state.scope) return null;
  return <div>
    <p className="dim" style={{ fontSize: 11, lineHeight: 1.6, margin: '0 0 8px' }}>
      브리핑 전일의 저장 관측 · 무신사 전체 카테고리 · 전체 성별 · 전체 연령.
      AI 브리핑 생성 여부와 별개로 확인할 자료이며, 판매량·수요 증가나 순위 상승 원인의 증거가 아닙니다.
    </p>
    <RankingDailyInsights scope={state.scope} load={state.load} compact={compact} heading="오늘 영업기획 확인" />
  </div>;
}
